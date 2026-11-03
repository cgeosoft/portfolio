/**
 * App math for the Guided Analysis calc tools: daily returns, volatility,
 * drawdown, correlation, beta, concentration and risk contribution. Pure
 * functions on close prices and weights; every result is a percentage or a
 * unitless ratio, never an amount.
 */

export interface PriceSeries {
  /** YYYY-MM-DD, ascending. */
  dates: string[];
  closes: number[];
}

export const TRADING_DAYS = 252;

const round = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Simple daily returns of a close series. */
export function dailyReturns(closes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (prev > 0 && Number.isFinite(cur)) out.push(cur / prev - 1);
  }
  return out;
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Sample standard deviation. */
export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

/** Annualised volatility in percent from daily returns. */
export function annualVolatilityPercent(returns: readonly number[]): number {
  return round(stdev(returns) * Math.sqrt(TRADING_DAYS) * 100);
}

/** Largest fall from a peak, in percent (a positive number), with the peak and trough positions. */
export function maxDrawdown(closes: readonly number[]): { percent: number; peakIndex: number; troughIndex: number } {
  let peak = -Infinity;
  let peakIndex = 0;
  let best = { percent: 0, peakIndex: 0, troughIndex: 0 };
  closes.forEach((c, i) => {
    if (c > peak) {
      peak = c;
      peakIndex = i;
    }
    const dd = peak > 0 ? (1 - c / peak) * 100 : 0;
    if (dd > best.percent) best = { percent: dd, peakIndex, troughIndex: i };
  });
  return { ...best, percent: round(best.percent) };
}

/** Fall from the highest close, in percent (a positive number). */
export function fromHighPercent(closes: readonly number[]): number {
  if (closes.length === 0) return 0;
  const high = Math.max(...closes);
  const last = closes[closes.length - 1]!;
  return high > 0 ? round((1 - last / high) * 100) : 0;
}

/** Change over the last `days` closes, in percent. */
export function changePercent(closes: readonly number[], days: number): number | undefined {
  if (closes.length <= days) return undefined;
  const from = closes[closes.length - 1 - days]!;
  const to = closes[closes.length - 1]!;
  return from > 0 ? round((to / from - 1) * 100) : undefined;
}

export function covariance(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (a[i]! - ma) * (b[i]! - mb);
  return sum / (n - 1);
}

export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  const sa = stdev(a.slice(0, n));
  const sb = stdev(b.slice(0, n));
  if (sa === 0 || sb === 0) return 0;
  return round(covariance(a, b) / (sa * sb));
}

/** Beta of `asset` returns to `market` returns. */
export function beta(asset: readonly number[], market: readonly number[]): number {
  const n = Math.min(asset.length, market.length);
  const variance = stdev(market.slice(0, n)) ** 2;
  if (variance === 0) return 0;
  return round(covariance(asset, market) / variance);
}

/**
 * Aligns several series on the dates they share, so returns line up. Series
 * with fewer than `minPoints` shared dates are left out.
 */
export function alignSeries(series: ReadonlyMap<string, PriceSeries>, minPoints = 40): { dates: string[]; closes: Map<string, number[]> } {
  const entries = [...series.entries()].filter(([, s]) => s.dates.length >= minPoints);
  if (entries.length === 0) return { dates: [], closes: new Map() };
  let shared = new Set(entries[0]![1].dates);
  for (const [, s] of entries.slice(1)) {
    const next = new Set(s.dates.filter((d) => shared.has(d)));
    if (next.size < minPoints) continue; // a short series would cut the window for everyone
    shared = next;
  }
  const dates = [...shared].sort();
  const closes = new Map<string, number[]>();
  for (const [key, s] of entries) {
    const byDate = new Map(s.dates.map((d, i) => [d, s.closes[i]!]));
    if (!dates.every((d) => byDate.has(d))) continue;
    closes.set(key, dates.map((d) => byDate.get(d)!));
  }
  return { dates, closes };
}

/** Daily returns of a fixed-weight basket. Weights need not sum to 1; they are renormalised. */
export function basketReturns(returns: ReadonlyMap<string, number[]>, weights: ReadonlyMap<string, number>): number[] {
  const keys = [...returns.keys()].filter((k) => (weights.get(k) ?? 0) > 0);
  const total = keys.reduce((a, k) => a + weights.get(k)!, 0);
  if (keys.length === 0 || total <= 0) return [];
  const n = Math.min(...keys.map((k) => returns.get(k)!.length));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(keys.reduce((a, k) => a + (weights.get(k)! / total) * returns.get(k)![i]!, 0));
  return out;
}

/** Closes of a basket that starts at 100, from its daily returns. */
export function basketCloses(returns: readonly number[]): number[] {
  const closes = [100];
  for (const r of returns) closes.push(closes[closes.length - 1]! * (1 + r));
  return closes;
}

/**
 * Share of the basket's variance each holding carries, in percent. Sums to
 * 100 when every holding has data. Uses the sample covariance of daily returns.
 */
export function riskContributions(returns: ReadonlyMap<string, number[]>, weights: ReadonlyMap<string, number>): Map<string, number> {
  const keys = [...returns.keys()].filter((k) => (weights.get(k) ?? 0) > 0);
  const total = keys.reduce((a, k) => a + weights.get(k)!, 0);
  const w = new Map(keys.map((k) => [k, weights.get(k)! / total]));
  const marginal = new Map<string, number>();
  for (const i of keys) {
    let sum = 0;
    for (const j of keys) sum += w.get(j)! * covariance(returns.get(i)!, returns.get(j)!);
    marginal.set(i, sum);
  }
  const variance = keys.reduce((a, k) => a + w.get(k)! * marginal.get(k)!, 0);
  const out = new Map<string, number>();
  if (variance <= 0) return out;
  for (const k of keys) out.set(k, round((w.get(k)! * marginal.get(k)! * 100) / variance, 1));
  return out;
}

/** Concentration of a weight list in percent: largest, top 5, and the effective number of holdings (1 / sum of squared shares). */
export function concentration(weightsPercent: readonly number[]): { largestPercent: number; top5Percent: number; effectiveHoldings: number } {
  const sorted = [...weightsPercent].filter((w) => w > 0).sort((a, b) => b - a);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total <= 0) return { largestPercent: 0, top5Percent: 0, effectiveHoldings: 0 };
  const shares = sorted.map((w) => w / total);
  return {
    largestPercent: round(sorted[0]!),
    top5Percent: round(sorted.slice(0, 5).reduce((a, b) => a + b, 0)),
    effectiveHoldings: round(1 / shares.reduce((a, s) => a + s * s, 0), 1),
  };
}
