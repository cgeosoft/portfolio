/**
 * Number grounding: every number the model writes in a finding, theme,
 * suggestion or report must exist in a node it cites. Numbers come from the
 * app; the model only connects and explains them.
 *
 * A number matches a source when the value agrees (within 1% or 0.05, or
 * rounded to 0 or 1 decimal), the unit agrees (a percentage needs a
 * percentage) and the direction agrees (an explicit sign, or an English verb
 * such as "rose" or "fell", against a signed source). Numbers are read in
 * every digit script and with "." or "," as the decimal mark, because the
 * model writes in the configured language.
 *
 * Small counts, years and the usual indicator windows (50 and 200 day
 * averages, RSI 14) pass without a source, but never as a percentage: "50 day
 * average" is a label, "50% of the portfolio" is a claim.
 */
import type { AnalysisNode } from "portfolio-shared/api-types";
import { ledgerDigits, readNumberToken } from "../llm-privacy.js";
import { MODEL_KINDS } from "./graph.js";

/** One number a claim may rest on. */
export interface NumberSource {
  /** The size, always positive. */
  value: number;
  /** -1 or 1 for a signed value, 0 when the source does not say. */
  sign: -1 | 0 | 1;
  /** Whether the source is a percentage; null when unknown. */
  percent: boolean | null;
}

interface Mention {
  /** The values the text can mean, most likely first: "1,234" is 1234 or 1.234. */
  readings: number[];
  sign: -1 | 0 | 1;
  percent: boolean;
  direction: "up" | "down" | null;
}

/** Letters that make a number a label when they touch it (Q3, 10Y). CJK and Thai write words and numbers with no space. */
const LABEL_LETTER = "\\p{Script=Latin}\\p{Script=Greek}\\p{Script=Cyrillic}";
const NUMBER = new RegExp(`(?<![${LABEL_LETTER}\\d.,])[-+\\u2212]?(?:\\d{1,3}(?:[\\u00a0\\u202f\\u2009]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)*)`, "gu");
const LABEL_AFTER = new RegExp(`^[${LABEL_LETTER}]`, "u");
const FREE_NUMBERS = new Set([14, 20, 21, 30, 50, 52, 60, 63, 90, 100, 200, 252, 365]);
/** Units that may follow a number with no space. Any other letter makes it a label (10Y, Q3, 3mo). */
const GLUED_UNIT = /^(?:ppts?|pp|bps?|x)(?![\p{L}\p{N}])/iu;
const PERCENT_AFTER = /^\s?(?:[%٪％]|ppts?(?![\p{L}])|pp(?![\p{L}])|bps?(?![\p{L}])|per ?cent|pct(?![\p{L}])|prozent|por ciento|pour ?cent|per cento|procent|процент|ποσοστ)/iu;
const PERCENT_BEFORE = /[%٪％]\s?$/u;
const HEDGE = "(?:(?:by|about|around|roughly|nearly|almost|only|over|some|more than|at most|as much as|up to)\\s+)*";
const ROSE = new RegExp(`\\b(?:rose|rise|rises|risen|rising|gained?|gains|climbed?|jumped|grew|up|increased)\\s+${HEDGE}$`, "i");
const FELL = new RegExp(`\\b(?:fell|fall|falls|fallen|falling|dropped|drop|declined?|lost|down|slid|sank|shed|decreased)\\s+${HEDGE}$`, "i");
/** Fact keys that hold the size of a fall, so a positive value can be written as "fell 8%". */
const MAGNITUDE_KEY = /drawdown|fromHigh|volatility|drop|below|loss/i;
const isPercentKey = (key: string) => /^percent$|Percent$/.test(key);

/** The numbers a text mentions. */
function mentionsIn(raw: string): Mention[] {
  const text = ledgerDigits(raw);
  const out: Mention[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const after = text.slice(end, end + 16);
    if (LABEL_AFTER.test(after) && !GLUED_UNIT.test(after)) continue;
    const marked = /^[-+\u2212]/.test(m[0]);
    const token = marked ? m[0].slice(1) : m[0];
    // A mark after a letter joins a word to the number, as in Hebrew, and says nothing about direction.
    const signed = marked && !/\p{L}$/u.test(text.slice(0, start));
    const sign = !signed ? 0 : m[0].startsWith("+") ? 1 : -1;
    const before = text.slice(Math.max(0, start - 40), start);
    const percent = PERCENT_AFTER.test(after) || PERCENT_BEFORE.test(before);
    const direction = ROSE.test(before) ? "up" : FELL.test(before) ? "down" : null;
    const whole = readNumberToken(token);
    // A token no format explains is a list such as "10,20,30": each part is a number of its own.
    const groups = whole.length ? [whole] : token.split(/[.,]/).map(readNumberToken).filter((g) => g.length);
    for (const group of groups) out.push({ readings: group.map((r) => Math.abs(r.value)), sign, percent, direction });
  }
  return out;
}

/** The numbers in a text, as absolute values. A number touching a Latin, Greek or Cyrillic letter (10Y, Q3, 3mo) is a label and left out. */
export function numbersIn(text: string): number[] {
  return mentionsIn(text).map((m) => m.readings[0]!);
}

/** A percentage the app worked out, with no direction of its own. */
export function percentSource(value: number): NumberSource {
  return { value: Math.abs(value), sign: 0, percent: true };
}

/** Every number a node offers as a source: its facts, and for app-made nodes its summary too. */
export function nodeNumbers(node: AnalysisNode): NumberSource[] {
  const out: NumberSource[] = [];
  const fromText = (text: string) => {
    for (const m of mentionsIn(text)) for (const value of m.readings) out.push({ value, sign: m.sign, percent: m.percent });
  };
  const walk = (v: unknown, key: string) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push({ value: Math.abs(v), sign: MAGNITUDE_KEY.test(key) ? 0 : (Math.sign(v) as -1 | 0 | 1), percent: isPercentKey(key) });
    else if (typeof v === "string") fromText(v);
    else if (Array.isArray(v)) v.forEach((item) => walk(item, key));
    else if (v && typeof v === "object") for (const [k, item] of Object.entries(v)) walk(item, k);
  };
  walk(node.facts, "");
  if (!MODEL_KINDS.has(node.kind)) fromText(node.summary);
  return out;
}

function isFree(m: Mention): boolean {
  return m.readings.some((n) => {
    if (m.percent) return n === 0 || n === 100; // "all of it" and "none of it" need no source
    return Number.isInteger(n) && (n <= 12 || FREE_NUMBERS.has(n) || (n >= 1900 && n <= 2199));
  });
}

function sameValue(n: number, source: number): boolean {
  if (Math.abs(n - source) <= Math.max(0.05, source * 0.01)) return true;
  return n === Math.round(source) || n === Math.round(source * 10) / 10;
}

function matches(m: Mention, s: NumberSource): boolean {
  if (m.percent && s.percent === false) return false;
  if (s.sign !== 0) {
    if (m.sign !== 0 && m.sign !== s.sign) return false;
    if ((m.direction === "up" && s.sign < 0) || (m.direction === "down" && s.sign > 0)) return false;
  }
  return m.readings.some((n) => sameValue(n, s.value));
}

const toSource = (s: number | NumberSource): NumberSource => (typeof s === "number" ? { value: Math.abs(s), sign: 0, percent: null } : s);

/** The numbers of `text` that no source supports. Empty when the text is grounded. */
export function ungroundedNumbers(text: string, sources: readonly (number | NumberSource)[]): number[] {
  const pool = sources.map(toSource);
  const out: number[] = [];
  for (const m of mentionsIn(text)) {
    if (isFree(m)) continue;
    if (!pool.some((s) => matches(m, s))) out.push(m.readings[0]!);
  }
  return [...new Set(out)];
}

/** Sources for a model node: the cited nodes plus the brief and the allocation, which every prompt shows. */
export function sourcesFor(cited: readonly (AnalysisNode | undefined)[], centre: readonly (AnalysisNode | undefined)[]): NumberSource[] {
  return [...cited, ...centre].filter((n): n is AnalysisNode => Boolean(n)).flatMap(nodeNumbers);
}

/** Removes the sentences of `text` that carry an ungrounded number. */
export function dropUngroundedSentences(text: string, sources: readonly (number | NumberSource)[]): string {
  // A sentence ends at . ! or ? followed by a space, so "4.2%" stays whole. CJK and Arabic marks need no space.
  const sentences = text.split(/(?<=[.!?])\s+|(?<=[。！？؟])\s*/u);
  return sentences.filter((s) => ungroundedNumbers(s, sources).length === 0).join(" ").trim();
}
