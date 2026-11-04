/**
 * Seed phase: the centre of the graph, built without a model. The brief, the
 * allocation, one node per holding, the concentration, and (when the
 * providers answer) the macro snapshot and the exposure after look-through.
 * Same ledger and same day give the same seed.
 */
import type { FinancialPortfolioData, PortfolioBrief } from "portfolio-shared/portfolio";
import { isBriefEmpty, optionText } from "portfolio-shared/brief";
import { formatBriefForPrompt } from "../portfolio-brief.js";
import { settleWithin } from "../ai-context.js";
import type { RunGraph } from "./graph.js";
import type { ToolContext } from "./types.js";
import { calcConcentration } from "./tools/calc.js";
import { getExposure, getMacro } from "./tools/market.js";
import { round, signedPct } from "./tools/common.js";

/** Holdings that get a node of their own; smaller ones are counted in the allocation. */
export const SEED_HOLDINGS = 25;

/** Structured brief fields as node facts: text, the 1 to 5 score and percentages only. */
function briefFacts(brief: PortfolioBrief): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  if (brief.purpose) facts.purpose = optionText(brief.purpose);
  if (brief.horizon) facts.horizon = optionText(brief.horizon);
  if (brief.riskTolerance) facts.riskTolerance = { riskScore: brief.riskTolerance.score, maxDropPercent: brief.riskTolerance.maxDropPercent };
  if (brief.incomeNeed) facts.incomeNeed = { required: brief.incomeNeed.required, targetYieldPercent: brief.incomeNeed.targetYieldPercent };
  if (brief.cashFlowPattern) facts.cashFlowPattern = optionText(brief.cashFlowPattern);
  if (brief.targetBands?.length) facts.targetBands = brief.targetBands.map((b) => ({ assetClass: optionText(b.assetClass), minPercent: b.minPercent, maxPercent: b.maxPercent }));
  if (brief.constraints?.length) facts.constraints = brief.constraints.map(optionText);
  if (brief.successInOwnWords) facts.successInOwnWords = brief.successInOwnWords;
  if (brief.prose) facts.prose = brief.prose;
  return facts;
}

export function seedCore(graph: RunGraph, data: FinancialPortfolioData, brief: PortfolioBrief): void {
  const empty = isBriefEmpty(brief);
  graph.addNode({
    id: "B",
    kind: "brief",
    title: "Portfolio brief",
    facts: empty ? { missing: true } : briefFacts(brief),
    summary: empty ? "The user has not written a brief. Judge the portfolio as a long-term, diversified investment." : formatBriefForPrompt({ ...brief, prose: undefined }).replace(/^- /gm, "").replace(/\n/g, "; ") || "The brief is in the user's own words.",
    source: { provider: "user" },
    createdBy: "seed",
    depth: 0,
    relevance: 1,
  });

  const s = data.summary;
  const held = (data.holdings ?? []).filter((h) => h.assetType !== "Cash" && h.shares > 0).sort((a, b) => b.weightPercent - a.weightPercent);
  const shown = held.slice(0, SEED_HOLDINGS);
  const restPercent = round(held.slice(SEED_HOLDINGS).reduce((a, h) => a + h.weightPercent, 0), 1);
  graph.addNode({
    id: "A",
    kind: "allocation",
    title: "Allocation",
    facts: {
      stockWeightPercent: round(s?.stockWeightPercent ?? 0, 1),
      etfWeightPercent: round(s?.etfWeightPercent ?? 0, 1),
      cryptoWeightPercent: round(s?.cryptoWeightPercent ?? 0, 1),
      otherWeightPercent: round(s?.otherWeightPercent ?? 0, 1),
      cashWeightPercent: round(s?.cashWeightPercent ?? 0, 1),
      totalGainLossPercent: round(s?.totalGainLossPercent ?? 0, 1),
      dayGainLossPercent: round(s?.dayGainLossPercent ?? 0, 2),
      holdingsCount: held.length,
      ...(restPercent > 0 ? { smallerHoldingsPercent: restPercent } : {}),
    },
    local: { totalValue: s?.totalPortfolioValue || s?.totalValue || 0, cashBalance: s?.cashBalance ?? 0, currency: s?.baseCurrency },
    summary: `Stocks ${round(s?.stockWeightPercent ?? 0, 1)}%, ETFs ${round(s?.etfWeightPercent ?? 0, 1)}%, crypto ${round(s?.cryptoWeightPercent ?? 0, 1)}%, private and other ${round(s?.otherWeightPercent ?? 0, 1)}%, cash ${round(s?.cashWeightPercent ?? 0, 1)}%. ${held.length} positions. Total return ${signedPct(s?.totalGainLossPercent)}.`,
    source: { provider: "ledger" },
    createdBy: "seed",
    depth: 0,
    relevance: 1,
  });

  for (const h of shown) {
    const node = graph.addNode({
      kind: "holding",
      title: `${h.symbol} ${h.name}`.trim(),
      facts: {
        symbol: h.symbol,
        name: h.name,
        assetType: h.assetType,
        weightPercent: round(h.weightPercent, 2),
        dayChangePercent: round(h.dayChangePercent, 2),
        totalGainLossPercent: round(h.totalGainLossPercent, 1),
        ...(h.isPrivate ? { privateAsset: true } : {}),
        ...(h.quoteMissing ? { noMarketQuote: true } : {}),
      },
      local: { value: h.currentValue, shares: h.shares, gain: h.totalGainLossDollar, currency: h.currency },
      summary: `${h.symbol} (${h.name}, ${h.assetType}): weight ${round(h.weightPercent, 2)}%, day ${signedPct(h.dayChangePercent, 2)}, total ${signedPct(h.totalGainLossPercent)}${h.isPrivate ? ", private asset" : ""}.`,
      source: { provider: "ledger" },
      createdBy: "seed",
      depth: 1,
      relevance: Math.min(0.95, 0.45 + h.weightPercent / 40),
    });
    graph.addEdge("A", node.id, "derived_from", `${round(h.weightPercent, 1)}% of the portfolio`);
  }
  graph.addEdge("B", "A", "about", "The goal the allocation serves");
}

/** The seed tools: concentration (local math) and, when the providers answer, macro and exposure. Failures leave the piece out. */
export async function seedContext(ctx: ToolContext): Promise<string[]> {
  const notes: string[] = [];
  const seedCtx = { ...ctx, depth: 1, relevance: 0.8 };
  const run = async (name: string, fn: () => Promise<unknown>, ms: number) => {
    const done = await settleWithin(`analysis_seed_${name}`, ms, async () => {
      await fn();
      return true;
    });
    if (!done) notes.push(name);
  };
  await run("concentration", () => calcConcentration.run({}, seedCtx), 5_000);
  await Promise.all([run("macro", () => getMacro.run({}, seedCtx), 30_000), run("exposure", () => getExposure.run({}, seedCtx), 30_000)]);
  return notes;
}
