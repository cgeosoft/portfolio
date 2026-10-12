/**
 * Portfolio suggestions: actionable rebalancing ideas from the model.
 *
 * The model sees weights in percent only and answers with target weights.
 * Shares and money amounts are computed here, on this machine, from live
 * prices. The service and the GUI share these pure helpers, so a status
 * means the same on both sides.
 */

export type SuggestionAction = "increase" | "decrease" | "open" | "close";

/** Status kept in the database. "done" and "cancelled" are also derived from live data, see evaluateSuggestion(). */
export type SuggestionStoredStatus = "active" | "done" | "cancelled" | "superseded" | "dismissed";

/** Status shown to the user. */
export type SuggestionStatus = SuggestionStoredStatus;

/** Conditions the GUI checks against live data. A failed rule cancels the suggestion. */
export interface SuggestionValidity {
  /** ISO timestamp after which the suggestion is no longer valid. */
  expiresAt: string;
  /** Valid while the price of the suggestion symbol, in its quote currency, stays in this range. */
  price?: { min?: number; max?: number; currency: string };
  /** Valid while the weight of the suggestion symbol, in percent of the portfolio, stays in this range. */
  weight?: { min?: number; max?: number };
}

/** Where a buy gets its money, or where a sell sends it. `key` is a suggestion key or "CASH". */
export interface SuggestionFunding {
  key: string;
  weight: number;
}

export interface PortfolioSuggestion {
  id: string;
  portfolioId: string;
  /** `action:SYMBOL`, the identity used to detect repeated suggestions. */
  key: string;
  action: SuggestionAction;
  symbol: string;
  name: string;
  /** Weight in percent when the suggestion was made, from the portfolio data, not from the model. */
  fromWeight: number;
  /** Weight in percent the suggestion aims for. */
  targetWeight: number;
  title: string;
  why: string;
  /** 1 is the highest priority, 5 the lowest. */
  priority: number;
  validity: SuggestionValidity;
  fundedBy: SuggestionFunding[];
  status: SuggestionStoredStatus;
  /** Why the stored status changed, for example the failed validity rule. */
  statusReason?: string;
  /** Weight of the symbol when the user dismissed the suggestion. */
  dismissedAtWeight?: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

/** Live price of a suggestion symbol that the portfolio does not hold. */
export interface SuggestionQuote {
  symbol: string;
  name?: string;
  /** Price in the quote currency. */
  price: number;
  currency: string;
  /** Multiplier from the quote currency to the base currency. */
  toBase: number;
  /** True for crypto and other instruments traded in fractions. */
  fractional?: boolean;
}

/** Live facts of one symbol, from the holdings or from a SuggestionQuote. */
export interface SuggestionMarket {
  /** Current weight in percent, 0 when not held. */
  weight: number;
  /** Price in the quote currency. */
  price?: number;
  currency?: string;
  /** Multiplier from the quote currency to the base currency. */
  toBase?: number;
  /** Shares or units held. */
  shares: number;
  /** True when the holding has fractional units, so suggested amounts keep decimals. */
  fractional: boolean;
}

export interface SuggestionEvaluation {
  status: SuggestionStatus;
  /** Why the suggestion is cancelled or done, in a short sentence. */
  reason?: string;
  currentWeight: number;
  /** Target minus current weight, in percentage points. Positive buys, negative sells. */
  deltaWeight: number;
  /** Amount to buy (positive) or sell (negative) in the base currency. Undefined without a total value. */
  deltaValue?: number;
  /** Shares to buy (positive) or sell (negative). Undefined without a price. */
  deltaShares?: number;
  /** Share of the planned move already done, 0 to 1. */
  progress: number;
}

export const SUGGESTION_ACTIONS: readonly SuggestionAction[] = ["increase", "decrease", "open", "close"];
/** Default and longest lifetime of a suggestion, in days. */
export const SUGGESTION_DEFAULT_TTL_DAYS = 7;
export const SUGGESTION_MAX_TTL_DAYS = 30;
/** A dismissed suggestion comes back once the weight of its symbol moved more than this, in percentage points. */
export const SUGGESTION_DISMISS_RESET_PP = 5;
/** Smallest tolerance for "done", in percentage points. */
export const SUGGESTION_MIN_TOLERANCE_PP = 0.5;
/** Share of the planned move that still counts as done. */
export const SUGGESTION_TOLERANCE_SHARE = 0.1;
/** Cash weight above which a set with sells is flagged as leaving money unallocated. */
export const SUGGESTION_HIGH_CASH_PERCENT = 20;

export function suggestionKey(action: SuggestionAction, symbol: string): string {
  return `${action}:${symbol.trim().toUpperCase()}`;
}

/** Tolerance in percentage points around the target weight. */
export function suggestionTolerance(fromWeight: number, targetWeight: number): number {
  return Math.max(SUGGESTION_MIN_TOLERANCE_PP, Math.abs(targetWeight - fromWeight) * SUGGESTION_TOLERANCE_SHARE);
}

const round = (value: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** Higher priority first, then the oldest. Statuses do not change the order. */
export function compareSuggestions(a: Pick<PortfolioSuggestion, "priority" | "createdAt">, b: Pick<PortfolioSuggestion, "priority" | "createdAt">): number {
  return a.priority - b.priority || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Status and amounts of one suggestion against live data. Order of checks:
 * stored final statuses, then the target reached, then the validity rules.
 */
export function evaluateSuggestion(
  s: Pick<PortfolioSuggestion, "action" | "symbol" | "fromWeight" | "targetWeight" | "validity" | "status" | "statusReason">,
  market: SuggestionMarket,
  totalValue: number | undefined,
  now: Date = new Date(),
): SuggestionEvaluation {
  const currentWeight = market.weight;
  const deltaWeight = round(s.targetWeight - currentWeight, 2);
  const planned = s.targetWeight - s.fromWeight;
  const progress = Math.abs(planned) < 1e-9 ? 1 : Math.min(1, Math.max(0, (currentWeight - s.fromWeight) / planned));

  let deltaValue: number | undefined;
  let deltaShares: number | undefined;
  if (totalValue !== undefined && Number.isFinite(totalValue) && totalValue > 0) {
    deltaValue = round((deltaWeight / 100) * totalValue, 2);
    const priceBase = market.price !== undefined && market.toBase !== undefined ? market.price * market.toBase : undefined;
    if (priceBase && priceBase > 0) {
      const raw = deltaValue / priceBase;
      // Closing a position sells everything held, whatever the rounding says.
      deltaShares = s.action === "close" ? -market.shares : market.fractional ? round(raw, 4) : Math.trunc(raw);
      if (deltaShares === 0) deltaShares = 0;
    }
  }

  const base = { currentWeight, deltaWeight, deltaValue, deltaShares, progress };
  if (s.status !== "active") return { ...base, status: s.status, reason: s.statusReason };

  const tolerance = suggestionTolerance(s.fromWeight, s.targetWeight);
  const reached =
    s.action === "decrease" || s.action === "close"
      ? currentWeight <= s.targetWeight + tolerance
      : currentWeight >= s.targetWeight - tolerance;
  if (reached) return { ...base, progress: 1, status: "done", reason: "Target weight reached" };

  const reason = failedValidity(s.validity, market, now);
  if (reason) return { ...base, status: "cancelled", reason };
  return { ...base, status: "active" };
}

/** The first validity rule that fails, as a sentence, or undefined. */
export function failedValidity(validity: SuggestionValidity, market: SuggestionMarket, now: Date = new Date()): string | undefined {
  const expires = Date.parse(validity.expiresAt);
  if (Number.isFinite(expires) && now.getTime() > expires) return `Expired on ${validity.expiresAt.slice(0, 10)}`;
  const p = validity.price;
  if (p && market.price !== undefined && (!market.currency || market.currency.toUpperCase() === p.currency.toUpperCase())) {
    if ((p.min !== undefined && market.price < p.min) || (p.max !== undefined && market.price > p.max)) {
      return `Price left the range ${rangeText(p.min, p.max)} ${p.currency}`;
    }
  }
  const w = validity.weight;
  if (w && ((w.min !== undefined && market.weight < w.min) || (w.max !== undefined && market.weight > w.max))) {
    return `Weight left the range ${rangeText(w.min, w.max)}%`;
  }
  return undefined;
}

function rangeText(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `${min} to ${max}`;
  if (min !== undefined) return `above ${min}`;
  return `below ${max}`;
}

/** The holding fields marketForSymbol() reads. PortfolioHolding satisfies it. */
export interface SuggestionHoldingInput {
  symbol: string;
  name: string;
  assetType: string;
  shares: number;
  weightPercent: number;
  currentPrice: number;
  nativePrice?: number;
  nativeCurrency?: string;
  currency: string;
}

/** Live facts of one symbol: the holding when held, else the quote. */
export function marketForSymbol(symbol: string, holdings: readonly SuggestionHoldingInput[], quotes: readonly SuggestionQuote[]): SuggestionMarket {
  const key = symbol.trim().toUpperCase();
  const h = holdings.find((x) => x.assetType !== "Cash" && x.symbol.toUpperCase() === key);
  if (h) {
    const native = h.nativePrice && h.nativePrice > 0 ? h.nativePrice : h.currentPrice;
    return {
      weight: h.weightPercent,
      price: native > 0 ? native : undefined,
      currency: h.nativeCurrency || h.currency,
      toBase: native > 0 && h.currentPrice > 0 ? h.currentPrice / native : 1,
      shares: h.shares,
      fractional: h.assetType === "Crypto" || Math.abs(h.shares - Math.round(h.shares)) > 1e-9,
    };
  }
  const q = quotes.find((x) => x.symbol.toUpperCase() === key);
  return { weight: 0, price: q?.price, currency: q?.currency, toBase: q?.toBase, shares: 0, fractional: Boolean(q?.fractional) };
}

// ── target portfolio ────────────────────────────────────────────────────────

export interface TargetPortfolioRow {
  symbol: string;
  name: string;
  currentWeight: number;
  targetWeight: number;
  deltaWeight: number;
  isNew: boolean;
  isClosed: boolean;
}

export interface TargetPortfolio {
  /** Holdings after the suggestions, largest target weight first. Cash is in `cash`, not here. */
  rows: TargetPortfolioRow[];
  cash: { currentWeight: number; targetWeight: number; deltaWeight: number };
  /** Weight sold and bought, in percentage points, both positive. */
  sold: number;
  bought: number;
  warnings: string[];
}

/**
 * Applies the given suggestions to the current weights. Cash takes the
 * difference: a sell without a matching buy shows up as more cash.
 */
export function projectTargetPortfolio(
  holdings: readonly { symbol: string; name: string; weight: number; isCash?: boolean }[],
  suggestions: readonly { symbol: string; name: string; targetWeight: number; action: SuggestionAction }[],
): TargetPortfolio {
  const rows = new Map<string, TargetPortfolioRow>();
  let cashWeight = 0;
  for (const h of holdings) {
    if (h.isCash) {
      cashWeight += h.weight;
      continue;
    }
    const symbol = h.symbol.toUpperCase();
    rows.set(symbol, { symbol: h.symbol, name: h.name, currentWeight: h.weight, targetWeight: h.weight, deltaWeight: 0, isNew: false, isClosed: false });
  }

  let sold = 0;
  let bought = 0;
  for (const s of suggestions) {
    const symbol = s.symbol.toUpperCase();
    let row = rows.get(symbol);
    if (!row) {
      row = { symbol: s.symbol, name: s.name, currentWeight: 0, targetWeight: 0, deltaWeight: 0, isNew: true, isClosed: false };
      rows.set(symbol, row);
    }
    const target = s.action === "close" ? 0 : Math.max(0, s.targetWeight);
    const delta = target - row.targetWeight;
    row.targetWeight = target;
    if (delta < 0) sold -= delta;
    else bought += delta;
  }

  for (const row of rows.values()) {
    row.targetWeight = round(row.targetWeight, 2);
    row.deltaWeight = round(row.targetWeight - row.currentWeight, 2);
    row.isClosed = !row.isNew && row.currentWeight > 0 && row.targetWeight === 0;
  }

  const cashTarget = round(cashWeight + sold - bought, 2);
  const warnings: string[] = [];
  if (cashTarget < -0.05) {
    warnings.push(`The buys need ${round(-cashTarget, 2)} percentage points more than the sells and the cash free up.`);
  } else if (sold > 0 && cashTarget > SUGGESTION_HIGH_CASH_PERCENT && cashTarget > cashWeight + 0.05) {
    warnings.push(`After the sells, ${round(cashTarget, 2)}% of the portfolio stays in cash.`);
  }

  return {
    rows: [...rows.values()].sort((a, b) => b.targetWeight - a.targetWeight || b.currentWeight - a.currentWeight),
    cash: { currentWeight: round(cashWeight, 2), targetWeight: cashTarget, deltaWeight: round(cashTarget - cashWeight, 2) },
    sold: round(sold, 2),
    bought: round(bought, 2),
    warnings,
  };
}
