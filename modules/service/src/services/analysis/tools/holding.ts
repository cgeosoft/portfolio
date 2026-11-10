/** Tools about one held position: indicators, company data and its news. */
import type { AnalysisNode } from "portfolio-shared/api-types";
import { formatCompanyIntelForPrompt, getCompanyIntel, getCompanyNews, isFundType, isIntelEligible } from "../../intel/company.js";
import { annualVolatilityPercent, changePercent, dailyReturns, fromHighPercent, maxDrawdown } from "../math.js";
import { ToolInputError, type AnalysisTool } from "../types.js";
import { heldSymbol, priceSeries, round, signedPct } from "./common.js";

const symbolInput = {
  type: "object" as const,
  properties: { symbol: { type: "string" as const, description: "Symbol of a held position, as on its holding node." } },
  required: ["symbol"],
};

export const getIndicators: AnalysisTool = {
  name: "get_indicators",
  description: "Technical state of one held position from one year of daily prices: RSI, distance to the 50 and 200 day averages, 1 and 3 month change, volatility, drawdown and distance from the 1-year high.",
  inputSchema: symbolInput,
  maxCallsPerRun: 15,
  timeoutMs: 20_000,
  async run(args, ctx) {
    const { holding, node } = heldSymbol(args, ctx);
    if (holding.isPrivate || holding.quoteMissing || holding.manualPrice) throw new ToolInputError(`${holding.symbol} has no market price, so it has no indicators.`);
    const series = await priceSeries(ctx, holding.symbol);
    const facts: Record<string, unknown> = { symbol: holding.symbol };
    if (holding.rsi !== undefined) facts.rsi = round(holding.rsi, 0);
    if (holding.sma50 && holding.currentPrice) facts.priceVsSma50Percent = round((holding.currentPrice / holding.sma50 - 1) * 100, 1);
    if (holding.sma200 && holding.currentPrice) facts.priceVsSma200Percent = round((holding.currentPrice / holding.sma200 - 1) * 100, 1);
    if (series && series.closes.length > 30) {
      const closes = series.closes;
      facts.change1mPercent = changePercent(closes, 21);
      facts.change3mPercent = changePercent(closes, 63);
      facts.volatilityPercent = annualVolatilityPercent(dailyReturns(closes));
      facts.maxDrawdown1yPercent = maxDrawdown(closes).percent;
      facts.fromHigh1yPercent = fromHighPercent(closes);
    }
    if (Object.keys(facts).length <= 1) throw new Error("No price history for this symbol");
    const parts = [
      facts.rsi !== undefined ? `RSI ${facts.rsi}` : "",
      facts.priceVsSma50Percent !== undefined ? `vs SMA50 ${signedPct(facts.priceVsSma50Percent as number)}` : "",
      facts.priceVsSma200Percent !== undefined ? `vs SMA200 ${signedPct(facts.priceVsSma200Percent as number)}` : "",
      facts.change3mPercent !== undefined ? `3 months ${signedPct(facts.change3mPercent as number)}` : "",
      facts.volatilityPercent !== undefined ? `volatility ${facts.volatilityPercent}% a year` : "",
      facts.fromHigh1yPercent !== undefined ? `${facts.fromHigh1yPercent}% below the 1-year high` : "",
    ].filter(Boolean);
    const added = ctx.graph.addNode({
      kind: "indicator",
      title: `${holding.symbol} technicals`,
      facts,
      summary: `${holding.symbol}: ${parts.join(", ")}.`,
      source: { provider: "app", fetchTime: new Date().toISOString() },
      createdBy: "get_indicators",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    ctx.graph.addEdge(added.id, node.id, "measures", "Price trend and risk of the holding");
    return [added];
  },
};

export const getCompany: AnalysisTool = {
  name: "get_company",
  description: "Public company data of one held stock or fund: profile, analyst view, financial scores and key ratios, as provided by the data providers.",
  inputSchema: symbolInput,
  maxCallsPerRun: 8,
  timeoutMs: 45_000,
  async run(args, ctx) {
    const { holding, node } = heldSymbol(args, ctx);
    if (!isIntelEligible(holding.symbol, holding.assetType, holding.isPrivate)) throw new ToolInputError(`No company data exists for ${holding.symbol}.`);
    const intel = await getCompanyIntel(ctx.deps, holding.symbol, {
      include: isFundType(holding.assetType) ? ["profile", "metrics"] : ["profile", "analyst", "scores", "metrics"],
      assetType: holding.assetType,
      isPrivate: holding.isPrivate,
    });
    const text = formatCompanyIntelForPrompt(intel, { maxChars: 1_200, headlines: false, maxGrades: 2 });
    const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("###"));
    if (lines.length === 0) throw new Error("The providers have no company data for this symbol");
    const profile = intel.profile?.data;
    const facts: Record<string, unknown> = { symbol: holding.symbol, text: lines.join("\n") };
    if (profile?.sector) facts.sector = profile.sector;
    if (profile?.industry) facts.industry = profile.industry;
    if (profile?.country) facts.country = profile.country;
    if (typeof profile?.beta === "number") facts.beta = round(profile.beta, 2);
    const sources = [intel.profile?.source, intel.analyst?.source, intel.scores?.source, intel.metrics?.source].filter(Boolean);
    const added = ctx.graph.addNode({
      kind: "company",
      title: `${holding.symbol} company data`,
      facts,
      summary: lines.join(" ").replace(/\s+/g, " "),
      source: { provider: [...new Set(sources)].join(", ") || undefined, fetchTime: intel.fetchedAt },
      createdBy: "get_company",
      depth: ctx.depth,
      relevance: ctx.relevance,
    });
    ctx.graph.addEdge(added.id, node.id, "about", "Fundamentals and analyst view of the holding");
    return [added];
  },
};

export const getHoldingNews: AnalysisTool = {
  name: "get_holding_news",
  description: "Recent headlines about one held stock or fund, up to 3, with source, date and link.",
  inputSchema: symbolInput,
  maxCallsPerRun: 10,
  timeoutMs: 30_000,
  async run(args, ctx) {
    const { holding, node } = heldSymbol(args, ctx);
    if (!isIntelEligible(holding.symbol, holding.assetType, holding.isPrivate)) throw new ToolInputError(`No news feed exists for ${holding.symbol}.`);
    const res = await getCompanyNews(ctx.deps, holding.symbol);
    const items = (res?.data ?? []).filter((n) => n.title).sort((a, b) => b.datetime - a.datetime).slice(0, 3);
    if (items.length === 0) throw new Error("No recent headlines for this symbol");
    const added: AnalysisNode[] = [];
    for (const item of items) {
      const date = new Date(item.datetime * 1000).toISOString().slice(0, 10);
      const news = ctx.graph.addNode({
        kind: "news",
        title: item.title,
        facts: { symbol: holding.symbol, date, publisher: item.publisher ?? "", headline: item.title, summary: (item.summary ?? "").slice(0, 400) },
        summary: `${date} ${item.publisher ? `(${item.publisher}) ` : ""}${item.title}${item.summary ? `: ${item.summary.slice(0, 400)}` : ""}`,
        source: { provider: res?.source, url: item.url, fetchTime: new Date().toISOString() },
        createdBy: "get_holding_news",
        depth: ctx.depth,
        relevance: ctx.relevance * 0.9,
      });
      ctx.graph.addEdge(news.id, node.id, "about", `Headline about ${holding.symbol}`);
      added.push(news);
    }
    return added;
  },
};
