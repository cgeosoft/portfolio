/**
 * Portfolio brief: what a portfolio is for and what success looks like.
 *
 * The brief is the root of every guided analysis. It holds prose the user
 * reads and edits, plus optional structured fields the analysis can check
 * findings against. Amounts never belong in it: the service scans every text
 * field (`scanForAmounts`) and refuses a brief that names one.
 *
 * The wizard asks the fixed questions below, one per screen, so it behaves
 * the same on a small local model. The GUI translates the labels with
 * `t("analysis.brief.wizard.<id>.*")`; the values here are stable ids.
 */
import type { PortfolioBrief, TargetBand } from "./portfolio";

export type { PortfolioBrief, TargetBand } from "./portfolio";

/** Brief fields a question, finding or suggestion can name as the goal it serves. */
export const BRIEF_FIELDS = [
  "purpose",
  "horizon",
  "riskTolerance",
  "incomeNeed",
  "cashFlowPattern",
  "targetBands",
  "constraints",
  "successInOwnWords",
] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];

export function isBriefField(value: unknown): value is BriefField {
  return typeof value === "string" && (BRIEF_FIELDS as readonly string[]).includes(value);
}

export const BRIEF_PURPOSES = ["retirement", "house", "income", "growth", "preservation", "education", "misc"] as const;
export const BRIEF_HORIZONS = ["lt3", "3to7", "7to15", "gt15"] as const;
export const BRIEF_CASH_FLOWS = ["contributions", "lump_sum", "drawdown", "none"] as const;
export const BRIEF_CONSTRAINTS = ["no_crypto", "esg", "home_bias", "tax_wrapper", "no_single_stocks", "no_leverage"] as const;
export const BRIEF_ASSET_CLASSES = ["equity", "bonds", "cash", "crypto", "real_estate", "commodities", "misc"] as const;

/** Longest text the brief keeps per field. */
export const BRIEF_LIMITS = { prose: 2_000, text: 300, constraints: 12, bands: 8 } as const;

export type WizardQuestionKind = "single" | "multi" | "scale" | "bands" | "text";

export interface WizardQuestion {
  id: BriefField;
  kind: WizardQuestionKind;
  /** Option ids for single and multi choice; the GUI shows `t("analysis.brief.options.<id>.<option>")`. */
  options?: readonly string[];
  /** True when the user may add own text next to the chips. */
  allowText?: boolean;
}

/** The fixed wizard questions, in the order they show. */
export const BRIEF_WIZARD_QUESTIONS: readonly WizardQuestion[] = [
  { id: "purpose", kind: "single", options: BRIEF_PURPOSES, allowText: true },
  { id: "horizon", kind: "single", options: BRIEF_HORIZONS, allowText: true },
  { id: "riskTolerance", kind: "scale" },
  { id: "incomeNeed", kind: "single", options: ["yes", "no"] },
  { id: "cashFlowPattern", kind: "single", options: BRIEF_CASH_FLOWS },
  { id: "targetBands", kind: "bands" },
  { id: "constraints", kind: "multi", options: BRIEF_CONSTRAINTS, allowText: true },
  { id: "successInOwnWords", kind: "text" },
];

/** English labels of the option ids, for prompts. The GUI uses its own translations. */
export const BRIEF_OPTION_TEXT: Record<string, string> = {
  retirement: "retirement",
  house: "saving for a house",
  income: "regular income",
  growth: "long-term growth",
  preservation: "capital preservation",
  education: "education costs",
  misc: "other",
  lt3: "less than 3 years",
  "3to7": "3 to 7 years",
  "7to15": "7 to 15 years",
  gt15: "more than 15 years",
  contributions: "regular contributions",
  lump_sum: "one-off investment",
  drawdown: "drawing money out",
  none: "no money in or out",
  no_crypto: "no crypto",
  esg: "ESG exclusions",
  home_bias: "prefers the home market",
  tax_wrapper: "tax wrapper rules apply",
  no_single_stocks: "no single stocks",
  no_leverage: "no leverage",
  equity: "equity",
  bonds: "bonds",
  cash: "cash",
  crypto: "crypto",
  real_estate: "real estate",
  commodities: "commodities",
};

const clean = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max).trimEnd() : text;
};

const cleanProse = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return undefined;
  return text.length > BRIEF_LIMITS.prose ? text.slice(0, BRIEF_LIMITS.prose).trimEnd() : text;
};

const finite = (value: unknown): number | undefined => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * A brief with every field checked: strings trimmed and cut, numbers in
 * range, unknown keys dropped, empty parts left out. Safe on any input.
 */
export function normalizeBrief(raw: unknown): PortfolioBrief {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const brief: PortfolioBrief = {};

  const purpose = clean(o.purpose, BRIEF_LIMITS.text);
  if (purpose) brief.purpose = purpose;
  const horizon = clean(o.horizon, BRIEF_LIMITS.text);
  if (horizon) brief.horizon = horizon;

  const risk = o.riskTolerance && typeof o.riskTolerance === "object" ? (o.riskTolerance as Record<string, unknown>) : {};
  const score = finite(risk.score);
  const maxDrop = finite(risk.maxDropPercent);
  if (score !== undefined || maxDrop !== undefined) {
    brief.riskTolerance = {};
    if (score !== undefined) brief.riskTolerance.score = clamp(Math.round(score), 1, 5);
    if (maxDrop !== undefined) brief.riskTolerance.maxDropPercent = clamp(Math.round(maxDrop), 0, 100);
  }

  const income = o.incomeNeed && typeof o.incomeNeed === "object" ? (o.incomeNeed as Record<string, unknown>) : {};
  const yieldTarget = finite(income.targetYieldPercent);
  if (typeof income.required === "boolean" || yieldTarget !== undefined) {
    brief.incomeNeed = {};
    if (typeof income.required === "boolean") brief.incomeNeed.required = income.required;
    if (yieldTarget !== undefined) brief.incomeNeed.targetYieldPercent = Math.round(clamp(yieldTarget, 0, 50) * 100) / 100;
  }

  const flow = clean(o.cashFlowPattern, BRIEF_LIMITS.text);
  if (flow) brief.cashFlowPattern = flow;

  if (Array.isArray(o.targetBands)) {
    const bands: TargetBand[] = [];
    for (const item of o.targetBands) {
      if (!item || typeof item !== "object") continue;
      const b = item as Record<string, unknown>;
      const assetClass = clean(b.assetClass, 60);
      const min = finite(b.minPercent);
      const max = finite(b.maxPercent);
      if (!assetClass || min === undefined || max === undefined) continue;
      const lo = clamp(Math.min(min, max), 0, 100);
      const hi = clamp(Math.max(min, max), 0, 100);
      if (bands.some((x) => x.assetClass.toLowerCase() === assetClass.toLowerCase())) continue;
      bands.push({ assetClass, minPercent: Math.round(lo), maxPercent: Math.round(hi) });
      if (bands.length >= BRIEF_LIMITS.bands) break;
    }
    if (bands.length) brief.targetBands = bands;
  }

  if (Array.isArray(o.constraints)) {
    const list = [...new Set(o.constraints.map((c) => clean(c, BRIEF_LIMITS.text)).filter((c): c is string => Boolean(c)))];
    if (list.length) brief.constraints = list.slice(0, BRIEF_LIMITS.constraints);
  }

  const success = clean(o.successInOwnWords, BRIEF_LIMITS.text * 2);
  if (success) brief.successInOwnWords = success;
  const prose = cleanProse(o.prose);
  if (prose) brief.prose = prose;
  return brief;
}

/** True when the brief says nothing. */
export function isBriefEmpty(brief: PortfolioBrief | null | undefined): boolean {
  return !brief || Object.keys(normalizeBrief(brief)).length === 0;
}

/** Every free-text part of a brief, labelled by field, for the amount scan. */
export function briefTexts(brief: PortfolioBrief): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  const add = (field: string, text: string | undefined) => {
    if (text) out.push({ field, text });
  };
  add("purpose", brief.purpose);
  add("horizon", brief.horizon);
  add("cashFlowPattern", brief.cashFlowPattern);
  for (const band of brief.targetBands ?? []) add("targetBands", band.assetClass);
  for (const c of brief.constraints ?? []) add("constraints", c);
  add("successInOwnWords", brief.successInOwnWords);
  add("prose", brief.prose);
  return out;
}

/** An option id as English text for prompts; free text stays as it is. */
export function optionText(value: string): string {
  return BRIEF_OPTION_TEXT[value] ?? value;
}

/** A stable fingerprint of a brief, to tell whether it changed since a run. */
export function briefFingerprint(brief: PortfolioBrief | null | undefined): string {
  const b = normalizeBrief(brief ?? {});
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sorted((value as Record<string, unknown>)[k])]));
    }
    return value;
  };
  return JSON.stringify(sorted(b));
}
