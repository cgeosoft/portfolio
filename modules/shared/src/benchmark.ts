/**
 * Portfolio against a benchmark: both series in percent from the same start.
 * Pure helpers used by the service (`getBenchmarkComparison`) and by the
 * performance chart in the GUI.
 *
 * The portfolio side is a time-weighted return of the invested holdings
 * (`totalValue`). A rise in cost basis counts as money added (a buy). A fall
 * counts as money taken out at the portfolio's average value-to-cost ratio
 * (an estimate of the sale proceeds). So buys and sells do not show up as
 * gains or losses; only price moves do.
 */

export interface BenchmarkValuePoint {
  date: string;
  totalValue: number;
  totalCost: number;
}

export interface BenchmarkClose {
  date: string;
  close: number;
}

export interface RelativePerformancePoint {
  date: string;
  /** Portfolio time-weighted return since the first point, percent. */
  portfolio: number;
  /** Benchmark change since the first point, percent. */
  benchmark: number;
}

/**
 * Both series in percent from the first date on or after `fromDate` where a
 * benchmark close exists (the close on or before that date, so weekends and
 * holidays carry the last close). Empty when the two do not overlap.
 */
export function relativePerformance(portfolio: BenchmarkValuePoint[], benchmark: BenchmarkClose[], fromDate?: string): RelativePerformancePoint[] {
  const points = portfolio.filter((p) => !fromDate || p.date >= fromDate).slice().sort((a, b) => a.date.localeCompare(b.date));
  const closes = benchmark.filter((b) => Number.isFinite(b.close) && b.close > 0).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (points.length === 0 || closes.length === 0) return [];

  const out: RelativePerformancePoint[] = [];
  let j = -1;
  let baseClose = 0;
  let index = 1;
  let prev: BenchmarkValuePoint | null = null;

  for (const p of points) {
    while (j + 1 < closes.length && closes[j + 1]!.date <= p.date) j++;
    if (j < 0) continue;
    const close = closes[j]!.close;

    if (!prev) {
      if (!(p.totalValue > 0)) continue;
      baseClose = close;
      prev = p;
      out.push({ date: p.date, portfolio: 0, benchmark: 0 });
      continue;
    }

    const costChange = p.totalCost - prev.totalCost;
    const flow = costChange >= 0 || !(prev.totalCost > 0) ? costChange : costChange * (prev.totalValue / prev.totalCost);
    if (prev.totalValue > 0) {
      const r = (p.totalValue - flow) / prev.totalValue - 1;
      if (Number.isFinite(r) && r > -1) index *= 1 + r;
    }
    prev = p;
    out.push({ date: p.date, portfolio: (index - 1) * 100, benchmark: (close / baseClose - 1) * 100 });
  }
  return out;
}
