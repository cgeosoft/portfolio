/**
 * Value-weighted harmonic mean P/E over the holdings with a positive P/E.
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

const FALLBACK: MetricOutput = { value: V(0, "number", "auto"), sub: [T("No P/E data for your holdings")], sentiment: "neutral" };
const expected = (pe: number, earningsYield: number | null, coverage: number): MetricOutput => ({
  value: V(pe, "number", "auto"),
  sub: [T("Earnings yield "), V(earningsYield, "percent", "never"), T(", "), V(coverage, "number", "auto"), T("% covered")],
  sentiment: "neutral",
});

let metric: LoadedMetric;
beforeAll(async () => {
  metric = await loadMetric("portfolio-pe");
}, 30_000);

describe("portfolio-pe contract", () => {
  it("declares its id, abi and scopes", () => {
    expect(metric.manifest.id).toBe("portfolio-pe");
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
    const first = run(STANDARD_HOLDINGS, [fundamental("AAA", { peRatio: 20 }), fundamental("BBB", { peRatio: 10 })]);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { peRatio: 20 }), fundamental("BBB", { peRatio: 10 })])).toEqual(first);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { peRatio: 20 }), fundamental("BBB", { peRatio: 10 })])).toEqual(first);
  });
});

describe("portfolio-pe output", () => {
  it("takes the harmonic mean weighted by value", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { peRatio: 20 }), fundamental("BBB", { peRatio: 10 })]);
    expectOutput(out, expected(15, 6.666666666666667, 90));
  });

  it("skips negative and zero P/E", () => {
    const out = run(STANDARD_HOLDINGS, [
      fundamental("AAA", { peRatio: -5 }),
      fundamental("BBB", { peRatio: 0 }),
      fundamental("CCC", { peRatio: 25 }),
    ]);
    expectOutput(out, expected(25, 4, 10));
  });

  it("falls back when every P/E is negative", () => {
    expectOutput(run(STANDARD_HOLDINGS, [fundamental("AAA", { peRatio: -1 })]), FALLBACK);
  });

  it("falls back on an empty portfolio", () => {
    expectOutput(run([], []), FALLBACK);
  });

  it("writes non-finite results as null when earnings overflow", () => {
    const out = run([holding("AAA", 1000)], [fundamental("AAA", { peRatio: 1e-310 })]);
    expectOutput(out, expected(0, null, 100));
  });

  it("falls back when the fundamentals scope is missing", () => {
    const rows = [fundamental("AAA", { peRatio: 20 })];
    expectOutput(run(STANDARD_HOLDINGS, rows, ["portfolio.holdings"]), FALLBACK);
  });
});
