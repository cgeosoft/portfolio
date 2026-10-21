/**
 * The tools of the MCP server (mcp-server.ts): what other LLM clients may
 * read about the portfolios.
 *
 * Every answer carries percentages, dates, names and public identifiers
 * only: weights, returns, exposure shares, yields. Never a money amount, a
 * price, a quantity, a cost basis or a balance, nor anything that adds up to
 * one. Each tool builds its answer field by field from the service data, and
 * `assertPercentOnly()` checks the result before it leaves: a number is
 * allowed only under a key that is `percent`, ends in `Percent` or is listed in
 * `ALLOWED_NUMBER_KEYS`. A field added to a domain type therefore never
 * reaches a client by accident.
 */
import type { BenchmarkComparison, PortfolioEvent, PortfolioExposureResponse, PortfolioIncomeSummary } from "portfolio-shared/api-types";
import type { FinancialPortfolioData, PortfolioHolding } from "portfolio-shared/portfolio";
import * as portfolioRepo from "../db/portfolio.repo";
import { getBenchmarkComparison, normalizeBenchmarkRange } from "./intel/benchmark";
import type { AppServices } from "./container";

/** Numbers that are not money: counts, an index from 0 to 100 and day spans. */
const ALLOWED_NUMBER_KEYS = new Set(["rsi", "holdingsCount", "commonHoldings", "days"]);

/** Thrown when an answer would carry a number that is not a percentage. The tool call then fails. */
export class McpPrivacyError extends Error {
  constructor(path: string) {
    super(`Refused to send a non-percentage number (${path})`);
    this.name = "McpPrivacyError";
  }
}

/**
 * Throws `McpPrivacyError` when `value` holds a number under a key that is
 * neither `percent`, a `...Percent` key nor in `ALLOWED_NUMBER_KEYS`, or a number in an
 * array. Strings, booleans and null pass.
 */
export function assertPercentOnly(value: unknown, path = "$", key = ""): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number" || typeof value === "bigint") {
    if (!/^percent$|Percent$/.test(key) && !ALLOWED_NUMBER_KEYS.has(key)) throw new McpPrivacyError(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (typeof item === "number") throw new McpPrivacyError(`${path}[${i}]`);
      assertPercentOnly(item, `${path}[${i}]`, key);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) assertPercentOnly(v, `${path}.${k}`, k);
  }
}

// ── tool definitions ────────────────────────────────────────────────────────

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  annotations: { readOnlyHint: true; openWorldHint: boolean };
}

const PORTFOLIO_ID = {
  type: "string",
  description: "Portfolio id from list_portfolios. May be left out when there is exactly one portfolio.",
};

const PRIVACY_NOTE = "Percentages only: the app never shares money amounts, prices, quantities or balances.";

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "list_portfolios",
    title: "List portfolios",
    description: `The portfolios in the Portfolio app: id, name and base currency. ${PRIVACY_NOTE}`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_portfolio_summary",
    title: "Portfolio summary",
    description: `Returns of a portfolio in percent (today, on cost, since start), allocation by asset type in percent of the portfolio value, and the best and worst holding today. ${PRIVACY_NOTE}`,
    inputSchema: { type: "object", properties: { portfolio_id: PORTFOLIO_ID }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "get_holdings",
    title: "Holdings",
    description: `The holdings of a portfolio, largest first: weight in percent of the portfolio value, return today and on cost in percent, and technical signals (RSI, distance from the 52-week range and the 50 and 200 day averages, in percent). ${PRIVACY_NOTE}`,
    inputSchema: { type: "object", properties: { portfolio_id: PORTFOLIO_ID }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "get_exposure",
    title: "Exposure",
    description: `Exposure of a portfolio after ETF and fund look-through, in percent of the portfolio value: sectors, countries, asset classes, largest underlying stocks, funds, fund overlap and concentration warnings. ${PRIVACY_NOTE}`,
    inputSchema: { type: "object", properties: { portfolio_id: PORTFOLIO_ID }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "get_performance",
    title: "Performance against a benchmark",
    description: `Time-weighted return of a portfolio against a benchmark over a range, in percent, with the cumulative return series. ${PRIVACY_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        portfolio_id: PORTFOLIO_ID,
        range: { type: "string", enum: ["1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "max"], description: "Period. Default 1y." },
        benchmark: { type: "string", description: "Benchmark symbol, such as ^GSPC or VWCE.DE. Default: the benchmark in the app settings." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "get_dividend_yield",
    title: "Dividend yield",
    description: `Forward dividend yield of a portfolio and of each dividend holding, on cost and on current value, in percent, with the next ex-dividend and pay dates. ${PRIVACY_NOTE}`,
    inputSchema: { type: "object", properties: { portfolio_id: PORTFOLIO_ID }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "get_upcoming_events",
    title: "Upcoming events",
    description: `Ex-dividend dates, dividend pay dates, earnings reports and splits of the held symbols in the next days. ${PRIVACY_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        portfolio_id: PORTFOLIO_ID,
        days: { type: "integer", minimum: 1, maximum: 365, description: "Days ahead. Default 30." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

// ── projections: service data to percent-only answers ───────────────────────

/** Rounds a percentage to two decimals; undefined for a missing or non-finite one. */
function pct(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  return Math.round(value * 100) / 100;
}

/** `a` relative to `b` in percent (`a / b - 1`); undefined when either is missing. */
function distancePct(a: number | undefined, b: number | undefined): number | undefined {
  if (!a || !b || !Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return pct((a / b - 1) * 100);
}

function heldOnly(holdings: readonly PortfolioHolding[]): PortfolioHolding[] {
  return holdings.filter((h) => h.assetType === "Cash" || h.shares > 0);
}

export function projectSummary(portfolio: portfolioRepo.PortfolioRow, data: FinancialPortfolioData) {
  const s = data.summary;
  const held = heldOnly(data.holdings);
  return {
    portfolioId: portfolio.id,
    name: portfolio.name,
    baseCurrency: s.baseCurrency,
    lastUpdated: s.lastUpdated,
    holdingsCount: held.filter((h) => h.assetType !== "Cash").length,
    returns: {
      dayPercent: pct(s.dayGainLossPercent),
      onCostPercent: pct(s.totalGainLossPercent),
      sinceStartPercent: pct(s.totalGainSinceStartPercent),
    },
    allocation: {
      stocksPercent: pct(s.stockWeightPercent),
      etfsPercent: pct(s.etfWeightPercent),
      cryptoPercent: pct(s.cryptoWeightPercent),
      otherPercent: pct(s.otherWeightPercent),
      cashPercent: pct(s.cashWeightPercent),
    },
    bestToday: s.bestPerformer ? { symbol: s.bestPerformer.symbol, changePercent: pct(s.bestPerformer.changePercent) } : null,
    worstToday: s.worstPerformer ? { symbol: s.worstPerformer.symbol, changePercent: pct(s.worstPerformer.changePercent) } : null,
  };
}

export function projectHoldings(portfolio: portfolioRepo.PortfolioRow, data: FinancialPortfolioData) {
  const held = heldOnly(data.holdings).sort((a, b) => b.weightPercent - a.weightPercent);
  return {
    portfolioId: portfolio.id,
    baseCurrency: data.summary.baseCurrency,
    lastUpdated: data.summary.lastUpdated,
    holdings: held.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      isin: h.isin,
      assetType: h.assetType,
      currency: h.nativeCurrency || h.currency,
      isPrivate: h.isPrivate || undefined,
      quoteMissing: h.quoteMissing || undefined,
      weightPercent: pct(h.weightPercent),
      dayChangePercent: h.assetType === "Cash" ? undefined : pct(h.dayChangePercent),
      onCostPercent: h.assetType === "Cash" ? undefined : pct(h.totalGainLossPercent),
      rsi: pct(h.rsi),
      from52WeekHighPercent: distancePct(h.currentPrice, h.fiftyTwoWeekHigh),
      from52WeekLowPercent: distancePct(h.currentPrice, h.fiftyTwoWeekLow),
      vsSma50Percent: distancePct(h.currentPrice, h.sma50),
      vsSma200Percent: distancePct(h.currentPrice, h.sma200),
    })),
  };
}

export function projectExposure(e: PortfolioExposureResponse) {
  const breakdown = (b: PortfolioExposureResponse["sectors"]) => ({
    items: b.items.map((s) => ({ name: s.name, percent: pct(s.percent) })),
    unknownPercent: pct(b.unknownPercent),
    notApplicablePercent: pct(b.notApplicablePercent),
  });
  return {
    portfolioId: e.portfolioId,
    generatedAt: e.generatedAt,
    note: "Percent of the whole portfolio value, cash included.",
    coverage: {
      directPercent: pct(e.coverage.directPercent),
      lookedThroughPercent: pct(e.coverage.lookedThroughPercent),
      unknownPercent: pct(e.coverage.unknownPercent),
      holdingsKnownPercent: pct(e.coverage.holdingsKnownPercent),
    },
    sectors: breakdown(e.sectors),
    countries: breakdown(e.countries),
    assetClasses: breakdown(e.assetClasses),
    topStocks: e.topStocks.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      percent: pct(s.percent),
      directPercent: pct(s.directPercent),
      viaFundsPercent: pct(s.viaFundsPercent),
    })),
    funds: e.funds.map((f) => ({
      symbol: f.symbol,
      name: f.name,
      percent: pct(f.percent),
      expenseRatioPercent: pct(f.expenseRatio),
      holdingsKnownPercent: pct(f.holdingsKnownPercent),
      holdingsComplete: f.holdingsComplete,
    })),
    overlaps: e.overlaps.map((o) => ({ fundA: o.a, fundB: o.b, overlapPercent: pct(o.overlapPercent), commonHoldings: o.commonHoldings, partial: o.partial })),
    warnings: e.warnings.map((w) => ({ kind: w.kind, name: w.name, percent: pct(w.percent), limitPercent: pct(w.limit) })),
    weightedExpenseRatioPercent: pct(e.weightedExpenseRatio?.percent),
  };
}

export function projectPerformance(portfolioId: string, c: BenchmarkComparison | null) {
  if (!c) return { portfolioId, comparison: null, note: "No portfolio history or benchmark data in this range." };
  return {
    portfolioId,
    benchmark: { symbol: c.symbol, label: c.label },
    range: c.range,
    from: c.from,
    to: c.to,
    note: "Time-weighted return of the invested holdings; deposits and withdrawals do not count as gains.",
    portfolioReturnPercent: pct(c.portfolioReturnPercent),
    benchmarkReturnPercent: pct(c.benchmarkReturnPercent),
    excessReturnPercent: pct(c.excessReturnPercent),
    series: c.series.map((p) => ({ date: p.date, portfolioPercent: pct(p.portfolio), benchmarkPercent: pct(p.benchmark) })),
  };
}

export function projectDividendYield(s: PortfolioIncomeSummary) {
  return {
    portfolioId: s.portfolioId,
    generatedAt: s.generatedAt,
    yieldOnCostPercent: pct(s.yieldOnCostPercent),
    currentYieldPercent: pct(s.currentYieldPercent),
    holdings: s.holdings.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      frequency: h.frequency,
      yieldOnCostPercent: pct(h.yieldOnCostPercent),
      currentYieldPercent: pct(h.currentYieldPercent),
      nextExDate: h.nextExDate,
      nextPayDate: h.nextPayDate,
      estimated: h.estimated,
    })),
  };
}

export function projectEvents(portfolioId: string, days: number, events: readonly PortfolioEvent[]) {
  return {
    portfolioId,
    days,
    events: events.map((e) => ({
      date: e.date,
      kind: e.kind,
      symbol: e.symbol,
      name: e.name,
      estimated: e.estimated || undefined,
      time: e.time,
      splitRatio: e.kind === "split" && e.numerator && e.denominator ? `${e.numerator}:${e.denominator}` : undefined,
    })),
  };
}

// ── tool calls ──────────────────────────────────────────────────────────────

/** A request the client got wrong (unknown portfolio, bad argument). The client sees the message. */
export class McpToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolInputError";
  }
}

function resolvePortfolio(args: Record<string, unknown>): portfolioRepo.PortfolioRow {
  const id = args.portfolio_id;
  if (id === undefined || id === null || id === "") {
    const all = portfolioRepo.findAll();
    if (all.length === 1) return all[0]!;
    throw new McpToolInputError(all.length === 0 ? "There are no portfolios yet." : "portfolio_id is required: there is more than one portfolio (see list_portfolios).");
  }
  if (typeof id !== "string") throw new McpToolInputError("portfolio_id must be a string");
  const row = portfolioRepo.findById(id);
  if (!row) throw new McpToolInputError("Portfolio not found");
  return row;
}

/** The services the tools read. `AppServices` satisfies it. */
export type McpToolDeps = Pick<AppServices, "portfolioService" | "exposure" | "income" | "yahoo" | "finnhub" | "fmp">;

/**
 * Runs one tool and returns its percent-only answer. Throws
 * `McpToolInputError` for a bad request and `McpPrivacyError` when the
 * answer would carry a number that is not a percentage.
 */
export async function callMcpTool(deps: McpToolDeps, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await runTool(deps, name, args);
  assertPercentOnly(result);
  return result;
}

async function runTool(deps: McpToolDeps, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "list_portfolios":
      // No description: it is free text and could name an amount.
      return { portfolios: portfolioRepo.findAll().map((p) => ({ id: p.id, name: p.name, baseCurrency: p.baseCurrency })) };
    case "get_portfolio_summary": {
      const p = resolvePortfolio(args);
      return projectSummary(p, await deps.portfolioService.getPortfolioData(p.id));
    }
    case "get_holdings": {
      const p = resolvePortfolio(args);
      return projectHoldings(p, await deps.portfolioService.getPortfolioData(p.id));
    }
    case "get_exposure": {
      const p = resolvePortfolio(args);
      return projectExposure(await deps.exposure.getExposure(p.id));
    }
    case "get_performance": {
      const p = resolvePortfolio(args);
      const range = normalizeBenchmarkRange(typeof args.range === "string" ? args.range : undefined);
      const benchmark = typeof args.benchmark === "string" && args.benchmark.trim() ? args.benchmark.trim() : undefined;
      return projectPerformance(p.id, await getBenchmarkComparison(deps, p.id, range, benchmark));
    }
    case "get_dividend_yield": {
      const p = resolvePortfolio(args);
      return projectDividendYield(await deps.income.getIncomeSummary(p.id));
    }
    case "get_upcoming_events": {
      const p = resolvePortfolio(args);
      const days = args.days === undefined ? 30 : Number(args.days);
      if (!Number.isInteger(days) || days < 1 || days > 365) throw new McpToolInputError("days must be a whole number from 1 to 365");
      const res = await deps.income.getUpcomingEvents(p.id, days);
      return projectEvents(p.id, days, res.events);
    }
    default:
      throw new McpToolInputError(`Unknown tool: ${name}`);
  }
}
