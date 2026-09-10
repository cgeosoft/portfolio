import { describe, it, expect } from "bun:test";
import {
  BUILTIN_METRIC_IDS,
  DEFAULT_METRIC_PREFERENCES,
  METRIC_SLOT_CAPACITY,
  countMetricSlots,
  getDefaultMetricPreferences,
  isMetricId,
  normalizeMetricPreferences,
  parseMetricPreferences,
  serializeMetricPreferences,
} from "../../../shared/metrics.js";

describe("Metric preferences", () => {
  it("returns the default dashboard when nothing is stored", () => {
    const prefs = parseMetricPreferences(null);
    expect(prefs).toHaveLength(BUILTIN_METRIC_IDS.length);
    expect(prefs.every((p) => p.added)).toBe(true);
    expect(prefs.filter((p) => p.slot === "large").map((p) => p.id)).toEqual([
      "total-portfolio-value",
      "day-gain-loss",
      "lifetime-gain",
      "cash-liquidity",
    ]);
    expect(prefs.filter((p) => p.slot === "compact")).toHaveLength(6);
    expect(prefs.map((p) => p.order)).toEqual(prefs.map((_, i) => i));
  });

  it("falls back to defaults on invalid stored JSON", () => {
    expect(parseMetricPreferences("{not json")).toEqual(getDefaultMetricPreferences());
    expect(normalizeMetricPreferences(undefined)).toEqual(getDefaultMetricPreferences());
    expect(normalizeMetricPreferences({ id: "broker-fees" })).toEqual(getDefaultMetricPreferences());
  });

  it("migrates the legacy {key, enabled, size} shape without loss", () => {
    const prefs = normalizeMetricPreferences([
      { key: "brokerFees", enabled: false, size: "large" },
      { key: "dayGainLoss", enabled: true, size: "compact" },
      { key: "totalPortfolioValue", enabled: true, size: "large" },
    ]);

    expect(prefs[0]).toEqual({ id: "broker-fees", added: true, slot: null, order: 0 });
    expect(prefs[1]).toEqual({ id: "day-gain-loss", added: true, slot: "compact", order: 1 });
    expect(prefs[2]).toEqual({ id: "total-portfolio-value", added: true, slot: "large", order: 2 });
    // Built-ins the legacy list did not mention are appended as added but unslotted.
    expect(prefs).toHaveLength(BUILTIN_METRIC_IDS.length);
    expect(prefs.find((p) => p.id === "lifetime-gain")).toEqual({ id: "lifetime-gain", added: true, slot: null, order: 3 });
  });

  it("keeps the array order, drops duplicates and unknown ids, and renumbers order", () => {
    const prefs = normalizeMetricPreferences([
      { id: "taxes-withheld", added: true, slot: "compact", order: 99 },
      { id: "Bad Id!", added: true, slot: "large" },
      { id: "taxes-withheld", added: false, slot: null },
      { id: "third-party-metric", added: true, slot: "large", order: 5 },
      null,
      "broker-fees",
    ]);

    expect(prefs[0]).toEqual({ id: "taxes-withheld", added: true, slot: "compact", order: 0 });
    expect(prefs[1]).toEqual({ id: "third-party-metric", added: true, slot: "large", order: 1 });
    expect(prefs.filter((p) => p.id === "taxes-withheld")).toHaveLength(1);
    expect(prefs.some((p) => p.id === "Bad Id!")).toBe(false);
  });

  it("keeps removed metrics as added:false so they are not re-added", () => {
    const prefs = normalizeMetricPreferences([{ id: "broker-fees", added: false, slot: "large" }]);
    expect(prefs.find((p) => p.id === "broker-fees")).toEqual({ id: "broker-fees", added: false, slot: null, order: 0 });
  });

  it("clamps the dashboard to 4 large and 6 compact slots without dropping entries", () => {
    const input = BUILTIN_METRIC_IDS.map((id) => ({ id, added: true, slot: "large" as const, order: 0 }));
    const prefs = normalizeMetricPreferences(input);
    expect(prefs).toHaveLength(BUILTIN_METRIC_IDS.length);
    expect(countMetricSlots(prefs)).toEqual({ large: METRIC_SLOT_CAPACITY.large, compact: 0 });
    expect(prefs.slice(4).every((p) => p.slot === null && p.added)).toBe(true);

    const compact = normalizeMetricPreferences(BUILTIN_METRIC_IDS.map((id) => ({ id, added: true, slot: "compact" })));
    expect(countMetricSlots(compact)).toEqual({ large: 0, compact: METRIC_SLOT_CAPACITY.compact });
  });

  it("serializes a validated list", () => {
    const json = serializeMetricPreferences([{ id: "broker-fees", added: true, slot: "compact", order: 0 }]);
    const parsed = parseMetricPreferences(json);
    expect(parsed[0]).toEqual({ id: "broker-fees", added: true, slot: "compact", order: 0 });
    expect(parsed).toHaveLength(DEFAULT_METRIC_PREFERENCES.length);
  });

  it("recognizes kebab-case ids only", () => {
    expect(isMetricId("taxes-withheld")).toBe(true);
    expect(isMetricId("sharpe-ratio-2")).toBe(true);
    expect(isMetricId("SharpeRatio")).toBe(false);
    expect(isMetricId("-bad")).toBe(false);
    expect(isMetricId("ab")).toBe(false);
    expect(isMetricId(42)).toBe(false);
  });
});
