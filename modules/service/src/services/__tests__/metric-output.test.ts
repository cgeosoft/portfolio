/**
 * Edge cases of metric output: the parser that checks untrusted module JSON
 * and the renderer that turns it into display strings and a colour class.
 */

import { describe, expect, it } from "bun:test";
import {
  HIDDEN_FIGURE,
  MAX_METRIC_OUTPUT_BYTES,
  hideDigits,
  parseMetricOutput,
  renderMetricOutput,
  type MetricFormatters,
  type MetricOutput,
} from "portfolio-shared/metric-output";

function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "";
}

const parseError = (json: unknown) => errorOf(() => parseMetricOutput(typeof json === "string" ? json : JSON.stringify(json)));
const VALUE = { amount: 1, format: "number" };

describe("parseMetricOutput", () => {
  it("keeps only the keys the output defines", () => {
    expect(parseMetricOutput('{"value":{"amount":1,"format":"number"}}')).toStrictEqual({ value: { amount: 1, format: "number" } });
  });

  it("accepts a null amount and drops unknown top-level keys", () => {
    expect(parseMetricOutput(JSON.stringify({ value: { amount: null, format: "none" }, extra: 1 }))).toStrictEqual({
      value: { amount: null, format: "none" },
    });
  });

  it("rejects an amount that is not a finite number or null", () => {
    expect(parseError({ value: { amount: "1", format: "number" } })).toBe("value.amount must be a finite number or null");
    expect(parseError({ value: { format: "number" } })).toBe("value.amount must be a finite number or null");
  });

  it("rejects an unknown format or sign", () => {
    expect(parseError({ value: { amount: 1, format: "money" } })).toBe("value.format must be one of currency, percent, number, none");
    expect(parseError({ value: { ...VALUE, sign: "plus" } })).toBe("value.sign must be one of auto, always, never");
  });

  it("requires a value object", () => {
    expect(parseError({})).toBe("value must be an object");
    expect(parseError({ value: 5 })).toBe("value must be an object");
  });

  it("requires a JSON object", () => {
    for (const json of ["[]", "null", "42"]) expect(parseError(json)).toBe("Result must be a JSON object");
    expect(parseError("not json")).toBe("Result is not valid JSON");
  });

  it("caps the result size", () => {
    expect(MAX_METRIC_OUTPUT_BYTES).toBe(4096);
    const padded = (total: number) => {
      const head = '{"value":{"amount":1,"format":"none"},"pad":"';
      return head + "x".repeat(total - head.length - 2) + '"}';
    };
    expect(padded(4096)).toHaveLength(4096);
    expect(parseMetricOutput(padded(4096)).value.amount).toBe(1);
    expect(parseError(padded(4097))).toBe("Result exceeds 4096 bytes");
  });

  it("checks the sub list", () => {
    expect(parseError({ value: VALUE, sub: {} })).toBe("sub must be an array");
    const parts = (n: number) => Array.from({ length: n }, () => ({ text: "a" }));
    expect(parseError({ value: VALUE, sub: parts(17) })).toBe("sub may hold at most 16 parts");
    expect(parseMetricOutput(JSON.stringify({ value: VALUE, sub: parts(16) })).sub).toHaveLength(16);
  });

  it("checks and trims text parts", () => {
    expect(parseError({ value: VALUE, sub: [{ text: 5 }] })).toBe("sub[0].text must be a string");
    const long = parseMetricOutput(JSON.stringify({ value: VALUE, sub: [{ text: "x".repeat(250) }] }));
    expect((long.sub![0] as { text: string }).text).toBe("x".repeat(200));
    const mixed = parseMetricOutput(JSON.stringify({ value: VALUE, sub: [{ text: "a", amount: 1 }] }));
    expect(mixed.sub![0]).toStrictEqual({ text: "a" } as never);
  });

  it("checks amount parts and names the failing index", () => {
    expect(parseError({ value: VALUE, sub: [null] })).toBe("sub[0] must be an object");
    expect(parseError({ value: VALUE, sub: [{ amount: 1 }] })).toBe("sub[0].format must be one of currency, percent, number, none");
    expect(parseError({ value: VALUE, sub: [{ text: "ok" }, { amount: 1 }] })).toBe(
      "sub[1].format must be one of currency, percent, number, none",
    );
  });

  it("checks the sentiment", () => {
    for (const sentiment of ["green", null]) {
      expect(parseError({ value: VALUE, sentiment })).toBe("sentiment must be one of auto, positive, negative, neutral");
    }
  });
});

describe("renderMetricOutput", () => {
  const fmt: MetricFormatters = {
    currency: (a) => (a === undefined ? "$-" : `$${a.toFixed(2)}`),
    percent: (v) => `${(v ?? 0) > 0 ? "+" : ""}${(v ?? 0).toFixed(2)}%`,
  };
  const out = (value: Partial<MetricOutput["value"]>, rest: Partial<MetricOutput> = {}): MetricOutput =>
    ({ value: { amount: 0, format: "none", ...value }, ...rest }) as MetricOutput;
  const render = (value: Partial<MetricOutput["value"]>, rest: Partial<MetricOutput> = {}, f: MetricFormatters = fmt) =>
    renderMetricOutput(out(value, rest), f);

  it("renders currency with each sign mode", () => {
    expect(render({ amount: 5, format: "currency", sign: "always" }).value).toBe("+$5.00");
    expect(render({ amount: -5, format: "currency", sign: "always" }).value).toBe("$-5.00");
    expect(render({ amount: 0, format: "currency", sign: "always" }).value).toBe("+$0.00");
    expect(render({ amount: null, format: "currency", sign: "always" }).value).toBe("+$-");
    expect(render({ amount: 5, format: "currency", sign: "auto" }).value).toBe("$5.00");
  });

  it("renders percent without a double plus", () => {
    expect(render({ amount: 3, format: "percent", sign: "never" }).value).toBe("3.00%");
    expect(render({ amount: 3, format: "percent", sign: "auto" }).value).toBe("+3.00%");
    expect(render({ amount: 3, format: "percent", sign: "always" }).value).toBe("+3.00%");
    expect(render({ amount: -3, format: "percent" }).value).toBe("-3.00%");
    expect(render({ amount: 3, format: "percent" }, {}, { ...fmt, hideFigures: true }).value).toBe("••••%");
  });

  it("renders number with and without a formatter", () => {
    expect(render({ amount: 1.5, format: "number" }).value).toBe("1.5");
    expect(render({ amount: null, format: "number" }).value).toBe("0");
    expect(render({ amount: 2, format: "number", sign: "always" }).value).toBe("+2");
    expect(render({ amount: 1.5, format: "number" }, {}, { ...fmt, number: (v) => `#${v}` }).value).toBe("#1.5");
    expect(render({ amount: 1.5, format: "number" }, {}, { ...fmt, hideFigures: true }).value).toBe("••••");
    expect(render({ amount: 1.5, format: "number", sign: "always" }, {}, { ...fmt, hideFigures: true }).value).toBe("+••••");
  });

  it("renders none", () => {
    expect(render({ amount: null, format: "none", sign: "always" }).value).toBe("+");
    expect(render({ amount: null, format: "none", sign: "auto" }).value).toBe("");
    expect(render({ amount: 7, format: "none" }).value).toBe("7");
    expect(render({ amount: 7, format: "none" }, {}, { ...fmt, hideFigures: true }).value).toBe("••••");
  });

  it("joins sub parts and leaves an empty sub undefined", () => {
    expect(render({ amount: 1 }, { sub: [] }).sub).toBeUndefined();
    expect(render({ amount: 1 }).sub).toBeUndefined();
    expect(render({ amount: 1 }, { sub: [{ text: "a" }, { amount: 2, format: "none" }] }).sub).toBe("a2");
  });

  it("picks the value class from the sentiment", () => {
    expect(render({ amount: -0.01 }, { sentiment: "auto" }).valueClass).toBe("text-rose-400");
    expect(render({ amount: 0 }, { sentiment: "auto" }).valueClass).toBe("text-emerald-400");
    expect(render({ amount: null }, { sentiment: "auto" }).valueClass).toBe("text-emerald-400");
    expect(render({ amount: -1 }, { sentiment: "positive" }).valueClass).toBe("text-emerald-400");
    expect(render({ amount: 1 }, { sentiment: "negative" }).valueClass).toBe("text-rose-400");
    expect(render({ amount: 1 }, { sentiment: "neutral" }).valueClass).toBe("text-slate-400");
    expect(render({ amount: 1 }).valueClass).toBe("text-slate-200");
  });
});

describe("hideDigits", () => {
  it("masks digits of any script", () => {
    expect(hideDigits("Q3 ٣ ½")).toBe("Q• • •");
    expect(HIDDEN_FIGURE).toBe("••••");
  });
});
