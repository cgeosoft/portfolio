/**
 * Lifetime taxes withheld.
 * Compiled from source by the shared harness; see extras/metrics/_test/harness.ts.
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { encodeMetricPayload } from "../../../modules/service/src/services/metrics/payload.ts";
import type { MetricOutput } from "../../../modules/shared/src/metric-output.ts";
import type { FinancialPortfolioData, PortfolioSummary } from "../../../modules/shared/src/portfolio.ts";
import {
  expectOutput,
  LOSING_SUMMARY,
  loadMetric,
  moduleContract,
  runMetric,
  runRaw,
  TYPICAL_SUMMARY,
  type LoadedMetric,
} from "../_test/harness.ts";

type Format = "currency" | "percent" | "number" | "none";
type Sign = "auto" | "always" | "never";
const V = (amount: number | null, format: Format, sign: Sign) => ({ amount, format, sign });
const T = (text: string) => ({ text });

const NONFINITE_SUMMARY = {
  ...TYPICAL_SUMMARY,
  totalFees: NaN,
  totalTaxes: Infinity,
  totalDividends: -Infinity,
  cashBalance: NaN,
  totalPortfolioValue: "12",
} as unknown as PortfolioSummary;

const expected = (value: number): MetricOutput => ({ value: V(value, "currency", "auto"), sub: [T("Lifetime tax deductions")], sentiment: "neutral" });

let metric: LoadedMetric;
beforeAll(async () => {
  metric = await loadMetric("taxes-withheld");
}, 30_000);

describe("taxes-withheld contract", () => {
  it("declares its id, abi and scopes", () => {
    expect(metric.manifest.id).toBe("taxes-withheld");
    expect(metric.manifest.abi).toBe(2);
    expect(metric.manifest.scopes).toEqual(["portfolio.summary"]);
  });

  it("imports only the env sandbox and exports the metric ABI", () => {
    const contract = moduleContract(metric);
    for (const name of contract.imports) expect(["env.memory", "env.abort", "env.seed", "env.trace"]).toContain(name);
    expect(contract.imports).toContain("env.memory");
    expect(contract.exports).toEqual(expect.arrayContaining(["metric_abi_version", "metric_alloc", "metric_run"]));
    expect(contract.exports).not.toContain("memory");
    expect(contract.abi).toBe(2);
  });

  it("refuses an ABI 1 payload", () => {
    const data = { summary: TYPICAL_SUMMARY, holdings: [], chartHistory: [], individualCharts: {} } as FinancialPortfolioData;
    expect(() => runRaw(metric, encodeMetricPayload(data, ["portfolio.summary"], { abi: 1 }))).toThrow(/^abort: payload abi mismatch$/);
  });

  it("starts from fresh memory on every run", () => {
    const first = runMetric(metric, { summary: TYPICAL_SUMMARY });
    expect(runMetric(metric, { summary: TYPICAL_SUMMARY })).toEqual(first);
    expect(runMetric(metric, { summary: TYPICAL_SUMMARY })).toEqual(first);
  });
});

describe("taxes-withheld output", () => {
  it("reads a typical summary", () => {
    expectOutput(runMetric(metric, { summary: TYPICAL_SUMMARY }), expected(33.1));
  });

  it("reads a losing summary", () => {
    expectOutput(runMetric(metric, { summary: LOSING_SUMMARY }), expected(0));
  });

  it("reads zeros when the data has no summary", () => {
    expectOutput(runMetric(metric), expected(0));
  });

  it("reads zeros when the summary scope is missing", () => {
    expectOutput(runMetric(metric, { summary: TYPICAL_SUMMARY, scopes: ["portfolio.holdings"] }), expected(0));
  });

  it("treats non-finite fields as 0 (totalTaxes Infinity becomes 0)", () => {
    expectOutput(runMetric(metric, { summary: NONFINITE_SUMMARY }), expected(0));
  });
});
