/**
 * View-side helpers for metric modules: format a sandbox result with the
 * currency and privacy settings of the UI, and describe failures.
 */

import { renderMetricOutput, type RenderedMetric } from "../../../../shared/metric-output";
import type { MetricEvaluation, MetricListing } from "../../../../shared/rpc-types";
import { fmtCurrency, fmtPercent } from "../portfolio/utils";

export interface MetricViewContext {
  currency: string;
  hideValues: boolean;
}

export type MetricDisplay =
  | ({ kind: "ok" } & RenderedMetric)
  | { kind: "pending" }
  | { kind: "failed"; status: "error" | "quarantined" | "missing"; error: string };

/** Turn the evaluation of a metric into display strings. Missing evaluations render as pending. */
export function displayMetric(evaluation: MetricEvaluation | undefined, ctx: MetricViewContext): MetricDisplay {
  if (!evaluation) return { kind: "pending" };
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
