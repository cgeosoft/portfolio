/**
 * The stages of an analysis as the Analysis tab shows them: which stages a run
 * reached, which nodes each one made, and the runs grouped by month.
 */
import { ANALYSIS_PHASES, type AnalysisNode, type AnalysisNodeKind, type AnalysisPhase, type AnalysisRunListItem, type AnalysisRunStatus, type AnalysisStep } from "portfolio-shared/api-types";

export type AnalysisStage = Exclude<AnalysisPhase, "done">;

export type StageState = "done" | "active" | "stopped" | "todo";

export const ANALYSIS_STAGES = ANALYSIS_PHASES as readonly AnalysisStage[];

/** Kinds that only one stage makes. Findings and evidence go by their time. */
const STAGE_OF_KIND: Partial<Record<AnalysisNodeKind, AnalysisStage>> = {
  brief: "seed",
  allocation: "seed",
  question: "survey",
  theme: "synthesise",
  suggestion: "suggest",
  report: "report",
};

export function stageStates(phase: AnalysisPhase, status: AnalysisRunStatus): Record<AnalysisStage, StageState> {
  const finished = phase === "done" || status === "completed";
  const current = ANALYSIS_STAGES.indexOf(phase as AnalysisStage);
  const states = {} as Record<AnalysisStage, StageState>;
  ANALYSIS_STAGES.forEach((stage, i) => {
    if (finished || i < current) states[stage] = "done";
    else if (i === current) states[stage] = status === "running" ? "active" : "stopped";
    else states[stage] = "todo";
  });
  return states;
}

/** The stage a run opens on: the live one, the report, or where it stopped. */
export function defaultStage(phase: AnalysisPhase, status: AnalysisRunStatus): AnalysisStage {
  if (phase === "done" || status === "completed") return "report";
  return phase;
}

/** When each stage began: its first step started then. */
function stageStarts(steps: readonly AnalysisStep[]): Map<AnalysisStage, number> {
  const starts = new Map<AnalysisStage, number>();
  for (const step of steps) {
    if (step.phase === "done") continue;
    const start = Date.parse(step.createdAt) - step.durationMs;
    const known = starts.get(step.phase);
    if (!Number.isNaN(start) && (known === undefined || start < known)) starts.set(step.phase, start);
  }
  return starts;
}

/** The nodes each stage made. A node has no stage field, so its kind or its time decides. */
export function nodesByStage(nodes: readonly AnalysisNode[], steps: readonly AnalysisStep[]): Map<AnalysisStage, AnalysisNode[]> {
  const starts = stageStarts(steps);
  const newestFirst = [...ANALYSIS_STAGES].reverse();
  const out = new Map<AnalysisStage, AnalysisNode[]>(ANALYSIS_STAGES.map((stage) => [stage, []]));
  for (const node of nodes) {
    if (node.status === "pruned") continue;
    const made = Date.parse(node.createdAt);
    const stage = STAGE_OF_KIND[node.kind] ?? newestFirst.find((s) => (starts.get(s) ?? Infinity) <= made) ?? "seed";
    out.get(stage)!.push(node);
  }
  return out;
}

/** The newest finished run: its suggestions and report are the current ones. */
export function lastCompletedRun(runs: readonly AnalysisRunListItem[]): AnalysisRunListItem | undefined {
  return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).find((r) => r.status === "completed");
}

/** The model time each stage took: the sum of its steps. */
export function stageDurations(steps: readonly AnalysisStep[]): Map<AnalysisStage, number> {
  const durations = new Map<AnalysisStage, number>();
  for (const step of steps) {
    if (step.phase !== "done") durations.set(step.phase, (durations.get(step.phase) ?? 0) + step.durationMs);
  }
  return durations;
}

/** A stage time at a glance: "23 s", "1 m 52 s". */
export function fmtStageTime(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} m ${total % 60} s`;
}

export interface RunMonth {
  key: string;
  label: string;
  runs: AnalysisRunListItem[];
}

/** The runs by the month they started, newest first. */
export function groupRunsByMonth(runs: readonly AnalysisRunListItem[], locale: string): RunMonth[] {
  const months = new Map<string, RunMonth>();
  for (const run of [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    const d = new Date(run.startedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const month = months.get(key) ?? { key, label: d.toLocaleString(locale, { month: "long", year: "numeric" }), runs: [] };
    month.runs.push(run);
    months.set(key, month);
  }
  return [...months.values()];
}
