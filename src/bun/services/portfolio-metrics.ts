/**
 * Per-portfolio overview metric selection.
 * The selection is stored as JSON in the portfolios table and validated
 * against the shared metric contract before it is read or written.
 */

import * as portfolioRepo from "../db/portfolio.repo.js";
import {
  getDefaultMetricPreferences,
  normalizeMetricPreferences,
  parseMetricPreferences,
  serializeMetricPreferences,
  type PortfolioMetricPreference,
} from "../../shared/metrics.js";

function assertPortfolioExists(portfolioId: string): void {
  if (!portfolioRepo.findById(portfolioId)) {
    throw new Error(`Portfolio not found (${portfolioId})`);
  }
}

/** Read the metric selection of a portfolio. Unset portfolios get the defaults. */
export function getPortfolioMetrics(portfolioId: string): PortfolioMetricPreference[] {
  assertPortfolioExists(portfolioId);
  return parseMetricPreferences(portfolioRepo.findMetricsJson(portfolioId));
}

/** Write the metric selection of a portfolio and return the stored result. */
export function savePortfolioMetrics(
  portfolioId: string,
  metrics: PortfolioMetricPreference[],
): PortfolioMetricPreference[] {
  assertPortfolioExists(portfolioId);
  const normalized = normalizeMetricPreferences(metrics);
  portfolioRepo.updateMetricsJson(portfolioId, serializeMetricPreferences(normalized));
  return normalized;
}

/** Restore the default metric selection of a portfolio. */
export function resetPortfolioMetrics(portfolioId: string): PortfolioMetricPreference[] {
  return savePortfolioMetrics(portfolioId, getDefaultMetricPreferences());
}
