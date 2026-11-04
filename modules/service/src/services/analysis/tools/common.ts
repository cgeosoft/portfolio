/** Helpers the analysis tools share: argument checks, holdings and price history. */
import type { AnalysisNode } from "portfolio-shared/api-types";
import type { PortfolioHolding } from "portfolio-shared/portfolio";
import type { PriceSeries } from "../math.js";
import { ToolInputError, type ToolContext } from "../types.js";

export const pct = (n: number | undefined, digits = 1) => (n === undefined || !Number.isFinite(n) ? "n/a" : `${n.toFixed(digits)}%`);
export const signedPct = (n: number | undefined, digits = 1) => (n === undefined || !Number.isFinite(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`);
export const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Holdings that are positions, not cash. */
export function positions(ctx: ToolContext): PortfolioHolding[] {
  return (ctx.data.holdings ?? []).filter((h) => h.assetType !== "Cash" && h.shares > 0).sort((a, b) => b.weightPercent - a.weightPercent);
}

/** Holdings with a public market price: the ones with price history. */
export function quotedPositions(ctx: ToolContext): PortfolioHolding[] {
  return positions(ctx).filter((h) => !h.isPrivate && !h.quoteMissing && !h.manualPrice);
}

/** The held position and its graph node named by `args.symbol`. Throws for a symbol the portfolio does not hold. */
export function heldSymbol(args: Record<string, unknown>, ctx: ToolContext): { holding: PortfolioHolding; node: AnalysisNode } {
  const raw = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "";
  if (!raw) throw new ToolInputError("symbol is required");
  const holding = positions(ctx).find((h) => h.symbol.toUpperCase() === raw);
  const node = ctx.graph.holding(raw);
  if (!holding || !node) throw new ToolInputError(`${raw} is not held in this portfolio. Use a symbol of a holding node.`);
  return { holding, node };
}

/** Daily closes of a symbol over a range, cached for the run. Null when no provider has them. */
export function priceSeries(ctx: ToolContext, symbol: string, range = "1y"): Promise<PriceSeries | null> {
  const key = `chart:${symbol.toUpperCase()}:${range}`;
  let pending = ctx.memo.get(key) as Promise<PriceSeries | null> | undefined;
  if (!pending) {
    pending = ctx.deps.marketData
      .getChart(symbol, range, "1d")
      .then((chart) => {
        const rows = (chart.candles ?? []).filter((c) => Number.isFinite(c.close) && c.close > 0);
        return rows.length >= 2 ? { dates: rows.map((c) => c.date.slice(0, 10)), closes: rows.map((c) => c.close) } : null;
      })
      .catch(() => null);
    ctx.memo.set(key, pending);
  }
  return pending;
}

/** Price series of the largest quoted holdings, by symbol, with the weight they cover. */
export async function holdingSeries(ctx: ToolContext, limit = 12): Promise<{ series: Map<string, PriceSeries>; weights: Map<string, number>; coveredPercent: number }> {
  const picked = quotedPositions(ctx).slice(0, limit);
  const loaded = await Promise.all(picked.map(async (h) => [h, await priceSeries(ctx, h.symbol)] as const));
  const series = new Map<string, PriceSeries>();
  const weights = new Map<string, number>();
  let covered = 0;
  for (const [h, s] of loaded) {
    if (!s) continue;
    series.set(h.symbol, s);
    weights.set(h.symbol, h.weightPercent);
    covered += h.weightPercent;
  }
  return { series, weights, coveredPercent: round(covered, 1) };
}

/** Text of an optional string argument. */
export function textArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

/** An integer argument within bounds, else the default. */
export function intArg(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const v = Number(args[key]);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}
