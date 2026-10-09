/**
 * Market context for the AI features: the weekly report, the weekly
 * analysis, the daily brief and the assistant chat.
 *
 * It gathers exposure after look-through (exposure.ts), dividend income and
 * upcoming events (income.ts), the macro snapshot (intel/macro.ts), the
 * benchmark comparison (intel/benchmark.ts), company intel and cached
 * earnings call summaries (intel/company.ts), and turns them into compact
 * prompt text. Every piece goes through the provider chain, so each one may
 * be null without an FMP key. A section without data is left out.
 *
 * Every fetch has a time limit, so a slow provider never blocks a reply.
 * The text carries percentages, dates and public company data only, never
 * money amounts, quantities or balances. Logs never name a symbol
 * (AGENTS.md rule 3).
 */
import type { DataProviderId } from "portfolio-shared/config-types";
import type {
  BenchmarkComparison,
  MacroSnapshot,
  PortfolioEvent,
  PortfolioEventsResponse,
  PortfolioIncomeSummary,
  YieldCurveSnapshot,
} from "portfolio-shared/api-types";
import type { CompanyIntel, CompanyIntelPart, TranscriptSummary } from "portfolio-shared/company-intel";
import type { PortfolioHolding } from "portfolio-shared/portfolio";
import { appLogger } from "../logger.js";
import type { FmpService } from "./fmp.js";
import type { FinnhubService } from "./finnhub.js";
import type { YahooFinanceService } from "./yahoo-finance.js";
import type { MarketDataCoordinator, MarketNewsItem } from "./market-data.js";
import type { PortfolioService } from "./portfolio.js";
import { describeIncomeForAssistant, type IncomeService } from "./income.js";
import { formatExposureForPrompt, getPortfolioExposureSummary, type PortfolioExposureSummary } from "./exposure.js";
import { getMacroSnapshot } from "./intel/macro.js";
import { getBenchmarkComparison } from "./intel/benchmark.js";
import { formatCompanyIntelListForPrompt, getCachedTranscriptSummary, getCompanyIntelBatch, isIntelEligible } from "./intel/company.js";

/** The services the AI context needs. `AppServices` (container.ts) satisfies it. */
export interface AiContextDeps {
  fmp: FmpService;
  finnhub: FinnhubService;
  yahoo: YahooFinanceService;
  marketData: MarketDataCoordinator;
  portfolioService: PortfolioService;
  income: IncomeService;
}

// ── budgets ─────────────────────────────────────────────────────────────────

/** Company parts for a portfolio-wide prompt. Each is one to five provider calls per symbol on a cold cache. */
export const REPORT_INTEL_PARTS: readonly CompanyIntelPart[] = ["profile", "analyst", "scores", "metrics", "news"];
/** Largest holdings that get company intel: with FMP, and with Finnhub alone (free tier, about 4 calls per stock). */
export const REPORT_INTEL_SYMBOLS = { fmp: 12, finnhub: 6 } as const;
/** Largest stocks checked for a cached earnings call summary (FMP only, one cached call each). */
export const REPORT_TRANSCRIPT_SYMBOLS = 5;
/** Character budgets of the report sections. */
export const REPORT_BUDGET = {
  companies: 7_000,
  companyBlock: 900,
  transcripts: 3,
  transcriptChars: 700,
  marketNews: 5,
  newsSummaryChars: 200,
  events: 15,
  incomeHoldings: 8,
  macroEvents: 6,
} as const;
/** Time limits per piece. Company intel gets more: a cold batch waits on the throttles. */
const REPORT_TIMEOUT_MS = 30_000;
const REPORT_COMPANY_TIMEOUT_MS = 60_000;
/** The chat rebuilds its context every turn; a slow piece is left out. */
const CHAT_TIMEOUT_MS = 8_000;

// ── helpers ─────────────────────────────────────────────────────────────────

/** Runs `fn` within `ms`; a throw or a timeout gives null and a warning without details. */
export async function settleWithin<T>(step: string, ms: number, fn: () => Promise<T | null>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          appLogger.logStep("warning", "ai_context", step, `AI context ${step} timed out after ${ms} ms`);
          resolve(null);
        }, ms);
      }),
    ]);
  } catch (err) {
    appLogger.logStep("warning", "ai_context", step, `AI context ${step} failed (${err instanceof Error ? err.name : typeof err})`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const signed = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
const signedPct = (value: number) => `${signed(value)}%`;

function cut(text: string | undefined, max: number): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t;
}

function addSource(list: DataProviderId[], source: DataProviderId | null | undefined): void {
  if (source && !list.includes(source)) list.push(source);
}

/** Non-cash holdings, largest weight first. */
function byWeight(holdings: readonly PortfolioHolding[]): PortfolioHolding[] {
  return holdings.filter((h) => h.assetType !== "Cash" && h.shares > 0).sort((a, b) => b.weightPercent - a.weightPercent);
}

// ── macro ───────────────────────────────────────────────────────────────────

export interface MacroFormatOptions {
  /** High-impact releases to list. Default 6; 0 leaves them out. */
  maxEvents?: number;
  /** Include the sector moves of the last session. Default true. */
  sectors?: boolean;
  /** One line per piece instead of the full section. Default false. */
  compact?: boolean;
}

/** Change of one yield maturity over about a week, from the weekly history. Percentage points. */
export function weeklyYieldChange(history: YieldCurveSnapshot["history"], key: "month3" | "year2" | "year10" | "year30"): number | undefined {
  const rows = history.filter((r) => typeof r[key] === "number");
  const last = rows[rows.length - 1];
  if (!last) return undefined;
  const limit = new Date(`${last.date}T00:00:00Z`).getTime() - 6 * 24 * 60 * 60 * 1000;
  const before = [...rows].reverse().find((r) => new Date(`${r.date}T00:00:00Z`).getTime() <= limit);
  if (!before) return undefined;
  return Math.round(((last[key] as number) - (before[key] as number)) * 100) / 100;
}

function formatEconomicEvents(m: MacroSnapshot, max: number): string {
  const events = m.calendar?.events ?? [];
  if (max <= 0 || events.length === 0) return "";
  const high = events.filter((e) => e.impact === "High");
  const picked = (high.length > 0 ? high : events).slice(0, max);
  const items = picked.map((e) => {
    const extra = [e.estimate !== null && e.estimate !== undefined ? `estimate ${e.estimate}` : "", e.previous !== null && e.previous !== undefined ? `previous ${e.previous}` : ""]
      .filter(Boolean)
      .join(", ");
    return `${e.date.slice(0, 16)} UTC ${e.currency} ${e.event}${extra ? ` (${extra})` : ""}`;
  });
  return `${high.length > 0 ? "Next high-impact releases" : "Next releases"} [${m.calendar!.source}]: ${items.join("; ")}`;
}

/** The macro snapshot as prompt lines. Empty when no piece has data. */
export function formatMacroForPrompt(m: MacroSnapshot | null, options: MacroFormatOptions = {}): string {
  if (!m) return "";
  const lines: string[] = [];
  const curve = m.yieldCurve;
  if (curve && curve.points.length > 0) {
    const pick = (tenor: string) => curve.points.find((p) => p.tenor === tenor);
    const keys = ["month3", "year2", "year10", "year30"].map(pick).filter((p): p is NonNullable<typeof p> => Boolean(p));
    const shown = (keys.length > 0 ? keys : curve.points.slice(0, 4)).map((p) => `${p.label} ${p.yield.toFixed(2)}%`).join(", ");
    const y2 = pick("year2");
    const y10 = pick("year10");
    const spread = y2 && y10 ? `; 10Y minus 2Y ${signed(y10.yield - y2.yield)} pts${y10.yield < y2.yield ? " (inverted)" : ""}` : "";
    let change = "";
    if (!options.compact) {
      const moves = (["year2", "year10"] as const)
        .map((k) => ({ k, v: weeklyYieldChange(curve.history, k) }))
        .filter((x): x is { k: "year2" | "year10"; v: number } => x.v !== undefined)
        .map((x) => `${x.k === "year2" ? "2Y" : "10Y"} ${signed(x.v)} pts`);
      if (moves.length) change = `. Change over the last week: ${moves.join(", ")}`;
    }
    lines.push(`US Treasury yields on ${curve.date} [${curve.source}]: ${shown}${spread}${change}.`);
  }

  const indicators = m.indicators?.items ?? [];
  if (indicators.length > 0) {
    const wanted = options.compact ? indicators.filter((i) => i.id === "inflationRate" || i.id === "federalFunds" || i.id === "unemploymentRate") : indicators;
    const fmt = (v: number, unit: string) => (unit === "%" ? `${v}%` : `${v} ${unit}`);
    const items = wanted.map((i) => `${i.name} ${fmt(i.value, i.unit)} (${i.date}${i.previous !== undefined ? `, previous ${fmt(i.previous, i.unit)}` : ""})`);
    if (items.length) lines.push(`US indicators [${m.indicators!.source}]: ${items.join("; ")}.`);
  }

  const events = formatEconomicEvents(m, options.maxEvents ?? (options.compact ? 3 : REPORT_BUDGET.macroEvents));
  if (events) lines.push(`${events}.`);

  if (options.sectors !== false && !options.compact && m.sectors && m.sectors.items.length >= 2) {
    const items = m.sectors.items;
    const fmt = (s: (typeof items)[number]) => `${s.sector} ${signedPct(s.changePercent)}${s.pe !== undefined ? ` (P/E ${s.pe})` : ""}`;
    const best = items.slice(0, 3).map(fmt).join(", ");
    const worst = items.slice(-3).reverse().map(fmt).join(", ");
    lines.push(`Sector moves on ${m.sectors.date} [${m.sectors.source}]: best ${best}; worst ${worst}.`);
  }

  if (lines.length === 0) return "";
  if (m.riskFreeRate.source !== "default" && !options.compact) lines.push(`Risk-free rate (3-month T-bill): ${(m.riskFreeRate.rate * 100).toFixed(2)}%.`);
  return lines.map((l) => `- ${l}`).join("\n");
}

// ── benchmark ───────────────────────────────────────────────────────────────

export interface PeriodComparison {
  from: string;
  to: string;
  portfolioReturnPercent: number;
  benchmarkReturnPercent: number;
  excessReturnPercent: number;
}

/**
 * Portfolio and benchmark return between the last close before `from` and
 * the last close on or before `to`, from the cumulative series of a longer
 * comparison. Null when the series does not cover the window.
 */
export function comparisonForWindow(c: BenchmarkComparison, from: string, to: string): PeriodComparison | null {
  const base = [...c.series].reverse().find((p) => p.date < from);
  const end = [...c.series].reverse().find((p) => p.date <= to);
  if (!base || !end || end.date <= base.date) return null;
  const rebase = (a: number, b: number) => ((1 + b / 100) / (1 + a / 100) - 1) * 100;
  const portfolio = rebase(base.portfolio, end.portfolio);
  const benchmark = rebase(base.benchmark, end.benchmark);
  const round = (v: number) => Math.round(v * 100) / 100;
  return { from: base.date, to: end.date, portfolioReturnPercent: round(portfolio), benchmarkReturnPercent: round(benchmark), excessReturnPercent: round(portfolio - benchmark) };
}

function comparisonLine(label: string, c: Pick<PeriodComparison, "from" | "to" | "portfolioReturnPercent" | "benchmarkReturnPercent" | "excessReturnPercent">): string {
  return `${label} (${c.from} to ${c.to}): portfolio ${signedPct(c.portfolioReturnPercent)}, benchmark ${signedPct(c.benchmarkReturnPercent)}, difference ${signed(c.excessReturnPercent)} pts.`;
}

/** The comparison as prompt lines, with the given week first when the series covers it. Empty without data. */
export function formatBenchmarkForPrompt(c: BenchmarkComparison | null, week?: { from: string; to: string }): string {
  if (!c) return "";
  const lines = [`- Benchmark: ${c.label} (${c.symbol})${c.source ? ` [${c.source}]` : ""}. Time-weighted return of the invested holdings.`];
  const w = week ? comparisonForWindow(c, week.from, week.to) : null;
  if (w) lines.push(`- ${comparisonLine("Week", w)}`);
  lines.push(`- ${comparisonLine(`Range ${c.range}`, c)}`);
  return lines.join("\n");
}

// ── income and events ───────────────────────────────────────────────────────

const EVENT_TEXT: Record<PortfolioEvent["kind"], string> = {
  exDividend: "ex-dividend date",
  dividendPayment: "dividend payment",
  earnings: "earnings report",
  split: "stock split",
};

/** Upcoming events as prompt lines, without money amounts beyond the public per-share dividend. Empty when none match. */
export function formatEventsForPrompt(
  res: PortfolioEventsResponse | null,
  options: { kinds?: readonly PortfolioEvent["kind"][]; maxLines?: number; from?: string; to?: string } = {},
): string {
  if (!res) return "";
  const kinds: readonly PortfolioEvent["kind"][] = options.kinds ?? ["exDividend", "earnings", "split"];
  const events = res.events.filter((e) => kinds.includes(e.kind) && (!options.from || e.date >= options.from) && (!options.to || e.date <= options.to));
  if (events.length === 0) return "";
  const max = options.maxLines ?? REPORT_BUDGET.events;
  const lines = events.slice(0, max).map((e) => {
    let detail = "";
    if ((e.kind === "exDividend" || e.kind === "dividendPayment") && e.amountPerShare !== undefined) detail = `, ${e.amountPerShare} ${e.currency ?? ""} per share`.trimEnd();
    if (e.kind === "earnings") {
      const when = e.time === "bmo" ? "before the open" : e.time === "amc" ? "after the close" : "";
      detail = [when, typeof e.epsEstimate === "number" ? `EPS estimate ${e.epsEstimate}` : ""].filter(Boolean).join(", ");
      detail = detail ? `, ${detail}` : "";
    }
    if (e.kind === "split") detail = `, ${e.numerator}-for-${e.denominator}`;
    return `- ${e.date} ${e.symbol}: ${EVENT_TEXT[e.kind]}${detail}${e.estimated ? " (estimated from the past pattern)" : ""}`;
  });
  if (events.length > max) lines.push(`- ${events.length - max} more events not listed.`);
  return lines.join("\n");
}

/** Yields and dividend dates for the prompt, capped to the largest payers. Empty when there is no dividend data. */
export function formatIncomeForPrompt(summary: PortfolioIncomeSummary | null, maxHoldings: number = REPORT_BUDGET.incomeHoldings): string {
  if (!summary) return "";
  if (summary.holdings.length === 0 && summary.splitWarnings.length === 0 && summary.yieldOnCostPercent === undefined && summary.currentYieldPercent === undefined) return "";
  const text = describeIncomeForAssistant({ ...summary, holdings: summary.holdings.slice(0, maxHoldings) });
  const more = summary.holdings.length - maxHoldings;
  return more > 0 ? `${text}\n- ${more} more dividend payers not listed.` : text;
}

// ── exposure ────────────────────────────────────────────────────────────────

/** A short exposure block for the chat: top sectors, countries, underlying stocks and the warnings. */
export function formatExposureCompact(s: PortfolioExposureSummary | null): string {
  if (!s) return "";
  const list = (rows: { name: string; percent: number }[], n: number) => rows.slice(0, n).map((r) => `${r.name} ${r.percent.toFixed(1)}%`).join(", ");
  const lines: string[] = [];
  if (s.sectors.length) lines.push(`- Sectors: ${list(s.sectors, 4)}${s.unknownSectorPercent > 0 ? `; unknown ${s.unknownSectorPercent.toFixed(1)}%` : ""}.`);
  if (s.countries.length) lines.push(`- Countries: ${list(s.countries, 4)}.`);
  if (s.topStocks.length) lines.push(`- Largest underlying stocks: ${s.topStocks.slice(0, 5).map((t) => `${t.symbol} ${t.percent.toFixed(1)}%`).join(", ")}.`);
  if (s.warnings.length) lines.push(`- Warnings: ${s.warnings.slice(0, 4).join(" ")}`);
  if (lines.length === 0) return "";
  return [`- Coverage: ${s.coverage.lookedThroughPercent.toFixed(1)}% looked through in funds, ${s.coverage.unknownPercent.toFixed(1)}% unknown.`, ...lines].join("\n");
}

// ── report ──────────────────────────────────────────────────────────────────

/** Everything the weekly report adds to the ledger. Every piece may be null or empty. */
export interface ReportIntel {
  marketNews: { items: MarketNewsItem[]; source: DataProviderId } | null;
  macro: MacroSnapshot | null;
  benchmark: BenchmarkComparison | null;
  exposure: PortfolioExposureSummary | null;
  income: PortfolioIncomeSummary | null;
  events: PortfolioEventsResponse | null;
  companies: CompanyIntel[];
  transcripts: TranscriptSummary[];
}

export const EMPTY_REPORT_INTEL: ReportIntel = {
  marketNews: null,
  macro: null,
  benchmark: null,
  exposure: null,
  income: null,
  events: null,
  companies: [],
  transcripts: [],
};

export interface ReportIntelRequest {
  portfolioId: string;
  holdings: readonly PortfolioHolding[];
  baseCurrency: string;
  /**
   * False for a past week: market news, macro, upcoming events and earnings
   * call summaries describe today, not that week, so they are left out.
   */
  current: boolean;
}

/** Collects the report context. Pieces run in parallel, each within its time limit. */
export async function collectReportIntel(deps: AiContextDeps, req: ReportIntelRequest): Promise<ReportIntel> {
  const ranked = byWeight(req.holdings).filter((h) => isIntelEligible(h.symbol, h.assetType, h.isPrivate));
  const fmpOn = deps.fmp.isConfigured();
  const cap = fmpOn ? REPORT_INTEL_SYMBOLS.fmp : deps.finnhub.isConfigured() ? REPORT_INTEL_SYMBOLS.finnhub : 0;
  const companyItems = ranked.slice(0, cap).map((h) => ({ symbol: h.symbol, assetType: h.assetType, isPrivate: h.isPrivate }));
  const transcriptSymbols = fmpOn && req.current ? ranked.filter((h) => h.assetType === "Stock").slice(0, REPORT_TRANSCRIPT_SYMBOLS).map((h) => h.symbol) : [];

  const [marketNews, macro, benchmark, exposure, income, events, companies, transcripts] = await Promise.all([
    req.current
      ? settleWithin("market_news", REPORT_TIMEOUT_MS, async () => {
          const res = await deps.marketData.getMarketNewsWithSource(REPORT_BUDGET.marketNews);
          return res.data && res.data.length > 0 && res.source ? { items: res.data, source: res.source } : null;
        })
      : null,
    req.current ? settleWithin("macro", REPORT_TIMEOUT_MS, () => getMacroSnapshot(deps, { baseCurrency: req.baseCurrency })) : null,
    settleWithin("benchmark", REPORT_TIMEOUT_MS, () => getBenchmarkComparison(deps, req.portfolioId, "1y")),
    settleWithin("exposure", REPORT_TIMEOUT_MS, () => getPortfolioExposureSummary(req.portfolioId)),
    settleWithin("income", REPORT_TIMEOUT_MS, () => deps.income.getIncomeSummary(req.portfolioId)),
    req.current ? settleWithin("events", REPORT_TIMEOUT_MS, () => deps.income.getUpcomingEvents(req.portfolioId, 7)) : null,
    companyItems.length > 0
      ? settleWithin("company_intel", REPORT_COMPANY_TIMEOUT_MS, async () => {
          const map = await getCompanyIntelBatch(deps, companyItems, { include: REPORT_INTEL_PARTS, concurrency: 3 });
          // Keep the weight order of the holdings.
          return companyItems.map((i) => map.get(i.symbol.trim().toUpperCase())).filter((x): x is CompanyIntel => Boolean(x));
        })
      : null,
    transcriptSymbols.length > 0
      ? settleWithin("transcripts", REPORT_TIMEOUT_MS, async () => {
          // Cached summaries only: a report never starts a new transcript summary.
          const found = await Promise.all(transcriptSymbols.map((s) => getCachedTranscriptSummary(deps, s).catch(() => null)));
          return found.filter((t): t is TranscriptSummary => Boolean(t?.summary));
        })
      : null,
  ]);

  return {
    marketNews,
    macro,
    benchmark,
    exposure,
    income,
    events,
    companies: companies ?? [],
    transcripts: transcripts ?? [],
  };
}

/** True when a company block holds more than its header line. */
function hasCompanyData(intel: CompanyIntel): boolean {
  return Boolean(intel.profile || intel.analyst || intel.scores || intel.metrics || intel.news || intel.estimates || intel.dcf);
}

export interface ReportIntelSections {
  /** Markdown sections for the user prompt, "" when there is nothing. */
  text: string;
  /** Titles of the sections that made it in. */
  sections: string[];
  /** Providers behind the data, in first-seen order. */
  sources: DataProviderId[];
  /** Market and company headlines in the prompt. */
  newsCount: number;
}

/** The report sections, each left out when it has no data. */
export function buildReportIntelSections(intel: ReportIntel, week: { from: string; to: string }): ReportIntelSections {
  const out: { title: string; body: string }[] = [];
  const sources: DataProviderId[] = [];
  let newsCount = 0;

  if (intel.marketNews && intel.marketNews.items.length > 0) {
    const items = intel.marketNews.items.slice(0, REPORT_BUDGET.marketNews);
    newsCount += items.length;
    addSource(sources, intel.marketNews.source);
    out.push({
      title: `Financial Market & Macroeconomic News [${intel.marketNews.source}]`,
      body: items.map((n) => `- **${cut(n.headline, 160)}** (${n.source})${n.summary ? `: ${cut(n.summary, REPORT_BUDGET.newsSummaryChars)}` : ""}`).join("\n"),
    });
  }

  const macro = formatMacroForPrompt(intel.macro);
  if (macro) {
    for (const s of [intel.macro?.yieldCurve?.source, intel.macro?.indicators?.source, intel.macro?.calendar?.source, intel.macro?.sectors?.source]) addSource(sources, s);
    out.push({ title: "Macro Snapshot", body: macro });
  }

  const benchmark = formatBenchmarkForPrompt(intel.benchmark, week);
  if (benchmark) {
    addSource(sources, intel.benchmark?.source);
    out.push({ title: "Benchmark Comparison", body: benchmark });
  }

  if (intel.exposure && (intel.exposure.sectors.length > 0 || intel.exposure.countries.length > 0)) {
    for (const s of intel.exposure.sources) addSource(sources, s);
    out.push({ title: "Exposure After ETF Look-Through", body: formatExposureForPrompt(intel.exposure) });
  }

  const income = formatIncomeForPrompt(intel.income);
  const events = formatEventsForPrompt(intel.events, { kinds: ["exDividend", "dividendPayment", "earnings", "split"] });
  if (income || events) {
    for (const s of [...(intel.income?.sources ?? []), ...(intel.events?.sources ?? [])]) addSource(sources, s);
    const body = [income, events ? `Upcoming events of the next 7 days (${intel.events!.from} to ${intel.events!.to}):\n${events}` : ""].filter(Boolean).join("\n\n");
    out.push({ title: "Income & Upcoming Events", body });
  }

  const companies = intel.companies.filter(hasCompanyData);
  if (companies.length > 0) {
    const body = formatCompanyIntelListForPrompt(companies, { totalChars: REPORT_BUDGET.companies, maxChars: REPORT_BUDGET.companyBlock, maxNews: 2, maxGrades: 2 });
    if (body) {
      for (const c of companies) {
        for (const part of [c.profile, c.analyst, c.scores, c.metrics, c.news]) addSource(sources, part?.source);
        newsCount += Math.min(2, c.news?.data.length ?? 0);
      }
      out.push({ title: "Key Asset Intelligence & Analyst Consensus (largest holdings by weight)", body: body.replace(/^### /gm, "#### ") });
    }
  }

  if (intel.transcripts.length > 0) {
    const body = intel.transcripts
      .slice(0, REPORT_BUDGET.transcripts)
      .map((t) => `#### ${t.symbol} Q${t.quarter} FY${t.fiscalYear}${t.date ? ` (${t.date})` : ""}\n${cut(t.summary, REPORT_BUDGET.transcriptChars)}`)
      .join("\n\n");
    addSource(sources, "fmp");
    out.push({ title: "Earnings Call Summaries (cached)", body });
  }

  if (out.length === 0) return { text: "", sections: [], sources, newsCount };
  const text = `\n## Real-Time Market Intelligence\nEach line names its data provider in brackets. Use only this data; do not invent figures.\n\n${out.map((s) => `### ${s.title}\n${s.body}`).join("\n\n")}\n`;
  return { text, sections: out.map((s) => s.title), sources, newsCount };
}

// ── weekly analysis ─────────────────────────────────────────────────────────

export interface WeeklyFacts {
  /** Short Markdown bullet lines, percent and dates only. */
  lines: string[];
}

/**
 * Facts for the weekly push summary: the week against the benchmark, the
 * events of the next 7 days, yield moves of the week and exposure warnings.
 */
export async function collectWeeklyFacts(deps: AiContextDeps, portfolioId: string, week: { from: string; to: string }, baseCurrency: string): Promise<WeeklyFacts> {
  const [benchmark, events, macro, exposure] = await Promise.all([
    settleWithin("weekly_benchmark", REPORT_TIMEOUT_MS, () => getBenchmarkComparison(deps, portfolioId, "3mo")),
    settleWithin("weekly_events", REPORT_TIMEOUT_MS, () => deps.income.getUpcomingEvents(portfolioId, 7)),
    settleWithin("weekly_macro", REPORT_TIMEOUT_MS, () => getMacroSnapshot(deps, { baseCurrency })),
    settleWithin("weekly_exposure", REPORT_TIMEOUT_MS, () => getPortfolioExposureSummary(portfolioId)),
  ]);
  const lines: string[] = [];
  const w = benchmark ? comparisonForWindow(benchmark, week.from, week.to) : null;
  if (benchmark && w) lines.push(`- Week vs ${benchmark.label}: ${signedPct(w.portfolioReturnPercent)} vs ${signedPct(w.benchmarkReturnPercent)} (${signed(w.excessReturnPercent)} pts)`);
  const curve = macro?.yieldCurve;
  if (curve) {
    const y10 = weeklyYieldChange(curve.history, "year10");
    const now10 = curve.points.find((p) => p.tenor === "year10");
    if (y10 !== undefined && now10) lines.push(`- US 10Y yield ${now10.yield.toFixed(2)}% (${signed(y10)} pts on the week)`);
  }
  const upcoming = (events?.events ?? []).filter((e) => e.kind === "earnings" || e.kind === "exDividend" || e.kind === "split");
  if (upcoming.length > 0) {
    const shown = upcoming.slice(0, 5).map((e) => `${e.symbol} ${EVENT_TEXT[e.kind]} ${e.date.slice(5)}`);
    lines.push(`- Next 7 days: ${shown.join(", ")}${upcoming.length > 5 ? `, ${upcoming.length - 5} more` : ""}`);
  }
  const high = (macro?.calendar?.events ?? []).filter((e) => e.impact === "High").slice(0, 3);
  if (high.length > 0) lines.push(`- Key releases: ${high.map((e) => `${e.currency} ${e.event} ${e.date.slice(5, 10)}`).join(", ")}`);
  for (const warning of (exposure?.warnings ?? []).slice(0, 2)) lines.push(`- Exposure: ${warning}`);
  return { lines };
}

// ── assistant chat ──────────────────────────────────────────────────────────

/**
 * A small market block for the chat system prompt: exposure, events of the
 * next 14 days, a macro headline and the 1-year benchmark line. About 2,000
 * characters at most; empty when nothing is available.
 */
export async function buildAssistantMarketContext(deps: AiContextDeps, portfolioId: string, baseCurrency: string): Promise<string> {
  const [exposure, events, macro, benchmark] = await Promise.all([
    settleWithin("chat_exposure", CHAT_TIMEOUT_MS, () => getPortfolioExposureSummary(portfolioId)),
    settleWithin("chat_events", CHAT_TIMEOUT_MS, () => deps.income.getUpcomingEvents(portfolioId, 14)),
    settleWithin("chat_macro", CHAT_TIMEOUT_MS, () => getMacroSnapshot(deps, { baseCurrency })),
    settleWithin("chat_benchmark", CHAT_TIMEOUT_MS, () => getBenchmarkComparison(deps, portfolioId, "1y")),
  ]);
  const blocks: string[] = [];
  const exp = formatExposureCompact(exposure);
  if (exp) blocks.push(`=== EXPOSURE AFTER ETF LOOK-THROUGH ===\n${exp}`);
  const ev = formatEventsForPrompt(events, { maxLines: 10 });
  if (ev && events) blocks.push(`=== EVENTS OF HELD SYMBOLS, ${events.from} TO ${events.to} ===\n${ev}`);
  const mac = formatMacroForPrompt(macro, { compact: true });
  if (mac) blocks.push(`=== MACRO HEADLINE ===\n${mac}`);
  if (benchmark) blocks.push(`=== BENCHMARK ===\n- ${comparisonLine(`${benchmark.label}, range ${benchmark.range}`, benchmark)}`);
  return blocks.join("\n\n");
}
