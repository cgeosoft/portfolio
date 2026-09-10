import { describe, it, expect } from "bun:test";
import {
  DEFAULT_METRIC_PREFERENCES,
  getDefaultMetricPreferences,
  isOverviewMetricKey,
  normalizeMetricPreferences,
  parseMetricPreferences,
  serializeMetricPreferences,
} from "../../../shared/metrics.js";

describe("Overview metric preferences", () => {
  it("returns the migrated default layout when nothing is stored", () => {
    const prefs = parseMetricPreferences(null);
    expect(prefs).toHaveLength(DEFAULT_METRIC_PREFERENCES.length);
    expect(prefs.filter((p) => p.enabled)).toHaveLength(DEFAULT_METRIC_PREFERENCES.length);
    expect(prefs.filter((p) => p.size === "large").map((p) => p.key)).toEqual([
      "totalPortfolioValue",
      "dayGainLoss",
      "lifetimeGain",
      "cashLiquidity",
    ]);
  });

  it("falls back to defaults on invalid stored JSON", () => {
    expect(parseMetricPreferences("{not json")).toEqual(getDefaultMetricPreferences());
  });

  it("keeps the stored order and appends missing metrics with their defaults", () => {
    const prefs = normalizeMetricPreferences([
      { key: "brokerFees", enabled: false, size: "large" },
      { key: "dayGainLoss", enabled: true, size: "compact" },
    ]);

    expect(prefs[0]).toEqual({ key: "brokerFees", enabled: false, size: "large" });
    expect(prefs[1]).toEqual({ key: "dayGainLoss", enabled: true, size: "compact" });
    expect(prefs).toHaveLength(DEFAULT_METRIC_PREFERENCES.length);
    expect(prefs.find((p) => p.key === "totalPortfolioValue")).toEqual({
      key: "totalPortfolioValue",
      enabled: true,
      size: "large",
    });
  });

  it("drops unknown keys, duplicates, and invalid field values", () => {
    const prefs = normalizeMetricPreferences([
      { key: "unknownMetric", enabled: true, size: "large" },
      { key: "cashLiquidity", enabled: false, size: "compact" },
      { key: "cashLiquidity", enabled: true, size: "large" },
      { key: "realizedPnL", enabled: "yes", size: "huge" },
      null,
      "brokerFees",
    ]);

    expect(prefs.some((p) => (p.key as string) === "unknownMetric")).toBe(false);
    expect(prefs.filter((p) => p.key === "cashLiquidity")).toHaveLength(1);
    expect(prefs.find((p) => p.key === "cashLiquidity")).toEqual({
      key: "cashLiquidity",
      enabled: false,
      size: "compact",
    });
    expect(prefs.find((p) => p.key === "realizedPnL")).toEqual({
      key: "realizedPnL",
      enabled: true,
      size: "compact",
    });
  });

  it("normalizes non-array input to the defaults", () => {
    expect(normalizeMetricPreferences(undefined)).toEqual(getDefaultMetricPreferences());
    expect(normalizeMetricPreferences({ key: "brokerFees" })).toEqual(getDefaultMetricPreferences());
  });

  it("serializes a validated list", () => {
    const json = serializeMetricPreferences([{ key: "brokerFees", enabled: false, size: "compact" }]);
    const parsed = parseMetricPreferences(json);
    expect(parsed[0]).toEqual({ key: "brokerFees", enabled: false, size: "compact" });
    expect(parsed).toHaveLength(DEFAULT_METRIC_PREFERENCES.length);
  });

  it("recognizes only known metric keys", () => {
    expect(isOverviewMetricKey("taxesWithheld")).toBe(true);
    expect(isOverviewMetricKey("sharpeRatio")).toBe(false);
    expect(isOverviewMetricKey(42)).toBe(false);
  });
});
