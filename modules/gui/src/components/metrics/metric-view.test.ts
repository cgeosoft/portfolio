import { describe, expect, it } from "bun:test";
import { Gauge, Receipt } from "lucide-react";
import type { MetricEvaluation } from "portfolio-shared/api-types";
import { getMetricIcon } from "../portfolio/metrics-catalog";
import { displayMetric } from "./metric-view";

const result: MetricEvaluation = {
  id: "acme-metric",
  status: "ok",
  output: {
    value: { amount: 1.25, format: "number" },
    sub: [{ text: "Beta of 12 holdings, " }, { amount: 3.5, format: "percent" }, { text: " " }, { amount: 1000, format: "currency" }],
  },
  elapsedMs: 1,
  cached: false,
};

const failure: MetricEvaluation = { id: "acme-metric", status: "error", error: "abort: AAPL 120 shares" };

const shown = { currency: "EUR", hideValues: false };
const hidden = { currency: "EUR", hideValues: true };
const verified = { verified: true };
const unverified = { verified: false };

describe("displayMetric", () => {
  it("shows every figure while values are visible", () => {
    expect(displayMetric(result, shown, unverified)).toMatchObject({ kind: "ok", value: "1.25", sub: "Beta of 12 holdings, +3.50% €1,000.00" });
  });

  it("masks only currency for a verified module while values are hidden", () => {
    expect(displayMetric(result, hidden, verified)).toMatchObject({ kind: "ok", value: "1.25", sub: "Beta of 12 holdings, +3.50% €••••" });
  });

  it("hides every figure of an unverified module while values are hidden", () => {
    expect(displayMetric(result, hidden, unverified)).toMatchObject({ kind: "ok", value: "••••", sub: "Beta of •• holdings, ••••% €••••" });
    expect(displayMetric(failure, hidden, unverified)).toMatchObject({ kind: "failed", error: "abort: AAPL ••• shares" });
    expect(displayMetric(failure, shown, unverified)).toMatchObject({ kind: "failed", error: "abort: AAPL 120 shares" });
  });

  it("treats a metric without a listing as unverified", () => {
    expect(displayMetric(result, hidden, undefined)).toMatchObject({ value: "••••" });
  });
});

describe("getMetricIcon", () => {
  it("maps known names and falls back to a gauge", () => {
    expect(getMetricIcon("receipt")).toBe(Receipt);
    expect(getMetricIcon("no-such-icon")).toBe(Gauge);
  });

  it("never returns a property of Object.prototype", () => {
    expect(getMetricIcon("constructor")).toBe(Gauge);
    expect(getMetricIcon("__proto__")).toBe(Gauge);
  });
});
