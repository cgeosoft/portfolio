/**
 * Guest ABI of a metric module: the binary input layout and the data
 * scopes. `scripts/build-metrics.ts` generates the AssemblyScript accessor
 * (`extras/metrics/_sdk/portfolio.ts`) from these tables and the main process
 * encodes the payload from the same tables, so host and guest cannot drift.
 *
 * Layout (all integers little-endian, every block 8-byte aligned):
 *
 *   header      u32 magic "PMET", u32 abi, u32 scopeMask,
 *               u32 summaryOffset, u32 holdingsOffset, u32 transactionsOffset,
 *               u32 historyOffset, u32 stringsOffset,
 *               (v2) u32 fundamentalsOffset, u32 pad
 *   summary     u32 fieldCount, u32 pad, f64[fieldCount]
 *   holdings    u32 count, u32 fieldCount, records...
 *   transactions u32 count, u32 fieldCount, records...
 *   history     u32 count, u32 fieldCount, records...
 *   fundamentals (v2) u32 count, u32 fieldCount, records...
 *   strings     UTF-8 bytes referenced by (offset, length) pairs
 *
 * A holding record is: u32 symbolOffset, u32 symbolLength, u32 assetType,
 * u32 pad, f64[fieldCount]. A transaction record is: u32 symbolOffset,
 * u32 symbolLength, u32 typeOffset, u32 typeLength, u32 kind, u32 pad,
 * f64[fieldCount]. A history record is f64[fieldCount]. A fundamentals
 * record is: u32 symbolOffset, u32 symbolLength, u32 flags, u32 pad,
 * f64[fieldCount]; a value the provider does not have is NaN. Offsets are
 * relative to the start of the payload; a missing block has offset 0.
 *
 * ABI 2 adds the fundamentals block and grows the header by 8 bytes. The
 * host still encodes the ABI 1 layout for modules that target ABI 1.
 */

/** ABI of the generated SDK and of new modules. */
export const METRIC_ABI_VERSION = 2;

/** Every ABI the host can encode a payload for. */
export const SUPPORTED_METRIC_ABI_VERSIONS: readonly number[] = [1, 2];

export function isSupportedMetricAbi(abi: number): boolean {
  return SUPPORTED_METRIC_ABI_VERSIONS.includes(abi);
}

/** "PMET" as a little-endian u32. */
export const METRIC_PAYLOAD_MAGIC = 0x54454d50;

export const METRIC_SCOPES = [
  "portfolio.summary",
  "portfolio.holdings",
  "portfolio.transactions",
  "portfolio.history",
  "market.fundamentals",
] as const;

export type MetricScope = (typeof METRIC_SCOPES)[number];

export const METRIC_SCOPE_BITS: Readonly<Record<MetricScope, number>> = {
  "portfolio.summary": 1,
  "portfolio.holdings": 2,
  "portfolio.transactions": 4,
  "portfolio.history": 8,
  "market.fundamentals": 16,
};

/** Lowest ABI that carries each scope. */
export const METRIC_SCOPE_MIN_ABI: Readonly<Record<MetricScope, number>> = {
  "portfolio.summary": 1,
  "portfolio.holdings": 1,
  "portfolio.transactions": 1,
  "portfolio.history": 1,
  "market.fundamentals": 2,
};

/**
 * Data provider a scope needs. A metric that reads such a scope is shown
 * disabled until the provider has an API key.
 */
export const METRIC_SCOPE_PROVIDER: Readonly<Partial<Record<MetricScope, "fmp">>> = {
  "market.fundamentals": "fmp",
};

/** Data providers the given scopes need, without duplicates. */
export function metricScopeProviders(scopes: readonly MetricScope[]): "fmp"[] {
  const out = new Set<"fmp">();
  for (const scope of scopes) {
    const provider = METRIC_SCOPE_PROVIDER[scope];
    if (provider) out.add(provider);
  }
  return [...out];
}

/** What each scope grants, in the words shown to the user before installing. */
export const METRIC_SCOPE_DESCRIPTIONS: Readonly<Record<MetricScope, { label: string; grants: string; consent: string }>> = {
  "portfolio.summary": {
    label: "Portfolio totals",
    grants: "Aggregate figures only: totals, cash, fees, taxes, weights. No symbols.",
    consent: "Portfolio totals. No individual positions.",
  },
  "portfolio.holdings": {
    label: "Holdings",
    grants: "Per-position rows: symbol, shares, prices, weights, indicators.",
    consent: "Every position you hold, including tickers and quantities.",
  },
  "portfolio.transactions": {
    label: "Transactions",
    grants: "The full ledger: every transaction with symbol, type, amount, fee, and tax.",
    consent: "Your complete transaction history.",
  },
  "portfolio.history": {
    label: "Value history",
    grants: "The equity curve: portfolio value, cost, and cash per day.",
    consent: "Your portfolio value over time.",
  },
  "market.fundamentals": {
    label: "Fundamentals",
    grants: "Public company data per held symbol: beta, valuation, dividends, analyst targets, DCF, financial scores. Needs a Financial Modeling Prep key.",
    consent: "Public company data for every symbol you hold. It names your symbols, not your quantities.",
  },
};

export function isMetricScope(value: unknown): value is MetricScope {
  return typeof value === "string" && (METRIC_SCOPES as readonly string[]).includes(value);
}

/** Summary fields, in payload order. Each is one f64. */
export const SUMMARY_FIELDS = [
  "totalValue",
  "totalCost",
  "totalGainLossDollar",
  "totalGainLossPercent",
  "dayGainLossDollar",
  "dayGainLossPercent",
  "totalGainSinceStartDollar",
  "totalGainSinceStartPercent",
  "totalCashInjected",
  "totalCashWithdrawn",
  "cashBalance",
  "totalPortfolioValue",
  "realizedPnL",
  "totalDividends",
  "totalInterest",
  "totalFees",
  "totalTaxes",
  "stockWeightPercent",
  "etfWeightPercent",
  "cryptoWeightPercent",
  "otherWeightPercent",
  "cashWeightPercent",
] as const;

export type SummaryField = (typeof SUMMARY_FIELDS)[number];

/** Numeric holding fields, in record order. */
export const HOLDING_FIELDS = [
  "shares",
  "buyPrice",
  "currentPrice",
  "previousClose",
  "totalCost",
  "currentValue",
  "dayChangeDollar",
  "dayChangePercent",
  "totalGainLossDollar",
  "totalGainLossPercent",
  "weightPercent",
  "fiftyTwoWeekHigh",
  "fiftyTwoWeekLow",
  "sma50",
  "sma200",
  "rsi",
] as const;

export type HoldingField = (typeof HOLDING_FIELDS)[number];

/** Asset type enum of a holding record. Index is the wire value. */
export const HOLDING_ASSET_TYPES = ["Other", "Stock", "ETF", "MutualFund", "Crypto", "Cash"] as const;

/** Numeric transaction fields, in record order. `timestamp` is unix ms. */
export const TRANSACTION_FIELDS = ["timestamp", "shares", "price", "amount", "fee", "tax"] as const;

export type TransactionField = (typeof TRANSACTION_FIELDS)[number];

/**
 * Coarse transaction kind. The raw `type` string is also in the record, but
 * most metrics only need this classification. Index is the wire value.
 */
export const TRANSACTION_KINDS = ["Other", "Buy", "Sell", "Dividend", "Interest", "Deposit", "Withdrawal"] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

const TRANSACTION_KIND_BY_TYPE: Readonly<Record<string, TransactionKind>> = {
  BUY: "Buy",
  STOCKPERK: "Buy",
  PRIVATE_MARKET_BUY: "Buy",
  SELL: "Sell",
  DIVIDEND: "Dividend",
  INTEREST_PAYMENT: "Interest",
  DEPOSIT: "Deposit",
  CUSTOMER_INBOUND: "Deposit",
  TRANSFER_INBOUND: "Deposit",
  WITHDRAWAL: "Withdrawal",
  CUSTOMER_OUTBOUND: "Withdrawal",
  TRANSFER_OUTBOUND: "Withdrawal",
};

export function classifyTransactionType(type: string | null | undefined): TransactionKind {
  return TRANSACTION_KIND_BY_TYPE[(type || "").toUpperCase()] ?? "Other";
}

/** Numeric history fields, in record order. `timestamp` is unix ms. */
export const HISTORY_FIELDS = [
  "timestamp",
  "totalValue",
  "totalCost",
  "totalGainLoss",
  "cashBalance",
  "totalPortfolioValue",
] as const;

export type HistoryField = (typeof HISTORY_FIELDS)[number];

/**
 * Fundamentals of one held symbol, in record order. Ratios, margins, yields
 * and upsides are fractions (0.27 = 27%). `price`, `priceTarget` and
 * `dcfValue` share the symbol's trading currency. NaN means unknown.
 */
export const FUNDAMENTAL_FIELDS = [
  "beta",
  "marketCap",
  "peRatio",
  "priceToBook",
  "earningsYield",
  "freeCashFlowYield",
  "dividendYield",
  "payoutRatio",
  "returnOnEquity",
  "netMargin",
  "debtToEquity",
  "price",
  "priceTarget",
  "targetUpside",
  "dcfValue",
  "dcfUpside",
  "piotroski",
  "altmanZ",
  "analystScore",
  "analystCount",
] as const;

export type FundamentalField = (typeof FUNDAMENTAL_FIELDS)[number];

/** Bit flags of a fundamentals record. */
export const FUNDAMENTAL_FLAG_FUND = 1;

/** Header size in bytes of ABI 1: 8 u32 fields. */
export const PAYLOAD_HEADER_BYTES_V1 = 32;

/** Header size in bytes of ABI 2: 10 u32 fields. */
export const PAYLOAD_HEADER_BYTES = 40;

export function payloadHeaderBytes(abi: number): number {
  return abi >= 2 ? PAYLOAD_HEADER_BYTES : PAYLOAD_HEADER_BYTES_V1;
}

/** Bytes before the f64 fields of a holding record. */
export const HOLDING_RECORD_PREFIX_BYTES = 16;

/** Bytes before the f64 fields of a transaction record. */
export const TRANSACTION_RECORD_PREFIX_BYTES = 24;

/** Bytes before the f64 fields of a fundamentals record. */
export const FUNDAMENTAL_RECORD_PREFIX_BYTES = 16;

/** Hard ceiling of guest memory, in 64 KiB pages (4 MiB). */
export const MAX_METRIC_MEMORY_PAGES = 64;

/** Initial guest memory, in pages. */
export const MIN_METRIC_MEMORY_PAGES = 2;

/** Default and upper bound of the per-run time budget. */
export const DEFAULT_METRIC_TIMEOUT_MS = 50;
export const MAX_METRIC_TIMEOUT_MS = 2000;
