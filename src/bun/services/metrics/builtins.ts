/**
 * Metric modules bundled with the application. The bytes are embedded by
 * scripts/build-metrics.ts, so dev and packaged builds resolve them the same
 * way with no runtime path lookup.
 */

import { BUILTIN_METRIC_MODULES, METRIC_REPOSITORY, type MetricRepositoryEntry } from "./builtin-modules.generated.js";
import type { MetricManifest } from "../../../shared/metric-manifest.js";

export type { MetricRepositoryEntry };

export interface BuiltinMetric {
  manifest: MetricManifest;
  sha256: string;
  size: number;
  bytes: Uint8Array;
}

let decoded: BuiltinMetric[] | null = null;

export function getBuiltinMetrics(): readonly BuiltinMetric[] {
  if (!decoded) {
    decoded = BUILTIN_METRIC_MODULES.map((item) => ({
      manifest: item.manifest,
      sha256: item.sha256,
      size: item.size,
      bytes: new Uint8Array(Buffer.from(item.base64, "base64")),
    }));
  }
  return decoded;
}

export function getMetricRepository(): readonly MetricRepositoryEntry[] {
  return METRIC_REPOSITORY;
}
