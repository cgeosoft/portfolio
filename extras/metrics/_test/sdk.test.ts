/**
 * The metric SDK in extras/metrics/_sdk: record accessors for every scope,
 * JSON escaping and non-finite numbers in Result, and the guest-side errors a
 * module raises for a bad payload or a misused Result.
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { encodeMetricPayload } from "../../../modules/service/src/services/metrics/payload.ts";
import type { MetricOutput } from "../../../modules/shared/src/metric-output.ts";
import type { FinancialPortfolioData, PortfolioTransaction } from "../../../modules/shared/src/portfolio.ts";
import {
  compileSource,
  emptySummary,
  expectOutput,
  fundamental,
  holding,
  runMetric,
  runRaw,
  SDK_IMPORT,
  type LoadedMetric,
  type MetricInput,
} from "./harness.ts";

type Format = "currency" | "percent" | "number" | "none";
type Sign = "auto" | "always" | "never";
const V = (amount: number | null, format: Format, sign: Sign) => ({ amount, format, sign });
const T = (text: string) => ({ text });

const EXPORTS = `export { metric_abi_version, metric_alloc } from "${SDK_IMPORT}";`;

const ACCESSORS = `import { Transactions, History, Holdings, Fundamentals, Result, Format, Sign } from "${SDK_IMPORT}";
${EXPORTS}
export function metric_run(ptr: i32, len: i32): i32 {
  const t = new Transactions(ptr, len); const y = new History(ptr, len); const f = new Fundamentals(ptr, len); const h = new Holdings(ptr, len);
  const r = new Result().value(NaN, Format.None, Sign.Never).amount(Infinity, Format.Number).amount(-Infinity, Format.Number);
  r.text("q\\"b\\\\c\\nd\\te\\u0001f€");
  for (let i = 0; i < t.count; i++) { const x = t.at(i); r.text(x.symbol + "|" + x.type + "|" + x.kind.toString()).amount(x.timestamp, Format.None).amount(x.fee, Format.None); }
  if (y.count > 0) r.amount(y.at(0).cashBalance, Format.None);
  const miss = f.find("NOPE"); r.text(miss ? "found" : "miss");
  const hit = f.find("AAA"); if (hit) { r.text(hit.isFund ? "fund" : "co").amount(hit.peRatio, Format.None).amount(hit.beta, Format.None); }
  if (h.count > 0) r.amount(<f64>h.at(0).assetType, Format.None).amount(h.at(0).rsi, Format.None);
  return r.neutral().finish();
}
`;

const NO_VALUE = `import { Result } from "${SDK_IMPORT}";
${EXPORTS}
export function metric_run(ptr: i32, len: i32): i32 {
  return new Result().text("x").finish();
}
`;

const OUT_OF_RANGE = `import { Holdings, Result, Format } from "${SDK_IMPORT}";
${EXPORTS}
export function metric_run(ptr: i32, len: i32): i32 {
  const h = new Holdings(ptr, len);
  return new Result().value(h.at(h.count).shares, Format.Number).finish();
}
`;

const SUMMARY_FEES = `import { Summary, Result, Format } from "${SDK_IMPORT}";
${EXPORTS}
export function metric_run(ptr: i32, len: i32): i32 {
  return new Result().value(new Summary(ptr, len).totalFees, Format.Number).finish();
}
`;

const ACCESSOR_INPUT: MetricInput = {
  holdings: [holding("AAA", 1, "ETF")],
  history: [{ date: "x", timestamp: 0, totalValue: 0, totalCost: 0, totalGainLoss: 0, cashBalance: 42.5 }],
  transactions: [
    { id: "1", date: "2026-01-02", type: "interest_payment", symbol: "", fee: 0.25 },
    { id: "2", date: "bad", type: "SWAP", symbol: "ÄÖ", fee: null },
  ] as PortfolioTransaction[],
  fundamentals: [fundamental("AAA", { beta: 0.9 }, true)],
  scopes: ["portfolio.holdings", "portfolio.transactions", "portfolio.history", "market.fundamentals"],
  abi: 2,
};

const ESCAPED = "q\"b\\c\nd\te\u0001f€";

let accessors: LoadedMetric;
let noValue: LoadedMetric;
let outOfRange: LoadedMetric;
let summaryFees: LoadedMetric;

beforeAll(async () => {
  [accessors, noValue, outOfRange, summaryFees] = await Promise.all([
    compileSource("accessors", ACCESSORS),
    compileSource("noValue", NO_VALUE),
    compileSource("outOfRange", OUT_OF_RANGE),
    compileSource("summaryFees", SUMMARY_FEES),
  ]);
}, 60_000);

const summaryPayload = (totalFees = 0) =>
  encodeMetricPayload(
    { summary: emptySummary({ totalFees }), holdings: [], chartHistory: [], individualCharts: {} } as FinancialPortfolioData,
    ["portfolio.summary"],
  );

describe("SDK accessors", () => {
  it("reads every scope and writes escaped, non-finite values", () => {
    const expected: MetricOutput = {
      value: V(null, "none", "never"),
      sub: [
        V(null, "number", "auto"),
        V(null, "number", "auto"),
        T(ESCAPED),
        T("|interest_payment|4"),
        V(1767312000000, "none", "auto"),
        V(0.25, "none", "auto"),
        T("ÄÖ|SWAP|0"),
        V(0, "none", "auto"),
        V(0, "none", "auto"),
        V(42.5, "none", "auto"),
        T("miss"),
        T("fund"),
        V(null, "none", "auto"),
        V(0.9, "none", "auto"),
        V(2, "none", "auto"),
        V(0, "none", "auto"),
      ],
      sentiment: "neutral",
    };
    const out = runMetric(accessors, ACCESSOR_INPUT);
    expectOutput(out, expected);
    expect((out.sub?.[2] as { text: string }).text).toBe(ESCAPED);
  });

  it("escapes control characters and quotes in the raw JSON", () => {
    const { holdings, transactions, history, fundamentals, scopes } = ACCESSOR_INPUT;
    const data = {
      summary: undefined,
      holdings,
      transactions,
      chartHistory: history,
      individualCharts: {},
    } as unknown as FinancialPortfolioData;
    const raw = runRaw(accessors, encodeMetricPayload(data, scopes!, { abi: 2, fundamentals }));
    expect(raw).toContain("\\u0001");
    expect(raw).toContain('\\"');
  });
});

describe("SDK errors", () => {
  it("aborts when Result.value() was not called", () => {
    expect(() => runRaw(noValue, summaryPayload())).toThrow(/^abort: Result\.value\(\) was not called$/);
  });

  it("aborts on a record index out of range", () => {
    const payload = encodeMetricPayload(
      { summary: undefined, holdings: [holding("AAA", 1)], chartHistory: [], individualCharts: {} } as unknown as FinancialPortfolioData,
      ["portfolio.holdings"],
    );
    expect(() => runRaw(outOfRange, payload)).toThrow(/^abort: record index out of range$/);
  });

  it("aborts on a payload smaller than the header", () => {
    expect(() => runRaw(summaryFees, new Uint8Array(39))).toThrow(/^abort: payload too small$/);
  });

  it("aborts on a wrong magic", () => {
    const payload = summaryPayload();
    payload[0] = 0;
    expect(() => runRaw(summaryFees, payload)).toThrow(/^abort: payload magic mismatch$/);
  });

  it("writes only the value when no sub or sentiment is set", () => {
    const out = runMetric(summaryFees, { summary: emptySummary({ totalFees: 3 }), scopes: ["portfolio.summary"] });
    expectOutput(out, { value: V(3, "number", "auto") });
  });
});
