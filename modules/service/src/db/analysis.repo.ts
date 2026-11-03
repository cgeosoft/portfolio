/**
 * Guided Analysis storage: runs, graph nodes, edges and model steps.
 *
 * Node facts are percent-only JSON that passed the privacy gate; `local`
 * holds the amounts the GUI shows and is never read by a prompt builder. A
 * finished run is read-only. The newest RUNS_KEPT runs per portfolio stay.
 */
import { randomBytes } from "node:crypto";
import type { AnalysisEdge, AnalysisEdgeType, AnalysisNode, AnalysisNodeKind, AnalysisNodeSource, AnalysisPhase, AnalysisRun, AnalysisRunStatus, AnalysisStep, AnalysisToolMode } from "portfolio-shared/api-types";
import type { PortfolioBrief } from "portfolio-shared/portfolio";
import { getDatabase } from "./database.js";

/** Runs kept per portfolio. */
export const RUNS_KEPT = 10;

export interface AnalysisRunRow {
  id: string;
  portfolioId: string;
  status: AnalysisRunStatus;
  phase: AnalysisPhase;
  briefJson: string;
  briefFingerprint: string;
  txFingerprint: string;
  baseCurrency: string;
  provider: string | null;
  model: string | null;
  toolMode: string | null;
  trigger: string | null;
  stepCount: number;
  toolCount: number;
  nodeCount: number;
  summary: string | null;
  notes: string;
  /** Harness state for a resume: open budgets and counters. */
  stateJson: string | null;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NodeRow {
  runId: string;
  id: string;
  kind: string;
  title: string;
  factsJson: string;
  localJson: string | null;
  summary: string;
  sourceJson: string | null;
  createdBy: string;
  depth: number;
  relevance: number;
  status: string;
  createdAt: string;
}

interface EdgeRow {
  runId: string;
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  rationale: string;
  createdAt: string;
}

interface StepRow {
  runId: string;
  stepIndex: number;
  phase: string;
  requestSummary: string | null;
  actionsJson: string | null;
  resultsJson: string | null;
  note: string | null;
  durationMs: number;
  createdAt: string;
}

function parse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export function newRunId(): string {
  return `ar_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

export function toRun(row: AnalysisRunRow): AnalysisRun {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    status: row.status,
    phase: row.phase,
    briefSnapshot: parse<PortfolioBrief>(row.briefJson, {}),
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    toolMode: (row.toolMode as AnalysisToolMode | null) ?? undefined,
    trigger: row.trigger ?? undefined,
    stepCount: row.stepCount,
    toolCount: row.toolCount,
    nodeCount: row.nodeCount,
    summary: row.summary ?? undefined,
    notes: parse<string[]>(row.notes, []),
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toNode(row: NodeRow): AnalysisNode {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind as AnalysisNodeKind,
    title: row.title,
    facts: parse<Record<string, unknown>>(row.factsJson, {}),
    local: row.localJson ? parse<Record<string, unknown>>(row.localJson, {}) : undefined,
    summary: row.summary,
    source: row.sourceJson ? parse<AnalysisNodeSource>(row.sourceJson, {}) : undefined,
    createdBy: row.createdBy,
    depth: row.depth,
    relevance: row.relevance,
    status: row.status as AnalysisNode["status"],
    createdAt: row.createdAt,
  };
}

function toEdge(row: EdgeRow): AnalysisEdge {
  return { ...row, type: row.type as AnalysisEdgeType };
}

function toStep(row: StepRow): AnalysisStep {
  return {
    id: `${row.runId}:${row.stepIndex}`,
    runId: row.runId,
    stepIndex: row.stepIndex,
    phase: row.phase as AnalysisPhase,
    requestSummary: row.requestSummary ?? undefined,
    actions: parse<unknown>(row.actionsJson, undefined),
    results: parse<unknown>(row.resultsJson, undefined),
    note: row.note ?? undefined,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  };
}

// ── runs ────────────────────────────────────────────────────────────────────

export function insertRun(row: AnalysisRunRow): void {
  getDatabase().run(
    `INSERT INTO analysis_runs (id, portfolioId, status, phase, briefJson, briefFingerprint, txFingerprint, baseCurrency, provider, model, toolMode, trigger,
       stepCount, toolCount, nodeCount, summary, notes, stateJson, startedAt, endedAt, error, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.portfolioId, row.status, row.phase, row.briefJson, row.briefFingerprint, row.txFingerprint, row.baseCurrency, row.provider, row.model,
      row.toolMode, row.trigger, row.stepCount, row.toolCount, row.nodeCount, row.summary, row.notes, row.stateJson, row.startedAt, row.endedAt, row.error,
      row.createdAt, row.updatedAt,
    ],
  );
}

const RUN_COLUMNS = new Set(["status", "phase", "provider", "model", "toolMode", "stepCount", "toolCount", "nodeCount", "summary", "notes", "stateJson", "endedAt", "error"]);

export function updateRun(id: string, patch: Partial<Omit<AnalysisRunRow, "id" | "portfolioId">>): void {
  const keys = Object.keys(patch).filter((k) => RUN_COLUMNS.has(k));
  if (keys.length === 0) return;
  const values = keys.map((k) => (patch as Record<string, unknown>)[k] ?? null) as (string | number | null)[];
  getDatabase().run(`UPDATE analysis_runs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updatedAt = ? WHERE id = ?`, [...values, new Date().toISOString(), id]);
}

export function findRunRow(id: string): AnalysisRunRow | null {
  return (getDatabase().query("SELECT * FROM analysis_runs WHERE id = ?").get(id) as AnalysisRunRow | null) ?? null;
}

export function listRunRows(portfolioId: string, limit = RUNS_KEPT): AnalysisRunRow[] {
  return getDatabase().query("SELECT * FROM analysis_runs WHERE portfolioId = ? ORDER BY startedAt DESC LIMIT ?").all(portfolioId, limit) as AnalysisRunRow[];
}

/** Runs left in "running", for a resume after a restart. */
export function findRunningRows(): AnalysisRunRow[] {
  return getDatabase().query("SELECT * FROM analysis_runs WHERE status = 'running' ORDER BY startedAt ASC").all() as AnalysisRunRow[];
}

/** The newest completed run before `beforeIso`, for the comparison. */
export function findPreviousCompleted(portfolioId: string, beforeIso: string): AnalysisRunRow | null {
  return (
    (getDatabase()
      .query("SELECT * FROM analysis_runs WHERE portfolioId = ? AND status = 'completed' AND startedAt < ? ORDER BY startedAt DESC LIMIT 1")
      .get(portfolioId, beforeIso) as AnalysisRunRow | null) ?? null
  );
}

/** Keeps the newest RUNS_KEPT runs of a portfolio; nodes, edges and steps go with their run. Never deletes a running run. */
export function pruneRuns(portfolioId: string, keep = RUNS_KEPT): number {
  const result = getDatabase().run(
    `DELETE FROM analysis_runs WHERE portfolioId = ? AND status <> 'running' AND id NOT IN (
       SELECT id FROM analysis_runs WHERE portfolioId = ? ORDER BY startedAt DESC LIMIT ?
     )`,
    [portfolioId, portfolioId, keep],
  );
  return result.changes;
}

export function deleteRun(portfolioId: string, id: string): boolean {
  return getDatabase().run("DELETE FROM analysis_runs WHERE id = ? AND portfolioId = ? AND status <> 'running'", [id, portfolioId]).changes > 0;
}

// ── nodes, edges, steps ─────────────────────────────────────────────────────

export function insertNodes(nodes: readonly AnalysisNode[]): void {
  if (nodes.length === 0) return;
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO analysis_nodes (runId, id, kind, title, factsJson, localJson, summary, sourceJson, createdBy, depth, relevance, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const n of nodes) {
      stmt.run(
        n.runId, n.id, n.kind, n.title, JSON.stringify(n.facts), n.local ? JSON.stringify(n.local) : null, n.summary,
        n.source ? JSON.stringify(n.source) : null, n.createdBy, n.depth, n.relevance, n.status, n.createdAt,
      );
    }
  })();
}

export function insertEdges(edges: readonly AnalysisEdge[]): void {
  if (edges.length === 0) return;
  const db = getDatabase();
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO analysis_edges (runId, id, sourceId, targetId, type, rationale, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (const e of edges) stmt.run(e.runId, e.id, e.sourceId, e.targetId, e.type, e.rationale, e.createdAt);
  })();
}

export function insertStep(step: Omit<AnalysisStep, "id">): void {
  getDatabase().run(
    `INSERT OR REPLACE INTO analysis_steps (runId, stepIndex, phase, requestSummary, actionsJson, resultsJson, note, durationMs, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      step.runId, step.stepIndex, step.phase, step.requestSummary ?? null, step.actions === undefined ? null : JSON.stringify(step.actions),
      step.results === undefined ? null : JSON.stringify(step.results), step.note ?? null, step.durationMs, step.createdAt,
    ],
  );
}

export function listNodes(runId: string): AnalysisNode[] {
  return (getDatabase().query("SELECT * FROM analysis_nodes WHERE runId = ? ORDER BY createdAt ASC, rowid ASC").all(runId) as NodeRow[]).map(toNode);
}

export function listEdges(runId: string): AnalysisEdge[] {
  return (getDatabase().query("SELECT * FROM analysis_edges WHERE runId = ? ORDER BY createdAt ASC, rowid ASC").all(runId) as EdgeRow[]).map(toEdge);
}

export function listSteps(runId: string): AnalysisStep[] {
  return (getDatabase().query("SELECT * FROM analysis_steps WHERE runId = ? ORDER BY stepIndex ASC").all(runId) as StepRow[]).map(toStep);
}

/** Findings of several runs at once, for the run list. */
export function countKinds(runIds: readonly string[], kind: AnalysisNodeKind): Map<string, number> {
  const out = new Map<string, number>();
  if (runIds.length === 0) return out;
  const rows = getDatabase()
    .query(`SELECT runId, COUNT(*) AS n FROM analysis_nodes WHERE kind = ? AND status = 'ready' AND runId IN (${runIds.map(() => "?").join(",")}) GROUP BY runId`)
    .all(kind, ...runIds) as { runId: string; n: number }[];
  for (const r of rows) out.set(r.runId, r.n);
  return out;
}

/** Removes the nodes, edges and steps of a run, for a seed that starts over. */
export function clearGraph(runId: string): void {
  const db = getDatabase();
  db.transaction(() => {
    db.run("DELETE FROM analysis_nodes WHERE runId = ?", [runId]);
    db.run("DELETE FROM analysis_edges WHERE runId = ?", [runId]);
    db.run("DELETE FROM analysis_steps WHERE runId = ?", [runId]);
  })();
}
