/**
 * Phase policies of Guided Analysis: per phase, the instructions, the output
 * schema and the fallback the harness uses when the model fails. The harness
 * (harness.ts) runs them in a fixed order: seed, survey, expand, synthesise,
 * suggest, report. Prompts stay English; the text the user reads comes back
 * in the configured language.
 */
import { BRIEF_FIELDS } from "portfolio-shared/brief";
import type { PortfolioBrief } from "portfolio-shared/portfolio";
import { SUGGESTION_MAX_TTL_DAYS } from "portfolio-shared/suggestions";
import { plainStyle, withLanguageInstruction } from "../output-language.js";
import { MAX_SUGGESTIONS, MIN_CHANGE_PP } from "../portfolio-suggestions.js";
import type { JsonSchema } from "./types.js";

const briefFieldSchema: JsonSchema = { type: "string", enum: [...BRIEF_FIELDS, "general"], description: "The brief field this is about." };
const ids = (description: string): JsonSchema => ({ type: "array", items: { type: "string" }, description });

const ROLE = `You are the analyst inside a portfolio app. The app is the harness: it fetches data, runs the math and checks every answer. You decide what to look at and you explain what the facts mean for the user's goal.
Everything you see is in percent of the portfolio, never money amounts. Never write money amounts, balances or share counts.
Each fact is a node of an evidence graph with an id in brackets, such as [H2] or [N7]. Cite node ids, never invent them.
Every number you write must come from a node you cite. Do not invent figures, dates or news.`;

function style(language: string | undefined): string {
  return `Use ${plainStyle(language)}. No emojis, no long dashes.`;
}

// ── survey ──────────────────────────────────────────────────────────────────

export const SURVEY_OUTPUT: JsonSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      maxItems: 7,
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "The question, one sentence, at most 20 words." },
          briefField: briefFieldSchema,
          why: { type: "string", description: "One short sentence: why this matters for the brief." },
        },
        required: ["title", "briefField"],
      },
    },
  },
  required: ["questions"],
};

export function surveySystem(language: string | undefined): string {
  return withLanguageInstruction(
    `${ROLE}

Phase: survey. Read the brief, the allocation and the starting facts. Open 3 to 7 questions worth checking, each tied to one brief field.
A good question can be answered with data: concentration against the accepted risk, drift from the target bands, yield against the income need, a holding whose trend or news could hurt the goal, the macro backdrop against the horizon.
Avoid generic questions that fit any portfolio. ${style(language)}`,
    language,
    { jsonFields: ["title", "why", "note"] },
  );
}

/** Questions the harness opens when the model fails the survey. */
export function defaultQuestions(brief: PortfolioBrief): { title: string; briefField: string; why: string }[] {
  const out = [
    { title: "Does the largest position fit the risk the brief accepts?", briefField: "riskTolerance", why: "Concentration drives how far the portfolio can fall." },
    { title: "Which holdings move the portfolio most right now, and why?", briefField: "general", why: "Large moves show where attention is needed." },
    { title: "What in the current market matters for this horizon?", briefField: "horizon", why: "The backdrop sets the risk of the next months." },
  ];
  if (brief.targetBands?.length) out.unshift({ title: "Is the allocation inside the target bands of the brief?", briefField: "targetBands", why: "Drift from the bands changes the risk profile." });
  if (brief.incomeNeed?.required) out.push({ title: "Does the portfolio yield what the brief needs?", briefField: "incomeNeed", why: "Income is a stated goal." });
  return out.slice(0, 5);
}

// ── expand and synthesise ───────────────────────────────────────────────────

const findingSchema: JsonSchema = {
  type: "object",
  properties: {
    questionId: { type: "string", description: "The question this finding answers, such as Q2." },
    title: { type: "string", description: "The finding, at most 12 words." },
    summary: { type: "string", description: "1 to 3 sentences with the facts and what they mean for the brief, at most 600 characters." },
    stance: { type: "string", enum: ["risk", "opportunity", "neutral"] },
    severity: { type: "integer", minimum: 1, maximum: 3, description: "3 needs action soon, 1 is worth knowing." },
    briefField: briefFieldSchema,
    supports: ids("Ids of the nodes that support the finding; at least one."),
    contradicts: ids("Ids of nodes that point the other way, if any."),
  },
  required: ["title", "summary", "stance", "severity", "supports"],
};

export const EXPAND_OUTPUT: JsonSchema = {
  type: "object",
  properties: {
    findings: { type: "array", maxItems: 4, items: findingSchema, description: "Findings that close a question; empty while you still need data." },
    subQuestions: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        properties: { parentId: { type: "string" }, title: { type: "string" }, briefField: briefFieldSchema },
        required: ["parentId", "title"],
      },
      description: "Narrower questions a result raised.",
    },
    close: ids("Questions to close without a finding: the data cannot answer them."),
  },
};

export function expandSystem(language: string | undefined): string {
  return withLanguageInstruction(
    `${ROLE}

Phase: expand. Work on the focus questions. Each step you may:
- call tools for facts you still need (pass the question id with each call),
- write a finding that answers a question, citing the nodes behind it,
- open a narrower sub-question, or close a question the data cannot answer.
Ask only for data you will use. Do not call a tool again with the same arguments; its result is already a node. A FAILED node means the data is not available.
Write a finding only when the facts support it. Cite counter-evidence in "contradicts" when a node points the other way. An answer of "no issue" is a valid finding.
Set "done" when the open questions need no more data. ${style(language)}`,
    language,
    { jsonFields: ["title", "summary", "note"] },
  );
}

export const SYNTHESISE_OUTPUT: JsonSchema = {
  type: "object",
  properties: {
    themes: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "A cross-cutting story, at most 8 words, such as \"AI capex cycle\"." },
          summary: { type: "string", description: "1 or 2 sentences." },
          holdings: ids("Symbols of the holdings exposed to the theme."),
          cites: ids("Ids of at least two nodes behind the theme."),
        },
        required: ["title", "summary", "cites"],
      },
    },
    findings: { type: "array", maxItems: 3, items: findingSchema, description: "Findings that only show across questions; leave out repeats of existing findings." },
  },
};

export function synthesiseSystem(language: string | undefined): string {
  return withLanguageInstruction(
    `${ROLE}

Phase: synthesise. Read the findings and the evidence. Name the themes that link several holdings and facts, each citing at least two nodes. Add a finding only when it shows across questions and no existing finding covers it. ${style(language)}`,
    language,
    { jsonFields: ["title", "summary", "note"] },
  );
}

// ── suggest ─────────────────────────────────────────────────────────────────

export const SUGGEST_OUTPUT: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "1 or 2 sentences: the overall view, or why no change is needed." },
    suggestions: {
      type: "array",
      maxItems: MAX_SUGGESTIONS,
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["increase", "decrease", "open", "close"] },
          symbol: { type: "string" },
          fromWeight: { type: "number", description: "Current weight in percent, from the ledger." },
          targetWeight: { type: "number", description: "Weight in percent after the action." },
          priority: { type: "integer", minimum: 1, maximum: 5 },
          title: { type: "string", description: "At most 8 words." },
          why: { type: "string", description: "1 to 3 short sentences naming the facts." },
          fundedBy: { type: "array", items: { type: "object", properties: { key: { type: "string" }, weight: { type: "number" } } } },
          validity: { type: "object", properties: { days: { type: "integer" }, priceMin: { type: "number" }, priceMax: { type: "number" }, weightMin: { type: "number" }, weightMax: { type: "number" } } },
          findings: ids("Ids of the findings this acts on; at least one."),
          evidence: ids("Ids of the fact nodes behind it."),
          goal: briefFieldSchema,
        },
        required: ["action", "symbol", "targetWeight", "title", "why", "findings"],
      },
    },
  },
  required: ["summary", "suggestions"],
};

export function suggestSystem(language: string | undefined): string {
  return withLanguageInstruction(
    `${ROLE}

Phase: suggest. Decide whether the portfolio needs rebalancing. Most of the time it does not.
- Every suggestion acts on at least one finding of this run, cited in "findings". A suggestion without a finding is dropped.
- An empty list is a good answer. Never fill the list to have something to say. When it is empty, "summary" says why no change is needed.
- Move the portfolio toward the brief and never break its constraints.
- Each suggestion changes the weight of one symbol by at least ${MIN_CHANGE_PP} percentage point. Actions: "decrease" and "increase" for held symbols, "close" to sell all of one, "open" for a symbol not held (Yahoo Finance symbol, exchange suffix for non-US listings).
- "fromWeight" repeats the weight from the ledger. The changes must balance: sells plus cash used equal buys. "fundedBy" lists the sources of "increase" and "open": "decrease:SYMBOL", "close:SYMBOL" or "CASH", with the weight in percentage points.
- "validity": "days" (1 to ${SUGGESTION_MAX_TTL_DAYS}), optional price range in the quote currency, optional weight range in percent.
- Do not trade private assets. At most ${MAX_SUGGESTIONS} suggestions. ${style(language)}`,
    language,
    { jsonFields: ["summary", "title", "why", "note"] },
  );
}

// ── report ──────────────────────────────────────────────────────────────────

export const REPORT_OUTPUT: JsonSchema = {
  type: "object",
  properties: {
    whereYouStand: { type: "string", description: "2 or 3 sentences: the portfolio against its brief." },
    matters: {
      type: "array",
      maxItems: 3,
      items: { type: "object", properties: { findingId: { type: "string" }, text: { type: "string", description: "1 or 2 sentences." } }, required: ["findingId", "text"] },
      description: "The 3 findings that matter most now, most important first.",
    },
    changed: { type: "string", description: "1 to 3 sentences on what changed since the last run, from the comparison given. Empty for a first run." },
    actions: {
      type: "array",
      maxItems: MAX_SUGGESTIONS,
      items: { type: "object", properties: { suggestionId: { type: "string" }, text: { type: "string", description: "One line." } }, required: ["suggestionId", "text"] },
    },
  },
  required: ["whereYouStand", "matters"],
};

export function reportSystem(language: string | undefined): string {
  return withLanguageInstruction(
    `${ROLE}

Phase: report. Write the short state report of this run, at most about 400 words in total. The app adds the headings and the links to the nodes.
- "whereYouStand": the portfolio against its brief.
- "matters": the three findings that matter most now.
- "changed": only from the comparison with the last run that is given.
- "actions": one line per suggestion, by its id.
${style(language)}`,
    language,
    { jsonFields: ["whereYouStand", "text", "changed", "note"] },
  );
}
