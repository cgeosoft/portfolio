/**
 * Portfolio brief: the purpose and goal of a portfolio, stored once per
 * portfolio and copied into each guided analysis run.
 *
 * The structured fields live in `portfolios.briefJson`, the prose in
 * `portfolios.description` (the column the chat and daily brief already
 * read). Every text field passes `scanForAmounts()` before it is saved or
 * sent to a model, so the brief never carries a money amount.
 *
 * With an AI provider the wizard asks fixed questions (shared/brief.ts),
 * then the model asks at most two follow-ups where the answers conflict
 * with the allocation, and drafts the prose. The structured fields come from
 * the answers on this machine, so a weak model can only make the prose worse.
 */
import type { FinancialPortfolioData, PortfolioBrief } from "portfolio-shared/portfolio";
import type { BriefWizardDraftResponse, BriefWizardFollowupResponse, GetPortfolioBriefResponse } from "portfolio-shared/api-types";
import { BRIEF_WIZARD_QUESTIONS, briefTexts, isBriefEmpty, normalizeBrief, optionText } from "portfolio-shared/brief";
import * as portfolioRepo from "../db/portfolio.repo.js";
import { loadConfig } from "../config.js";
import { appLogger } from "../logger.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { scanForAmounts, toPromptSafe } from "./llm-privacy.js";
import { sanitizeLlmResponse, type LlmService } from "./llm.js";
import type { PortfolioService } from "./portfolio.js";
import { plainStyle, withLanguageInstruction } from "./output-language.js";
import { extractJsonObject } from "./json-reply.js";

/** Refused text: it names a money amount. `matches` are the parts the GUI asks the user to rewrite in percent. */
export class BriefAmountError extends ValidationError {
  constructor(public readonly matches: string[]) {
    super(`The brief names an amount (${matches.slice(0, 3).join(", ")}). Describe it in percent of the portfolio instead.`);
    this.name = "BriefAmountError";
  }
}

/** The brief of a stored portfolio row: the JSON fields plus the description as prose. Null when both are empty. */
export function readBrief(row: Pick<portfolioRepo.PortfolioRow, "briefJson" | "description">): PortfolioBrief | null {
  let parsed: unknown = {};
  if (row.briefJson) {
    try {
      parsed = JSON.parse(row.briefJson);
    } catch {
      parsed = {};
    }
  }
  const brief = normalizeBrief({ ...(parsed as object), prose: row.description ?? undefined });
  return isBriefEmpty(brief) ? null : brief;
}

/** Every amount in the free text of `brief`. Empty when it is clean. */
export function briefAmounts(brief: PortfolioBrief): string[] {
  const found = new Set<string>();
  for (const { text } of briefTexts(brief)) for (const m of scanForAmounts(text).matches) found.add(m);
  return [...found];
}

/** Throws `BriefAmountError` when any text names an amount. */
function assertNoAmounts(texts: string[]): void {
  const found = new Set<string>();
  for (const text of texts) for (const m of scanForAmounts(text).matches) found.add(m);
  if (found.size > 0) throw new BriefAmountError([...found]);
}

const pct = (n: number | undefined) => (n === undefined ? "" : `${n}%`);

/**
 * The brief as prompt lines, for the report, suggestion and chat prompts and
 * the analysis seed. Empty when there is no brief. Percent and text only.
 */
export function formatBriefForPrompt(brief: PortfolioBrief | null | undefined): string {
  if (!brief || isBriefEmpty(brief)) return "";
  const lines: string[] = [];
  if (brief.purpose) lines.push(`- Purpose: ${optionText(brief.purpose)}`);
  if (brief.horizon) lines.push(`- Horizon: ${optionText(brief.horizon)}`);
  const risk = brief.riskTolerance;
  if (risk && (risk.score !== undefined || risk.maxDropPercent !== undefined)) {
    const parts = [risk.score !== undefined ? `${risk.score} of 5 (1 is cautious, 5 is aggressive)` : "", risk.maxDropPercent !== undefined ? `largest accepted drop ${pct(risk.maxDropPercent)}` : ""].filter(Boolean);
    lines.push(`- Risk tolerance: ${parts.join(", ")}`);
  }
  const income = brief.incomeNeed;
  if (income && (income.required !== undefined || income.targetYieldPercent !== undefined)) {
    const parts = [income.required === undefined ? "" : income.required ? "needs income" : "no income needed", income.targetYieldPercent !== undefined ? `target yield ${pct(income.targetYieldPercent)}` : ""].filter(Boolean);
    lines.push(`- Income: ${parts.join(", ")}`);
  }
  if (brief.cashFlowPattern) lines.push(`- Cash flow: ${optionText(brief.cashFlowPattern)}`);
  if (brief.targetBands?.length) lines.push(`- Target bands: ${brief.targetBands.map((b) => `${optionText(b.assetClass)} ${b.minPercent} to ${b.maxPercent}%`).join(", ")}`);
  if (brief.constraints?.length) lines.push(`- Constraints: ${brief.constraints.map(optionText).join(", ")}`);
  if (brief.successInOwnWords) lines.push(`- Success in the user's words: ${brief.successInOwnWords}`);
  if (brief.prose) lines.push(`- Description: ${brief.prose.replace(/\s*\n+\s*/g, " ")}`);
  return lines.join("\n");
}

/** The brief section of a prompt, with its heading, or "" without a brief. */
export function briefPromptSection(brief: PortfolioBrief | null | undefined, heading = "## Portfolio Brief (the user's purpose and goal)"): string {
  const text = formatBriefForPrompt(brief);
  return text ? `\n${heading}\n${text}\n` : "";
}

// ── wizard answers ──────────────────────────────────────────────────────────

type Answers = Record<string, unknown>;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The answer to a single choice question: the chip, else the typed text. */
function choiceOf(answer: unknown): string {
  if (typeof answer === "string") return answer.trim();
  const a = obj(answer);
  return str(a.text) || str(a.choice);
}

/** Every text the user typed in the wizard, for the amount scan. */
export function answerTexts(answers: Answers, followupAnswers: Answers = {}): string[] {
  const texts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(answers);
  walk(followupAnswers);
  return texts;
}

/** The structured brief the answers describe. No model involved. */
export function briefFromAnswers(answers: Answers): PortfolioBrief {
  const risk = obj(answers.riskTolerance);
  const income = obj(answers.incomeNeed);
  const constraints = obj(answers.constraints);
  const incomeChoice = str(income.choice);
  return normalizeBrief({
    purpose: choiceOf(answers.purpose),
    horizon: choiceOf(answers.horizon),
    riskTolerance: { score: risk.score, maxDropPercent: risk.maxDropPercent },
    incomeNeed: { required: incomeChoice === "yes" ? true : incomeChoice === "no" ? false : undefined, targetYieldPercent: income.targetYieldPercent },
    cashFlowPattern: choiceOf(answers.cashFlowPattern),
    targetBands: Array.isArray(answers.targetBands) ? answers.targetBands : [],
    constraints: [...(Array.isArray(constraints.choices) ? constraints.choices : []), ...str(constraints.text).split(/[,;\n]/)].map((c) => (typeof c === "string" ? c.trim() : "")),
    successInOwnWords: typeof answers.successInOwnWords === "string" ? answers.successInOwnWords : choiceOf(answers.successInOwnWords),
  });
}

/** The allocation in percent, for the wizard prompts: asset classes, cash and the five largest holdings. */
export function allocationForPrompt(data: FinancialPortfolioData): string {
  const s = data.summary;
  const top = (data.holdings ?? [])
    .filter((h) => h.assetType !== "Cash" && h.shares > 0)
    .sort((a, b) => b.weightPercent - a.weightPercent)
    .slice(0, 5)
    .map((h) => `${h.symbol} (${h.assetType}) ${h.weightPercent.toFixed(1)}%`);
  return [
    `- Stocks ${(s?.stockWeightPercent ?? 0).toFixed(1)}%, ETFs ${(s?.etfWeightPercent ?? 0).toFixed(1)}%, Crypto ${(s?.cryptoWeightPercent ?? 0).toFixed(1)}%, Private and other ${(s?.otherWeightPercent ?? 0).toFixed(1)}%, Cash ${(s?.cashWeightPercent ?? 0).toFixed(1)}%`,
    `- Largest holdings: ${top.join(", ") || "none"}`,
  ].join("\n");
}

const MAX_FOLLOWUPS = 2;

// ── service ─────────────────────────────────────────────────────────────────

export class PortfolioBriefService {
  constructor(
    private readonly llm: LlmService,
    private readonly portfolioService: PortfolioService,
  ) {}

  private row(portfolioId: string): portfolioRepo.PortfolioRow {
    const row = portfolioRepo.findById(portfolioId);
    if (!row) throw new NotFoundError("Portfolio not found");
    return row;
  }

  public getBrief(portfolioId: string): GetPortfolioBriefResponse {
    const row = this.row(portfolioId);
    return { portfolioId, brief: readBrief(row), briefUpdatedAt: row.briefUpdatedAt };
  }

  /** The brief of a portfolio for prompts; null when it has none. */
  public briefOf(portfolioId: string): PortfolioBrief | null {
    const row = portfolioRepo.findById(portfolioId);
    return row ? readBrief(row) : null;
  }

  /** Saves a checked brief. Throws `BriefAmountError` when a text names an amount. */
  public saveBrief(portfolioId: string, raw: unknown): GetPortfolioBriefResponse {
    this.row(portfolioId);
    const brief = normalizeBrief(raw);
    const amounts = briefAmounts(brief);
    if (amounts.length > 0) throw new BriefAmountError(amounts);
    const { prose, ...structured } = brief;
    const empty = Object.keys(structured).length === 0;
    const saved = portfolioRepo.updateBrief(portfolioId, empty ? null : JSON.stringify(structured), prose ?? null);
    this.portfolioService.clearPortfolioCache(portfolioId);
    appLogger.logStep("info", "brief", "save", "Portfolio brief saved", undefined, { fields: Object.keys(brief).length });
    return { portfolioId, brief: saved ? readBrief(saved) : null, briefUpdatedAt: saved?.briefUpdatedAt ?? null };
  }

  private async allocation(portfolioId: string): Promise<string> {
    const row = this.row(portfolioId);
    const data = await this.portfolioService.getPortfolioData(portfolioId, row.baseCurrency || loadConfig().baseCurrency || "EUR");
    return allocationForPrompt(data);
  }

  /**
   * At most two follow-up questions where the answers conflict with each
   * other or with the allocation. An empty list is the usual answer.
   */
  public async followups(portfolioId: string, answers: Answers): Promise<BriefWizardFollowupResponse> {
    assertNoAmounts(answerTexts(answers));
    const language = loadConfig().language;
    const draft = briefFromAnswers(answers);
    const system = withLanguageInstruction(
      `You help an investor describe the purpose and goal of one portfolio. You see their answers to fixed questions and the allocation in percent.
Ask at most ${MAX_FOLLOWUPS} short follow-up questions, only where two answers conflict or an answer conflicts with the allocation. Example: "capital preservation" while 40% sits in one stock.
Most of the time nothing conflicts. Then return an empty list.
Never ask about money amounts. Ask for percentages when you need a size.
Each question is one sentence. "options" lists 2 to 4 short answer choices.
Use ${plainStyle(language)}. No emojis, no long dashes.
Reply with one JSON object and nothing else: {"followups": [{"question": "...", "options": ["...", "..."]}]}`,
      language,
      { jsonFields: ["question", "options"] },
    );
    const user = `## Answers\n${formatBriefForPrompt(draft) || "- No answers"}\n\n## Allocation\n${await this.allocation(portfolioId)}`;
    let reply: string;
    try {
      reply = await this.llm.chat([
        { role: "system", content: toPromptSafe(system) },
        { role: "user", content: toPromptSafe(user) },
      ], { temperature: 0.2, maxTokens: 800 });
    } catch (err) {
      // The follow-ups are optional: the wizard goes on to the draft without them.
      appLogger.logStep("warning", "brief", "followups", `Brief follow-ups failed (${err instanceof Error ? err.name : typeof err})`);
      return { followups: [] };
    }
    let raw: Record<string, unknown>;
    try {
      raw = extractJsonObject(reply);
    } catch {
      return { followups: [] };
    }
    const list = Array.isArray(raw.followups) ? raw.followups : [];
    const followups: BriefWizardFollowupResponse["followups"] = [];
    for (const item of list) {
      const o = obj(item);
      const question = sanitizeLlmResponse(str(o.question)).slice(0, 240);
      if (!question) continue;
      const options = Array.isArray(o.options) ? o.options.map((x) => sanitizeLlmResponse(str(x)).slice(0, 80)).filter(Boolean).slice(0, 4) : [];
      followups.push({ id: `f${followups.length + 1}`, question, options: options.length ? options : undefined });
      if (followups.length >= MAX_FOLLOWUPS) break;
    }
    return { followups };
  }

  /** The structured brief from the answers plus a prose draft from the model. The user edits it before saving. */
  public async draft(portfolioId: string, answers: Answers, followupAnswers: Answers = {}): Promise<BriefWizardDraftResponse> {
    assertNoAmounts(answerTexts(answers, followupAnswers));
    const language = loadConfig().language;
    const brief = briefFromAnswers(answers);
    const extra = Object.entries(followupAnswers)
      .map(([, v]) => obj(v))
      .filter((v) => str(v.question) && str(v.answer))
      .map((v) => `- ${str(v.question)} ${str(v.answer)}`)
      .join("\n");
    const system = withLanguageInstruction(
      `You write the brief of one investment portfolio from the owner's answers: what the portfolio is for and what success looks like.
Write 3 to 5 sentences in the first person, as the owner. Cover the purpose, the horizon, the risk the owner accepts, income needs, and the constraints that were given.
Use only the answers. Do not invent goals, numbers or holdings. Never write money amounts; percentages are allowed.
Use ${plainStyle(language)}. No emojis, no long dashes, no headings, no lists. Reply with the brief text only.`,
      language,
    );
    const user = `## Answers\n${formatBriefForPrompt(brief) || "- No answers"}${extra ? `\n\n## Follow-up answers\n${extra}` : ""}\n\n## Allocation, for context only\n${await this.allocation(portfolioId)}`;
    let prose = "";
    try {
      prose = sanitizeLlmResponse(
        await this.llm.chat([
          { role: "system", content: toPromptSafe(system) },
          { role: "user", content: toPromptSafe(user) },
        ], { temperature: 0.3, maxTokens: 900 }),
      ).replace(/[–—]/g, "-").trim();
    } catch (err) {
      appLogger.logStep("warning", "brief", "draft", `Brief draft failed (${err instanceof Error ? err.name : typeof err})`);
    }
    // A draft that names an amount is dropped: the user writes the prose instead.
    if (prose && scanForAmounts(prose).hasAmounts) prose = "";
    return { prose, brief: normalizeBrief({ ...brief, prose }) };
  }
}

/** Ids of the fixed wizard questions, for request validation. */
export const WIZARD_QUESTION_IDS: ReadonlySet<string> = new Set(BRIEF_WIZARD_QUESTIONS.map((q) => q.id));
