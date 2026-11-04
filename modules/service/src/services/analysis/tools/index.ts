/**
 * The tool registry of Guided Analysis. Every tool is read-only and returns
 * graph nodes whose facts passed the privacy gate. The same catalog goes to
 * every provider: as real tools to models with native tool calling, and as a
 * JSON action list to the CLI providers (model-port.ts).
 */
import type { AnalysisTool } from "../types.js";
import { calcBeta, calcConcentration, calcCorrelation, calcDrawdown, calcRiskContribution, runMetric } from "./calc.js";
import { getCompany, getHoldingNews, getIndicators } from "./holding.js";
import { getBenchmark, getEvents, getExposure, getIncome, getMacro, getMarketNews } from "./market.js";

export const ANALYSIS_TOOLS: readonly AnalysisTool[] = [
  getIndicators,
  getCompany,
  getHoldingNews,
  getMarketNews,
  getMacro,
  getEvents,
  getBenchmark,
  getExposure,
  getIncome,
  calcConcentration,
  calcCorrelation,
  calcDrawdown,
  calcBeta,
  calcRiskContribution,
  runMetric,
];

const BY_NAME = new Map(ANALYSIS_TOOLS.map((t) => [t.name, t]));

export function findTool(name: string): AnalysisTool | undefined {
  return BY_NAME.get(name);
}
