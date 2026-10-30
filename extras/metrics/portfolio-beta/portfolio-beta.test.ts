/**
 * Value-weighted portfolio beta over the holdings with fundamentals.
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

const FALLBACK: MetricOutput = { value: V(0, "number", "auto"), sub: [T("No beta data for your holdings")], sentiment: "neutral" };
const expected = (beta: number, text: string, coverage: number): MetricOutput => ({
  value: V(beta, "number", "auto"),
  sub: [T(text), V(coverage, "number", "auto"), T("% covered")],
  sentiment: "neutral",
});
const MORE = "More volatile than the market, ";
const CALMER = "Calmer than the market, ";

let metric: LoadedMetric;
beforeAll(async () => {
  metric = await loadMetric("portfolio-beta");
}, 30_000);

describe("portfolio-beta contract", () => {
  it("declares its id, abi and scopes", () => {
    expect(metric.manifest.id).toBe("portfolio-beta");
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
    const first = run(STANDARD_HOLDINGS, [fundamental("AAA", { beta: 1.2 }), fundamental("BBB", { beta: 0.8 })]);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { beta: 1.2 }), fundamental("BBB", { beta: 0.8 })])).toEqual(first);
    expect(run(STANDARD_HOLDINGS, [fundamental("AAA", { beta: 1.2 }), fundamental("BBB", { beta: 0.8 })])).toEqual(first);
  });
});

describe("portfolio-beta output", () => {
  it("weights beta by value over covered holdings", () => {
    const out = run(STANDARD_HOLDINGS, [fundamental("AAA", { beta: 1.2 }), fundamental("BBB", { beta: 0.8 })]);
    expectOutput(out, expected(1.0666666666666667, MORE, 90));
  });

  it("skips cash and rows without beta", () => {
    const out = run(
      [...STANDARD_HOLDINGS, holding("CASH", 500, "Cash")],
      [fundamental("AAA", { beta: 0.5 }), fundamental("BBB", {}), fundamental("CCC", { beta: 0.9 }), fundamental("CASH", { beta: 3 })],
    );
    expectOutput(out, expected(0.5571428571428572, CALMER, 70));
  });

  it("falls back on an empty portfolio", () => {
    expectOutput(run([], []), FALLBACK);
  });

  it("falls back when a scope is missing", () => {
    const rows = [fundamental("AAA", { beta: 1.2 })];
    expectOutput(run(STANDARD_HOLDINGS, rows, ["portfolio.holdings"]), FALLBACK);
    expectOutput(run(STANDARD_HOLDINGS, rows, ["market.fundamentals"]), FALLBACK);
  });

  it("calls a beta of exactly 1 more volatile", () => {
    expectOutput(run([holding("AAA", 1000)], [fundamental("AAA", { beta: 1 })]), expected(1, MORE, 100));
  });

  it("calls a negative beta calmer", () => {
    expectOutput(run([holding("AAA", 1000)], [fundamental("AAA", { beta: -0.5 })]), expected(-0.5, CALMER, 100));
  });

  it("skips zero and negative values", () => {
    const out = run(
      [holding("AAA", 0), holding("BBB", -100), holding("CCC", 1000)],
      [fundamental("AAA", { beta: 5 }), fundamental("BBB", { beta: 5 }), fundamental("CCC", { beta: 2 })],
    );
    expectOutput(out, expected(2, MORE, 100));
  });

  it("uses fund rows", () => {
    const out = run(
      [holding("ETF1", 2000, "ETF"), holding("AAA", 2000)],
      [fundamental("ETF1", { beta: 1.1 }, true), fundamental("AAA", { beta: 0.9 })],
    );
    expectOutput(out, expected(1, MORE, 100));
  });

  it("matches symbols case-sensitively", () => {
    expectOutput(run([holding("aaa", 1000), holding("AAA", 1000)], [fundamental("AAA", { beta: 2 })]), expected(2, MORE, 50));
  });

  it("matches unicode symbols exactly and counts every lot", () => {
    const out = run(
      [holding("ÄBC", 1000), holding("ÄBC", 3000), holding("ÄB", 1000)],
      [fundamental("ÄBC", { beta: 1.5 }), fundamental("ÄBCD", { beta: 9 })],
    );
    expectOutput(out, expected(1.5, MORE, 80));
  });

  it("treats an infinite beta as unknown", () => {
    expectOutput(run([holding("AAA", 1000)], [fundamental("AAA", { beta: Infinity })]), FALLBACK);
  });
});
