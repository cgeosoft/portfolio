/**
 * YAML parsing of metric manifests in the main process. Validation itself is
 * shared with the webview (modules/shared/src/metric-manifest.ts).
 */

import { validateMetricManifest, type MetricManifest } from "portfolio-shared/metric-manifest";

/** Upper bound of a manifest document, in bytes. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

/** Upper bound of the values in a parsed manifest. A real one holds about 50. */
const MAX_MANIFEST_NODES = 5_000;

/**
 * Bun.YAML keeps an alias as a reference to the anchored value, so a few
 * hundred bytes of nested aliases describe millions of values. Count every
 * value reached, aliases included, and stop at the budget before anything
 * walks or serializes the document.
 */
function assertManifestSize(root: unknown): void {
  const stack: unknown[] = [root];
  let nodes = 1;
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    for (const child of Object.values(node)) {
      if (++nodes > MAX_MANIFEST_NODES) throw new Error(`manifest holds more than ${MAX_MANIFEST_NODES} values`);
      stack.push(child);
    }
  }
}

export function parseManifestYaml(yaml: string): MetricManifest {
  if (yaml.length > MAX_MANIFEST_BYTES) throw new Error("manifest exceeds 64 KiB");
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(yaml);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`manifest is not valid YAML: ${reason.slice(0, 200)}`);
  }
  assertManifestSize(parsed);
  return validateMetricManifest(parsed);
}
