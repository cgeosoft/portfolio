/**
 * Overview metric contract shared by the Bun main process and the webview.
 * Keeps metric keys, defaults, and preference validation in one place so the
 * marketplace page and the stored portfolio configuration cannot drift apart.
 */

/** Identifier of a metric that the overview page can display. */
export type OverviewMetricKey =
  | "totalPortfolioValue"
  | "dayGainLoss"
  | "lifetimeGain"
  | "cashLiquidity"
  | "investedCapital"
  | "holdingsCost"
  | "realizedPnL"
  | "dividendsInterest"
  | "brokerFees"
  | "taxesWithheld";

/** Display size of a selected metric on the overview page. */
export type MetricCardSize = "large" | "compact";

/** Per-portfolio selection state of a single metric. */
export interface PortfolioMetricPreference {
  key: OverviewMetricKey;
  enabled: boolean;
  size: MetricCardSize;
}

/**
 * Default selection. It reproduces the metric layout that the overview page
 * used before the metrics marketplace: four large cards and six compact tiles.
 */
export const DEFAULT_METRIC_PREFERENCES: readonly PortfolioMetricPreference[] = [
  { key: "totalPortfolioValue", enabled: true, size: "large" },
  { key: "dayGainLoss", enabled: true, size: "large" },
  { key: "lifetimeGain", enabled: true, size: "large" },
  { key: "cashLiquidity", enabled: true, size: "large" },
  { key: "investedCapital", enabled: true, size: "compact" },
  { key: "holdingsCost", enabled: true, size: "compact" },
  { key: "realizedPnL", enabled: true, size: "compact" },
  { key: "dividendsInterest", enabled: true, size: "compact" },
  { key: "brokerFees", enabled: true, size: "compact" },
  { key: "taxesWithheld", enabled: true, size: "compact" },
];

/** Every known metric key, in catalog order. */
export const OVERVIEW_METRIC_KEYS: readonly OverviewMetricKey[] = DEFAULT_METRIC_PREFERENCES.map((p) => p.key);

const DEFAULT_BY_KEY = new Map<OverviewMetricKey, PortfolioMetricPreference>(
  DEFAULT_METRIC_PREFERENCES.map((pref) => [pref.key, pref]),
);

export function isOverviewMetricKey(value: unknown): value is OverviewMetricKey {
  return typeof value === "string" && DEFAULT_BY_KEY.has(value as OverviewMetricKey);
}

/** Return a fresh copy of the default preference list. */
export function getDefaultMetricPreferences(): PortfolioMetricPreference[] {
  return DEFAULT_METRIC_PREFERENCES.map((pref) => ({ ...pref }));
}

/**
 * Validate an unknown preference list. Unknown keys are dropped, duplicates are
 * removed, and metrics that the list does not mention are appended with their
 * default state. The saved order is kept, because it controls display order.
 */
export function normalizeMetricPreferences(input: unknown): PortfolioMetricPreference[] {
  const result: PortfolioMetricPreference[] = [];
  const seen = new Set<OverviewMetricKey>();

  if (Array.isArray(input)) {
    for (const raw of input) {
      if (!raw || typeof raw !== "object") continue;
      const candidate = raw as Partial<PortfolioMetricPreference>;
      if (!isOverviewMetricKey(candidate.key) || seen.has(candidate.key)) continue;

      const fallback = DEFAULT_BY_KEY.get(candidate.key)!;
      result.push({
        key: candidate.key,
        enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
        size: candidate.size === "large" || candidate.size === "compact" ? candidate.size : fallback.size,
      });
      seen.add(candidate.key);
    }
  }

  for (const pref of DEFAULT_METRIC_PREFERENCES) {
    if (!seen.has(pref.key)) {
      result.push({ ...pref });
    }
  }

  return result;
}

/** Parse a stored JSON string. Invalid or empty values fall back to defaults. */
export function parseMetricPreferences(json: string | null | undefined): PortfolioMetricPreference[] {
  if (!json) return getDefaultMetricPreferences();
  try {
    return normalizeMetricPreferences(JSON.parse(json));
  } catch {
    return getDefaultMetricPreferences();
  }
}

/** Serialize a preference list for storage. */
export function serializeMetricPreferences(prefs: PortfolioMetricPreference[]): string {
  return JSON.stringify(normalizeMetricPreferences(prefs));
}
