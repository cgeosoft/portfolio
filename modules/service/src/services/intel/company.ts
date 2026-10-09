/**
 * Per-company intelligence: profile, analyst views, estimates, financial
 * scores, DCF, TTM ratios, insider activity, press releases, news, peers and
 * the latest earnings call transcript.
 *
 * Every part resolves through the provider chain (`firstAvailable`), so the
 * best provider with a key wins: FMP first, then Finnhub where Finnhub has
 * the data. Each part returns `{ data, source }` or null, in the shapes of
 * `portfolio-shared/company-intel`.
 *
 * Batch use (a whole portfolio): `getCompanyIntelBatch` dedupes symbols,
 * skips cash, crypto, FX pairs and indices, asks only the parts that apply
 * to ETFs and funds, and runs a few symbols at a time. Every FMP call goes
 * through the shared FMP throttle and cache (`FmpService.get`), so repeated
 * calls within a TTL cost nothing.
 *
 * For the assistant and reports: `getCompanyIntel`, `summarizeTranscript`,
 * `formatCompanyIntelForPrompt` and `trimTranscript`. Company data is public;
 * none of it carries the user's holdings or balances.
 *
 * Logs never name a symbol (AGENTS.md rule 3).
 */
import * as marketCache from "../../db/market-cache.repo.js";
import { appLogger } from "../../logger.js";
import { FMP_TTL, toFmpSymbol, type FmpNewsArticle, type FmpService } from "../fmp.js";
import type { FinnhubBasicFinancials, FinnhubInsiderTransaction, FinnhubService } from "../finnhub.js";
import type { MarketDataCoordinator } from "../market-data.js";
import { sanitizeLlmResponse, type LlmMessage, type LlmService } from "../llm.js";
import { mapWithConcurrencyLimit } from "../yahoo-finance.js";
import { firstAvailable } from "../providers/chain.js";
import {
  COMPANY_INTEL_PARTS,
  FUND_INTEL_PARTS,
  consensusFromCounts,
  describeAltmanZ,
  describePiotroski,
  type AnalystGrade,
  type CompanyAnalystView,
  type CompanyDcf,
  type CompanyEstimate,
  type CompanyEstimates,
  type CompanyInsiderActivity,
  type CompanyIntel,
  type CompanyIntelPart,
  type CompanyKeyMetrics,
  type CompanyNewsItem,
  type CompanyPeer,
  type CompanyProfile,
  type CompanyScores,
  type EarningsTranscript,
  type InsiderQuarterStats,
  type InsiderTrade,
  type Sourced,
  type TranscriptMeta,
  type TranscriptSummary,
} from "portfolio-shared/company-intel";
import type { GetTranscriptResponse, SummarizeTranscriptResponse } from "portfolio-shared/api-types";

/** The services company intel needs. `AppServices` (container.ts) satisfies it. */
export interface CompanyIntelDeps {
  fmp: FmpService;
  finnhub: FinnhubService;
  /** For the current price next to price targets and DCF. Optional. */
  marketData?: MarketDataCoordinator;
}

export interface TranscriptSummaryDeps extends CompanyIntelDeps {
  llm: LlmService;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A transcript never changes once published. */
const TRANSCRIPT_TTL_MS = 30 * DAY_MS;
/** LLM summaries are kept a year per symbol and quarter. */
const SUMMARY_TTL_MS = 365 * DAY_MS;
/** Default transcript size sent to the model; fits small local models. */
export const DEFAULT_TRANSCRIPT_PROMPT_CHARS = 24_000;

const MAX_GRADES = 12;
const MAX_TRADES = 15;
const MAX_NEWS = 8;
const MAX_PEERS = 10;
const NEWS_SUMMARY_CHARS = 320;

// ── small helpers ───────────────────────────────────────────────────────────

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A positive finite number, or undefined (FMP sends 0 for "not available" in several ratios). */
function pos(value: unknown): number | undefined {
  const n = num(value);
  return n !== undefined && n > 0 ? n : undefined;
}

/** Finnhub percent (27.1) to a fraction (0.271). */
function pct(value: unknown): number | undefined {
  const n = num(value);
  return n === undefined ? undefined : n / 100;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function first<T>(rows: T[] | null): T | null {
  return Array.isArray(rows) && rows.length > 0 && rows[0] ? rows[0] : null;
}

/** Drops undefined fields; null when nothing is left. */
function compact<T extends object>(value: T): T | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length > 0 ? (out as T) : null;
}

function toSourced<T>(result: { data: T | null; source: Sourced<T>["source"] | null }): Sourced<T> | null {
  if (result.data === null || result.data === undefined || !result.source) return null;
  if (Array.isArray(result.data) && result.data.length === 0) return null;
  return { data: result.data, source: result.source };
}

function cut(text: string | undefined, max: number): string | undefined {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function fmpDateToUnix(value: string | undefined): number {
  const ms = Date.parse(`${(value || "").replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function normSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

const fmpOn = (deps: CompanyIntelDeps) => () => deps.fmp.isConfigured();
const finnhubOn = (deps: CompanyIntelDeps) => () => deps.finnhub.isConfigured();

// ── eligibility ─────────────────────────────────────────────────────────────

/**
 * Whether a symbol can have company data at all: not cash, crypto, an FX
 * pair, an index or a private asset.
 */
export function isIntelEligible(symbol: string, assetType?: string, isPrivate?: boolean): boolean {
  const s = normSymbol(symbol);
  if (!s || isPrivate) return false;
  if (assetType === "Cash" || assetType === "Crypto") return false;
  if (s === "CASH" || s.startsWith("^") || s.endsWith("=X") || s.endsWith("=F")) return false;
  if (/^[A-Z0-9]{2,10}-(USD|EUR|GBP|USDT|USDC|BTC|ETH)$/.test(s)) return false;
  return true;
}

/** True for asset types that hold other securities (ETF, mutual fund). */
export function isFundType(assetType?: string): boolean {
  return assetType === "ETF" || assetType === "MutualFund";
}

/** The asked parts split into those that apply to the asset and those skipped. */
export function applicableParts(include: readonly CompanyIntelPart[], fund: boolean): { parts: CompanyIntelPart[]; skipped: CompanyIntelPart[] } {
  const asked = Array.from(new Set(include)).filter((p) => (COMPANY_INTEL_PARTS as readonly string[]).includes(p));
  if (!fund) return { parts: asked, skipped: [] };
  return { parts: asked.filter((p) => FUND_INTEL_PARTS.includes(p)), skipped: asked.filter((p) => !FUND_INTEL_PARTS.includes(p)) };
}

/** Parses "profile,analyst" (the `include` query) into known parts; empty or "all" means every part. */
export function parseIntelParts(value: string | null | undefined): CompanyIntelPart[] {
  const raw = (value || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (raw.length === 0 || raw.includes("all")) return [...COMPANY_INTEL_PARTS];
  return raw.filter((p): p is CompanyIntelPart => (COMPANY_INTEL_PARTS as readonly string[]).includes(p));
}

// ── current price ───────────────────────────────────────────────────────────

async function currentQuote(deps: CompanyIntelDeps, symbol: string): Promise<{ price: number; currency?: string } | null> {
  if (!deps.marketData) return null;
  try {
    const quotes = await deps.marketData.getQuotes([symbol]);
    const q = quotes.get(normSymbol(symbol));
    return q && q.regularMarketPrice > 0 ? { price: q.regularMarketPrice, currency: q.currency } : null;
  } catch {
    return null;
  }
}

// ── profile ─────────────────────────────────────────────────────────────────

export async function getCompanyProfile(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<CompanyProfile> | null> {
  const sym = normSymbol(symbol);
  const result = await firstAvailable<CompanyProfile>({
    category: "fundamentals",
    attempts: [
      {
        provider: "fmp",
        isAvailable: fmpOn(deps),
        fetch: async () => {
          const p = await deps.fmp.getProfile(toFmpSymbol(sym));
          if (!p) return null;
          const employees = Number(String(p.fullTimeEmployees ?? "").replace(/[^0-9.]/g, ""));
          return {
            symbol: sym,
            name: str(p.companyName),
            exchange: str(p.exchange) ?? str(p.exchangeFullName),
            currency: str(p.currency),
            sector: str(p.sector),
            industry: str(p.industry),
            country: str(p.country),
            marketCap: pos(p.marketCap),
            beta: num(p.beta),
            price: pos(p.price),
            ceo: str(p.ceo),
            employees: employees > 0 ? employees : undefined,
            website: str(p.website),
            description: str(p.description),
            logoUrl: str(p.image),
            ipoDate: str(p.ipoDate),
            isEtf: p.isEtf === true || undefined,
            isFund: p.isFund === true || undefined,
            isAdr: p.isAdr === true || undefined,
          };
        },
      },
      {
        provider: "finnhub",
        isAvailable: finnhubOn(deps),
        fetch: async () => {
          const p = await deps.finnhub.getCompanyProfile(sym);
          if (!p) return null;
          return {
            symbol: sym,
            name: str(p.name),
            exchange: str(p.exchange),
            currency: str(p.currency),
            industry: str(p.finnhubIndustry),
            country: str(p.country),
            // Finnhub reports market cap in millions.
            marketCap: pos(p.marketCapitalization) !== undefined ? p.marketCapitalization! * 1e6 : undefined,
            website: str(p.weburl),
            logoUrl: str(p.logo),
            ipoDate: str(p.ipo),
          };
        },
      },
    ],
  });
  return toSourced(result);
}

// ── analysts ────────────────────────────────────────────────────────────────

interface FmpPriceTargetConsensus {
  targetHigh?: number;
  targetLow?: number;
  targetConsensus?: number;
  targetMedian?: number;
}
interface FmpPriceTargetSummary {
  lastMonthCount?: number;
  lastQuarterCount?: number;
  lastQuarterAvgPriceTarget?: number;
  lastYearCount?: number;
}
interface FmpGrade {
  date?: string;
  gradingCompany?: string;
  previousGrade?: string;
  newGrade?: string;
  action?: string;
}
interface FmpGradesConsensus {
  strongBuy?: number;
  buy?: number;
  hold?: number;
  sell?: number;
  strongSell?: number;
  consensus?: string;
}
interface FmpRatingSnapshot {
  rating?: string;
  overallScore?: number;
  discountedCashFlowScore?: number;
  returnOnEquityScore?: number;
  returnOnAssetsScore?: number;
  debtToEquityScore?: number;
  priceToEarningsScore?: number;
  priceToBookScore?: number;
}

async function fmpAnalyst(deps: CompanyIntelDeps, sym: string): Promise<CompanyAnalystView | null> {
  const symbol = toFmpSymbol(sym);
  const ttl = FMP_TTL.fundamentals;
  const [consensus, summary, grades, gradesConsensus, rating] = await Promise.all([
    deps.fmp.get<FmpPriceTargetConsensus[]>("/price-target-consensus", { symbol }, ttl).then(first),
    deps.fmp.get<FmpPriceTargetSummary[]>("/price-target-summary", { symbol }, ttl).then(first),
    deps.fmp.get<FmpGrade[]>("/grades", { symbol }, ttl),
    deps.fmp.get<FmpGradesConsensus[]>("/grades-consensus", { symbol }, ttl).then(first),
    deps.fmp.get<FmpRatingSnapshot[]>("/ratings-snapshot", { symbol }, ttl).then(first),
  ]);

  const priceTarget = compact({
    low: pos(consensus?.targetLow),
    high: pos(consensus?.targetHigh),
    median: pos(consensus?.targetMedian),
    consensus: pos(consensus?.targetConsensus),
    lastMonthCount: num(summary?.lastMonthCount),
    lastQuarterCount: num(summary?.lastQuarterCount),
    lastYearCount: num(summary?.lastYearCount),
    lastQuarterAverage: pos(summary?.lastQuarterAvgPriceTarget),
  });

  const gradeRows: AnalystGrade[] = (Array.isArray(grades) ? grades : [])
    .filter((g) => g && str(g.date) && str(g.gradingCompany))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, MAX_GRADES)
    .map((g) => ({ date: g.date!.slice(0, 10), firm: g.gradingCompany!.trim(), previousGrade: str(g.previousGrade), newGrade: str(g.newGrade), action: str(g.action) }));

  let recommendations: CompanyAnalystView["recommendations"];
  if (gradesConsensus) {
    const counts = {
      strongBuy: num(gradesConsensus.strongBuy) ?? 0,
      buy: num(gradesConsensus.buy) ?? 0,
      hold: num(gradesConsensus.hold) ?? 0,
      sell: num(gradesConsensus.sell) ?? 0,
      strongSell: num(gradesConsensus.strongSell) ?? 0,
    };
    if (counts.strongBuy + counts.buy + counts.hold + counts.sell + counts.strongSell > 0) {
      recommendations = { ...counts, consensus: str(gradesConsensus.consensus) ?? consensusFromCounts(counts) };
    }
  }

  const ratingView = rating
    ? compact({
        rating: str(rating.rating),
        overallScore: num(rating.overallScore),
        dcfScore: num(rating.discountedCashFlowScore),
        roeScore: num(rating.returnOnEquityScore),
        roaScore: num(rating.returnOnAssetsScore),
        debtToEquityScore: num(rating.debtToEquityScore),
        peScore: num(rating.priceToEarningsScore),
        pbScore: num(rating.priceToBookScore),
      }) ?? undefined
    : undefined;

  if (!priceTarget && gradeRows.length === 0 && !recommendations && !ratingView) return null;
  return { priceTarget: priceTarget ?? undefined, recommendations, grades: gradeRows, rating: ratingView };
}

async function finnhubRecommendations(deps: CompanyIntelDeps, sym: string): Promise<CompanyAnalystView["recommendations"] | null> {
  const r = await deps.finnhub.getRecommendationTrends(sym);
  if (!r) return null;
  const counts = { strongBuy: r.strongBuy ?? 0, buy: r.buy ?? 0, hold: r.hold ?? 0, sell: r.sell ?? 0, strongSell: r.strongSell ?? 0 };
  if (counts.strongBuy + counts.buy + counts.hold + counts.sell + counts.strongSell <= 0) return null;
  return { ...counts, consensus: consensusFromCounts(counts), period: str(r.period) };
}

/**
 * Price targets, recent grades, recommendation counts and the FMP rating
 * snapshot. Without FMP, Finnhub recommendation trends. With FMP but no
 * recommendation counts in the plan, Finnhub fills the counts
 * (`recommendationsSource`).
 */
export async function getAnalystView(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<CompanyAnalystView> | null> {
  const sym = normSymbol(symbol);
  const [result, quote] = await Promise.all([
    firstAvailable<CompanyAnalystView>({
      category: "analyst",
      attempts: [
        { provider: "fmp", isAvailable: fmpOn(deps), fetch: () => fmpAnalyst(deps, sym) },
        {
          provider: "finnhub",
          isAvailable: finnhubOn(deps),
          fetch: async () => {
            const recommendations = await finnhubRecommendations(deps, sym);
            return recommendations ? { recommendations, grades: [] } : null;
          },
        },
      ],
    }),
    currentQuote(deps, sym),
  ]);
  const sourced = toSourced(result);
  if (!sourced) return null;
  if (!sourced.data.recommendations && sourced.source !== "finnhub" && deps.finnhub.isConfigured()) {
    const recommendations = await finnhubRecommendations(deps, sym).catch(() => null);
    if (recommendations) sourced.data = { ...sourced.data, recommendations, recommendationsSource: "finnhub" };
  }
  if (quote) sourced.data = { ...sourced.data, currentPrice: quote.price, currency: quote.currency };
  return sourced;
}

// ── estimates ───────────────────────────────────────────────────────────────

interface FmpEstimateRow {
  date?: string;
  revenueAvg?: number;
  revenueLow?: number;
  revenueHigh?: number;
  epsAvg?: number;
  epsLow?: number;
  epsHigh?: number;
  netIncomeAvg?: number;
  ebitdaAvg?: number;
  numAnalystsRevenue?: number;
  numAnalystsEps?: number;
}

/** Annual consensus estimates: the last reported year and up to three ahead (FMP only). */
export async function getEstimates(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<CompanyEstimates> | null> {
  const sym = normSymbol(symbol);
  const result = await firstAvailable<CompanyEstimates>({
    category: "fundamentals",
    attempts: [
      {
        provider: "fmp",
        isAvailable: fmpOn(deps),
        fetch: async () => {
          const rows = await deps.fmp.get<FmpEstimateRow[]>("/analyst-estimates", { symbol: toFmpSymbol(sym), period: "annual", page: 0, limit: 10 }, FMP_TTL.fundamentals);
          if (!Array.isArray(rows)) return null;
          const since = isoDate(Date.now() - 365 * DAY_MS);
          const periods: CompanyEstimate[] = rows
            .filter((r) => r && str(r.date) && r.date! >= since)
            .sort((a, b) => a.date!.localeCompare(b.date!))
            .slice(0, 4)
            .map((r) => ({
              date: r.date!.slice(0, 10),
              period: "annual" as const,
              revenueAvg: pos(r.revenueAvg),
              revenueLow: pos(r.revenueLow),
              revenueHigh: pos(r.revenueHigh),
              epsAvg: num(r.epsAvg),
              epsLow: num(r.epsLow),
              epsHigh: num(r.epsHigh),
              netIncomeAvg: num(r.netIncomeAvg),
              ebitdaAvg: num(r.ebitdaAvg),
              analystsRevenue: num(r.numAnalystsRevenue),
              analystsEps: num(r.numAnalystsEps),
            }));
          return periods.length > 0 ? { periods } : null;
        },
      },
    ],
  });
  return toSourced(result);
}

// ── financial scores ────────────────────────────────────────────────────────

/** Piotroski F-score and Altman Z-score (FMP only). */
export async function getFinancialScores(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<CompanyScores> | null> {
  const sym = normSymbol(symbol);
  const result = await firstAvailable<CompanyScores>({
    category: "fundamentals",
    attempts: [
      {
        provider: "fmp",
        isAvailable: fmpOn(deps),
        fetch: async () => {
          const row = first(await deps.fmp.get<Array<{ piotroskiScore?: number; altmanZScore?: number; reportedCurrency?: string }>>("/financial-scores", { symbol: toFmpSymbol(sym) }, FMP_TTL.fundamentals));
          if (!row) return null;
          return compact({ piotroski: num(row.piotroskiScore), altmanZ: num(row.altmanZScore), reportedCurrency: str(row.reportedCurrency) });
        },
      },
    ],
  });
  return toSourced(result);
}

// ── DCF ─────────────────────────────────────────────────────────────────────

/** FMP discounted cash flow value against the current price (FMP only). */
export async function getDcf(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<CompanyDcf> | null> {
  const sym = normSymbol(symbol);
  const result = await firstAvailable<CompanyDcf>({
    category: "fundamentals",
    attempts: [
      {
        provider: "fmp",
        isAvailable: fmpOn(deps),
        fetch: async () => {
          const row = first(await deps.fmp.get<Array<Record<string, unknown>>>("/discounted-cash-flow", { symbol: toFmpSymbol(sym) }, FMP_TTL.fundamentals));
          const dcfValue = num(row?.dcf);
          if (!row || dcfValue === undefined) return null;
          const quote = await currentQuote(deps, sym);
          const price = quote?.price ?? pos(row["Stock Price"]);
          return {
            date: str(row.date),
            dcfValue,
            price,
            currency: quote?.currency,
            upside: price ? dcfValue / price - 1 : undefined,
          };
        },
      },
    ],
  });
  return toSourced(result);
}

// ── key metrics and ratios ──────────────────────────────────────────────────

function fromFinnhubMetrics(f: FinnhubBasicFinancials): CompanyKeyMetrics | null {
  const m = f.metric as Record<string, unknown>;
  const cap = pos(m.marketCapitalization);
  return compact({
    peRatio: pos(m.peTTM) ?? pos(m.peBasicExclExtraTTM),
    priceToSales: pos(m.psTTM),
    priceToBook: pos(m.pbQuarterly) ?? pos(m.pbAnnual),
    priceToFreeCashFlow: pos(m.pfcfShareTTM),
    evToEbitda: pos(m.evEbitdaTTM),
    dividendYield: pct(m.dividendYieldIndicatedAnnual),
    payoutRatio: pct(m.payoutRatioTTM),
    grossMargin: pct(m.grossMarginTTM),
    operatingMargin: pct(m.operatingMarginTTM),
    netMargin: pct(m.netProfitMarginTTM),
    returnOnEquity: pct(m.roeTTM),
    returnOnAssets: pct(m.roaTTM),
    returnOnInvestedCapital: pct(m.roiTTM),
    currentRatio: pos(m.currentRatioQuarterly),
    quickRatio: pos(m.quickRatioQuarterly),
    debtToEquity: num(m["totalDebt/totalEquityQuarterly"]),
    interestCoverage: num(m.netInterestCoverageTTM),
    revenueGrowth: pct(m.revenueGrowthTTMYoy),
    epsGrowth: pct(m.epsGrowthTTMYoy),
    beta: num(m.beta),
    marketCap: cap !== undefined ? cap * 1e6 : undefined,
  });
}

/** TTM valuation, profitability and balance sheet ratios. FMP key metrics and ratios, else Finnhub /stock/metric. */
export async function getKeyMetrics(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<CompanyKeyMetrics> | null> {
  const sym = normSymbol(symbol);
  const result = await firstAvailable<CompanyKeyMetrics>({
    category: "fundamentals",
    attempts: [
      {
        provider: "fmp",
        isAvailable: fmpOn(deps),
        fetch: async () => {
          const symbol = toFmpSymbol(sym);
          const [km, r] = await Promise.all([
            deps.fmp.get<Array<Record<string, unknown>>>("/key-metrics-ttm", { symbol }, FMP_TTL.fundamentals).then(first),
            deps.fmp.get<Array<Record<string, unknown>>>("/ratios-ttm", { symbol }, FMP_TTL.fundamentals).then(first),
          ]);
          if (!km && !r) return null;
          return compact({
            peRatio: pos(r?.priceToEarningsRatioTTM),
            pegRatio: num(r?.priceToEarningsGrowthRatioTTM),
            priceToSales: pos(r?.priceToSalesRatioTTM),
            priceToBook: pos(r?.priceToBookRatioTTM),
            priceToFreeCashFlow: pos(r?.priceToFreeCashFlowRatioTTM),
            evToEbitda: num(km?.evToEBITDATTM),
            evToSales: pos(km?.evToSalesTTM),
            earningsYield: num(km?.earningsYieldTTM),
            freeCashFlowYield: num(km?.freeCashFlowYieldTTM),
            dividendYield: num(r?.dividendYieldTTM),
            payoutRatio: num(r?.dividendPayoutRatioTTM),
            grossMargin: num(r?.grossProfitMarginTTM),
            operatingMargin: num(r?.operatingProfitMarginTTM),
            netMargin: num(r?.netProfitMarginTTM),
            returnOnEquity: num(km?.returnOnEquityTTM),
            returnOnAssets: num(km?.returnOnAssetsTTM),
            returnOnInvestedCapital: num(km?.returnOnInvestedCapitalTTM),
            currentRatio: pos(r?.currentRatioTTM) ?? pos(km?.currentRatioTTM),
            quickRatio: pos(r?.quickRatioTTM),
            debtToEquity: num(r?.debtToEquityRatioTTM),
            interestCoverage: pos(r?.interestCoverageRatioTTM),
            netDebtToEbitda: num(km?.netDebtToEBITDATTM),
            marketCap: pos(km?.marketCap),
          });
        },
      },
      {
        provider: "finnhub",
        isAvailable: finnhubOn(deps),
        fetch: async () => {
          const f = await deps.finnhub.getBasicFinancials(sym);
          return f ? fromFinnhubMetrics(f) : null;
        },
      },
    ],
  });
  return toSourced(result);
}

// ── insider activity ────────────────────────────────────────────────────────

interface FmpInsiderTrade {
  transactionDate?: string;
  filingDate?: string;
  reportingName?: string;
  typeOfOwner?: string;
  transactionType?: string;
  acquisitionOrDisposition?: string;
  securitiesTransacted?: number;
  price?: number;
  securitiesOwned?: number;
  url?: string;
}
interface FmpInsiderStats {
  year?: number;
  quarter?: number;
  totalPurchases?: number;
  totalSales?: number;
  acquiredTransactions?: number;
  disposedTransactions?: number;
  totalAcquired?: number;
  totalDisposed?: number;
}

function tradeValue(shares?: number, price?: number): number | undefined {
  return shares !== undefined && price !== undefined && price > 0 ? shares * price : undefined;
}

function quarterOf(date: string): { year: number; quarter: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return null;
  return { year: Number(m[1]), quarter: Math.floor((Number(m[2]) - 1) / 3) + 1 };
}

/** Quarterly purchase and sale counts from individual trades (Finnhub fallback). */
function statsFromTrades(trades: InsiderTrade[]): InsiderQuarterStats[] {
  const byQuarter = new Map<string, Required<InsiderQuarterStats>>();
  for (const t of trades) {
    const q = quarterOf(t.transactionDate || t.filingDate || "");
    if (!q) continue;
    const key = `${q.year}-${q.quarter}`;
    const s = byQuarter.get(key) ?? { ...q, purchases: 0, sales: 0, acquiredTransactions: 0, disposedTransactions: 0, sharesAcquired: 0, sharesDisposed: 0 };
    if (t.isPurchase) s.purchases += 1;
    if (t.isSale) s.sales += 1;
    if (t.acquired) {
      s.acquiredTransactions += 1;
      s.sharesAcquired += t.shares ?? 0;
    } else {
      s.disposedTransactions += 1;
      s.sharesDisposed += t.shares ?? 0;
    }
    byQuarter.set(key, s);
  }
  return Array.from(byQuarter.values()).sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}

/** Recent insider trades and quarterly statistics. FMP, else Finnhub insider transactions (last 180 days). */
export async function getInsiderActivity(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<CompanyInsiderActivity> | null> {
  const sym = normSymbol(symbol);
  const result = await firstAvailable<CompanyInsiderActivity>({
    category: "fundamentals",
    attempts: [
      {
        provider: "fmp",
        isAvailable: fmpOn(deps),
        fetch: async () => {
          const symbol = toFmpSymbol(sym);
          const [rows, stats] = await Promise.all([
            deps.fmp.get<FmpInsiderTrade[]>("/insider-trading/search", { symbol, page: 0, limit: 50 }, FMP_TTL.calendar),
            deps.fmp.get<FmpInsiderStats[]>("/insider-trading/statistics", { symbol }, FMP_TTL.fundamentals),
          ]);
          const trades: InsiderTrade[] = (Array.isArray(rows) ? rows : [])
            .filter((r) => r && str(r.reportingName))
            .sort((a, b) => (b.transactionDate || b.filingDate || "").localeCompare(a.transactionDate || a.filingDate || ""))
            .slice(0, MAX_TRADES)
            .map((r) => {
              const type = str(r.transactionType);
              const shares = num(r.securitiesTransacted);
              const price = num(r.price);
              return {
                transactionDate: str(r.transactionDate),
                filingDate: str(r.filingDate),
                name: r.reportingName!.trim(),
                role: str(r.typeOfOwner),
                transactionType: type,
                acquired: (r.acquisitionOrDisposition || "").toUpperCase() === "A",
                isPurchase: /^P-/i.test(type || ""),
                isSale: /^S-/i.test(type || ""),
                shares,
                price,
                value: tradeValue(shares, price),
                sharesOwnedAfter: num(r.securitiesOwned),
                url: str(r.url),
              };
            });
          const statistics: InsiderQuarterStats[] = (Array.isArray(stats) ? stats : [])
            .filter((s) => s && num(s.year) && num(s.quarter))
            .sort((a, b) => b.year! - a.year! || b.quarter! - a.quarter!)
            .slice(0, 4)
            .map((s) => ({
              year: s.year!,
              quarter: s.quarter!,
              purchases: num(s.totalPurchases) ?? 0,
              sales: num(s.totalSales) ?? 0,
              acquiredTransactions: num(s.acquiredTransactions),
              disposedTransactions: num(s.disposedTransactions),
              sharesAcquired: num(s.totalAcquired),
              sharesDisposed: num(s.totalDisposed),
            }));
          return trades.length > 0 || statistics.length > 0 ? { trades, statistics } : null;
        },
      },
      {
        provider: "finnhub",
        isAvailable: finnhubOn(deps),
        fetch: async () => {
          const now = Date.now();
          const rows = await deps.finnhub.getInsiderTransactions(sym, isoDate(now - 180 * DAY_MS), isoDate(now));
          const all: InsiderTrade[] = rows.map((r: FinnhubInsiderTransaction) => {
            const change = num(r.change) ?? 0;
            const code = (r.transactionCode || "").toUpperCase();
            const shares = Math.abs(change);
            const price = num(r.transactionPrice);
            return {
              transactionDate: str(r.transactionDate),
              filingDate: str(r.filingDate),
              name: r.name.trim(),
              transactionType: code || undefined,
              acquired: change > 0,
              isPurchase: code === "P",
              isSale: code === "S",
              shares,
              price,
              value: tradeValue(shares, price),
              sharesOwnedAfter: num(r.share),
            };
          });
          return all.length > 0 ? { trades: all.slice(0, MAX_TRADES), statistics: statsFromTrades(all).slice(0, 4) } : null;
        },
      },
    ],
  });
  return toSourced(result);
}

// ── press releases and news ─────────────────────────────────────────────────

function fromFmpArticles(rows: FmpNewsArticle[] | null): CompanyNewsItem[] | null {
  if (!Array.isArray(rows)) return null;
  return rows
    .filter((r) => r && str(r.title))
    .map((r) => ({ title: r.title.trim(), summary: cut(r.text, NEWS_SUMMARY_CHARS), publisher: str(r.publisher) ?? str(r.site), url: str(r.url), datetime: fmpDateToUnix(r.publishedDate) }))
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, MAX_NEWS);
}

/** Official press releases (FMP only). */
export async function getPressReleases(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<CompanyNewsItem[]> | null> {
  const sym = normSymbol(symbol);
  const result = await firstAvailable<CompanyNewsItem[]>({
    category: "news",
    attempts: [
      {
        provider: "fmp",
        isAvailable: fmpOn(deps),
        fetch: async () => fromFmpArticles(await deps.fmp.get<FmpNewsArticle[]>("/news/press-releases", { symbols: toFmpSymbol(sym), page: 0, limit: 10 }, FMP_TTL.news)),
      },
    ],
  });
  return toSourced(result);
}

/** Recent stock news. FMP, else Finnhub company news of the last 14 days. */
export async function getCompanyNews(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<CompanyNewsItem[]> | null> {
  const sym = normSymbol(symbol);
  const result = await firstAvailable<CompanyNewsItem[]>({
    category: "companyNews",
    attempts: [
      { provider: "fmp", isAvailable: fmpOn(deps), fetch: async () => fromFmpArticles(await deps.fmp.getStockNews([toFmpSymbol(sym)], { limit: 10 })) },
      {
        provider: "finnhub",
        isAvailable: finnhubOn(deps),
        fetch: async () => {
          const now = Date.now();
          const rows = await deps.finnhub.getCompanyNews(sym, isoDate(now - 14 * DAY_MS), isoDate(now), MAX_NEWS);
          return rows.map((n) => ({ title: n.headline.trim(), summary: cut(n.summary, NEWS_SUMMARY_CHARS), publisher: str(n.source), url: str(n.url), datetime: n.datetime }));
        },
      },
    ],
  });
  return toSourced(result);
}

// ── peers ───────────────────────────────────────────────────────────────────

/** Companies in the same sector and size range. FMP (with name, price, market cap), else Finnhub (symbols only). */
export async function getPeers(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<CompanyPeer[]> | null> {
  const sym = normSymbol(symbol);
  const result = await firstAvailable<CompanyPeer[]>({
    category: "fundamentals",
    attempts: [
      {
        provider: "fmp",
        isAvailable: fmpOn(deps),
        fetch: async () => {
          const rows = await deps.fmp.get<Array<{ symbol?: string; companyName?: string; price?: number; mktCap?: number }>>("/stock-peers", { symbol: toFmpSymbol(sym) }, FMP_TTL.fundamentals);
          if (!Array.isArray(rows)) return null;
          return rows
            .filter((r) => r && str(r.symbol) && normSymbol(r.symbol!) !== toFmpSymbol(sym))
            .slice(0, MAX_PEERS)
            .map((r) => ({ symbol: r.symbol!.trim(), name: str(r.companyName), price: pos(r.price), marketCap: pos(r.mktCap) }));
        },
      },
      {
        provider: "finnhub",
        isAvailable: finnhubOn(deps),
        fetch: async () => (await deps.finnhub.getPeers(sym)).slice(0, MAX_PEERS).map((s) => ({ symbol: s.trim() })),
      },
    ],
  });
  return toSourced(result);
}

// ── earnings call transcripts (FMP only) ────────────────────────────────────

/** The latest earnings call with a transcript, or null. */
export async function getLatestTranscriptMeta(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<TranscriptMeta> | null> {
  const sym = normSymbol(symbol);
  const result = await firstAvailable<TranscriptMeta>({
    category: "fundamentals",
    attempts: [
      {
        provider: "fmp",
        isAvailable: fmpOn(deps),
        fetch: async () => {
          const rows = await deps.fmp.get<Array<{ quarter?: number; fiscalYear?: number; date?: string }>>("/earning-call-transcript-dates", { symbol: toFmpSymbol(sym) }, FMP_TTL.calendar);
          if (!Array.isArray(rows)) return null;
          const today = isoDate(Date.now());
          const latest = rows
            .filter((r) => r && num(r.fiscalYear) && num(r.quarter) && (!r.date || r.date.slice(0, 10) <= today))
            .sort((a, b) => b.fiscalYear! - a.fiscalYear! || b.quarter! - a.quarter! || (b.date || "").localeCompare(a.date || ""))[0];
          return latest ? { symbol: sym, fiscalYear: latest.fiscalYear!, quarter: latest.quarter!, date: str(latest.date)?.slice(0, 10) } : null;
        },
      },
    ],
  });
  return toSourced(result);
}

/** The full text of the latest earnings call transcript (FMP only), or null. */
export async function getLatestTranscript(deps: CompanyIntelDeps, symbol: string): Promise<Sourced<EarningsTranscript> | null> {
  const meta = await getLatestTranscriptMeta(deps, symbol);
  if (!meta) return null;
  const { fiscalYear, quarter } = meta.data;
  const row = first(
    await deps.fmp.get<Array<{ content?: string; date?: string }>>(
      "/earning-call-transcript",
      { symbol: toFmpSymbol(meta.data.symbol), year: fiscalYear, quarter },
      TRANSCRIPT_TTL_MS,
    ),
  );
  const text = (row?.content || "").trim();
  if (!text) return null;
  return { data: { ...meta.data, date: meta.data.date ?? str(row?.date)?.slice(0, 10), text, length: text.length }, source: meta.source };
}

/**
 * Cuts a transcript to at most `maxChars` for a model prompt. Keeps the
 * first two thirds (prepared remarks: results and guidance) and the last
 * third (end of the Q&A), cut at whitespace, with a marker in between.
 */
export function trimTranscript(text: string, maxChars = DEFAULT_TRANSCRIPT_PROMPT_CHARS): { text: string; trimmed: boolean } {
  const clean = (text || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= maxChars) return { text: clean, trimmed: false };
  const marker = "\n\n[... part of the call omitted ...]\n\n";
  const budget = Math.max(0, maxChars - marker.length);
  const headLen = Math.floor(budget * (2 / 3));
  const tailLen = budget - headLen;
  let head = clean.slice(0, headLen);
  const headCut = head.lastIndexOf(" ");
  if (headCut > headLen * 0.9) head = head.slice(0, headCut);
  let tail = clean.slice(clean.length - tailLen);
  const tailCut = tail.indexOf(" ");
  if (tailCut >= 0 && tailCut < tailLen * 0.1) tail = tail.slice(tailCut + 1);
  return { text: `${head.trimEnd()}${marker}${tail.trimStart()}`, trimmed: true };
}

const summaryInFlight = new Map<string, Promise<TranscriptSummary | null>>();

function summaryCacheKey(meta: TranscriptMeta): string {
  return `intel:transcript-summary:${meta.symbol}:${meta.fiscalYear}Q${meta.quarter}`;
}

/** The cached summary of the latest call, without calling the model. */
export async function getCachedTranscriptSummary(deps: CompanyIntelDeps, symbol: string): Promise<TranscriptSummary | null> {
  const meta = await getLatestTranscriptMeta(deps, symbol);
  if (!meta) return null;
  const cached = marketCache.get<Omit<TranscriptSummary, "cached">>(summaryCacheKey(meta.data));
  return cached?.data?.summary ? { ...cached.data, cached: true } : null;
}

export function buildTranscriptSummaryPrompt(meta: TranscriptMeta, transcript: string, trimmed: boolean, companyName?: string): LlmMessage[] {
  const company = companyName ? `${companyName} (${meta.symbol})` : meta.symbol;
  return [
    {
      role: "system",
      content: [
        "You are an equity analyst. Summarize an earnings call transcript for a private investor.",
        "Use only facts stated in the transcript. Do not invent numbers. Say so when the call does not cover a section.",
        "Write Markdown with these sections, each a short bulleted list:",
        "## Results (revenue, earnings, margins, versus last year or guidance)",
        "## Guidance and outlook",
        "## Strategy and management comments",
        "## Analyst questions",
        "## Risks and concerns",
        "## Tone (one line: confident, cautious or mixed, and why)",
        "Keep it under 300 words. Short active sentences. No preamble.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `${company}, Q${meta.quarter} fiscal ${meta.fiscalYear} earnings call${meta.date ? ` on ${meta.date}` : ""}.${trimmed ? " The transcript was shortened; a marker shows the cut." : ""}\n\nTranscript:\n\n${transcript}`,
    },
  ];
}

export interface SummarizeTranscriptOptions {
  /** Ignore the cached summary and ask the model again. */
  force?: boolean;
  /** Transcript characters sent to the model. Default `DEFAULT_TRANSCRIPT_PROMPT_CHARS`. */
  maxChars?: number;
  /** LLM provider and model; default the ones in Settings. */
  provider?: string;
  model?: string;
}

/**
 * Summarizes the latest earnings call with the configured LLM. Cached per
 * symbol and fiscal quarter in `market_cache` (`intel:transcript-summary:`,
 * one year; Clear Market Cache keeps it). Null when no transcript is
 * available (no FMP key or plan, or no call on record). Throws when the
 * model fails.
 */
export async function summarizeTranscript(deps: TranscriptSummaryDeps, symbol: string, options: SummarizeTranscriptOptions = {}): Promise<TranscriptSummary | null> {
  const meta = await getLatestTranscriptMeta(deps, symbol);
  if (!meta) return null;
  const key = summaryCacheKey(meta.data);
  if (!options.force) {
    const cached = marketCache.get<Omit<TranscriptSummary, "cached">>(key);
    if (cached?.data?.summary) return { ...cached.data, cached: true };
  }
  const existing = summaryInFlight.get(key);
  if (existing) return existing;

  const run = (async (): Promise<TranscriptSummary | null> => {
    const [transcript, profile] = await Promise.all([getLatestTranscript(deps, symbol), deps.fmp.getProfile(toFmpSymbol(meta.data.symbol)).catch(() => null)]);
    if (!transcript) return null;
    const { text, trimmed } = trimTranscript(transcript.data.text, options.maxChars ?? DEFAULT_TRANSCRIPT_PROMPT_CHARS);
    const timer = appLogger.startTimer("intel", "transcript_summary");
    try {
      const raw = await deps.llm.chat(buildTranscriptSummaryPrompt(transcript.data, text, trimmed, str(profile?.companyName)), {
        provider: options.provider,
        model: options.model,
        maxTokens: 1200,
        temperature: 0.2,
      });
      const summary = sanitizeLlmResponse(raw);
      if (!summary) throw new Error("The model returned an empty summary");
      const value: Omit<TranscriptSummary, "cached"> = {
        symbol: transcript.data.symbol,
        fiscalYear: transcript.data.fiscalYear,
        quarter: transcript.data.quarter,
        date: transcript.data.date,
        summary,
        generatedAt: new Date().toISOString(),
        trimmed,
      };
      marketCache.set(key, value, SUMMARY_TTL_MS);
      timer.end("info", "Summarized an earnings call transcript", { trimmed, chars: text.length });
      return { ...value, cached: false };
    } catch (err) {
      timer.fail(err, "Earnings call summary failed");
      throw err;
    }
  })().finally(() => summaryInFlight.delete(key));
  summaryInFlight.set(key, run);
  return run;
}

// ── aggregate ───────────────────────────────────────────────────────────────

export interface CompanyIntelOptions {
  /** Parts to fetch; default every part. */
  include?: readonly CompanyIntelPart[];
  /** Portfolio asset type ("Stock", "ETF", ...). Unknown types are checked against the profile. */
  assetType?: string;
  isPrivate?: boolean;
}

const FETCHERS: { [P in Exclude<CompanyIntelPart, "profile">]: (deps: CompanyIntelDeps, symbol: string) => Promise<CompanyIntel[P]> } = {
  analyst: getAnalystView,
  estimates: getEstimates,
  scores: getFinancialScores,
  dcf: getDcf,
  metrics: getKeyMetrics,
  insider: getInsiderActivity,
  press: getPressReleases,
  news: getCompanyNews,
  peers: getPeers,
  transcript: getLatestTranscriptMeta,
};

function emptyIntel(symbol: string): CompanyIntel {
  return {
    symbol,
    fetchedAt: new Date().toISOString(),
    included: [],
    skipped: [],
    profile: null,
    analyst: null,
    estimates: null,
    scores: null,
    dcf: null,
    metrics: null,
    insider: null,
    press: null,
    news: null,
    peers: null,
    transcript: null,
  };
}

async function safe<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    appLogger.logStep("warning", "intel", "part_failed", `A company intel part failed (${err instanceof Error ? err.name : typeof err})`);
    return null;
  }
}

/**
 * Fetches the requested parts for one symbol concurrently; every FMP call
 * still goes through the shared throttle and cache. Cash, crypto, FX pairs,
 * indices and private assets get an empty result. ETFs and funds get only
 * `FUND_INTEL_PARTS`. When the asset type is unknown and company-only parts
 * are asked, the profile decides (it is cached for a day).
 */
export async function getCompanyIntel(deps: CompanyIntelDeps, symbol: string, options: CompanyIntelOptions = {}): Promise<CompanyIntel> {
  const sym = normSymbol(symbol);
  const intel = emptyIntel(sym);
  const include = options.include && options.include.length > 0 ? options.include : COMPANY_INTEL_PARTS;
  if (!isIntelEligible(sym, options.assetType, options.isPrivate)) {
    intel.skipped = Array.from(new Set(include));
    return intel;
  }

  const fund = isFundType(options.assetType);
  let { parts, skipped } = applicableParts(include, fund);
  const companyOnly = parts.some((p) => !FUND_INTEL_PARTS.includes(p));
  const knownType = options.assetType === "Stock" || fund;

  if (parts.includes("profile") || (companyOnly && !knownType)) {
    intel.profile = await safe(() => getCompanyProfile(deps, sym));
    if (!knownType && (intel.profile?.data.isEtf || intel.profile?.data.isFund)) {
      ({ parts, skipped } = applicableParts(include, true));
    }
    if (!parts.includes("profile")) intel.profile = null;
  }

  intel.included = parts;
  intel.skipped = skipped;
  await Promise.all(
    parts
      .filter((p): p is Exclude<CompanyIntelPart, "profile"> => p !== "profile")
      .map(async (part) => {
        const value = await safe(() => FETCHERS[part](deps, sym) as Promise<unknown>);
        (intel as unknown as Record<string, unknown>)[part] = value;
      }),
  );
  intel.fetchedAt = new Date().toISOString();
  return intel;
}

export interface CompanyIntelBatchItem {
  symbol: string;
  assetType?: string;
  isPrivate?: boolean;
}

/**
 * Intel for many holdings (a whole portfolio): dedupes symbols, leaves out
 * the ones without company data, and runs `concurrency` symbols at a time
 * (default 3; each symbol's FMP calls share the FMP throttle). Keyed by the
 * upper-case symbol. Ask only the parts you need: every part is one to five
 * provider calls per symbol on a cold cache.
 */
export async function getCompanyIntelBatch(
  deps: CompanyIntelDeps,
  items: readonly CompanyIntelBatchItem[],
  options: { include?: readonly CompanyIntelPart[]; concurrency?: number } = {},
): Promise<Map<string, CompanyIntel>> {
  const unique = new Map<string, CompanyIntelBatchItem>();
  for (const item of items) {
    const sym = normSymbol(item.symbol || "");
    if (!sym || unique.has(sym) || !isIntelEligible(sym, item.assetType, item.isPrivate)) continue;
    unique.set(sym, { ...item, symbol: sym });
  }
  const out = new Map<string, CompanyIntel>();
  const list = Array.from(unique.values());
  await mapWithConcurrencyLimit(list, Math.max(1, options.concurrency ?? 3), async (item) => {
    out.set(item.symbol, await getCompanyIntel(deps, item.symbol, { include: options.include, assetType: item.assetType, isPrivate: item.isPrivate }));
  });
  appLogger.logStep("debug", "intel", "batch", `Company intel for ${out.size} of ${items.length} holdings`);
  return out;
}

// ── prompt formatting ───────────────────────────────────────────────────────

function fmtNum(value: number | undefined, digits = 2): string | undefined {
  return value === undefined ? undefined : value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtPct(value: number | undefined, digits = 1): string | undefined {
  return value === undefined ? undefined : `${(value * 100).toFixed(digits)}%`;
}

function fmtBig(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return fmtNum(value, 0);
}

function fmtDate(unix: number): string {
  return unix > 0 ? new Date(unix * 1000).toISOString().slice(0, 10) : "";
}

function joinDefined(parts: Array<string | undefined | false>, sep = ", "): string {
  return parts.filter((p): p is string => Boolean(p)).join(sep);
}

export interface FormatIntelOptions {
  /** Hard cap on the block length. Default 2500. */
  maxChars?: number;
  maxGrades?: number;
  maxNews?: number;
  /** Include the news and press release headlines. Default true. */
  headlines?: boolean;
}

/**
 * A compact plain-text block of one company's intel for an LLM prompt, one
 * line per part, each tagged with its source. Parts without data are left
 * out. Holds public company data only.
 */
export function formatCompanyIntelForPrompt(intel: CompanyIntel, options: FormatIntelOptions = {}): string {
  const maxGrades = options.maxGrades ?? 3;
  const maxNews = options.maxNews ?? 3;
  const lines: string[] = [];
  const p = intel.profile?.data;
  lines.push(
    `### ${intel.symbol}${p?.name ? ` (${p.name})` : ""}` +
      (p ? ` ${joinDefined([joinDefined([p.sector, p.industry], " / "), p.country, p.currency, p.marketCap ? `market cap ${fmtBig(p.marketCap)}` : undefined])} [${intel.profile!.source}]` : ""),
  );

  const a = intel.analyst?.data;
  if (a) {
    const r = a.recommendations;
    const t = a.priceTarget;
    const vs = a.currentPrice && t?.consensus ? ` (${fmtPct(t.consensus / a.currentPrice - 1)} vs price ${fmtNum(a.currentPrice)})` : "";
    const grades = a.grades.slice(0, maxGrades).map((g) => `${g.date} ${g.firm} ${g.action ?? ""} ${g.newGrade ?? ""}`.replace(/\s+/g, " ").trim());
    lines.push(
      `Analysts [${intel.analyst!.source}${a.recommendationsSource ? `, counts ${a.recommendationsSource}` : ""}]: ` +
        joinDefined(
          [
            r ? `${r.consensus ?? "n/a"} (strong buy ${r.strongBuy}, buy ${r.buy}, hold ${r.hold}, sell ${r.sell}, strong sell ${r.strongSell})` : undefined,
            t ? `target ${joinDefined([t.low !== undefined && t.high !== undefined ? `${fmtNum(t.low)}-${fmtNum(t.high)}` : undefined, t.median !== undefined ? `median ${fmtNum(t.median)}` : undefined, t.consensus !== undefined ? `consensus ${fmtNum(t.consensus)}${vs}` : undefined])}` : undefined,
            a.rating?.rating ? `FMP rating ${a.rating.rating}${a.rating.overallScore !== undefined ? ` (${a.rating.overallScore}/5)` : ""}` : undefined,
            grades.length ? `recent: ${grades.join("; ")}` : undefined,
          ],
          "; ",
        ),
    );
  }

  const e = intel.estimates?.data;
  if (e && e.periods.length) {
    lines.push(
      `Estimates [${intel.estimates!.source}]: ` +
        e.periods
          .slice(0, 3)
          .map((x) => `FY ending ${x.date}: ${joinDefined([x.epsAvg !== undefined ? `EPS ${fmtNum(x.epsAvg)}` : undefined, x.revenueAvg !== undefined ? `revenue ${fmtBig(x.revenueAvg)}` : undefined])}`)
          .join("; "),
    );
  }

  const s = intel.scores?.data;
  if (s) {
    lines.push(
      `Scores [${intel.scores!.source}]: ` +
        joinDefined([
          s.piotroski !== undefined ? `Piotroski ${s.piotroski}/9 (${describePiotroski(s.piotroski).label})` : undefined,
          s.altmanZ !== undefined ? `Altman Z ${s.altmanZ.toFixed(2)} (${describeAltmanZ(s.altmanZ).label})` : undefined,
        ]),
    );
  }

  const d = intel.dcf?.data;
  if (d) lines.push(`DCF [${intel.dcf!.source}]: value ${fmtNum(d.dcfValue)}${d.price ? ` vs price ${fmtNum(d.price)} (${fmtPct(d.upside)})` : ""}`);

  const m = intel.metrics?.data;
  if (m) {
    lines.push(
      `Ratios TTM [${intel.metrics!.source}]: ` +
        joinDefined([
          m.peRatio !== undefined ? `P/E ${fmtNum(m.peRatio, 1)}` : undefined,
          m.priceToSales !== undefined ? `P/S ${fmtNum(m.priceToSales, 1)}` : undefined,
          m.priceToBook !== undefined ? `P/B ${fmtNum(m.priceToBook, 1)}` : undefined,
          m.evToEbitda !== undefined ? `EV/EBITDA ${fmtNum(m.evToEbitda, 1)}` : undefined,
          m.freeCashFlowYield !== undefined ? `FCF yield ${fmtPct(m.freeCashFlowYield)}` : undefined,
          m.dividendYield !== undefined ? `dividend yield ${fmtPct(m.dividendYield)}` : undefined,
          m.grossMargin !== undefined ? `gross margin ${fmtPct(m.grossMargin)}` : undefined,
          m.operatingMargin !== undefined ? `operating margin ${fmtPct(m.operatingMargin)}` : undefined,
          m.netMargin !== undefined ? `net margin ${fmtPct(m.netMargin)}` : undefined,
          m.returnOnEquity !== undefined ? `ROE ${fmtPct(m.returnOnEquity)}` : undefined,
          m.debtToEquity !== undefined ? `debt/equity ${fmtNum(m.debtToEquity)}` : undefined,
          m.currentRatio !== undefined ? `current ratio ${fmtNum(m.currentRatio)}` : undefined,
          m.revenueGrowth !== undefined ? `revenue growth ${fmtPct(m.revenueGrowth)}` : undefined,
        ]),
    );
  }

  const ins = intel.insider?.data;
  if (ins) {
    const q = ins.statistics[0];
    const recent = ins.trades.slice(0, 3).map((t) => `${t.transactionDate ?? t.filingDate ?? ""} ${t.name}${t.role ? ` (${t.role})` : ""} ${t.isPurchase ? "bought" : t.isSale ? "sold" : t.acquired ? "acquired" : "disposed of"}${t.value ? ` ${fmtBig(t.value)}` : ""}`.trim());
    lines.push(
      `Insiders [${intel.insider!.source}]: ` +
        joinDefined([q ? `Q${q.quarter} ${q.year}: ${q.purchases} purchases, ${q.sales} sales` : undefined, recent.length ? `recent: ${recent.join("; ")}` : undefined], "; "),
    );
  }

  if (options.headlines !== false) {
    for (const [label, part] of [["Press releases", intel.press], ["News", intel.news]] as const) {
      const items = part?.data.slice(0, maxNews) ?? [];
      if (items.length) lines.push(`${label} [${part!.source}]: ${items.map((n) => `${fmtDate(n.datetime)} ${n.title}`.trim()).join(" | ")}`);
    }
  }

  const peers = intel.peers?.data;
  if (peers?.length) lines.push(`Peers [${intel.peers!.source}]: ${peers.slice(0, 6).map((x) => x.symbol).join(", ")}`);

  const tr = intel.transcript?.data;
  if (tr) lines.push(`Latest earnings call: Q${tr.quarter} FY${tr.fiscalYear}${tr.date ? ` on ${tr.date}` : ""} [${intel.transcript!.source}]`);

  const text = lines.join("\n");
  const max = options.maxChars ?? 2500;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Several companies' blocks, within a total character budget (default 12000). */
export function formatCompanyIntelListForPrompt(intels: Iterable<CompanyIntel>, options: FormatIntelOptions & { totalChars?: number } = {}): string {
  const total = options.totalChars ?? 12_000;
  const out: string[] = [];
  let used = 0;
  for (const intel of intels) {
    const block = formatCompanyIntelForPrompt(intel, options);
    if (used + block.length + 2 > total) break;
    out.push(block);
    used += block.length + 2;
  }
  return out.join("\n\n");
}

// ── route helpers (HTTP shapes; errors become messages, so no path with a symbol is logged) ──

/** `GET /api/symbols/:symbol/transcript`. */
export async function getTranscriptResponse(deps: CompanyIntelDeps, symbol: string): Promise<GetTranscriptResponse> {
  const transcript = await getLatestTranscript(deps, symbol).catch(() => null);
  const summary = transcript ? marketCache.get<Omit<TranscriptSummary, "cached">>(summaryCacheKey(transcript.data)) : null;
  return {
    transcript: transcript?.data ?? null,
    source: transcript?.source ?? null,
    summary: summary?.data?.summary ? { ...summary.data, cached: true } : null,
  };
}

/** `POST /api/symbols/:symbol/transcript/summary`. */
export async function summarizeTranscriptResponse(deps: TranscriptSummaryDeps, symbol: string, options: SummarizeTranscriptOptions = {}): Promise<SummarizeTranscriptResponse> {
  try {
    const summary = await summarizeTranscript(deps, symbol, options);
    return summary ? { summary } : { summary: null, error: "No earnings call transcript is available. Transcripts need a Financial Modeling Prep key with transcript access." };
  } catch (err) {
    return { summary: null, error: err instanceof Error ? err.message : String(err) };
  }
}
