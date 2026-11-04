/**
 * Number grounding: every number the model writes in a finding, theme or
 * report must exist in a node it cites. Numbers come from the app; the model
 * only connects and explains them.
 *
 * Small counts, years and the usual indicator windows (50 and 200 day
 * averages, RSI 14) pass without a source. A value matches a source when it
 * equals it within 1% or 0.05, or equals it rounded to 0 or 1 decimal.
 */
import type { AnalysisNode } from "portfolio-shared/api-types";
import { MODEL_KINDS } from "./graph.js";

const NUMBER = /(?<![\p{L}\d.,])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu;
const FREE_NUMBERS = new Set([14, 20, 21, 30, 50, 52, 60, 63, 90, 100, 200, 252, 365]);

/** The numbers in a text, as absolute values. A number glued to a letter (10Y, Q3, 3mo) is a label and left out. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const end = (m.index ?? 0) + m[0].length;
    if (/^[\p{L}]/u.test(text.slice(end, end + 1))) continue;
    const n = Math.abs(Number(m[0].replace(/,/g, "")));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Every number a node offers as a source: its facts, and for app-made nodes its summary too. */
export function nodeNumbers(node: AnalysisNode): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(Math.abs(v));
    else if (typeof v === "string") out.push(...numbersIn(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(node.facts);
  if (!MODEL_KINDS.has(node.kind)) out.push(...numbersIn(node.summary));
  return out;
}

function isFree(n: number): boolean {
  if (Number.isInteger(n) && (n <= 12 || FREE_NUMBERS.has(n) || (n >= 1900 && n <= 2199))) return true;
  return false;
}

function matches(n: number, source: number): boolean {
  if (Math.abs(n - source) <= Math.max(0.05, Math.abs(source) * 0.01)) return true;
  return n === Math.round(source) || n === Math.round(source * 10) / 10;
}

/** The numbers of `text` that no source supports. Empty when the text is grounded. */
export function ungroundedNumbers(text: string, sources: readonly number[]): number[] {
  const out: number[] = [];
  for (const n of numbersIn(text)) {
    if (isFree(n)) continue;
    if (!sources.some((s) => matches(n, s))) out.push(n);
  }
  return [...new Set(out)];
}

/** Sources for a model node: the cited nodes plus the brief and the allocation, which every prompt shows. */
export function sourcesFor(cited: readonly (AnalysisNode | undefined)[], centre: readonly (AnalysisNode | undefined)[]): number[] {
  return [...cited, ...centre].filter((n): n is AnalysisNode => Boolean(n)).flatMap(nodeNumbers);
}

/** Removes the sentences of `text` that carry an ungrounded number. */
export function dropUngroundedSentences(text: string, sources: readonly number[]): string {
  // A sentence ends at . ! or ? followed by a space, so "4.2%" stays whole.
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.filter((s) => ungroundedNumbers(s, sources).length === 0).join(" ").trim();
}
