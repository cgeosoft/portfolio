/**
 * View-side helpers for metric modules: format a sandbox result with the
 * currency and privacy settings of the UI, and describe failures.
 */

import { renderMetricOutput, type RenderedMetric } from "portfolio-shared/metric-output";
import type { MetricEvaluation, MetricListing } from "portfolio-shared/api-types";
import { fmtCurrency, fmtPercent } from "../portfolio/utils";

export interface MetricViewContext {
  currency: string;
  hideValues: boolean;
}

export type MetricDisplay =
  | ({ kind: "ok" } & RenderedMetric)
  | { kind: "pending" }
  /** A data provider the metric needs has no API key. Shown disabled, not as an error. */
  | { kind: "unavailable"; reason: string }
  | { kind: "failed"; status: "error" | "quarantined" | "missing"; error: string };

/** Turn the evaluation of a metric into display strings. Missing evaluations render as pending. */
export function displayMetric(evaluation: MetricEvaluation | undefined, ctx: MetricViewContext): MetricDisplay {
  if (!evaluation) return { kind: "pending" };
  if (evaluation.status === "unavailable") return { kind: "unavailable", reason: evaluation.error };
  if (evaluation.status !== "ok") return { kind: "failed", status: evaluation.status, error: evaluation.error };
  const rendered = renderMetricOutput(evaluation.output, {
    currency: (amount) => fmtCurrency(amount, ctx.currency, ctx.hideValues),
    percent: fmtPercent,
    number: (value) => (value === undefined ? "0" : value.toLocaleString("en-US", { maximumFractionDigits: 2 })),
  });
  return { kind: "ok", ...rendered };
}

export function metricTitle(listing: MetricListing): string {
  return listing.manifest.name;
}

export function metricShortTitle(listing: MetricListing): string {
  return listing.manifest.shortName || listing.manifest.name;
}

/** Why a metric cannot be added or run (a provider without an API key), or null. */
export function metricUnavailableReason(listing: MetricListing | null | undefined): string | null {
  return listing?.status === "unavailable" ? listing.statusReason || "A data provider this metric needs is not set up" : null;
}

/** Short label of a disabled metric, for tiles and badges. */
export const UNAVAILABLE_LABEL = "Needs FMP key";
