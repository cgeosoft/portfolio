/**
 * Share of the covered value in holdings with an Altman Z below 1.8.
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

const FALLBACK: MetricOutput = { value: V(0, "percent", "never"), sub: [T("No scores for your holdings")], sentiment: "neutral" };
const expected = (value: number, names: number): MetricOutput => ({
  value: V(value, "percent", "never"),
  sub: [V(names, "number", "auto"), T(names === 1 ? " stock below Altman Z 1.8" : " stocks below Altman Z 1.8")],
  sentiment: names > 0 ? "negative" : "positive",
});

let metric: LoadedMetric;
beforeAll(async () => {
  metric = await loadMetric("distress-exposure");
}, 30_000);

describe("distress-exposure contract", () => {
  it("declares its id, abi and scopes", () => {
    expect(metric.manifest.id).toBe("distress-exposure");
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
    const first = run(STANDARD_HOLDINGS, [fundamental("AAA", { altmanZ: 3.5 }), fundamental("BBB", { altmanZ: 1.2 })]);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { altmanZ: 3.5 }), fundamental("BBB", { altmanZ: 1.2 })])).toEqual(first);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { altmanZ: 3.5 }), fundamental("BBB", { altmanZ: 1.2 })])).toEqual(first);
  });
});

describe("distress-exposure output", () => {
  it("reports one distressed name", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { altmanZ: 3.5 }), fundamental("BBB", { altmanZ: 1.2 })]);
    expectOutput(out, expected(33.33333333333333, 1));
  });

  it("reports several distressed names", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { altmanZ: 1.0 }), fundamental("BBB", { altmanZ: -2 })]);
    expectOutput(out, expected(100, 2));
  });

  it("is positive without distressed names", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { altmanZ: 3 }), fundamental("BBB", { altmanZ: 2 })]);
    expectOutput(out, expected(0, 0));
  });

  it("does not count a Z of exactly 1.8", () => {
    expectOutput(run([holding("AAA", 1000)], [fundamental("AAA", { altmanZ: 1.8 })]), expected(0, 0));
  });

  it("falls back on an empty portfolio", () => {
    expectOutput(run([], []), FALLBACK);
  });

  it("falls back when the fundamentals scope is missing", () => {
    const rows = [fundamental("AAA", { altmanZ: 1.2 })];
    expectOutput(run(STANDARD_HOLDINGS, rows, ["portfolio.holdings"]), FALLBACK);
  });
});
