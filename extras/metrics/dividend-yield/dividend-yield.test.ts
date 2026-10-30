/**
 * Value-weighted dividend yield over stock holdings with fundamentals.
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

const FALLBACK: MetricOutput = { value: V(0, "percent", "never"), sub: [T("No dividend data for your holdings")], sentiment: "neutral" };
const expected = (value: number, income: number, coverage: number): MetricOutput => ({
  value: V(value, "percent", "never"),
  sub: [T("About "), V(income, "currency", "auto"), T(" a year, "), V(coverage, "number", "auto"), T("% covered")],
  sentiment: "neutral",
});

let metric: LoadedMetric;
beforeAll(async () => {
  metric = await loadMetric("dividend-yield");
}, 30_000);

describe("dividend-yield contract", () => {
  it("declares its id, abi and scopes", () => {
    expect(metric.manifest.id).toBe("dividend-yield");
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
    const first = run(STANDARD_HOLDINGS, [fundamental("AAA", { dividendYield: 0.02 }), fundamental("BBB", { dividendYield: 0.04 })]);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { dividendYield: 0.02 }), fundamental("BBB", { dividendYield: 0.04 })])).toEqual(first);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { dividendYield: 0.02 }), fundamental("BBB", { dividendYield: 0.04 })])).toEqual(first);
  });
});

describe("dividend-yield output", () => {
  it("weights the yield by value", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { dividendYield: 0.02 }), fundamental("BBB", { dividendYield: 0.04 })]);
    expectOutput(out, expected(2.666666666666667, 240, 90));
  });

  it("counts stock rows as covered whatever their yield", () => {
    // Current behaviour: an unknown (NaN) yield counts as covered at 0%. See spec suspected issue 4.
    const out = run(STANDARD_HOLDINGS, [
      fundamental("AAA", {}),
      fundamental("BBB", { dividendYield: 0 }),
      fundamental("CCC", { dividendYield: -0.01 }),
    ]);
    expectOutput(out, expected(0, 0, 100));
  });

  it("skips fund rows", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { dividendYield: 0.05 }, true), fundamental("BBB", { dividendYield: 0.03 })]);
    expectOutput(out, expected(3, 90, 30));
  });

  it("falls back with only a fund row", () => {
    expectOutput(run(STANDARD_HOLDINGS, [fundamental("AAA", { dividendYield: 0.05 }, true)]), FALLBACK);
  });

  it("falls back on an empty portfolio", () => {
    expectOutput(run([], []), FALLBACK);
  });

  it("skips cash holdings", () => {
    const out = run(
      [holding("CASH", 1000, "Cash"), holding("AAA", 1000)],
      [fundamental("CASH", { dividendYield: 0.5 }), fundamental("AAA", { dividendYield: 0.01 })],
    );
    expectOutput(out, expected(1, 10, 100));
  });
});
