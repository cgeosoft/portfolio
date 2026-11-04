/**
 * App math as tools: concentration, correlation, drawdown and volatility,
 * beta to the benchmark, and risk contribution. Each works on the current
 * weights and one year of daily closes of the quoted holdings, so the result
 * describes the portfolio as it is today, not its past contributions.
 */
import type { AnalysisNode } from "portfolio-shared/api-types";
import { DEFAULT_BENCHMARK_SYMBOL } from "portfolio-shared/config-types";
import { benchmarkLabel, configuredBenchmark } from "../../intel/benchmark.js";
import { alignSeries, annualVolatilityPercent, basketCloses, basketReturns, beta, concentration, correlation, dailyReturns, maxDrawdown, riskContributions } from "../math.js";
import { ToolInputError, type AnalysisTool, type ToolContext } from "../types.js";
import { heldSymbol, holdingSeries, positions, priceSeries, round } from "./common.js";

const noInput = { type: "object" as const, properties: {} };

function link(ctx: ToolContext, node: AnalysisNode, symbols: readonly string[], rationale: string): void {
  for (const symbol of symbols) {
    const holding = ctx.graph.holding(symbol);
    if (holding) ctx.graph.addEdge(node.id, holding.id, "derived_from", rationale);
  }
}

/** Daily returns of the largest quoted holdings on shared dates, and the weights they carry. */
async function alignedReturns(ctx: ToolContext, limit = 12) {
  const { series, weights, coveredPercent } = await holdingSeries(ctx, limit);
  const aligned = alignSeries(series);
  const returns = new Map<string, number[]>();
  for (const [symbol, closes] of aligned.closes) returns.set(symbol, dailyReturns(closes));
  return { returns, weights, coveredPercent, days: aligned.dates.length };
}

export const calcConcentration: AnalysisTool = {
  name: "calc_concentration",
  description: "Concentration of the portfolio: weight of the largest position, of the top 5, and the effective number of holdings.",
  inputSchema: noInput,
  maxCallsPerRun: 1,
  timeoutMs: 5_000,
  async run(_args, ctx) {
    const held = positions(ctx);
    if (held.length === 0) throw new ToolInputError("The portfolio holds no positions.");
    const c = concentration(held.map((h) => h.weightPercent));
    const largest = held[0]!;
    const node = ctx.graph.addNode({
      kind: "calc",
      title: "Concentration",
      facts: { largestSymbol: largest.symbol, largestPercent: c.largestPercent, top5Percent: c.top5Percent, effectiveHoldings: c.effectiveHoldings, holdingsCount: held.length },
      summary: `Largest position ${largest.symbol} ${c.largestPercent}%, top 5 ${c.top5Percent}%, ${held.length} positions acting like ${c.effectiveHoldings} equal ones.`,
      source: { provider: "app" },
      createdBy: "calc_concentration",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    link(ctx, node, held.slice(0, 5).map((h) => h.symbol), "Weight used in the concentration");
    return [node];
  },
};

export const calcCorrelation: AnalysisTool = {
  name: "calc_correlation",
  description: "Correlation of daily returns over one year between 2 to 6 held symbols. Without symbols it uses the 6 largest quoted positions.",
  inputSchema: {
    type: "object",
    properties: { symbols: { type: "array", items: { type: "string" }, maxItems: 6, description: "Held symbols." } },
  },
  maxCallsPerRun: 3,
  timeoutMs: 45_000,
  async run(args, ctx) {
    const wanted = Array.isArray(args.symbols) ? args.symbols.filter((s): s is string => typeof s === "string").map((s) => s.trim().toUpperCase()).slice(0, 6) : [];
    const symbols = wanted.length >= 2 ? wanted.map((s) => heldSymbol({ symbol: s }, ctx).holding.symbol) : positions(ctx).filter((h) => !h.isPrivate && !h.quoteMissing).slice(0, 6).map((h) => h.symbol);
    if (symbols.length < 2) throw new ToolInputError("Correlation needs at least two quoted holdings.");
    const series = new Map((await Promise.all(symbols.map(async (s) => [s, await priceSeries(ctx, s)] as const))).filter((x): x is [string, NonNullable<(typeof x)[1]>] => Boolean(x[1])));
    const aligned = alignSeries(series);
    const returns = [...aligned.closes.entries()].map(([s, closes]) => [s, dailyReturns(closes)] as const);
    if (returns.length < 2) throw new Error("Not enough shared price history");
    const pairs: { a: string; b: string; correlation: number }[] = [];
    for (let i = 0; i < returns.length; i++) for (let j = i + 1; j < returns.length; j++) pairs.push({ a: returns[i]![0], b: returns[j]![0], correlation: correlation(returns[i]![1], returns[j]![1]) });
    pairs.sort((x, y) => y.correlation - x.correlation);
    const high = pairs.filter((p) => p.correlation >= 0.7);
    const node = ctx.graph.addNode({
      kind: "calc",
      title: `Correlation of ${returns.map((r) => r[0]).join(", ")}`,
      facts: { pairs, days: aligned.dates.length },
      summary: `Over ${aligned.dates.length} days: ${pairs.slice(0, 4).map((p) => `${p.a}/${p.b} ${p.correlation}`).join(", ")}. ${high.length} pairs at 0.7 or more.`,
      source: { provider: "app" },
      createdBy: "calc_correlation",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    link(ctx, node, returns.map((r) => r[0]), "Returns used in the correlation");
    return [node];
  },
};

export const calcDrawdown: AnalysisTool = {
  name: "calc_drawdown",
  description: "Largest fall from a peak and the volatility over one year, for one held symbol, or for the portfolio at today's weights when no symbol is given.",
  inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Optional held symbol." } } },
  maxCallsPerRun: 4,
  timeoutMs: 45_000,
  async run(args, ctx) {
    if (typeof args.symbol === "string" && args.symbol.trim()) {
      const { holding, node: target } = heldSymbol(args, ctx);
      const s = await priceSeries(ctx, holding.symbol);
      if (!s || s.closes.length < 40) throw new Error("Not enough price history");
      const dd = maxDrawdown(s.closes);
      const vol = annualVolatilityPercent(dailyReturns(s.closes));
      const node = ctx.graph.addNode({
        kind: "calc",
        title: `${holding.symbol} drawdown and volatility`,
        facts: { symbol: holding.symbol, maxDrawdownPercent: dd.percent, volatilityPercent: vol, peakDate: s.dates[dd.peakIndex], troughDate: s.dates[dd.troughIndex], days: s.closes.length },
        summary: `${holding.symbol} fell at most ${dd.percent}% from a peak in the last year (${s.dates[dd.peakIndex]} to ${s.dates[dd.troughIndex]}); volatility ${vol}% a year.`,
        source: { provider: "app" },
        createdBy: "calc_drawdown",
        depth: ctx.depth,
        relevance: ctx.relevance,
      });
      ctx.graph.addEdge(node.id, target.id, "measures", "Price risk of the holding");
      return [node];
    }
    const { returns, weights, coveredPercent, days } = await alignedReturns(ctx);
    if (returns.size === 0 || days < 40) throw new Error("Not enough shared price history");
    const basket = basketReturns(returns, weights);
    const closes = basketCloses(basket);
    const dd = maxDrawdown(closes);
    const vol = annualVolatilityPercent(basket);
    const node = ctx.graph.addNode({
      kind: "calc",
      title: "Portfolio drawdown and volatility at today's weights",
      facts: { maxDrawdownPercent: dd.percent, volatilityPercent: vol, coveredWeightPercent: coveredPercent, days },
      summary: `At today's weights the quoted holdings (${coveredPercent}% of the portfolio) fell at most ${dd.percent}% from a peak over ${days} days; volatility ${vol}% a year.`,
      source: { provider: "app" },
      createdBy: "calc_drawdown",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    ctx.graph.addEdge(node.id, "A", "measures", "Price risk of the allocation");
    return [node];
  },
};

export const calcBeta: AnalysisTool = {
  name: "calc_beta",
  description: "Beta to the benchmark index over one year, for one held symbol, or for the portfolio at today's weights when no symbol is given.",
  inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Optional held symbol." } } },
  maxCallsPerRun: 4,
  timeoutMs: 45_000,
  async run(args, ctx) {
    const benchSymbol = configuredBenchmark() ?? DEFAULT_BENCHMARK_SYMBOL;
    const bench = await priceSeries(ctx, benchSymbol);
    if (!bench) throw new Error("No benchmark price history");
    const label = benchmarkLabel(benchSymbol);
    let symbol = "";
    let target = "A";
    let series = new Map([["__bench", bench]]);
    let weights = new Map<string, number>();
    let covered = 100;
    if (typeof args.symbol === "string" && args.symbol.trim()) {
      const { holding, node } = heldSymbol(args, ctx);
      const s = await priceSeries(ctx, holding.symbol);
      if (!s) throw new Error("No price history for this symbol");
      symbol = holding.symbol;
      target = node.id;
      series.set(symbol, s);
      weights.set(symbol, 1);
    } else {
      const h = await holdingSeries(ctx);
      series = new Map([["__bench", bench], ...h.series]);
      weights = h.weights;
      covered = h.coveredPercent;
    }
    const aligned = alignSeries(series);
    const benchCloses = aligned.closes.get("__bench");
    if (!benchCloses || aligned.dates.length < 40) throw new Error("Not enough shared price history");
    const returns = new Map<string, number[]>();
    for (const [k, closes] of aligned.closes) if (k !== "__bench") returns.set(k, dailyReturns(closes));
    const asset = basketReturns(returns, weights);
    if (asset.length === 0) throw new Error("Not enough shared price history");
    const b = beta(asset, dailyReturns(benchCloses));
    const node = ctx.graph.addNode({
      kind: "calc",
      title: `${symbol || "Portfolio"} beta to ${label}`,
      facts: { ...(symbol ? { symbol } : { coveredWeightPercent: covered }), benchmark: label, beta: b, days: aligned.dates.length },
      summary: `${symbol || `The quoted holdings (${covered}% of the portfolio)`} moved with a beta of ${b} to ${label} over ${aligned.dates.length} days.`,
      source: { provider: "app" },
      createdBy: "calc_beta",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    ctx.graph.addEdge(node.id, target, "measures", "Sensitivity to the market");
    return [node];
  },
};

export const calcRiskContribution: AnalysisTool = {
  name: "calc_risk_contribution",
  description: "Share of the portfolio's price risk that each of the largest quoted holdings carries, next to its weight.",
  inputSchema: noInput,
  maxCallsPerRun: 1,
  timeoutMs: 45_000,
  async run(_args, ctx) {
    const { returns, weights, coveredPercent, days } = await alignedReturns(ctx);
    if (returns.size < 2 || days < 40) throw new Error("Not enough shared price history");
    const contributions = riskContributions(returns, weights);
    const totalWeight = [...returns.keys()].reduce((a, k) => a + (weights.get(k) ?? 0), 0);
    const rows = [...contributions.entries()]
      .map(([symbol, riskPercent]) => ({ symbol, weightPercent: round(((weights.get(symbol) ?? 0) / totalWeight) * 100, 1), riskPercent }))
      .sort((a, b) => b.riskPercent - a.riskPercent)
      .slice(0, 8);
    const node = ctx.graph.addNode({
      kind: "calc",
      title: "Risk contribution",
      facts: { holdings: rows, coveredWeightPercent: coveredPercent, days },
      summary: `Within the quoted holdings: ${rows.slice(0, 4).map((r) => `${r.symbol} ${r.riskPercent}% of risk at ${r.weightPercent}% of weight`).join("; ")}.`,
      source: { provider: "app" },
      createdBy: "calc_risk_contribution",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    link(ctx, node, rows.map((r) => r.symbol), "Returns used in the risk split");
    return [node];
  },
};

export const runMetric: AnalysisTool = {
  name: "run_metric",
  description: "Runs one installed metric module on the portfolio. Only metrics that return a percentage are kept.",
  inputSchema: { type: "object", properties: { metricId: { type: "string", description: "Id of an installed metric." } }, required: ["metricId"] },
  maxCallsPerRun: 4,
  timeoutMs: 30_000,
  async run(args, ctx) {
    const metrics = ctx.deps.metricsService;
    if (!metrics) throw new ToolInputError("Metric modules are not available.");
    const id = typeof args.metricId === "string" ? args.metricId.trim() : "";
    const listing = id ? metrics.getCatalog().installed.find((m) => m.id === id) : undefined;
    if (!listing) throw new ToolInputError(`Unknown metric "${id}".`);
    const [result] = await metrics.evaluateForPortfolio({ portfolioId: ctx.portfolioId, baseCurrency: ctx.baseCurrency, ids: [id] });
    if (!result || result.status !== "ok") throw new Error(result ? result.error : "The metric returned nothing");
    const value = result.output.value;
    if (value.format !== "percent" || value.amount === null || !Number.isFinite(value.amount)) throw new ToolInputError("This metric does not return a percentage, so it stays out of the analysis.");
    const subs = (result.output.sub ?? []).filter((p): p is { amount: number; format: "percent" } => "amount" in p && p.format === "percent" && typeof p.amount === "number");
    const name = listing.manifest.name || id;
    const node = ctx.graph.addNode({
      kind: "metric",
      title: name,
      facts: { metricId: id, valuePercent: round(value.amount, 2), ...(subs.length ? { detailsPercent: subs.map((p) => ({ percent: round(p.amount, 2) })) } : {}) },
      summary: `${name}: ${round(value.amount, 2)}%.${listing.manifest.summary ? ` ${listing.manifest.summary}` : ""}`,
      source: { provider: listing.verified ? "metric module (reviewed)" : "metric module" },
      createdBy: "run_metric",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    ctx.graph.addEdge(node.id, "A", "measures", "Metric of the whole portfolio");
    return [node];
  },
};
