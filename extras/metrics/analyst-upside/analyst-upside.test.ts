/**
 * Value-weighted upside to the analyst consensus targets.
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

const FALLBACK: MetricOutput = { value: V(0, "percent", "auto"), sub: [T("No analyst targets for your holdings")], sentiment: "neutral" };
const expected = (value: number, names: number): MetricOutput => ({
  value: V(value, "percent", "always"),
  sub: [T("To consensus targets, "), V(names, "number", "auto"), T(names === 1 ? " stock" : " stocks")],
  sentiment: "auto",
});

let metric: LoadedMetric;
beforeAll(async () => {
  metric = await loadMetric("analyst-upside");
}, 30_000);

describe("analyst-upside contract", () => {
  it("declares its id, abi and scopes", () => {
    expect(metric.manifest.id).toBe("analyst-upside");
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
    const first = run(STANDARD_HOLDINGS, [fundamental("AAA", { targetUpside: 0.1 }), fundamental("BBB", { targetUpside: -0.05 })]);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { targetUpside: 0.1 }), fundamental("BBB", { targetUpside: -0.05 })])).toEqual(first);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { targetUpside: 0.1 }), fundamental("BBB", { targetUpside: -0.05 })])).toEqual(first);
  });
});

describe("analyst-upside output", () => {
  it("weights the upside by value", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { targetUpside: 0.1 }), fundamental("BBB", { targetUpside: -0.05 })]);
    expectOutput(out, expected(5, 2));
  });

  it("uses the singular for one name", () => {
    expectOutput(run(STANDARD_HOLDINGS, [fundamental("AAA", { targetUpside: 0.2 })]), expected(20, 1));
  });

  it("falls back when no row has a target", () => {
    expectOutput(run(STANDARD_HOLDINGS, [fundamental("AAA", {}), fundamental("BBB", { beta: 1 })]), FALLBACK);
  });

  it("reports a negative upside", () => {
    expectOutput(run([holding("AAA", 1000)], [fundamental("AAA", { targetUpside: -0.3 })]), expected(-30, 1));
  });

  it("uses fund rows", () => {
    expectOutput(run([holding("ETF1", 1000, "ETF")], [fundamental("ETF1", { targetUpside: 0.1 }, true)]), expected(10, 1));
  });

  it("falls back on an empty portfolio", () => {
    expectOutput(run([], []), FALLBACK);
  });

  it("counts holdings, not symbols", () => {
    expectOutput(run([holding("AAA", 1000), holding("AAA", 1000)], [fundamental("AAA", { targetUpside: 0.1 })]), expected(10, 2));
  });
});
