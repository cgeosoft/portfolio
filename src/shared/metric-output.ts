/**
 * Result schema of a metric module. A module returns structured data, never a
 * formatted string, so currency, locale, and the privacy mask stay under host
 * control. The module never learns whether values are masked.
 */

export type MetricValueFormat = "currency" | "percent" | "number" | "none";

/** `always` prefixes "+" to non-negative amounts, matching the legacy cards. */
export type MetricValueSign = "auto" | "always" | "never";

/** Color of the value. `auto` derives it from the sign of the main amount. */
export type MetricSentiment = "auto" | "positive" | "negative" | "neutral";

export interface MetricAmountPart {
  amount: number | null;
  format: MetricValueFormat;
  sign?: MetricValueSign;
}

export interface MetricTextPart {
  text: string;
}

export type MetricSubPart = MetricAmountPart | MetricTextPart;

export interface MetricOutput {
  value: MetricAmountPart;
  sub?: MetricSubPart[];
  sentiment?: MetricSentiment;
}

const FORMATS: readonly string[] = ["currency", "percent", "number", "none"];
const SIGNS: readonly string[] = ["auto", "always", "never"];
const SENTIMENTS: readonly string[] = ["auto", "positive", "negative", "neutral"];

/** Upper bound of the JSON a module may return, in bytes. */
export const MAX_METRIC_OUTPUT_BYTES = 4096;
const MAX_SUB_PARTS = 16;
const MAX_TEXT_LENGTH = 200;

function readAmountPart(raw: unknown, path: string): MetricAmountPart {
  if (!raw || typeof raw !== "object") throw new Error(`${path} must be an object`);
  const part = raw as Record<string, unknown>;
  const amount = part["amount"];
  if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount))) {
    throw new Error(`${path}.amount must be a finite number or null`);
  }
  if (typeof part["format"] !== "string" || !FORMATS.includes(part["format"])) {
    throw new Error(`${path}.format must be one of ${FORMATS.join(", ")}`);
  }
  const result: MetricAmountPart = { amount: amount as number | null, format: part["format"] as MetricValueFormat };
  if (part["sign"] !== undefined) {
    if (typeof part["sign"] !== "string" || !SIGNS.includes(part["sign"])) {
      throw new Error(`${path}.sign must be one of ${SIGNS.join(", ")}`);
    }
    result.sign = part["sign"] as MetricValueSign;
  }
  return result;
}

/** Validate the JSON a module returned. Throws a descriptive error on any deviation. */
export function parseMetricOutput(json: string): MetricOutput {
  if (json.length > MAX_METRIC_OUTPUT_BYTES) {
    throw new Error(`Result exceeds ${MAX_METRIC_OUTPUT_BYTES} bytes`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Result is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Result must be a JSON object");
  const obj = raw as Record<string, unknown>;

  const output: MetricOutput = { value: readAmountPart(obj["value"], "value") };

  if (obj["sub"] !== undefined) {
    if (!Array.isArray(obj["sub"])) throw new Error("sub must be an array");
    if (obj["sub"].length > MAX_SUB_PARTS) throw new Error(`sub may hold at most ${MAX_SUB_PARTS} parts`);
    output.sub = obj["sub"].map((item, index) => {
      const path = `sub[${index}]`;
      if (item && typeof item === "object" && "text" in (item as object)) {
        const text = (item as Record<string, unknown>)["text"];
        if (typeof text !== "string") throw new Error(`${path}.text must be a string`);
        return { text: text.slice(0, MAX_TEXT_LENGTH) };
      }
      return readAmountPart(item, path);
    });
  }

  if (obj["sentiment"] !== undefined) {
    if (typeof obj["sentiment"] !== "string" || !SENTIMENTS.includes(obj["sentiment"])) {
      throw new Error(`sentiment must be one of ${SENTIMENTS.join(", ")}`);
    }
    output.sentiment = obj["sentiment"] as MetricSentiment;
  }

  return output;
}

/** Host formatters. The webview supplies its currency and privacy-aware helpers. */
export interface MetricFormatters {
  currency: (amount: number | undefined) => string;
  percent: (value: number | undefined) => string;
  number?: (value: number | undefined) => string;
}

function formatAmount(part: MetricAmountPart, fmt: MetricFormatters): string {
  const amount = part.amount === null ? undefined : part.amount;
  const prefix = part.sign === "always" && (amount ?? 0) >= 0 ? "+" : "";
  switch (part.format) {
    case "currency":
      return `${prefix}${fmt.currency(amount)}`;
    case "percent":
      return fmt.percent(amount);
    case "number":
      return `${prefix}${fmt.number ? fmt.number(amount) : String(amount ?? 0)}`;
    case "none":
      return `${prefix}${amount === undefined ? "" : String(amount)}`;
  }
}

export interface RenderedMetric {
  value: string;
  sub?: string;
  /** Tailwind text color class of the compact tile value. */
  valueClass: string;
}

/** Turn a validated result into display strings, reproducing the legacy card rules. */
export function renderMetricOutput(output: MetricOutput, fmt: MetricFormatters): RenderedMetric {
  const value = formatAmount(output.value, fmt);
  const sub = output.sub?.map((part) => ("text" in part ? part.text : formatAmount(part, fmt))).join("");
  return { value, sub: sub === "" ? undefined : sub, valueClass: sentimentClass(output) };
}

function sentimentClass(output: MetricOutput): string {
  switch (output.sentiment) {
    case "auto":
      return (output.value.amount ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400";
    case "positive":
      return "text-emerald-400";
    case "negative":
      return "text-rose-400";
    case "neutral":
      return "text-slate-400";
    default:
      return "text-slate-200";
  }
}
