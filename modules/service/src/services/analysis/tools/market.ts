/**
 * Tools about the market and the whole portfolio: market news, macro,
 * upcoming events, benchmark, exposure after look-through and income.
 * Each wraps the data services of ai-context.ts with the same formatters, so
 * the text holds percentages, dates and public data only.
 */
import type { AnalysisNode } from "portfolio-shared/api-types";
import { formatIncomeForPrompt, formatMacroForPrompt } from "../../ai-context.js";
import { formatExposureForPrompt, getPortfolioExposureSummary } from "../../exposure.js";
import { getBenchmarkComparison } from "../../intel/benchmark.js";
import { getMacroSnapshot } from "../../intel/macro.js";
import { instrumentLabel } from "../../instrument-label.js";
import type { AnalysisTool, ToolContext } from "../types.js";
import { intArg, signedPct, textArg } from "./common.js";

const noInput = { type: "object" as const, properties: {} };

/** The allocation node, which portfolio-wide facts hang from. */
function allocationId(ctx: ToolContext): string {
  return ctx.graph.get("A")?.id ?? "A";
}

export const getMarketNews: AnalysisTool = {
  name: "get_market_news",
  description: "The latest general market and economy headlines, up to 5.",
  inputSchema: noInput,
  maxCallsPerRun: 1,
  timeoutMs: 30_000,
  async run(_args, ctx) {
    const res = await ctx.deps.marketData.getMarketNewsWithSource(5);
    const items = (res.data ?? []).filter((n) => n.headline).slice(0, 5);
    if (items.length === 0) throw new Error("No market headlines available");
    const added: AnalysisNode[] = [];
    for (const item of items) {
      const date = item.datetime ? new Date((item.datetime > 1e12 ? item.datetime : item.datetime * 1000)).toISOString().slice(0, 10) : "";
      const node = ctx.graph.addNode({
        kind: "news",
        title: item.headline,
        facts: { date, publisher: item.source ?? "", headline: item.headline, summary: (item.summary ?? "").slice(0, 400) },
        summary: `${date ? `${date} ` : ""}${item.source ? `(${item.source}) ` : ""}${item.headline}${item.summary ? `: ${item.summary}` : ""}`,
        source: { provider: res.source ?? undefined, url: item.url, fetchTime: new Date().toISOString() },
        createdBy: "get_market_news",
        depth: ctx.depth,
        relevance: ctx.relevance * 0.8,
      });
      ctx.graph.addEdge(node.id, allocationId(ctx), "about", "Market-wide headline");
      added.push(node);
    }
    return added;
  },
};

export const getMacro: AnalysisTool = {
  name: "get_macro",
  description: "Macro snapshot: US Treasury yields and the curve, inflation, policy rate and unemployment, the next high-impact economic releases, and sector moves.",
  inputSchema: noInput,
  maxCallsPerRun: 1,
  timeoutMs: 30_000,
  async run(_args, ctx) {
    const existing = ctx.graph.byKind("macro")[0];
    if (existing) return [existing];
    const macro = await getMacroSnapshot(ctx.deps, { baseCurrency: ctx.baseCurrency });
    const text = formatMacroForPrompt(macro);
    if (!text) throw new Error("No macro data available");
    const facts: Record<string, unknown> = { text };
    const y2 = macro.yieldCurve?.points.find((p) => p.tenor === "year2");
    const y10 = macro.yieldCurve?.points.find((p) => p.tenor === "year10");
    if (y10) facts.us10yYieldPercent = y10.yield;
    if (y2) facts.us2yYieldPercent = y2.yield;
    if (y2 && y10) facts.curve10y2ySpreadPercent = Math.round((y10.yield - y2.yield) * 100) / 100;
    const inflation = macro.indicators?.items.find((i) => i.id === "inflationRate");
    if (inflation && inflation.unit === "%") facts.inflationPercent = inflation.value;
    const node = ctx.graph.addNode({
      kind: "macro",
      title: "Macro snapshot",
      facts,
      summary: text.replace(/^- /gm, "").replace(/\n/g, " "),
      source: { provider: [macro.yieldCurve?.source, macro.indicators?.source].filter(Boolean).join(", ") || undefined, fetchTime: new Date().toISOString() },
      createdBy: "get_macro",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    ctx.graph.addEdge(node.id, allocationId(ctx), "about", "Economic backdrop of the portfolio");
    return [node];
  },
};

export const getEvents: AnalysisTool = {
  name: "get_events",
  description: "Upcoming earnings reports, ex-dividend dates and splits of held symbols in the next N days (default 14, at most 30).",
  inputSchema: { type: "object", properties: { days: { type: "integer", description: "Days ahead, 1 to 30.", minimum: 1, maximum: 30 } } },
  maxCallsPerRun: 1,
  timeoutMs: 30_000,
  async run(args, ctx) {
    const days = intArg(args, "days", 14, 1, 30);
    const res = await ctx.deps.income.getUpcomingEvents(ctx.portfolioId, days);
    const events = res.events.filter((e) => e.kind === "earnings" || e.kind === "exDividend" || e.kind === "split").slice(0, 8);
    if (events.length === 0) throw new Error(`No earnings, ex-dividend dates or splits of held symbols in the next ${days} days`);
    const label = { earnings: "earnings report", exDividend: "ex-dividend date", split: "stock split", dividendPayment: "dividend payment" } as const;
    const added: AnalysisNode[] = [];
    for (const e of events) {
      const holding = ctx.graph.holding(e.symbol);
      const node = ctx.graph.addNode({
        kind: "event",
        title: `${e.symbol} ${label[e.kind]} ${e.date}`,
        facts: { symbol: e.symbol, date: e.date, event: label[e.kind], estimated: Boolean(e.estimated) },
        summary: `${e.date} ${instrumentLabel(e.symbol, e.name)}: ${label[e.kind]}${e.estimated ? " (estimated from the past pattern)" : ""}.`,
        source: { provider: e.source ?? undefined, fetchTime: new Date().toISOString() },
        createdBy: "get_events",
        depth: ctx.depth,
        relevance: ctx.relevance * 0.8,
      });
      if (holding) ctx.graph.addEdge(node.id, holding.id, "about", "Upcoming event of the holding");
      added.push(node);
    }
    return added;
  },
};

export const getBenchmark: AnalysisTool = {
  name: "get_benchmark",
  description: "Time-weighted return of the portfolio against its benchmark index over a range: 3mo, 6mo, 1y or 2y (default 1y).",
  inputSchema: { type: "object", properties: { range: { type: "string", enum: ["3mo", "6mo", "1y", "2y"], description: "Range of the comparison." } } },
  maxCallsPerRun: 2,
  timeoutMs: 30_000,
  async run(args, ctx) {
    const range = ["3mo", "6mo", "1y", "2y"].includes(textArg(args, "range")) ? textArg(args, "range") : "1y";
    const c = await getBenchmarkComparison(ctx.deps, ctx.portfolioId, range);
    if (!c) throw new Error("No benchmark comparison available");
    const node = ctx.graph.addNode({
      kind: "calc",
      title: `Portfolio vs ${c.label}, ${c.range}`,
      facts: { benchmark: c.label, range: c.range, from: c.from, to: c.to, portfolioReturnPercent: c.portfolioReturnPercent, benchmarkReturnPercent: c.benchmarkReturnPercent, excessReturnPercent: c.excessReturnPercent },
      summary: `${c.from} to ${c.to}: portfolio ${signedPct(c.portfolioReturnPercent)}, ${c.label} ${signedPct(c.benchmarkReturnPercent)}, difference ${signedPct(c.excessReturnPercent)}.`,
      source: { provider: c.source ?? undefined, fetchTime: new Date().toISOString() },
      createdBy: "get_benchmark",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    ctx.graph.addEdge(node.id, allocationId(ctx), "measures", "Return against the benchmark");
    return [node];
  },
};

export const getExposure: AnalysisTool = {
  name: "get_exposure",
  description: "Exposure after looking through funds: sectors, countries, asset classes, the largest underlying stocks, fund overlaps and warnings.",
  inputSchema: noInput,
  maxCallsPerRun: 1,
  timeoutMs: 30_000,
  async run(_args, ctx) {
    const existing = ctx.graph.nodes.find((n) => n.createdBy === "get_exposure");
    if (existing) return [existing];
    const s = await getPortfolioExposureSummary(ctx.portfolioId);
    if (!s || (s.sectors.length === 0 && s.countries.length === 0)) throw new Error("No exposure data available");
    const node = ctx.graph.addNode({
      kind: "calc",
      title: "Exposure after look-through",
      facts: {
        text: formatExposureForPrompt(s),
        sectors: s.sectors.map((x) => ({ name: x.name, percent: x.percent })),
        countries: s.countries.map((x) => ({ name: x.name, percent: x.percent })),
        topStocks: s.topStocks.slice(0, 5).map((x) => ({ symbol: x.symbol, percent: x.percent })),
        lookedThroughPercent: s.coverage.lookedThroughPercent,
        warnings: s.warnings.slice(0, 4),
      },
      summary: [
        s.sectors.length ? `Sectors: ${s.sectors.slice(0, 4).map((x) => `${x.name} ${x.percent.toFixed(1)}%`).join(", ")}.` : "",
        s.countries.length ? `Countries: ${s.countries.slice(0, 3).map((x) => `${x.name} ${x.percent.toFixed(1)}%`).join(", ")}.` : "",
        s.warnings.length ? `Warning: ${s.warnings[0]}` : "",
      ].filter(Boolean).join(" "),
      source: { provider: s.sources.join(", ") || undefined, fetchTime: new Date().toISOString() },
      createdBy: "get_exposure",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    ctx.graph.addEdge(node.id, allocationId(ctx), "derived_from", "Look-through of the funds in the allocation");
    return [node];
  },
};

export const getIncome: AnalysisTool = {
  name: "get_income",
  description: "Dividend yield of the portfolio (current and on cost) and of the largest payers, with their next ex-dividend and pay dates.",
  inputSchema: noInput,
  maxCallsPerRun: 1,
  timeoutMs: 30_000,
  async run(_args, ctx) {
    const s = await ctx.deps.income.getIncomeSummary(ctx.portfolioId);
    const text = formatIncomeForPrompt(s, 6);
    if (!text) throw new Error("No dividend data for this portfolio");
    const facts: Record<string, unknown> = { text };
    if (s.currentYieldPercent !== undefined) facts.currentYieldPercent = s.currentYieldPercent;
    if (s.yieldOnCostPercent !== undefined) facts.yieldOnCostPercent = s.yieldOnCostPercent;
    facts.count = s.holdings.length;
    const node = ctx.graph.addNode({
      kind: "calc",
      title: "Dividend income",
      facts,
      summary: `Current yield ${s.currentYieldPercent ?? "n/a"}%, yield on cost ${s.yieldOnCostPercent ?? "n/a"}%, ${s.holdings.length} dividend payers.`,
      source: { provider: s.sources.join(", ") || undefined, fetchTime: s.generatedAt },
      createdBy: "get_income",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    ctx.graph.addEdge(node.id, allocationId(ctx), "measures", "Income the portfolio produces");
    return [node];
  },
};
