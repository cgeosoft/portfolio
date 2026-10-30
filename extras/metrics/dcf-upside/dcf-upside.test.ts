/**
 * Value-weighted upside to the DCF value, capped at 300% per holding.
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

const FALLBACK: MetricOutput = { value: V(0, "percent", "auto"), sub: [T("No DCF values for your holdings")], sentiment: "neutral" };
const expected = (value: number, coverage: number): MetricOutput => ({
  value: V(value, "percent", "always"),
  sub: [T("Versus DCF value, "), V(coverage, "number", "auto"), T("% covered")],
  sentiment: "auto",
});

let metric: LoadedMetric;
beforeAll(async () => {
  metric = await loadMetric("dcf-upside");
}, 30_000);

describe("dcf-upside contract", () => {
  it("declares its id, abi and scopes", () => {
    expect(metric.manifest.id).toBe("dcf-upside");
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
    const first = run(STANDARD_HOLDINGS, [fundamental("AAA", { dcfUpside: 0.5 }), fundamental("BBB", { dcfUpside: 5 })]);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { dcfUpside: 0.5 }), fundamental("BBB", { dcfUpside: 5 })])).toEqual(first);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { dcfUpside: 0.5 }), fundamental("BBB", { dcfUpside: 5 })])).toEqual(first);
  });
});

describe("dcf-upside output", () => {
  it("caps each upside at 3", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { dcfUpside: 0.5 }), fundamental("BBB", { dcfUpside: 5 })]);
    expectOutput(out, expected(133.33333333333331, 90));
  });

  it("reports a negative upside", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { dcfUpside: -0.2 }), fundamental("BBB", { dcfUpside: -0.4 })]);
    expectOutput(out, expected(-26.666666666666668, 90));
  });

  it("does not floor an upside below -100%", () => {
    // Current behaviour; a floor of -1 would make this -100. See spec suspected issue 3.
    expectOutput(run([holding("AAA", 1000)], [fundamental("AAA", { dcfUpside: -2.5 })]), expected(-250, 100));
  });

  it("falls back without rows", () => {
    expectOutput(run(STANDARD_HOLDINGS, []), FALLBACK);
  });

  it("applies the cap at the boundary", () => {
    const out = run([holding("AAA", 1000), holding("BBB", 1000)], [fundamental("AAA", { dcfUpside: 3 }), fundamental("BBB", { dcfUpside: 3.5 })]);
    expectOutput(out, expected(300, 100));
  });

  it("rounds the coverage", () => {
    expectOutput(run([holding("AAA", 1000), holding("BBB", 2000)], [fundamental("AAA", { dcfUpside: 0.1 })]), expected(10, 33));
  });
});
