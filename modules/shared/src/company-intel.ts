/**
 * Per-company intelligence: normalized shapes of profile, analyst views,
 * estimates, scores, valuation, ratios, insider activity, news, peers and
 * earnings call transcripts. The service fills them from the best provider
 * available (modules/service/src/services/intel/company.ts) and tags each
 * part with its source; the GUI and the assistant read only these shapes.
 *
 * Ratios, margins, returns and yields are fractions (0.27 = 27%). Money is in
 * the company's trading or reporting currency, never in the portfolio's base
 * currency.
 */
import type { DataProviderId } from "./config-types";

/** The parts `getCompanyIntel` can fetch. */
export const COMPANY_INTEL_PARTS = ["profile", "analyst", "estimates", "scores", "dcf", "metrics", "insider", "press", "news", "peers", "transcript"] as const;
export type CompanyIntelPart = (typeof COMPANY_INTEL_PARTS)[number];

/** Parts that apply to an ETF or a fund: the rest describe an operating company. */
export const FUND_INTEL_PARTS: readonly CompanyIntelPart[] = ["profile", "news"];

/** A value and the provider that supplied it. */
export interface Sourced<T> {
  data: T;
  source: DataProviderId;
}

export interface CompanyProfile {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  sector?: string;
  industry?: string;
  country?: string;
  /** Market capitalization in `currency`. */
  marketCap?: number;
  beta?: number;
  price?: number;
  ceo?: string;
  employees?: number;
  website?: string;
  description?: string;
  logoUrl?: string;
  ipoDate?: string;
  isEtf?: boolean;
  isFund?: boolean;
  isAdr?: boolean;
}

/** One analyst rating action (upgrade, downgrade, maintain, initiate). */
export interface AnalystGrade {
  date: string;
  firm: string;
  previousGrade?: string;
  newGrade?: string;
  action?: string;
}

/** Number of analysts per recommendation. */
export interface AnalystRecommendationCounts {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  /** Provider label such as "Buy", or one derived from the counts. */
  consensus?: string;
  /** Month the counts refer to ("YYYY-MM-DD"), when the provider gives one. */
  period?: string;
}

export interface CompanyAnalystView {
  /** Latest price, for comparing with the targets. */
  currentPrice?: number;
  currency?: string;
  priceTarget?: {
    low?: number;
    high?: number;
    median?: number;
    consensus?: number;
    /** Analysts with a target in the last month, quarter and year. */
    lastMonthCount?: number;
    lastQuarterCount?: number;
    lastYearCount?: number;
    lastQuarterAverage?: number;
  };
  recommendations?: AnalystRecommendationCounts;
  /** Provider of `recommendations` when it differs from the section source. */
  recommendationsSource?: DataProviderId;
  /** Newest first. */
  grades: AnalystGrade[];
  /** FMP ratings snapshot: letter rating and 1-5 sub-scores. */
  rating?: {
    rating?: string;
    overallScore?: number;
    dcfScore?: number;
    roeScore?: number;
    roaScore?: number;
    debtToEquityScore?: number;
    peScore?: number;
    pbScore?: number;
  };
}

/** Consensus estimate for one fiscal period. */
export interface CompanyEstimate {
  /** Fiscal period end ("YYYY-MM-DD"). */
  date: string;
  period: "annual" | "quarter";
  revenueAvg?: number;
  revenueLow?: number;
  revenueHigh?: number;
  epsAvg?: number;
  epsLow?: number;
  epsHigh?: number;
  netIncomeAvg?: number;
  ebitdaAvg?: number;
  analystsRevenue?: number;
  analystsEps?: number;
}

export interface CompanyEstimates {
  /** Upcoming fiscal periods first. */
  periods: CompanyEstimate[];
}

export interface CompanyScores {
  /** 0 to 9. */
  piotroski?: number;
  altmanZ?: number;
  reportedCurrency?: string;
}

export interface CompanyDcf {
  date?: string;
  dcfValue: number;
  price?: number;
  currency?: string;
  /** dcfValue / price − 1; positive means the model values the stock above its price. */
  upside?: number;
}

/** Trailing twelve month metrics. Fractions for margins, returns and yields. */
export interface CompanyKeyMetrics {
  peRatio?: number;
  pegRatio?: number;
  priceToSales?: number;
  priceToBook?: number;
  priceToFreeCashFlow?: number;
  evToEbitda?: number;
  evToSales?: number;
  earningsYield?: number;
  freeCashFlowYield?: number;
  dividendYield?: number;
  payoutRatio?: number;
  grossMargin?: number;
  operatingMargin?: number;
  netMargin?: number;
  returnOnEquity?: number;
  returnOnAssets?: number;
  returnOnInvestedCapital?: number;
  currentRatio?: number;
  quickRatio?: number;
  debtToEquity?: number;
  interestCoverage?: number;
  netDebtToEbitda?: number;
  revenueGrowth?: number;
  epsGrowth?: number;
  beta?: number;
  marketCap?: number;
}

export interface InsiderTrade {
  transactionDate?: string;
  filingDate?: string;
  name: string;
  role?: string;
  /** Provider code, e.g. "S-Sale", "P-Purchase", "A-Award", or Finnhub's "S", "P". */
  transactionType?: string;
  /** True for shares acquired, false for shares disposed of. */
  acquired: boolean;
  /** An open-market purchase (code P). */
  isPurchase: boolean;
  /** An open-market sale (code S). */
  isSale: boolean;
  shares?: number;
  price?: number;
  /** shares × price, when both are known and the price is above zero. */
  value?: number;
  sharesOwnedAfter?: number;
  url?: string;
}

export interface InsiderQuarterStats {
  year: number;
  quarter: number;
  purchases: number;
  sales: number;
  acquiredTransactions?: number;
  disposedTransactions?: number;
  sharesAcquired?: number;
  sharesDisposed?: number;
}

export interface CompanyInsiderActivity {
  /** Newest first. */
  trades: InsiderTrade[];
  /** Newest quarter first. */
  statistics: InsiderQuarterStats[];
}

export interface CompanyNewsItem {
  title: string;
  summary?: string;
  publisher?: string;
  url?: string;
  /** Unix seconds. */
  datetime: number;
}

export interface CompanyPeer {
  symbol: string;
  name?: string;
  price?: number;
  marketCap?: number;
}

export interface TranscriptMeta {
  symbol: string;
  fiscalYear: number;
  quarter: number;
  /** Call date "YYYY-MM-DD". */
  date?: string;
}

export interface EarningsTranscript extends TranscriptMeta {
  text: string;
  /** Characters in the full transcript. */
  length: number;
}

export interface TranscriptSummary extends TranscriptMeta {
  /** Markdown, cleaned with sanitizeLlmResponse(). */
  summary: string;
  generatedAt: string;
  /** True when the summary came from the cache. */
  cached: boolean;
  /** True when the transcript was cut to fit the model. */
  trimmed: boolean;
}

/** Every part is null when no provider had it (or it was not asked for). */
export interface CompanyIntel {
  symbol: string;
  fetchedAt: string;
  /** Parts asked for and applicable to this kind of asset. */
  included: CompanyIntelPart[];
  /** Parts skipped because they do not apply (an ETF has no insider trades). */
  skipped: CompanyIntelPart[];
  profile: Sourced<CompanyProfile> | null;
  analyst: Sourced<CompanyAnalystView> | null;
  estimates: Sourced<CompanyEstimates> | null;
  scores: Sourced<CompanyScores> | null;
  dcf: Sourced<CompanyDcf> | null;
  metrics: Sourced<CompanyKeyMetrics> | null;
  insider: Sourced<CompanyInsiderActivity> | null;
  press: Sourced<CompanyNewsItem[]> | null;
  news: Sourced<CompanyNewsItem[]> | null;
  peers: Sourced<CompanyPeer[]> | null;
  /** Metadata of the latest call; the text comes from the transcript route. */
  transcript: Sourced<TranscriptMeta> | null;
}

// ── plain explanations, shared by the GUI and the prompt formatter ─────────

export type ScoreTone = "good" | "neutral" | "bad";

/** Piotroski F-score: nine pass/fail checks on profitability, leverage and efficiency. */
export function describePiotroski(score: number): { label: string; tone: ScoreTone; explanation: string } {
  if (score >= 7) return { label: "Strong", tone: "good", explanation: `${score} of 9 checks on profit, debt and efficiency pass. Fundamentals are improving.` };
  if (score >= 4) return { label: "Average", tone: "neutral", explanation: `${score} of 9 checks on profit, debt and efficiency pass. Mixed fundamentals.` };
  return { label: "Weak", tone: "bad", explanation: `Only ${score} of 9 checks on profit, debt and efficiency pass. Fundamentals are weakening.` };
}

/** Altman Z-score: bankruptcy risk from working capital, retained earnings, EBIT, market value and sales. */
export function describeAltmanZ(z: number): { label: string; tone: ScoreTone; explanation: string } {
  if (z >= 3) return { label: "Safe zone", tone: "good", explanation: "Above 3: low risk of financial distress in the next two years." };
  if (z >= 1.8) return { label: "Grey zone", tone: "neutral", explanation: "Between 1.8 and 3: some risk of financial distress. Watch debt and cash flow." };
  return { label: "Distress zone", tone: "bad", explanation: "Below 1.8: high risk of financial distress. Banks and insurers often score low by design." };
}

/** A consensus label from recommendation counts, when the provider gives none. */
export function consensusFromCounts(c: Pick<AnalystRecommendationCounts, "strongBuy" | "buy" | "hold" | "sell" | "strongSell">): string | undefined {
  const total = c.strongBuy + c.buy + c.hold + c.sell + c.strongSell;
  if (total <= 0) return undefined;
  const score = (c.strongBuy * 5 + c.buy * 4 + c.hold * 3 + c.sell * 2 + c.strongSell) / total;
  if (score >= 4.5) return "Strong Buy";
  if (score >= 3.5) return "Buy";
  if (score >= 2.5) return "Hold";
  if (score >= 1.5) return "Sell";
  return "Strong Sell";
}
