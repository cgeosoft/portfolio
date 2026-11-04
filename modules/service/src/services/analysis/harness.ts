/**
 * The Guided Analysis harness: runs one analysis through its fixed phases.
 *
 *   seed -> survey -> expand (loop) -> synthesise -> suggest -> report
 *
 * The app owns the loop. The model is called inside a phase to pick tool
 * calls or to write reasoning nodes; it never controls the sequence, the
 * budgets or what is stored. After every model turn the harness validates:
 * unknown tools and bad arguments go back as errors, a reasoning node that
 * cites missing ids is dropped, and every number in a finding, theme or
 * report must exist in a cited node (one repair turn, then the claim goes).
 *
 * Every step is stored, and the phase and counters are saved after each one,
 * so a restart resumes from the last finished step. A tool failure becomes a
 * failed node the model can see, never a crashed run. When the model fails a
 * phase the harness falls back (default questions, a report built from the
 * findings) so a run still ends with what it found.
 */
import type { AnalysisNode, AnalysisNodeKind, AnalysisPhase } from "portfolio-shared/api-types";
import { isBriefField } from "portfolio-shared/brief";
import type { FinancialPortfolioData, PortfolioBrief } from "portfolio-shared/portfolio";
import type { SuggestionEvidence } from "portfolio-shared/suggestions";
import * as analysisRepo from "../../db/analysis.repo.js";
import * as reportRepo from "../../db/report.repo.js";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import { appLogger } from "../../logger.js";
import { t } from "../../i18n.js";
import { localDate } from "../daily-brief.js";
import { sanitizeLlmResponse } from "../llm.js";
import { getIsoWeekKey } from "../portfolio-report.js";
import { describeHolding, heldHoldings, NEW_POSITION_CASH_PERCENT, type PortfolioSuggestionService } from "../portfolio-suggestions.js";
import { compareRuns } from "./compare.js";
import { citableIds, graphContext, nodeLine, openQuestions } from "./context.js";
import { cutText, type RunGraph } from "./graph.js";
import { dropUngroundedSentences, nodeNumbers, sourcesFor, ungroundedNumbers } from "./grounding.js";
import type { ModelPort, PortRequest, PortTurn } from "./model-port.js";
import {
  EXPAND_OUTPUT,
  REPORT_OUTPUT,
  SUGGEST_OUTPUT,
  SURVEY_OUTPUT,
  SYNTHESISE_OUTPUT,
  defaultQuestions,
  expandSystem,
  reportSystem,
  suggestSystem,
  surveySystem,
  synthesiseSystem,
} from "./phases.js";
import { seedContext, seedCore } from "./seed.js";
import { ANALYSIS_TOOLS, findTool } from "./tools/index.js";
import { ToolInputError, type AnalysisDeps, type AnalysisTool, type ToolCall, type ToolContext } from "./types.js";

/** Budgets of one run. Expand stops at the first one reached; later phases always run on what exists. */
export const BUDGET = {
  expandSteps: 12,
  toolCalls: 40,
  nodes: 150,
  depth: 3,
  durationMs: 10 * 60_000,
  callsPerStep: 6,
  openQuestions: 10,
  focus: 3,
  /** Steps a question may stay in focus without progress before it is closed. */
  stalls: 2,
  /** Model failures in a row that end the expand loop. */
  failures: 2,
  /** Parallel tool calls. */
  parallel: 4,
} as const;

export const PHASE_ORDER: readonly AnalysisPhase[] = ["seed", "survey", "expand", "synthesise", "suggest", "report", "done"];

/** Harness state saved with the run, so a restart resumes where it stopped. */
export interface RunState {
  expandSteps: number;
  toolCalls: number;
  toolUse: Record<string, number>;
  /** `name|args` of the calls already run. */
  callKeys: string[];
  stalls: Record<string, number>;
  lastErrors: string[];
  modelCalls: number;
  modelFailures: number;
  consecutiveFailures: number;
  notes: string[];
  startedAtMs: number;
}

export function newRunState(): RunState {
  return { expandSteps: 0, toolCalls: 0, toolUse: {}, callKeys: [], stalls: {}, lastErrors: [], modelCalls: 0, modelFailures: 0, consecutiveFailures: 0, notes: [], startedAtMs: Date.now() };
}

export interface HarnessDeps {
  deps: AnalysisDeps;
  suggestions: PortfolioSuggestionService;
  /** The seed fetches (macro, exposure); tests pass an offline stand-in. */
  seedContext?: (ctx: ToolContext) => Promise<string[]>;
}

export interface HarnessSetup {
  row: analysisRepo.AnalysisRunRow;
  graph: RunGraph;
  state: RunState;
  port: ModelPort;
  data: FinancialPortfolioData;
  brief: PortfolioBrief;
  language: string | undefined;
  signal: AbortSignal;
  onLive: (phase: AnalysisPhase, message: string) => void;
}

class RunCancelled extends Error {
  constructor() {
    super("The run was cancelled");
    this.name = "RunCancelled";
  }
}

const FAILED_KIND: Record<string, AnalysisNodeKind> = {
  get_indicators: "indicator",
  get_company: "company",
  get_holding_news: "news",
  get_market_news: "news",
  get_macro: "macro",
  get_events: "event",
  run_metric: "metric",
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : []);
const text = (v: unknown, max: number): string => (typeof v === "string" ? cutText(sanitizeLlmResponse(v), max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No answer within ${Math.round(ms / 1000)} s`)), ms);
    const onAbort = () => reject(new RunCancelled());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    });
  });
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

interface ParsedFinding {
  questionId?: string;
  title: string;
  summary: string;
  stance: "risk" | "opportunity" | "neutral";
  severity: number;
  briefField: string;
  supports: string[];
  contradicts: string[];
}

export class RunHarness {
  private readonly graph: RunGraph;
  private readonly state: RunState;
  private readonly port: ModelPort;
  private readonly data: FinancialPortfolioData;
  private readonly brief: PortfolioBrief;
  private readonly language: string | undefined;
  private readonly signal: AbortSignal;
  private readonly onLive: HarnessSetup["onLive"];
  private readonly memo = new Map<string, Promise<unknown>>();
  private row: analysisRepo.AnalysisRunRow;

  constructor(
    setup: HarnessSetup,
    private readonly h: HarnessDeps,
  ) {
    this.row = setup.row;
    this.graph = setup.graph;
    this.state = setup.state;
    this.port = setup.port;
    this.data = setup.data;
    this.brief = setup.brief;
    this.language = setup.language;
    this.signal = setup.signal;
    this.onLive = setup.onLive;
  }

  private get today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private checkAbort(): void {
    if (this.signal.aborted) throw new RunCancelled();
  }

  private timeLeft(): boolean {
    return Date.now() - this.state.startedAtMs < BUDGET.durationMs;
  }

  private note(message: string): void {
    if (!this.state.notes.includes(message)) this.state.notes.push(message);
  }

  /** Saves the graph, the counters and the state. */
  private save(patch: Partial<analysisRepo.AnalysisRunRow> = {}): void {
    this.graph.flush();
    const update = {
      ...patch,
      toolCount: this.state.toolCalls,
      nodeCount: this.graph.size,
      notes: JSON.stringify(this.state.notes),
      stateJson: JSON.stringify(this.state),
    };
    analysisRepo.updateRun(this.row.id, update);
    this.row = { ...this.row, ...update } as analysisRepo.AnalysisRunRow;
  }

  /** Runs the phases from the stored one to the end. Throws `RunCancelled` on cancel. */
  async execute(): Promise<void> {
    let index = Math.max(0, PHASE_ORDER.indexOf(this.row.phase));
    while (PHASE_ORDER[index] !== "done") {
      this.checkAbort();
      const phase = PHASE_ORDER[index]!;
      this.onLive(phase, t(`service.analysis.live.${phase}`));
      if (phase === "seed") await this.seed();
      else if (phase === "survey") await this.survey();
      else if (phase === "expand") await this.expand();
      else if (phase === "synthesise") await this.synthesise();
      else if (phase === "suggest") await this.suggest();
      else if (phase === "report") await this.report();
      index++;
      this.save({ phase: PHASE_ORDER[index]! });
      // A run whose model never answered stops before it writes suggestions or a report.
      if (phase === "expand" && this.state.modelCalls > 0 && this.state.modelFailures === this.state.modelCalls) {
        throw new Error("The model did not answer any step of the run");
      }
    }
    if (this.state.modelCalls > 0 && this.state.modelFailures === this.state.modelCalls) throw new Error("The model did not answer any step of the run");
  }

  // ── model steps ───────────────────────────────────────────────────────────

  /** One model turn, stored as a step. Null when the model failed; the error type goes to the log. */
  private async modelStep(phase: AnalysisPhase, req: Omit<PortRequest, "signal">, summary: string): Promise<PortTurn | null> {
    this.checkAbort();
    const started = Date.now();
    const stepIndex = this.row.stepCount;
    this.state.modelCalls++;
    let turn: PortTurn | null = null;
    let failure = "";
    try {
      turn = await this.port.step({ ...req, signal: this.signal });
      this.state.consecutiveFailures = 0;
    } catch (err) {
      if (this.signal.aborted) throw new RunCancelled();
      this.state.modelFailures++;
      this.state.consecutiveFailures++;
      failure = err instanceof Error ? err.message : String(err);
      appLogger.logStep("warning", "analysis", `step_${phase}`, `Model step failed (${err instanceof Error ? err.name : typeof err})`);
    }
    analysisRepo.insertStep({
      runId: this.row.id,
      stepIndex,
      phase,
      requestSummary: summary,
      actions: turn ? { calls: turn.calls.map((c) => ({ name: c.name, args: c.args, questionId: c.questionId })), output: turn.output } : undefined,
      results: turn ? { errors: turn.errors } : { error: cutText(failure, 300) },
      note: turn?.note || undefined,
      durationMs: Date.now() - started,
      createdAt: new Date().toISOString(),
    });
    this.save({ stepCount: stepIndex + 1 });
    if (turn?.note) this.onLive(phase, turn.note);
    return turn;
  }

  // ── tools ─────────────────────────────────────────────────────────────────

  /** Tools with calls left in this run. */
  private availableTools(): AnalysisTool[] {
    if (this.state.toolCalls >= BUDGET.toolCalls || this.graph.size >= BUDGET.nodes) return [];
    return ANALYSIS_TOOLS.filter((tool) => (this.state.toolUse[tool.name] ?? 0) < tool.maxCallsPerRun && (tool.name !== "run_metric" || this.installedMetrics().length > 0));
  }

  private installedMetrics(): { id: string; name: string }[] {
    try {
      return (this.h.deps.metricsService?.getCatalog().installed ?? []).filter((m) => m.status === "ready").map((m) => ({ id: m.id, name: m.manifest.name }));
    } catch {
      return [];
    }
  }

  /** Runs the calls of one step in parallel. Returns the new node ids and the errors for the next prompt. */
  private async runCalls(calls: readonly ToolCall[]): Promise<{ nodeIds: string[]; errors: string[]; served: Set<string> }> {
    const errors: string[] = [];
    const served = new Set<string>();
    const accepted: { call: ToolCall; tool: AnalysisTool }[] = [];
    for (const call of calls) {
      const tool = findTool(call.name);
      if (!tool) {
        errors.push(`Unknown tool "${call.name}".`);
        continue;
      }
      const key = `${call.name}|${JSON.stringify(call.args, Object.keys(call.args).sort())}`;
      if (this.state.callKeys.includes(key)) {
        errors.push(`${call.name} with these arguments already ran; its result is in the graph.`);
        if (call.questionId) served.add(call.questionId);
        continue;
      }
      if (accepted.length >= BUDGET.callsPerStep || this.state.toolCalls + accepted.length >= BUDGET.toolCalls) {
        errors.push(`Tool budget reached; ${call.name} was not run.`);
        continue;
      }
      if ((this.state.toolUse[tool.name] ?? 0) + accepted.filter((a) => a.tool === tool).length >= tool.maxCallsPerRun) {
        errors.push(`${call.name} reached its limit for this run.`);
        continue;
      }
      this.state.callKeys.push(key);
      accepted.push({ call, tool });
    }

    const nodeIds: string[] = [];
    await mapLimit(accepted, BUDGET.parallel, async ({ call, tool }) => {
      this.checkAbort();
      this.state.toolCalls++;
      this.state.toolUse[tool.name] = (this.state.toolUse[tool.name] ?? 0) + 1;
      const question = call.questionId ? this.graph.get(call.questionId) : undefined;
      const q = question?.kind === "question" ? question : undefined;
      if (q) served.add(q.id);
      const ctx: ToolContext = {
        runId: this.row.id,
        portfolioId: this.row.portfolioId,
        baseCurrency: this.row.baseCurrency,
        data: this.data,
        deps: this.h.deps,
        graph: this.graph,
        memo: this.memo,
        depth: Math.min(BUDGET.depth, (q?.depth ?? 1) + 1),
        relevance: Math.max(0.3, (q?.relevance ?? 0.7) * 0.9),
        signal: this.signal,
      };
      this.onLive("expand", t("service.analysis.live.tool", { tool: tool.name }));
      try {
        const nodes = await withTimeout(tool.run(call.args, ctx), tool.timeoutMs, this.signal);
        for (const node of nodes) {
          nodeIds.push(node.id);
          if (q) this.graph.addEdge(node.id, q.id, "answers", `Fetched for ${q.id}`);
        }
      } catch (err) {
        if (err instanceof RunCancelled || this.signal.aborted) throw new RunCancelled();
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof ToolInputError) {
          errors.push(`${call.name}: ${message}`);
          return;
        }
        // The model sees the failure as a node, so it does not ask again.
        const failed = this.graph.addNode({
          kind: FAILED_KIND[tool.name] ?? "calc",
          title: `${tool.name} ${typeof call.args.symbol === "string" ? call.args.symbol : ""}`.trim(),
          facts: { tool: tool.name, error: cutText(message, 200) },
          summary: cutText(message, 200),
          createdBy: tool.name,
          depth: ctx.depth,
          relevance: 0.1,
          status: "failed",
        });
        nodeIds.push(failed.id);
        if (q) this.graph.addEdge(failed.id, q.id, "answers", "No data");
        appLogger.logStep("warning", "analysis", "tool_failed", `Analysis tool ${tool.name} failed (${err instanceof Error ? err.name : typeof err})`);
      }
    });
    this.graph.flush();
    return { nodeIds, errors, served };
  }

  // ── reasoning nodes ───────────────────────────────────────────────────────

  private addQuestion(title: string, briefField: string, why: string, parent?: AnalysisNode): AnalysisNode | null {
    const clean = text(title, 200);
    if (!clean) return null;
    const open = openQuestions(this.graph);
    if (open.length >= BUDGET.openQuestions) return null;
    if (open.some((q) => q.title.toLowerCase() === clean.toLowerCase())) return null;
    const depth = parent ? Math.min(BUDGET.depth - 1, parent.depth + 1) : 1;
    const field = isBriefField(briefField) ? briefField : "general";
    const node = this.graph.addNode({
      kind: "question",
      title: clean,
      facts: { briefField: field, status: "open", ...(parent ? { parentId: parent.id } : {}) },
      summary: text(why, 300) || clean,
      createdBy: `model:${this.port.mode}`,
      depth,
      relevance: parent ? Math.max(0.5, parent.relevance - 0.1) : Math.max(0.6, 0.95 - 0.05 * this.graph.byKind("question").length),
    });
    this.graph.addEdge(node.id, parent?.id ?? "B", "derived_from", text(why, 200) || (parent ? "Narrower question" : `About the ${field} of the brief`));
    return node;
  }

  private closeQuestion(id: string, outcome: "answered" | "unanswered"): void {
    const q = this.graph.get(id);
    if (!q || q.kind !== "question" || q.facts.status === "closed") return;
    this.graph.updateNode(id, { facts: { ...q.facts, status: "closed", outcome } });
  }

  /** Reads one finding and checks its citations and numbers. */
  private parseFinding(raw: unknown, allowed: Set<string>): { finding?: ParsedFinding; error?: string } {
    const o = obj(raw);
    const title = text(o.title, 140);
    const summary = text(o.summary, 300);
    if (!title || !summary) return { error: "A finding needs a title and a summary." };
    const supports = strings(o.supports).filter((id) => allowed.has(id));
    const contradicts = strings(o.contradicts).filter((id) => allowed.has(id) && !supports.includes(id));
    const missing = strings(o.supports).filter((id) => !allowed.has(id));
    if (supports.filter((id) => id !== "B").length === 0) {
      return { error: `Finding "${title}" cites no existing fact node${missing.length ? ` (unknown ids: ${missing.join(", ")})` : ""}. Cite the node ids in brackets.` };
    }
    const sources = sourcesFor([...supports, ...contradicts].map((id) => this.graph.get(id)), [this.graph.get("B"), this.graph.get("A")]);
    const bad = ungroundedNumbers(`${title} ${summary}`, sources);
    if (bad.length) return { error: `Finding "${title}" uses numbers that are in none of its cited nodes: ${bad.join(", ")}. Use only numbers from the cited nodes, or cite the node that has them.` };
    const stance = o.stance === "risk" || o.stance === "opportunity" ? o.stance : "neutral";
    const severity = Math.min(3, Math.max(1, Math.round(Number(o.severity) || 2)));
    const qid = typeof o.questionId === "string" ? o.questionId.trim() : undefined;
    return {
      finding: { questionId: qid, title, summary, stance, severity, briefField: isBriefField(o.briefField) ? o.briefField : "general", supports, contradicts },
    };
  }

  private addFinding(f: ParsedFinding): AnalysisNode {
    const q = f.questionId ? this.graph.get(f.questionId) : undefined;
    const question = q?.kind === "question" ? q : undefined;
    const cited = [...f.supports, ...f.contradicts].map((id) => this.graph.get(id)).filter((n): n is AnalysisNode => Boolean(n));
    const symbols = [...new Set(cited.map((n) => n.facts.symbol).filter((s): s is string => typeof s === "string"))];
    const briefField = f.briefField !== "general" ? f.briefField : String(question?.facts.briefField ?? "general");
    const node = this.graph.addNode({
      kind: "finding",
      title: f.title,
      facts: { stance: f.stance, severity: f.severity, briefField, symbols, supports: f.supports, contradicts: f.contradicts, ...(question ? { questionId: question.id } : {}) },
      summary: f.summary,
      createdBy: `model:${this.port.mode}`,
      depth: Math.min(BUDGET.depth, Math.max(2, ...cited.map((n) => n.depth))),
      relevance: 0.6 + 0.1 * f.severity,
    });
    for (const id of f.supports) this.graph.addEdge(id, node.id, "supports", "");
    for (const id of f.contradicts) this.graph.addEdge(id, node.id, "contradicts", "");
    this.graph.addEdge(node.id, "B", "against_goal", briefField === "general" ? "Measured against the brief" : `About the ${briefField} of the brief`);
    if (question) {
      this.graph.addEdge(node.id, question.id, "answers", "");
      this.closeQuestion(question.id, "answered");
    }
    // Facts a finding leans on move up in the ranking of later prompts.
    for (const n of cited) if (n.relevance < 0.75) this.graph.updateNode(n.id, { relevance: 0.75 });
    return node;
  }

  /** Adds the valid findings; one repair turn for the rest. Returns the ids added. */
  private async applyFindings(phase: AnalysisPhase, raw: unknown[]): Promise<string[]> {
    const allowed = citableIds(this.graph);
    const added: string[] = [];
    const errors: { raw: unknown; error: string }[] = [];
    for (const item of raw.slice(0, 6)) {
      const { finding, error } = this.parseFinding(item, allowed);
      if (finding) added.push(this.addFinding(finding).id);
      else if (error) errors.push({ raw: item, error });
    }
    if (errors.length === 0) return added;

    const turn = await this.modelStep(
      phase,
      {
        system: expandSystem(this.language),
        user: `Date: ${this.today}.\n\nSome findings were refused. Fix them and submit only the fixed findings; leave out any you cannot support.\n\n${errors.map((e) => `- ${e.error}\n  Refused: ${JSON.stringify(e.raw).slice(0, 600)}`).join("\n")}\n\n${graphContext(this.graph)}`,
        tools: [],
        output: { name: "fixed findings", description: "The refused findings, fixed.", schema: { type: "object", properties: { findings: EXPAND_OUTPUT.properties!.findings! } } },
      },
      `Repair ${errors.length} finding(s)`,
    );
    let dropped = errors.length;
    for (const item of (turn?.output && Array.isArray(turn.output.findings) ? turn.output.findings : []).slice(0, errors.length)) {
      const { finding } = this.parseFinding(item, citableIds(this.graph));
      if (finding) {
        added.push(this.addFinding(finding).id);
        dropped--;
      }
    }
    if (dropped > 0) this.note(t("service.analysis.notes.findingsDropped", { count: dropped }));
    return added;
  }

  // ── phases ────────────────────────────────────────────────────────────────

  private async seed(): Promise<void> {
    seedCore(this.graph, this.data, this.brief);
    this.graph.flush();
    const ctx: ToolContext = {
      runId: this.row.id,
      portfolioId: this.row.portfolioId,
      baseCurrency: this.row.baseCurrency,
      data: this.data,
      deps: this.h.deps,
      graph: this.graph,
      memo: this.memo,
      depth: 1,
      relevance: 0.8,
      signal: this.signal,
    };
    const missing = await (this.h.seedContext ?? seedContext)(ctx);
    if (missing.length) this.note(t("service.analysis.notes.seedMissing", { parts: missing.join(", ") }));
  }

  private async survey(): Promise<void> {
    const turn = await this.modelStep(
      "survey",
      {
        system: surveySystem(this.language),
        user: `Date: ${this.today}.\n\n${graphContext(this.graph)}\n\nOpen the questions now.`,
        tools: [],
        output: { name: "questions", description: "3 to 7 questions worth checking, each tied to a brief field.", schema: SURVEY_OUTPUT },
        maxTokens: 2000,
      },
      "Open the questions",
    );
    const list = turn?.output && Array.isArray(turn.output.questions) ? turn.output.questions : [];
    for (const item of list.slice(0, 7)) {
      const o = obj(item);
      this.addQuestion(String(o.title ?? ""), String(o.briefField ?? "general"), String(o.why ?? ""));
    }
    if (openQuestions(this.graph).length === 0) {
      for (const q of defaultQuestions(this.brief)) this.addQuestion(q.title, q.briefField, q.why);
      this.note(t("service.analysis.notes.defaultQuestions"));
    }
  }

  private async expand(): Promise<void> {
    while (this.state.expandSteps < BUDGET.expandSteps) {
      this.checkAbort();
      const open = openQuestions(this.graph);
      if (open.length === 0) break;
      if (!this.timeLeft()) {
        this.note(t("service.analysis.notes.timeBudget"));
        break;
      }
      if (this.state.consecutiveFailures >= BUDGET.failures) {
        this.note(t("service.analysis.notes.modelFailures"));
        break;
      }
      const focus = open.slice(0, BUDGET.focus);
      const tools = this.availableTools();
      const metrics = tools.some((tool) => tool.name === "run_metric") ? this.installedMetrics() : [];
      this.state.expandSteps++;
      const errors = this.state.lastErrors;
      const user = [
        `Date: ${this.today}. Step ${this.state.expandSteps} of at most ${BUDGET.expandSteps}. Tool calls left: ${Math.max(0, BUDGET.toolCalls - this.state.toolCalls)}.`,
        errors.length ? `## Problems with your last step\n${errors.map((e) => `- ${e}`).join("\n")}` : "",
        `## Focus questions\n${focus.map((q) => nodeLine(q)).join("\n")}`,
        graphContext(this.graph, { focus: focus.map((q) => q.id) }),
        metrics.length ? `## Installed metrics for run_metric\n${metrics.map((m) => `- ${m.id}: ${m.name}`).join("\n")}` : "",
        tools.length === 0 ? "No tool calls are left. Write findings from the evidence you have, or close the questions." : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const turn = await this.modelStep(
        "expand",
        {
          system: expandSystem(this.language),
          user,
          tools,
          output: { name: "step result", description: "Findings that answer focus questions, sub-questions, and questions to close. Leave a list empty when you have nothing for it.", schema: EXPAND_OUTPUT },
        },
        `Focus ${focus.map((q) => q.id).join(", ")}`,
      );
      if (!turn) continue;

      const progress = new Set<string>();
      const ran = turn.calls.length ? await this.runCalls(turn.calls) : { nodeIds: [], errors: [], served: new Set<string>() };
      ran.served.forEach((id) => progress.add(id));

      const output = turn.output ?? {};
      const before = new Set(open.filter((q) => q.facts.status !== "closed").map((q) => q.id));
      await this.applyFindings("expand", Array.isArray(output.findings) ? output.findings : []);
      for (const id of before) if (this.graph.get(id)?.facts.status === "closed") progress.add(id);

      for (const item of (Array.isArray(output.subQuestions) ? output.subQuestions : []).slice(0, 2)) {
        const o = obj(item);
        const parent = this.graph.get(String(o.parentId ?? ""));
        if (parent?.kind !== "question" || parent.depth >= BUDGET.depth - 1) continue;
        if (this.addQuestion(String(o.title ?? ""), String(o.briefField ?? parent.facts.briefField ?? "general"), "", parent)) progress.add(parent.id);
      }
      for (const id of strings(output.close)) {
        this.closeQuestion(id, "unanswered");
        progress.add(id);
      }

      // A question in focus twice without progress is closed, so the loop moves on.
      for (const q of focus) {
        if (progress.has(q.id)) {
          delete this.state.stalls[q.id];
          continue;
        }
        this.state.stalls[q.id] = (this.state.stalls[q.id] ?? 0) + 1;
        if (this.state.stalls[q.id]! >= BUDGET.stalls) this.closeQuestion(q.id, "unanswered");
      }
      this.state.lastErrors = [...turn.errors, ...ran.errors].slice(0, 8);
      this.save();
      if (turn.done && turn.calls.length === 0) break;
    }
    if (this.state.expandSteps >= BUDGET.expandSteps && openQuestions(this.graph).length) this.note(t("service.analysis.notes.stepBudget"));
    if (this.state.toolCalls >= BUDGET.toolCalls) this.note(t("service.analysis.notes.toolBudget"));
    for (const q of openQuestions(this.graph)) this.closeQuestion(q.id, "unanswered");
  }

  private async synthesise(): Promise<void> {
    if (this.graph.byKind("finding").length === 0 && this.graph.size < 8) return;
    const turn = await this.modelStep(
      "synthesise",
      {
        system: synthesiseSystem(this.language),
        user: `Date: ${this.today}.\n\n${graphContext(this.graph)}\n\nName the themes now.`,
        tools: [],
        output: { name: "synthesis", description: "Themes across holdings and facts, and findings that only show across questions.", schema: SYNTHESISE_OUTPUT },
      },
      "Themes and cross-cutting findings",
    );
    if (!turn?.output) return;
    const allowed = citableIds(this.graph);
    let dropped = 0;
    for (const item of (Array.isArray(turn.output.themes) ? turn.output.themes : []).slice(0, 4)) {
      const o = obj(item);
      const title = text(o.title, 100);
      const summary = text(o.summary, 300);
      const cites = strings(o.cites).filter((id) => allowed.has(id) && id !== "B");
      const holdings = strings(o.holdings).map((s) => this.graph.holding(s)).filter((n): n is AnalysisNode => Boolean(n));
      const sources = sourcesFor(cites.map((id) => this.graph.get(id)), [this.graph.get("A"), ...holdings]);
      if (!title || cites.length < 2 || ungroundedNumbers(`${title} ${summary}`, sources).length) {
        dropped++;
        continue;
      }
      const theme = this.graph.addNode({
        kind: "theme",
        title,
        facts: { cites, symbols: holdings.map((n) => String(n.facts.symbol)) },
        summary: summary || title,
        createdBy: `model:${this.port.mode}`,
        depth: 2,
        relevance: 0.7,
      });
      for (const id of cites) this.graph.addEdge(id, theme.id, "supports", "");
      for (const n of holdings) this.graph.addEdge(n.id, theme.id, "exposes", "");
    }
    if (dropped) this.note(t("service.analysis.notes.themesDropped", { count: dropped }));
    await this.applyFindings("synthesise", Array.isArray(turn.output.findings) ? turn.output.findings : []);
  }

  private async suggest(): Promise<void> {
    const findings = this.graph.byKind("finding").filter((f) => f.status === "ready");
    const now = new Date();
    const keys = this.h.suggestions.promptKeys(this.row.portfolioId, this.data);
    const holdings = heldHoldings(this.data).sort((a, b) => b.weightPercent - a.weightPercent);
    const cash = this.data.summary?.cashWeightPercent ?? 0;
    const user = [
      `Date: ${this.today}. Base currency: ${this.row.baseCurrency}.`,
      `## Holdings ledger\n${holdings.map(describeHolding).join("\n") || "- No holdings"}\n- Cash: ${cash.toFixed(2)}%`,
      findings.length ? `## Findings of this run\n${findings.map((f) => nodeLine(f)).join("\n")}` : "## Findings of this run\nNone. Return an empty list.",
      keys.openKeys.length ? `## Open suggestions\nRepeat one with the same action and symbol only if it still applies:\n${keys.openKeys.map((k) => `- ${k}`).join("\n")}` : "",
      keys.dismissedKeys.length ? `## Dismissed suggestions\nThe user rejected these. Do not suggest them again:\n${keys.dismissedKeys.map((k) => `- ${k}`).join("\n")}` : "",
      cash >= NEW_POSITION_CASH_PERCENT ? `Cash is ${cash.toFixed(2)}% of the portfolio. "open" may fill a clear gap the findings show.` : "",
      graphContext(this.graph, { budget: 8_000 }),
    ]
      .filter(Boolean)
      .join("\n\n");
    const turn = findings.length
      ? await this.modelStep(
          "suggest",
          {
            system: suggestSystem(this.language),
            user,
            tools: [],
            output: { name: "suggestions", description: "Rebalancing actions, each acting on findings of this run, or an empty list.", schema: SUGGEST_OUTPUT },
          },
          `Suggestions from ${findings.length} finding(s)`,
        )
      : null;

    const findingIds = new Set(findings.map((f) => f.id));
    const allowed = citableIds(this.graph);
    const rawList = turn?.output && Array.isArray(turn.output.suggestions) ? turn.output.suggestions : [];
    const kept: Record<string, unknown>[] = [];
    const evidence = new Map<string, SuggestionEvidence>();
    let noFinding = 0;
    for (const item of rawList) {
      const o = obj(item);
      const acts = strings(o.findings).filter((id) => findingIds.has(id));
      if (acts.length === 0) {
        noFinding++;
        continue;
      }
      const nodes = strings(o.evidence).filter((id) => allowed.has(id) && !findingIds.has(id));
      const goal = isBriefField(o.goal) ? o.goal : undefined;
      kept.push(o);
      if (typeof o.symbol === "string") evidence.set(o.symbol.trim().toUpperCase(), { findings: acts, nodes, goal });
    }
    const extraNotes = noFinding ? [t("service.analysis.notes.suggestionsWithoutFinding", { count: noFinding })] : [];
    if (!turn && findings.length) this.note(t("service.analysis.notes.suggestFailed"));

    // A failed step leaves the stored suggestions as they are; an answer, even an empty one, replaces them.
    // No findings after model failures says nothing about the portfolio, so the list stays too.
    if (!turn && (findings.length > 0 || this.state.modelFailures > 0)) return;
    const summary = typeof turn?.output?.summary === "string" ? turn.output.summary : findings.length ? "" : t("service.analysis.noFindingsSummary");
    const result = await this.h.suggestions.applyAnswer(this.row.portfolioId, this.row.baseCurrency, this.data, { summary, suggestions: kept }, {
      now,
      fingerprint: this.row.txFingerprint,
      provider: this.row.provider ?? "",
      model: this.row.model ?? null,
      runId: this.row.id,
      evidence,
      extraNotes,
    });
    for (const n of extraNotes) this.note(n);

    for (const s of result.kept) {
      const ev = s.evidence;
      const node = this.graph.addNode({
        kind: "suggestion",
        title: s.title,
        facts: { suggestionId: s.id, action: s.action, symbol: s.symbol, fromWeightPercent: s.fromWeight, targetWeightPercent: s.targetWeight, goal: ev?.goal ?? "general" },
        summary: s.why || s.title,
        createdBy: `model:${this.port.mode}`,
        depth: BUDGET.depth + 1,
        relevance: 0.8,
      });
      for (const id of ev?.findings ?? []) this.graph.addEdge(id, node.id, "motivates", "");
      for (const id of ev?.nodes ?? []) this.graph.addEdge(id, node.id, "supports", "");
      const holding = this.graph.holding(s.symbol);
      if (holding) this.graph.addEdge(node.id, holding.id, "about", "");
    }
  }

  private async report(): Promise<void> {
    const findings = this.graph.byKind("finding").filter((f) => f.status === "ready").sort((a, b) => Number(b.facts.severity) - Number(a.facts.severity));
    const suggestions = this.graph.byKind("suggestion");
    const previous = analysisRepo.findPreviousCompleted(this.row.portfolioId, this.row.startedAt);
    const comparison = compareRuns(this.row.id, this.graph.nodes, previous?.id, previous ? analysisRepo.listNodes(previous.id) : null);
    const changes = previous
      ? [
          comparison.newFindings.length ? `New findings: ${comparison.newFindings.map((f) => `[${f.id}] ${f.title}`).join("; ")}` : "No new findings.",
          comparison.resolvedFindings.length ? `Resolved since the last run: ${comparison.resolvedFindings.map((f) => f.title).join("; ")}` : "No finding was resolved.",
          comparison.changedWeights.length
            ? `Weight moves: ${comparison.changedWeights.slice(0, 6).map((w) => `${w.symbol} ${w.previousWeight.toFixed(1)}% to ${w.currentWeight.toFixed(1)}%`).join(", ")}`
            : "No weight moved by 1 point or more.",
        ].join("\n")
      : "This is the first run; there is nothing to compare.";
    const turn = await this.modelStep(
      "report",
      {
        system: reportSystem(this.language),
        user: [
          `Date: ${this.today}.`,
          `## Findings\n${findings.map((f) => nodeLine(f)).join("\n") || "None."}`,
          `## Suggestions\n${suggestions.map((s) => nodeLine(s)).join("\n") || "None."}`,
          `## Comparison with the last run\n${changes}`,
          graphContext(this.graph, { budget: 8_000 }),
        ].join("\n\n"),
        tools: [],
        output: { name: "report", description: "The parts of the short state report.", schema: REPORT_OUTPUT },
        maxTokens: 2500,
      },
      "Short state report",
    );

    const sources = [
      ...this.graph.nodes.filter((n) => n.status === "ready").flatMap(nodeNumbers),
      ...comparison.changedWeights.flatMap((w) => [w.previousWeight, w.currentWeight, w.diff]),
    ];
    const clean = (value: unknown, max: number) => {
      const raw = text(value, max);
      const grounded = dropUngroundedSentences(raw, sources);
      if (grounded !== raw) this.note(t("service.analysis.notes.reportTrimmed"));
      return grounded;
    };
    const out = turn?.output ?? {};
    const findingById = new Map(findings.map((f) => [f.id, f]));
    let stand = clean(out.whereYouStand, 700);
    const matters = (Array.isArray(out.matters) ? out.matters : [])
      .map((m) => obj(m))
      .map((m) => ({ finding: findingById.get(String(m.findingId ?? "")), text: clean(m.text, 400) }))
      .filter((m): m is { finding: AnalysisNode; text: string } => Boolean(m.finding && m.text))
      .slice(0, 3);
    let changed = previous ? clean(out.changed, 500) : "";
    const actionText = new Map(
      (Array.isArray(out.actions) ? out.actions : []).map((a) => obj(a)).map((a) => [String(a.suggestionId ?? ""), clean(a.text, 240)] as const),
    );

    // Without a model answer the report is built from the findings themselves.
    if (!stand) stand = findings[0] ? findings[0].summary : t("service.analysis.noFindingsSummary");
    const top = matters.length ? matters : findings.slice(0, 3).map((f) => ({ finding: f, text: f.summary }));
    if (previous && !changed) {
      changed = t("service.analysis.report.changedFallback", { added: comparison.newFindings.length, resolved: comparison.resolvedFindings.length, moved: comparison.changedWeights.length });
    }

    const link = (n: AnalysisNode) => `[${n.id}](#node/${n.id})`;
    const cites = (f: AnalysisNode) => strings(f.facts.supports).slice(0, 3).map((id) => this.graph.get(id)).filter((n): n is AnalysisNode => Boolean(n)).map(link);
    const markdown = [
      `## ${t("service.analysis.report.whereYouStand")}`,
      stand,
      `## ${t("service.analysis.report.whatMatters")}`,
      top.length ? top.map((m, i) => `${i + 1}. **${m.finding.title}** ${m.text} (${[link(m.finding), ...cites(m.finding)].join(", ")})`).join("\n") : t("service.analysis.report.nothingMatters"),
      `## ${t("service.analysis.report.whatChanged")}`,
      previous ? changed : t("service.analysis.report.firstRun"),
      `## ${t("service.analysis.report.actions")}`,
      suggestions.length
        ? suggestions.map((s) => `- ${actionText.get(s.id) || s.title} (${link(s)})`).join("\n")
        : t("service.analysis.report.noActions"),
    ].join("\n\n");

    const portfolio = portfolioRepo.findById(this.row.portfolioId);
    const now = new Date();
    const summary = this.data.summary;
    const day = localDate(now);
    reportRepo.upsert({
      id: `${this.row.portfolioId}_run_${this.row.id}`,
      portfolioId: this.row.portfolioId,
      period: now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      weekStartDate: day,
      weekEndDate: day,
      weekKey: getIsoWeekKey(now),
      title: t("service.analysis.report.title", { portfolio: portfolio?.name ?? "", date: day }),
      summary: cutText(stand, 300),
      content: markdown,
      prompt: null,
      metrics: {
        totalPortfolioValue: summary?.totalPortfolioValue || summary?.totalValue || 0,
        weeklyGainLossDollar: summary?.dayGainLossDollar,
        weeklyGainLossPercent: summary?.dayGainLossPercent,
        cashBalance: summary?.cashBalance ?? 0,
        baseCurrency: this.row.baseCurrency,
        holdingsCount: heldHoldings(this.data).length,
        intelSources: [],
      },
      model: this.row.model ?? "",
      provider: this.row.provider ?? "",
      status: turn ? "success" : "fallback",
      isFallback: !turn,
      runId: this.row.id,
    });
    const reportNode = this.graph.addNode({
      id: "R1",
      kind: "report",
      title: t("service.analysis.report.nodeTitle"),
      facts: {},
      summary: stand,
      createdBy: turn ? `model:${this.port.mode}` : "harness",
      depth: BUDGET.depth + 1,
      relevance: 0.9,
    });
    for (const m of top) this.graph.addEdge(reportNode.id, m.finding.id, "derived_from", "");
    this.save({ summary: cutText(stand, 600) });
  }
}

export { RunCancelled };
