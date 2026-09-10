/**
 * YAML parsing of metric manifests in the main process. Validation itself is
 * shared with the webview (src/shared/metric-manifest.ts).
 */

import { validateMetricManifest, type MetricManifest } from "../../../shared/metric-manifest.js";

/** Upper bound of a manifest document, in bytes. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

export function parseManifestYaml(yaml: string): MetricManifest {
  if (yaml.length > MAX_MANIFEST_BYTES) throw new Error("manifest exceeds 64 KiB");
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(yaml);
  } catch (err) {
    throw new Error(`manifest is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  return validateMetricManifest(parsed);
}
