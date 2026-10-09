/**
 * Assistant-picked dashboard layout. The model gets the allocation of the
 * portfolio as percentages and the metrics added to it, and chooses the large
 * cards and compact tiles. Nothing is saved here: the GUI shows a preview and
 * saves the returned list only when the user confirms.
 */

import {
  METRIC_SLOT_CAPACITY,
  normalizeMetricPreferences,
  type MetricSlot,
  type PortfolioMetricPreference,
} from "portfolio-shared/metrics";
import type { MetricListing, SuggestPortfolioMetricsResponse } from "portfolio-shared/api-types";
import type { FinancialPortfolioData } from "portfolio-shared/portfolio";
import type { LlmMessage, LlmService } from "./llm.js";
import type { MetricsService } from "./metrics/index.js";
import type { PortfolioService } from "./portfolio.js";
import { getPortfolioMetrics } from "./portfolio-metrics.js";

interface Candidate {
  id: string;
  listing: MetricListing;
}

const pct = (value: number | undefined): string => `${(Number.isFinite(value) ? (value as number) : 0).toFixed(1)}%`;

/** Allocation facts without balances, amounts or tickers. */
function describeAllocation(data: FinancialPortfolioData): string {
  const summary = data.summary;
  const holdings = [...(data.holdings ?? [])].sort((a, b) => b.weightPercent - a.weightPercent);
  const top5 = holdings.slice(0, 5).reduce((sum, h) => sum + (h.weightPercent || 0), 0);
  const lines = [
    `- Stocks: ${pct(summary?.stockWeightPercent)}`,
    `- ETFs and funds: ${pct(summary?.etfWeightPercent)}`,
    `- Crypto: ${pct(summary?.cryptoWeightPercent)}`,
    `- Private and other: ${pct(summary?.otherWeightPercent)}`,
    `- Cash: ${pct(summary?.cashWeightPercent)}`,
    `- Number of holdings: ${holdings.length}`,
    `- Largest single holding: ${pct(holdings[0]?.weightPercent)}`,
    `- Top 5 holdings together: ${pct(top5)}`,
    `- Has received dividends or interest: ${(summary?.totalDividends ?? 0) + (summary?.totalInterest ?? 0) > 0 ? "yes" : "no"}`,
    `- Has realized gains or losses from sales: ${(summary?.realizedPnL ?? 0) !== 0 ? "yes" : "no"}`,
    `- Has paid broker fees: ${(summary?.totalFees ?? 0) > 0 ? "yes" : "no"}`,
    `- Has paid withheld taxes: ${(summary?.totalTaxes ?? 0) > 0 ? "yes" : "no"}`,
  ];
  return lines.join("\n");
}

function describeCandidates(candidates: Candidate[]): string {
  return candidates
    .map(({ id, listing }) => {
      const m = listing.manifest;
      return `- id: ${id} | name: ${m.name} | category: ${m.category} | default size: ${m.display.defaultSize} | ${m.summary}`;
    })
    .join("\n");
}

function buildPrompt(data: FinancialPortfolioData, candidates: Candidate[]): LlmMessage[] {
  return [
    {
      role: "system",
      content: `You choose the metrics for the dashboard of an investment portfolio app.
The dashboard has ${METRIC_SLOT_CAPACITY.large} large cards and ${METRIC_SLOT_CAPACITY.compact} compact tiles.
Put the metrics that matter most for this allocation on large cards, in order of importance. Put useful secondary metrics on compact tiles.
A metric can appear only once. Use only ids from the list. Leave out metrics that are not relevant to this portfolio.
Reply with one JSON object and nothing else, in this shape:
{"large": ["id", ...], "compact": ["id", ...], "reason": "at most 2 short sentences"}
Use ASD-STE100 Simplified English in "reason". Do not use long dashes. Do not give buy or sell advice.`,
    },
    {
      role: "user",
      content: `=== PORTFOLIO ALLOCATION ===\n${describeAllocation(data)}\n\n=== AVAILABLE METRICS ===\n${describeCandidates(candidates)}`,
    },
  ];
}

/** Find the first JSON object in the reply; models sometimes wrap it in a code fence or text. */
function parseReply(text: string): { large: unknown; compact: unknown; reason: unknown } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The assistant did not return a layout");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The assistant returned a layout that is not valid JSON");
  }
}

function pickIds(raw: unknown, allowed: Set<string>, taken: Set<string>, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  const result: string[] = [];
  for (const value of raw) {
    const id = typeof value === "string" ? value.trim() : "";
    if (!allowed.has(id) || taken.has(id)) continue;
    taken.add(id);
    result.push(id);
    if (result.length >= limit) break;
  }
  return result;
}

/** Apply the chosen slots: large cards first, then compact tiles, then every other entry off the dashboard. */
function applyLayout(prefs: PortfolioMetricPreference[], large: string[], compact: string[]): PortfolioMetricPreference[] {
  const byId = new Map(prefs.map((pref) => [pref.id, pref]));
  const slotted = (ids: string[], slot: MetricSlot) => ids.map((id, place) => ({ ...byId.get(id)!, slot, place }));
  const chosen = new Set([...large, ...compact]);
  const rest = prefs.filter((pref) => !chosen.has(pref.id)).map((pref) => ({ ...pref, slot: null, place: undefined }));
  return normalizeMetricPreferences([...slotted(large, "large"), ...slotted(compact, "compact"), ...rest]);
}

export async function suggestMetricLayout(
  deps: { llm: LlmService; portfolioService: PortfolioService; metricsService: MetricsService },
  portfolioId: string,
  baseCurrency?: string,
): Promise<SuggestPortfolioMetricsResponse> {
  const prefs = getPortfolioMetrics(portfolioId);
  const listings = new Map(deps.metricsService.getCatalog().installed.map((listing) => [listing.id, listing]));
  const candidates: Candidate[] = prefs
    .filter((pref) => pref.added && listings.has(pref.id) && listings.get(pref.id)!.status !== "unavailable")
    .map((pref) => ({ id: pref.id, listing: listings.get(pref.id)! }));
  if (candidates.length === 0) throw new Error("Add metrics to this portfolio first");

  const data = await deps.portfolioService.getPortfolioData(portfolioId, baseCurrency);
  const reply = parseReply(await deps.llm.chat(buildPrompt(data, candidates), deps.llm.resolve({ temperature: 0.2 })));

  const allowed = new Set(candidates.map((c) => c.id));
  const taken = new Set<string>();
  const large = pickIds(reply.large, allowed, taken, METRIC_SLOT_CAPACITY.large);
  const compact = pickIds(reply.compact, allowed, taken, METRIC_SLOT_CAPACITY.compact);
  if (large.length + compact.length === 0) throw new Error("The assistant did not choose any of the available metrics");

  const reason = typeof reply.reason === "string" ? reply.reason.trim().slice(0, 400) : "";
  return { portfolioId, metrics: applyLayout(prefs, large, compact), large, compact, reason };
}
