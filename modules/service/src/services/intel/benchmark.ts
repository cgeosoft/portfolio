/**
 * Benchmark history (index or ETF closes) and the portfolio's performance
 * against it.
 *
 * History runs through the provider chain under the "charts" category: FMP
 * end-of-day bars (indices included, no currency lookup needed), then Yahoo.
 * The comparison uses `relativePerformance()` from portfolio-shared/benchmark,
 * the same math the performance chart draws.
 */
import { BENCHMARK_OPTIONS, DEFAULT_BENCHMARK_SYMBOL } from "portfolio-shared/config-types";
import { relativePerformance } from "portfolio-shared/benchmark";
import type { BenchmarkComparison, BenchmarkHistoryResponse, BenchmarkPoint } from "portfolio-shared/api-types";
import { loadConfig } from "../../config.js";
import { toFmpSymbol, type FmpService } from "../fmp.js";
import type { YahooFinanceService } from "../yahoo-finance.js";
import type { PortfolioService } from "../portfolio.js";
import { firstAvailable } from "../providers/chain.js";

export interface BenchmarkDeps {
  fmp: FmpService;
  yahoo: YahooFinanceService;
}

const RANGE_PATTERN = /^(\d{1,2})(d|mo|y)$|^ytd$|^max$/;

/** A Yahoo-style range ("1mo", "6mo", "1y", "5y", "ytd", "max"); anything else becomes "1y". */
export function normalizeBenchmarkRange(range: string | null | undefined): string {
  const r = (range || "").trim().toLowerCase();
  return RANGE_PATTERN.test(r) ? r : "1y";
}

/** A benchmark symbol: upper case, letters, digits and `^.-=` only, at most 20 characters. Null for anything else. */
export function normalizeBenchmarkSymbol(symbol: string | null | undefined): string | null {
  const s = (symbol || "").trim().toUpperCase();
  return /^[\^A-Z0-9.\-=]{1,20}$/.test(s) ? s : null;
}

/** The display name of a benchmark: its `BENCHMARK_OPTIONS` label, else the symbol. */
export function benchmarkLabel(symbol: string): string {
  return BENCHMARK_OPTIONS.find((o) => o.symbol === symbol)?.label ?? symbol;
}

/** The benchmark in the settings, or null when the user picked "none". */
export function configuredBenchmark(): string | null {
  const value = (loadConfig().benchmarkSymbol ?? DEFAULT_BENCHMARK_SYMBOL).trim();
  if (!value || value.toLowerCase() === "none") return null;
  return normalizeBenchmarkSymbol(value);
}

/** First day of a range as "YYYY-MM-DD"; null for "max". */
function rangeStart(range: string, now = new Date()): string | null {
  if (range === "max") return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "ytd") return `${d.getUTCFullYear()}-01-01`;
  const m = /^(\d+)(d|mo|y)$/.exec(range);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "d") d.setUTCDate(d.getUTCDate() - Math.max(7, n * 2));
  else if (m[2] === "mo") d.setUTCMonth(d.getUTCMonth() - n);
  else d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

/** Daily closes of `symbol` over `range`, oldest first, with the provider that supplied them. */
export async function getBenchmarkHistory(deps: BenchmarkDeps, symbol: string, range = "1y", forceFresh = false): Promise<BenchmarkHistoryResponse> {
  const sym = normalizeBenchmarkSymbol(symbol) ?? DEFAULT_BENCHMARK_SYMBOL;
  const r = normalizeBenchmarkRange(range);
  const from = rangeStart(r);

  const result = await firstAvailable<BenchmarkPoint[]>({
    category: "charts",
    attempts: [
      {
        provider: "fmp",
        isAvailable: () => deps.fmp.isConfigured(),
        fetch: async () => {
          // FMP picks a short default window without `from`; ask for 30 years for "max".
          const start = from ?? `${new Date().getUTCFullYear() - 30}-01-01`;
          const bars = await deps.fmp.getEodChart(toFmpSymbol(sym), { from: start, forceFresh });
          return bars?.map((b) => ({ date: b.date, close: b.close })) ?? null;
        },
      },
      {
        provider: "yahoo",
        fetch: async () => {
          const chart = await deps.yahoo.getChart(sym, r, "1d", forceFresh);
          return chart.candles.filter((c) => Number.isFinite(c.close) && c.close > 0).map((c) => ({ date: c.date.slice(0, 10), close: c.close }));
        },
      },
    ],
  });

  const points = (result.data ?? []).filter((p) => !from || p.date >= from);
  return { symbol: sym, label: benchmarkLabel(sym), range: r, points, source: points.length > 0 ? result.source : null };
}

/**
 * The portfolio's time-weighted return against a benchmark over `range`.
 * `symbol` defaults to the benchmark in the settings (S&P 500 when "none").
 * Null when the portfolio has no history in the range or the benchmark has no data.
 */
export async function getBenchmarkComparison(
  deps: BenchmarkDeps & { portfolioService: PortfolioService },
  portfolioId: string,
  range = "1y",
  symbol?: string,
): Promise<BenchmarkComparison | null> {
  const sym = normalizeBenchmarkSymbol(symbol) ?? configuredBenchmark() ?? DEFAULT_BENCHMARK_SYMBOL;
  const r = normalizeBenchmarkRange(range);
  const [data, history] = await Promise.all([deps.portfolioService.getPortfolioData(portfolioId), getBenchmarkHistory(deps, sym, r)]);
  const from = rangeStart(r) ?? undefined;
  const series = relativePerformance(data.chartHistory ?? [], history.points, from);
  if (series.length < 2) return null;
  const last = series[series.length - 1]!;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    symbol: sym,
    label: history.label,
    range: r,
    from: series[0]!.date,
    to: last.date,
    portfolioReturnPercent: round(last.portfolio),
    benchmarkReturnPercent: round(last.benchmark),
    excessReturnPercent: round(last.portfolio - last.benchmark),
    series: series.map((p) => ({ date: p.date, portfolio: round(p.portfolio), benchmark: round(p.benchmark) })),
    source: history.source,
  };
}
