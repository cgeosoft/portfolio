/**
 * Portfolio suggestions: the model proposes target weights, this service
 * checks them and keeps one list per portfolio.
 *
 * The prompt carries weights in percent, public prices and public market
 * data, never balances, amounts or quantities. Shares and money amounts are
 * computed from the target weights on this machine (shared/suggestions.ts).
 *
 * A suggestion is identified by `action:SYMBOL`. A new generation updates an
 * open suggestion with the same key, skips a dismissed one until the weight
 * of its symbol moved by SUGGESTION_DISMISS_RESET_PP, and marks open ones the
 * model did not repeat as superseded. Logs never name a symbol (AGENTS.md rule 3).
 */

import type { FinancialPortfolioData, PortfolioHolding } from "portfolio-shared/portfolio";
import type { GetSuggestionsResponse, SuggestionGeneration } from "portfolio-shared/api-types";
import {
  SUGGESTION_ACTIONS,
  SUGGESTION_DEFAULT_TTL_DAYS,
  SUGGESTION_DISMISS_RESET_PP,
  SUGGESTION_MAX_TTL_DAYS,
  compareSuggestions,
  evaluateSuggestion,
  marketForSymbol,
  suggestionKey,
  type PortfolioSuggestion,
  type SuggestionAction,
  type SuggestionFunding,
  type SuggestionMarket,
  type SuggestionQuote,
  type SuggestionValidity,
} from "portfolio-shared/suggestions";
import { loadConfig } from "../config.js";
import { appLogger } from "../logger.js";
import * as portfolioRepo from "../db/portfolio.repo.js";
import * as suggestionRepo from "../db/suggestion.repo.js";
import { sanitizeLlmResponse, type LlmMessage, type LlmService } from "./llm.js";
import type { PortfolioService } from "./portfolio.js";
import type { MarketDataCoordinator } from "./market-data.js";
import { buildReportIntelSections, collectReportIntel, EMPTY_REPORT_INTEL, type AiContextDeps, type ReportIntel, type ReportIntelRequest } from "./ai-context.js";
import { plainStyle, withLanguageInstruction } from "./output-language.js";
import { t } from "../i18n.js";

/** Most suggestions kept from one answer. */
const MAX_SUGGESTIONS = 8;
/** Largest gap between the weight the model echoes and the real weight, in percentage points. */
const WEIGHT_ECHO_TOLERANCE_PP = 2;
/** Smallest weight change worth a suggestion, in percentage points. */
const MIN_CHANGE_PP = 0.25;
/** Cash weight from which the prompt invites new positions. */
const NEW_POSITION_CASH_PERCENT = 10;

export type SuggestionIntelLoader = (req: ReportIntelRequest) => Promise<ReportIntel>;

/** A checked proposal, before it is merged with the stored list. */
export interface SuggestionProposal {
  key: string;
  action: SuggestionAction;
  symbol: string;
  name: string;
  currentWeight: number;
  targetWeight: number;
  title: string;
  why: string;
  priority: number;
  validity: SuggestionValidity;
  fundedBy: SuggestionFunding[];
}

export interface ParsedAnswer {
  summary: string;
  proposals: SuggestionProposal[];
  notes: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const text = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  const clean = sanitizeLlmResponse(v).replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3).trimEnd()}...` : clean;
};

function heldHoldings(data: FinancialPortfolioData): PortfolioHolding[] {
  return (data.holdings ?? []).filter((h) => h.assetType !== "Cash" && h.shares > 0);
}

function findHolding(data: FinancialPortfolioData, symbol: string): PortfolioHolding | undefined {
  const key = symbol.trim().toUpperCase();
  return heldHoldings(data).find((h) => h.symbol.toUpperCase() === key);
}

function totalValueOf(data: FinancialPortfolioData): number {
  return data.summary?.totalPortfolioValue || data.summary?.totalValue || 0;
}

/** Find the first JSON object in the reply; models sometimes wrap it in a code fence or text. */
export function extractJsonObject(reply: string): Record<string, unknown> {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The assistant did not return a JSON object");
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("The assistant returned JSON that is not valid");
  }
}

/**
 * Checks every proposal of the answer against the portfolio. A proposal that
 * fails a check is dropped and counted in a note; the rest is kept.
 * `quotes` holds the prices of symbols the portfolio does not hold.
 */
export function parseSuggestionAnswer(
  raw: Record<string, unknown>,
  data: FinancialPortfolioData,
  quotes: readonly SuggestionQuote[],
  now: Date = new Date(),
): ParsedAnswer {
  const holdings = heldHoldings(data);
  const items = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  const dropped = { invalid: 0, notHeld: 0, unknown: 0, privateAsset: 0, misread: 0, noChange: 0, duplicate: 0, extra: 0 };
  const proposals: SuggestionProposal[] = [];
  const rawFunding = new Map<string, unknown>();

  for (const item of items) {
    if (!item || typeof item !== "object") {
      dropped.invalid++;
      continue;
    }
    const o = item as Record<string, unknown>;
    let action = typeof o.action === "string" ? (o.action.trim().toLowerCase() as SuggestionAction) : undefined;
    const rawSymbol = typeof o.symbol === "string" ? o.symbol.trim().toUpperCase() : "";
    const title = text(o.title, 120);
    if (!action || !SUGGESTION_ACTIONS.includes(action) || !rawSymbol || rawSymbol === "CASH" || !title) {
      dropped.invalid++;
      continue;
    }

    const holding = findHolding(data, rawSymbol);
    if (holding?.isPrivate) {
      dropped.privateAsset++;
      continue;
    }
    if (action === "open" && holding) action = "increase";
    if (action !== "open" && !holding) {
      dropped.notHeld++;
      continue;
    }
    const quote = quotes.find((q) => q.symbol.toUpperCase() === rawSymbol);
    if (action === "open" && !(quote && quote.price > 0)) {
      dropped.unknown++;
      continue;
    }

    const symbol = holding?.symbol ?? rawSymbol;
    const market: SuggestionMarket = marketForSymbol(symbol, holdings, quotes);
    const current = market.weight;
    const echoed = num(o.fromWeight);
    if (action !== "open" && echoed !== undefined && Math.abs(echoed - current) > WEIGHT_ECHO_TOLERANCE_PP) {
      dropped.misread++;
      continue;
    }

    const target = action === "close" ? 0 : round2(Math.min(100, Math.max(0, num(o.targetWeight) ?? Number.NaN)));
    const sells = action === "decrease" || action === "close";
    if (!Number.isFinite(target) || (sells ? current - target < MIN_CHANGE_PP : target - current < MIN_CHANGE_PP)) {
      dropped.noChange++;
      continue;
    }

    const key = suggestionKey(action, symbol);
    if (proposals.some((p) => p.symbol.toUpperCase() === symbol.toUpperCase())) {
      dropped.duplicate++;
      continue;
    }
    if (proposals.length >= MAX_SUGGESTIONS) {
      dropped.extra++;
      continue;
    }

    rawFunding.set(key, o.fundedBy);
    proposals.push({
      key,
      action,
      symbol,
      name: holding?.name || quote?.name || symbol,
      currentWeight: current,
      targetWeight: target,
      title,
      why: text(o.why, 700),
      priority: Math.min(5, Math.max(1, Math.round(num(o.priority) ?? 3))),
      validity: parseValidity(o.validity, market, now),
      fundedBy: [],
    });
  }

  // Funding links point only at sells of this answer or at cash.
  const sellKeys = new Set(proposals.filter((p) => p.action === "decrease" || p.action === "close").map((p) => p.key));
  for (const p of proposals) {
    if (p.action !== "increase" && p.action !== "open") continue;
    p.fundedBy = parseFunding(rawFunding.get(p.key), sellKeys);
  }

  const notes: string[] = [];
  for (const reason of Object.keys(dropped) as (keyof typeof dropped)[]) {
    const count = dropped[reason];
    if (count > 0) notes.push(t(`service.suggestions.dropped.${reason}`, { count, max: MAX_SUGGESTIONS }));
  }

  return { summary: text(raw.summary, 600), proposals, notes };
}

function parseValidity(raw: unknown, market: SuggestionMarket, now: Date): SuggestionValidity {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const days = Math.min(SUGGESTION_MAX_TTL_DAYS, Math.max(1, Math.round(num(o.days) ?? SUGGESTION_DEFAULT_TTL_DAYS)));
  const validity: SuggestionValidity = { expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString() };

  // A range that the current value already breaks would cancel the suggestion at once; leave it out.
  const priceMin = num(o.priceMin);
  const priceMax = num(o.priceMax);
  if (market.price !== undefined && market.currency && (priceMin !== undefined || priceMax !== undefined)) {
    const min = priceMin !== undefined && priceMin > 0 && priceMin < market.price ? priceMin : undefined;
    const max = priceMax !== undefined && priceMax > market.price ? priceMax : undefined;
    if (min !== undefined || max !== undefined) validity.price = { min, max, currency: market.currency.toUpperCase() };
  }
  const weightMin = num(o.weightMin);
  const weightMax = num(o.weightMax);
  if (weightMin !== undefined || weightMax !== undefined) {
    const min = weightMin !== undefined && weightMin >= 0 && weightMin <= market.weight ? round2(weightMin) : undefined;
    const max = weightMax !== undefined && weightMax <= 100 && weightMax >= market.weight ? round2(weightMax) : undefined;
    if (min !== undefined || max !== undefined) validity.weight = { min, max };
  }
  return validity;
}

function parseFunding(raw: unknown, sellKeys: Set<string>): SuggestionFunding[] {
  if (!Array.isArray(raw)) return [];
  const out: SuggestionFunding[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const rawKey = typeof e.key === "string" ? e.key.trim() : "";
    const [a, s] = rawKey.split(":");
    const key = rawKey.toUpperCase() === "CASH" ? "CASH" : a && s ? suggestionKey(a.toLowerCase() as SuggestionAction, s) : "";
    const weight = num(e.weight);
    if (!key || weight === undefined || weight <= 0) continue;
    if (key !== "CASH" && !sellKeys.has(key)) continue;
    if (out.some((f) => f.key === key)) continue;
    out.push({ key, weight: round2(weight) });
  }
  return out;
}

// ── merge ───────────────────────────────────────────────────────────────────

export interface MergeResult {
  suggestions: PortfolioSuggestion[];
  /** Proposals left out because the user dismissed them. */
  skippedDismissed: number;
}

/**
 * Merges checked proposals into the stored list and returns every row that
 * changed. Pure: the caller saves the rows. Open rows whose target was
 * reached or whose validity failed are closed first, so the model's
 * repetition of them starts a new suggestion.
 */
export function mergeSuggestions(
  portfolioId: string,
  existing: readonly PortfolioSuggestion[],
  proposals: readonly SuggestionProposal[],
  marketOf: (symbol: string) => SuggestionMarket,
  totalValue: number,
  now: Date = new Date(),
): MergeResult {
  const stamp = now.toISOString();
  const changed = new Map<string, PortfolioSuggestion>();
  const open = new Map<string, PortfolioSuggestion>();

  for (const s of existing) {
    if (s.status !== "active") continue;
    const ev = evaluateSuggestion(s, marketOf(s.symbol), totalValue, now);
    if (ev.status === "active") {
      open.set(s.key, s);
    } else {
      changed.set(s.id, { ...s, status: ev.status, statusReason: ev.reason, updatedAt: stamp, resolvedAt: stamp });
    }
  }

  const lastDismissed = new Map<string, PortfolioSuggestion>();
  for (const s of existing) {
    if (s.status !== "dismissed") continue;
    const prev = lastDismissed.get(s.key);
    if (!prev || s.updatedAt > prev.updatedAt) lastDismissed.set(s.key, s);
  }

  let skippedDismissed = 0;
  for (const p of proposals) {
    const dismissed = lastDismissed.get(p.key);
    if (dismissed && isStillDismissed(dismissed, p.currentWeight)) {
      skippedDismissed++;
      continue;
    }
    const same = open.get(p.key);
    if (same) {
      open.delete(p.key);
      // Keep the identity, the creation date and the starting weight, so progress still counts from there.
      changed.set(same.id, {
        ...same,
        name: p.name,
        targetWeight: p.targetWeight,
        title: p.title,
        why: p.why,
        priority: p.priority,
        validity: p.validity,
        fundedBy: p.fundedBy,
        updatedAt: stamp,
      });
      continue;
    }
    const id = suggestionRepo.newSuggestionId();
    changed.set(id, {
      id,
      portfolioId,
      key: p.key,
      action: p.action,
      symbol: p.symbol,
      name: p.name,
      fromWeight: p.currentWeight,
      targetWeight: p.targetWeight,
      title: p.title,
      why: p.why,
      priority: p.priority,
      validity: p.validity,
      fundedBy: p.fundedBy,
      status: "active",
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  for (const s of open.values()) {
    changed.set(s.id, { ...s, status: "superseded", statusReason: "The last generation did not repeat it", updatedAt: stamp, resolvedAt: stamp });
  }

  return { suggestions: [...changed.values()], skippedDismissed };
}

/** A dismissal holds while the weight of its symbol stays near the weight at dismissal. */
export function isStillDismissed(dismissed: Pick<PortfolioSuggestion, "dismissedAtWeight" | "fromWeight">, currentWeight: number): boolean {
  const at = dismissed.dismissedAtWeight ?? dismissed.fromWeight;
  return Math.abs(currentWeight - at) <= SUGGESTION_DISMISS_RESET_PP;
}

// ── prompt ──────────────────────────────────────────────────────────────────

const pct = (n: number) => `${n.toFixed(2)}%`;
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function describeHolding(h: PortfolioHolding): string {
  const parts = [`weight ${pct(h.weightPercent)}`];
  if (h.isPrivate) parts.push("private asset, cannot be traded");
  else if (h.nativePrice && h.nativeCurrency) parts.push(`price ${h.nativePrice} ${h.nativeCurrency}`);
  parts.push(`day ${signedPct(h.dayChangePercent)}`, `total gain ${signedPct(h.totalGainLossPercent)}`);
  // Ratios only: the moving averages are in the base currency, the price above in the quote currency.
  if (h.sma200 && h.currentPrice) parts.push(`price vs SMA200 ${signedPct((h.currentPrice / h.sma200 - 1) * 100)}`);
  if (h.sma50 && h.currentPrice) parts.push(`price vs SMA50 ${signedPct((h.currentPrice / h.sma50 - 1) * 100)}`);
  if (h.rsi !== undefined) parts.push(`RSI ${h.rsi.toFixed(0)}`);
  return `- ${h.symbol} (${h.name}, ${h.assetType}): ${parts.join(" | ")}`;
}

export function buildSuggestionPrompt(
  data: FinancialPortfolioData,
  /** `language`: interface language code for the text fields; English when left out. */
  ctx: { baseCurrency: string; intelText: string; openKeys: string[]; dismissedKeys: string[]; today: string; language?: string },
): LlmMessage[] {
  const summary = data.summary;
  const cash = summary?.cashWeightPercent ?? 0;
  const holdings = heldHoldings(data).sort((a, b) => b.weightPercent - a.weightPercent);
  const newPositions =
    cash >= NEW_POSITION_CASH_PERCENT
      ? `Cash is ${pct(cash)} of the portfolio. You may suggest "open" for new instruments to put cash to work. Use Yahoo Finance symbols, with the exchange suffix for non-US listings (for example VWCE.DE). Prefer liquid, broad ETFs or large companies. The app checks each symbol and drops unknown ones.`
      : `Suggest "open" for a new instrument only when it clearly fixes a gap in the allocation. Use Yahoo Finance symbols with the exchange suffix for non-US listings.`;

  const system = withLanguageInstruction(`You are a portfolio analyst. You give a short list of concrete rebalancing actions for one investment portfolio.
You see weights in percent of the total portfolio, never money amounts. Never write money amounts or share counts. The app turns your target weights into amounts.

Rules:
- Each suggestion changes the weight of one symbol. Actions: "decrease" and "increase" for held symbols, "close" to sell a held symbol completely, "open" for a symbol not held.
- "targetWeight" is the weight in percent after the action. "fromWeight" repeats the current weight from the ledger.
- The changes must balance. The weight you sell plus the cash you use must equal the weight you buy. Leftover goes to cash; say so in "why" when you mean it.
- For "increase" and "open", "fundedBy" lists the sources: keys of your sell suggestions ("decrease:SYMBOL" or "close:SYMBOL") or "CASH", with the weight in percentage points from each.
- "priority" is 1 (most important) to 5.
- "validity" says how long the idea holds: "days" (1 to ${SUGGESTION_MAX_TTL_DAYS}), and optional "priceMin" / "priceMax" in the quote currency of the symbol, and optional "weightMin" / "weightMax" in percent. The app cancels the suggestion when a rule fails.
- Do not trade private assets. Give at most ${MAX_SUGGESTIONS} suggestions. Give none when the portfolio needs no change.
- "title" is at most 8 words. "why" is 1 to 3 short sentences based on the data given. Use ${plainStyle(ctx.language)}. No emojis, no long dashes.

Reply with one JSON object and nothing else, in this shape:
{"summary": "1 or 2 sentences", "suggestions": [{"action": "decrease", "symbol": "NVDA", "fromWeight": 14.2, "targetWeight": 9, "priority": 1, "title": "Trim the largest single stock", "why": "...", "fundedBy": [], "validity": {"days": 5, "priceMin": 160, "priceMax": 210}}]}`, ctx.language, { jsonFields: ["summary", "title", "why"] });

  const open = ctx.openKeys.length > 0
    ? `\n## Open suggestions\nThe user has not acted on these yet. Repeat one with the same action and symbol only if it still applies:\n${ctx.openKeys.map((k) => `- ${k}`).join("\n")}\n`
    : "";
  const dismissed = ctx.dismissedKeys.length > 0
    ? `\n## Dismissed suggestions\nThe user rejected these. Do not suggest them again:\n${ctx.dismissedKeys.map((k) => `- ${k}`).join("\n")}\n`
    : "";

  const user = `Date: ${ctx.today}. Base currency: ${ctx.baseCurrency}.

## Allocation
- Cash: ${pct(cash)}
- Stocks ${pct(summary?.stockWeightPercent ?? 0)}, ETFs ${pct(summary?.etfWeightPercent ?? 0)}, Crypto ${pct(summary?.cryptoWeightPercent ?? 0)}, Private and other ${pct(summary?.otherWeightPercent ?? 0)}

## Holdings ledger
${holdings.map(describeHolding).join("\n") || "- No holdings"}
${open}${dismissed}
## New positions
${newPositions}
${ctx.intelText}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── service ─────────────────────────────────────────────────────────────────

export class PortfolioSuggestionService {
  private readonly jobs = new Map<string, SuggestionGeneration>();
  private readonly loadIntel: SuggestionIntelLoader;

  constructor(
    private readonly llm: LlmService,
    private readonly portfolioService: PortfolioService,
    private readonly marketData: MarketDataCoordinator,
    intel?: AiContextDeps | SuggestionIntelLoader,
  ) {
    if (typeof intel === "function") this.loadIntel = intel;
    else if (intel) this.loadIntel = (req) => collectReportIntel(intel, req);
    else this.loadIntel = async () => EMPTY_REPORT_INTEL;
  }

  private baseCurrencyOf(portfolioId: string, requested?: string): string {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) throw new Error("Portfolio not found");
    return (requested || portfolio.baseCurrency || loadConfig().baseCurrency || "EUR").toUpperCase();
  }

  /** Prices of symbols not in the holdings, converted with live FX. Missing ones are left out. */
  private async quotesFor(symbols: string[], baseCurrency: string): Promise<SuggestionQuote[]> {
    const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (unique.length === 0) return [];
    const quotes = await this.marketData.getQuotes(unique).catch(() => new Map());
    const currencies = [...new Set([...quotes.values()].map((q) => (q.currency || "").toUpperCase()).filter((c) => c && c !== baseCurrency))];
    const rates = currencies.length > 0 ? await this.marketData.getExchangeRates(baseCurrency, currencies).catch(() => new Map<string, number>()) : new Map<string, number>();
    const out: SuggestionQuote[] = [];
    for (const symbol of unique) {
      const q = quotes.get(symbol);
      if (!q || !(q.regularMarketPrice > 0)) continue;
      const currency = (q.currency || baseCurrency).toUpperCase();
      const toBase = currency === baseCurrency ? 1 : rates.get(currency);
      if (!toBase) continue;
      out.push({
        symbol,
        name: q.longName || q.shortName,
        price: q.regularMarketPrice,
        currency,
        toBase,
        fractional: (q.instrumentType || "").toUpperCase() === "CRYPTOCURRENCY",
      });
    }
    return out;
  }

  public async getSuggestions(portfolioId: string, requestedCurrency?: string): Promise<GetSuggestionsResponse> {
    const baseCurrency = this.baseCurrencyOf(portfolioId, requestedCurrency);
    const suggestions = suggestionRepo.findByPortfolio(portfolioId).sort(compareSuggestions);
    const run = suggestionRepo.findRun(portfolioId);
    const openSymbols = suggestions.filter((s) => s.status === "active" && s.action === "open").map((s) => s.symbol);
    const quotes = await this.quotesFor(openSymbols, baseCurrency);
    return {
      portfolioId,
      suggestions,
      quotes,
      generatedAt: run?.generatedAt,
      stale: run ? run.txFingerprint !== suggestionRepo.transactionFingerprint(portfolioId) : false,
      notes: run ? (JSON.parse(run.notes) as string[]) : [],
      summary: run?.summary ?? undefined,
      generation: this.jobs.get(portfolioId) ?? { status: "idle" },
    };
  }

  /** Starts a generation in the background; the GUI polls getSuggestions(). */
  public startGeneration(portfolioId: string, requestedCurrency?: string): SuggestionGeneration {
    const running = this.jobs.get(portfolioId);
    if (running?.status === "running") return running;
    const baseCurrency = this.baseCurrencyOf(portfolioId, requestedCurrency);
    const job: SuggestionGeneration = { status: "running", startedAt: new Date().toISOString() };
    this.jobs.set(portfolioId, job);
    void this.generate(portfolioId, baseCurrency)
      .then(() => this.jobs.set(portfolioId, { status: "idle" }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        appLogger.logStep("error", "suggestions", "generate", `Suggestion generation failed (${err instanceof Error ? err.name : typeof err})`);
        this.jobs.set(portfolioId, { status: "fail", error: message });
      });
    return job;
  }

  public async generate(portfolioId: string, baseCurrency: string): Promise<void> {
    const now = new Date();
    const fingerprint = suggestionRepo.transactionFingerprint(portfolioId);
    const data = await this.portfolioService.getPortfolioData(portfolioId, baseCurrency);
    const holdings = heldHoldings(data);
    const existing = suggestionRepo.findByPortfolio(portfolioId);

    const openKeys = existing.filter((s) => s.status === "active").map((s) => s.key);
    const dismissedKeys = [
      ...new Set(
        existing
          .filter((s) => s.status === "dismissed" && isStillDismissed(s, marketForSymbol(s.symbol, holdings, []).weight))
          .map((s) => s.key),
      ),
    ];

    let intelText = "";
    try {
      const intel = await this.loadIntel({ portfolioId, holdings: data.holdings ?? [], baseCurrency, current: true });
      const from = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
      intelText = buildReportIntelSections(intel, { from, to: now.toISOString().slice(0, 10) }).text;
    } catch (err) {
      appLogger.logStep("warning", "suggestions", "intel_failed", `Suggestion market context failed (${err instanceof Error ? err.name : typeof err})`);
    }

    const messages = buildSuggestionPrompt(data, { baseCurrency, intelText, openKeys, dismissedKeys, today: now.toISOString().slice(0, 10), language: loadConfig().language });
    const target = this.llm.resolve({ temperature: 0.2 });
    let raw: Record<string, unknown>;
    const first = await this.llm.chat(messages, { temperature: 0.2 });
    try {
      raw = extractJsonObject(first);
    } catch (err) {
      // One retry with the error, for local models that drift from the format.
      const retry = await this.llm.chat(
        [
          ...messages,
          { role: "assistant", content: first.slice(0, 4000) },
          { role: "user", content: `${err instanceof Error ? err.message : "Invalid answer"}. Reply again with only the JSON object in the given shape.` },
        ],
        { temperature: 0.1 },
      );
      raw = extractJsonObject(retry);
    }

    const newSymbols = Array.isArray(raw.suggestions)
      ? raw.suggestions
          .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>).symbol : undefined))
          .filter((s): s is string => typeof s === "string" && !findHolding(data, s))
      : [];
    const quotes = await this.quotesFor(newSymbols, baseCurrency);
    const parsed = parseSuggestionAnswer(raw, data, quotes, now);

    // Quotes of symbols in older open suggestions, for their validity checks.
    const oldSymbols = existing.filter((s) => s.status === "active" && !findHolding(data, s.symbol)).map((s) => s.symbol);
    const allQuotes = [...quotes, ...(await this.quotesFor(oldSymbols, baseCurrency))];
    const merged = mergeSuggestions(portfolioId, existing, parsed.proposals, (symbol) => marketForSymbol(symbol, holdings, allQuotes), totalValueOf(data), now);

    const notes = [...parsed.notes];
    if (merged.skippedDismissed > 0) notes.push(t("service.suggestions.dismissedLeftOut", { count: merged.skippedDismissed }));
    suggestionRepo.saveGeneration(merged.suggestions, {
      portfolioId,
      generatedAt: now.toISOString(),
      txFingerprint: fingerprint,
      summary: parsed.summary || null,
      notes,
      provider: target.provider,
      model: target.model || null,
    });
    appLogger.logStep("info", "suggestions", "generate", "Suggestions generated", undefined, { kept: parsed.proposals.length, notes: notes.length });
  }

  /** Dismiss, mark done, or reopen one suggestion. A dismissal remembers the current weight of the symbol. */
  public async updateStatus(portfolioId: string, id: string, status: "active" | "done" | "dismissed", requestedCurrency?: string): Promise<PortfolioSuggestion> {
    const current = suggestionRepo.findById(portfolioId, id);
    if (!current) throw new Error("Suggestion not found");
    if (status === "active" && current.status !== "active") {
      const twin = suggestionRepo.findByPortfolio(portfolioId).find((s) => s.status === "active" && s.key === current.key && s.id !== id);
      if (twin) throw new Error("An open suggestion with the same action and symbol already exists");
    }
    let dismissedAtWeight: number | undefined;
    if (status === "dismissed") {
      const data = await this.portfolioService.getPortfolioData(portfolioId, this.baseCurrencyOf(portfolioId, requestedCurrency));
      dismissedAtWeight = marketForSymbol(current.symbol, heldHoldings(data), []).weight;
    }
    const reason = status === "done" ? "Marked done by the user" : status === "dismissed" ? "Dismissed by the user" : null;
    const updated = suggestionRepo.setStatus(portfolioId, id, status, { statusReason: reason, dismissedAtWeight: dismissedAtWeight ?? null });
    if (!updated) throw new Error("Suggestion not found");
    return updated;
  }
}
