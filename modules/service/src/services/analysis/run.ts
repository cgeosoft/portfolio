/**
 * Guided Analysis runs: start, follow, cancel, resume, list and compare.
 *
 * A run needs an AI setup that answered a request (`LlmService.isReady`) and
 * a way to call tools: native tool calling, or JSON actions for the CLI
 * providers. A model without either cannot start a run. One run at a time
 * per portfolio; the GUI follows it by polling `get()`.
 *
 * Logs and telemetry carry counts only, never a symbol or an amount.
 */
import type {
  AiCapabilityResponse,
  AnalysisPhase,
  AnalysisRunListItem,
  CompareAnalysisRunsResponse,
  GetAnalysisRunResponse,
  ListAnalysisRunsResponse,
} from "portfolio-shared/api-types";
import { briefFingerprint } from "portfolio-shared/brief";
import type { PortfolioBrief, PortfolioReport } from "portfolio-shared/portfolio";
import * as analysisRepo from "../../db/analysis.repo.js";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import * as reportRepo from "../../db/report.repo.js";
import * as suggestionRepo from "../../db/suggestion.repo.js";
import type { ReportMetrics } from "../../db/report.repo.js";
import { loadConfig } from "../../config.js";
import { appLogger } from "../../logger.js";
import { NotFoundError, ServiceError } from "../errors.js";
import { sanitizeLlmResponse, type LlmService } from "../llm.js";
import { readBrief } from "../portfolio-brief.js";
import type { PortfolioService } from "../portfolio.js";
import type { PortfolioSuggestionService } from "../portfolio-suggestions.js";
import { telemetry } from "../telemetry.js";
import { compareRuns } from "./compare.js";
import { RunGraph, cutText } from "./graph.js";
import { RunCancelled, RunHarness, newRunState, type RunState } from "./harness.js";
import { createModelPort } from "./model-port.js";
import type { AnalysisDeps } from "./types.js";

/** A run left "running" by a stopped service resumes when it was updated this recently; older ones are marked failed. */
const RESUME_WINDOW_MS = 30 * 60_000;

/** Thrown when a run cannot start; `reason` is what the GUI shows. */
export class AnalysisUnavailableError extends ServiceError {
  constructor(public readonly reason: NonNullable<AiCapabilityResponse["reason"]>, message: string) {
    super(409, message);
    this.name = "AnalysisUnavailableError";
  }
}

interface ActiveRun {
  controller: AbortController;
  live: { phase: AnalysisPhase; message: string; since: string };
  done: Promise<void>;
}

function toReport(row: reportRepo.ReportRow): PortfolioReport {
  return {
    ...row,
    content: sanitizeLlmResponse(row.content),
    prompt: null,
    error: row.error ?? undefined,
    metrics: JSON.parse(row.metrics) as ReportMetrics,
    isFallback: Boolean(row.isFallback),
  };
}

export class AnalysisService {
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    private readonly llm: LlmService,
    private readonly portfolioService: PortfolioService,
    private readonly suggestions: PortfolioSuggestionService,
    private readonly deps: AnalysisDeps,
  ) {}

  /** Whether the AI features can run. `probe` repeats the tool-calling test even when an answer is cached. */
  public async capability(probe = false): Promise<AiCapabilityResponse> {
    const { ready, target, configured } = this.llm.isReady();
    const base = { configured, aiReady: ready, provider: target.provider, providerName: target.name, model: target.model };
    if (!configured) return { ...base, reason: "not_configured" };
    if (!ready) return { ...base, reason: "not_verified" };
    try {
      const { mode, forced } = await this.llm.toolCallingMode(probe);
      if (mode === "none") return { ...base, toolMode: mode, toolModeForced: forced, reason: forced ? "turned_off" : "no_tool_calling" };
      return { ...base, toolMode: mode, toolModeForced: forced };
    } catch {
      // The probe could not reach the model; the Run button tries again.
      return base;
    }
  }

  private listItem(row: analysisRepo.AnalysisRunRow, counts?: { findings?: number; suggestions?: number }): AnalysisRunListItem {
    const portfolio = portfolioRepo.findById(row.portfolioId);
    const currentBrief = portfolio ? readBrief(portfolio) : null;
    return {
      ...analysisRepo.toRun(row),
      briefChanged: briefFingerprint(currentBrief) !== row.briefFingerprint,
      stale: suggestionRepo.transactionFingerprint(row.portfolioId) !== row.txFingerprint,
      findingsCount: counts?.findings ?? 0,
      suggestionsCount: counts?.suggestions ?? 0,
    };
  }

  public list(portfolioId: string): ListAnalysisRunsResponse {
    if (!portfolioRepo.findById(portfolioId)) throw new NotFoundError("Portfolio not found");
    const rows = analysisRepo.listRunRows(portfolioId);
    const ids = rows.map((r) => r.id);
    const findings = analysisRepo.countKinds(ids, "finding");
    const suggestions = analysisRepo.countKinds(ids, "suggestion");
    const runs = rows.map((r) => this.listItem(r, { findings: findings.get(r.id), suggestions: suggestions.get(r.id) }));
    return { portfolioId, runs, activeRunId: rows.find((r) => r.status === "running" && this.active.has(r.id))?.id };
  }

  public get(runId: string): GetAnalysisRunResponse {
    const row = analysisRepo.findRunRow(runId);
    if (!row) throw new NotFoundError("Analysis run not found");
    const nodes = analysisRepo.listNodes(runId);
    const report = reportRepo.findByRun(row.portfolioId, runId);
    const suggestions = suggestionRepo.findByPortfolio(row.portfolioId).filter((s) => s.runId === runId);
    return {
      run: this.listItem(row, { findings: nodes.filter((n) => n.kind === "finding" && n.status === "ready").length, suggestions: nodes.filter((n) => n.kind === "suggestion").length }),
      nodes,
      edges: analysisRepo.listEdges(runId),
      steps: analysisRepo.listSteps(runId),
      report: report ? toReport(report) : null,
      suggestions,
      live: this.active.get(runId)?.live,
    };
  }

  public compare(runId: string): CompareAnalysisRunsResponse {
    const row = analysisRepo.findRunRow(runId);
    if (!row) throw new NotFoundError("Analysis run not found");
    const previous = analysisRepo.findPreviousCompleted(row.portfolioId, row.startedAt);
    return compareRuns(runId, analysisRepo.listNodes(runId), previous?.id, previous ? analysisRepo.listNodes(previous.id) : null);
  }

  public delete(portfolioId: string, runId: string): boolean {
    return analysisRepo.deleteRun(portfolioId, runId);
  }

  public cancel(runId: string): boolean {
    const active = this.active.get(runId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  /** Starts a run in the background. Returns the running one when the portfolio already has one. */
  public async start(portfolioId: string, options: { baseCurrency?: string; trigger?: "manual" | "schedule" } = {}): Promise<AnalysisRunListItem> {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) throw new NotFoundError("Portfolio not found");
    for (const [id] of this.active) {
      const row = analysisRepo.findRunRow(id);
      if (row?.portfolioId === portfolioId) return this.listItem(row);
    }
    const capability = await this.capability();
    if (capability.reason) throw new AnalysisUnavailableError(capability.reason, `Guided Analysis cannot start: ${capability.reason.replace(/_/g, " ")}`);
    if (!capability.toolMode || capability.toolMode === "none") throw new AnalysisUnavailableError("no_tool_calling", "Guided Analysis could not reach the model to test tool calling. Try again.");

    const brief: PortfolioBrief = readBrief(portfolio) ?? {};
    const now = new Date().toISOString();
    const row: analysisRepo.AnalysisRunRow = {
      id: analysisRepo.newRunId(),
      portfolioId,
      status: "running",
      phase: "seed",
      briefJson: JSON.stringify(brief),
      briefFingerprint: briefFingerprint(brief),
      txFingerprint: suggestionRepo.transactionFingerprint(portfolioId),
      baseCurrency: (options.baseCurrency || portfolio.baseCurrency || loadConfig().baseCurrency || "EUR").toUpperCase(),
      provider: capability.provider,
      model: capability.model || null,
      toolMode: capability.toolMode,
      trigger: options.trigger ?? "manual",
      stepCount: 0,
      toolCount: 0,
      nodeCount: 0,
      summary: null,
      notes: "[]",
      stateJson: JSON.stringify(newRunState()),
      startedAt: now,
      endedAt: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    analysisRepo.insertRun(row);
    telemetry.capture("analysis_run_started", { trigger: row.trigger, toolMode: row.toolMode });
    appLogger.logStep("info", "analysis", "start", `Guided Analysis started (${row.toolMode})`);
    this.launch(row, false);
    return this.listItem(row);
  }

  /** Waits for a run to end. For the weekly schedule. */
  public async waitFor(runId: string): Promise<void> {
    await this.active.get(runId)?.done;
  }

  /** On service start: resumes recent runs left running, marks older ones failed. */
  public resumeInterrupted(): void {
    for (const row of analysisRepo.findRunningRows()) {
      if (this.active.has(row.id)) continue;
      if (Date.now() - new Date(row.updatedAt).getTime() > RESUME_WINDOW_MS || !row.toolMode || row.toolMode === "none") {
        analysisRepo.updateRun(row.id, { status: "failed", error: "The app stopped while the analysis ran.", endedAt: new Date().toISOString() });
        continue;
      }
      appLogger.logStep("info", "analysis", "resume", `Resuming a Guided Analysis run at phase ${row.phase}`);
      this.launch(row, true);
    }
  }

  private launch(row: analysisRepo.AnalysisRunRow, resume: boolean): void {
    const controller = new AbortController();
    const entry: ActiveRun = {
      controller,
      live: { phase: row.phase, message: "", since: new Date().toISOString() },
      done: Promise.resolve(),
    };
    this.active.set(row.id, entry);
    entry.done = this.execute(row, controller, resume, (phase, message) => {
      entry.live = { phase, message, since: new Date().toISOString() };
    }).finally(() => this.active.delete(row.id));
  }

  private async execute(row: analysisRepo.AnalysisRunRow, controller: AbortController, resume: boolean, onLive: (phase: AnalysisPhase, message: string) => void): Promise<void> {
    const started = Date.now();
    let status: "completed" | "failed" | "cancelled" = "completed";
    let error: string | null = null;
    try {
      if (resume && row.phase === "seed") analysisRepo.clearGraph(row.id);
      const data = await this.portfolioService.getPortfolioData(row.portfolioId, row.baseCurrency);
      const graph = new RunGraph(row.id, resume ? analysisRepo.listNodes(row.id) : [], resume ? analysisRepo.listEdges(row.id) : []);
      let state: RunState = newRunState();
      if (resume && row.stateJson) {
        try {
          state = { ...newRunState(), ...(JSON.parse(row.stateJson) as Partial<RunState>), startedAtMs: Date.now() };
        } catch {
          state = newRunState();
        }
      }
      const harness = new RunHarness(
        {
          row,
          graph,
          state,
          port: createModelPort(this.llm, row.toolMode === "native" ? "native" : "json"),
          data,
          brief: JSON.parse(row.briefJson) as PortfolioBrief,
          language: loadConfig().language,
          signal: controller.signal,
          onLive,
        },
        { deps: this.deps, suggestions: this.suggestions },
      );
      await harness.execute();
    } catch (err) {
      if (err instanceof RunCancelled || controller.signal.aborted) {
        status = "cancelled";
      } else {
        status = "failed";
        error = cutText(err instanceof Error ? err.message : String(err), 400);
        appLogger.logStep("error", "analysis", "run", `Guided Analysis failed (${err instanceof Error ? err.name : typeof err})`);
      }
    }
    analysisRepo.updateRun(row.id, { status, error, endedAt: new Date().toISOString(), ...(status === "completed" ? { phase: "done" as const } : {}) });
    analysisRepo.pruneRuns(row.portfolioId);
    const final = analysisRepo.findRunRow(row.id);
    telemetry.capture("analysis_run_finished", { status, steps: final?.stepCount ?? 0, tools: final?.toolCount ?? 0, nodes: final?.nodeCount ?? 0 });
    appLogger.logStep(status === "failed" ? "warning" : "info", "analysis", "finish", `Guided Analysis ${status}`, Date.now() - started, {
      steps: final?.stepCount ?? 0,
      tools: final?.toolCount ?? 0,
      nodes: final?.nodeCount ?? 0,
    });
  }
}
