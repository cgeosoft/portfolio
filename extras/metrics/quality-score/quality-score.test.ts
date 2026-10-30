/**
 * Value-weighted Piotroski score with the share held in strong names.
 * Compiled from source by the shared harness; see extras/metrics/_test/harness.ts.
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { encodeMetricPayload } from "../../../modules/service/src/services/metrics/payload.ts";
import type { MetricOutput } from "../../../modules/shared/src/metric-output.ts";
import type { MetricScope } from "../../../modules/shared/src/metric-abi.ts";
import type { FinancialPortfolioData, PortfolioHolding } from "../../../modules/shared/src/portfolio.ts";
import {
  expectOutput,
  fundamental,
  holding,
  loadMetric,
  moduleContract,
  runMetric,
  runRaw,
  STANDARD_HOLDINGS,
  TYPICAL_SUMMARY,
  type LoadedMetric,
} from "../_test/harness.ts";

type Format = "currency" | "percent" | "number" | "none";
type Sign = "auto" | "always" | "never";
const V = (amount: number | null, format: Format, sign: Sign) => ({ amount, format, sign });
const T = (text: string) => ({ text });

type Row = ReturnType<typeof fundamental>;
const run = (holdings: PortfolioHolding[], fundamentals: Row[], scopes?: MetricScope[]) =>
  runMetric(metric, { holdings, fundamentals, scopes });

const FALLBACK: MetricOutput = { value: V(0, "number", "auto"), sub: [T("No scores for your holdings")], sentiment: "neutral" };
const expected = (score: number, strong: number, sentiment: "positive" | "negative" | "neutral"): MetricOutput => ({
  value: V(score, "number", "auto"),
  sub: [T("of 9, "), V(strong, "percent", "never"), T(" in strong names")],
  sentiment,
});
const one = (piotroski: number) => run([holding("AAA", 1000)], [fundamental("AAA", { piotroski })]);

let metric: LoadedMetric;
beforeAll(async () => {
  metric = await loadMetric("quality-score");
}, 30_000);

describe("quality-score contract", () => {
  it("declares its id, abi and scopes", () => {
    expect(metric.manifest.id).toBe("quality-score");
    expect(metric.manifest.abi).toBe(2);
    expect(metric.manifest.scopes).toEqual(["portfolio.holdings", "market.fundamentals"]);
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
    const first = run(STANDARD_HOLDINGS, [fundamental("AAA", { piotroski: 8 }), fundamental("BBB", { piotroski: 4 })]);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { piotroski: 8 }), fundamental("BBB", { piotroski: 4 })])).toEqual(first);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { piotroski: 8 }), fundamental("BBB", { piotroski: 4 })])).toEqual(first);
  });
});

describe("quality-score output", () => {
  it("is neutral between 4 and 7", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { piotroski: 8 }), fundamental("BBB", { piotroski: 4 })]);
    expectOutput(out, expected(6.666666666666667, 66.66666666666666, "neutral"));
  });

  it("is positive at 7 or more", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { piotroski: 9 }), fundamental("BBB", { piotroski: 7 })]);
    expectOutput(out, expected(8.333333333333334, 100, "positive"));
  });

  it("is negative below 4", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { piotroski: 3 }), fundamental("BBB", { piotroski: 2 })]);
    expectOutput(out, expected(2.6666666666666665, 0, "negative"));
  });

  it("applies the boundaries", () => {
    expectOutput(one(7), expected(7, 100, "positive"));
    expectOutput(one(4), expected(4, 0, "neutral"));
    expectOutput(one(3.99), expected(3.99, 0, "negative"));
  });

  it("falls back on an empty portfolio", () => {
    expectOutput(run([], []), FALLBACK);
  });
});
