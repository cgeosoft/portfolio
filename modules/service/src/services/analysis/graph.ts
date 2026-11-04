/**
 * The evidence graph of one Guided Analysis run, in memory.
 *
 * Every node passes the privacy gate when it is added: `facts` must hold
 * percentages, allowed counts or text only (`assertPercentOnly`). Amounts
 * and quantities go to `local`, which no prompt builder reads. New nodes and
 * edges collect in a pending list that `flush()` writes to the database, so
 * a run that stops keeps everything it found.
 *
 * Node ids are short and readable for the model: B (brief), A (allocation),
 * H1.. (holdings), Q1.. (questions), F1.. (findings), T1.. (themes), S1..
 * (suggestions), R1 (report) and N1.. for tool facts.
 */
import type { AnalysisEdge, AnalysisEdgeType, AnalysisNode, AnalysisNodeKind, AnalysisNodeSource } from "portfolio-shared/api-types";
import * as analysisRepo from "../../db/analysis.repo.js";
import { assertPercentOnly } from "../llm-privacy.js";

/** Characters of a node summary, the text the model sees. */
const SUMMARY_MAX_CHARS = 300;
/** Kinds whose summary carries more: cutting these loses the point of the node. */
const SUMMARY_MAX_BY_KIND: Partial<Record<AnalysisNodeKind, number>> = { brief: 1_500, finding: 700, theme: 500, macro: 1_200, company: 700, report: 700 };
const TITLE_MAX_CHARS = 120;
const RATIONALE_MAX_CHARS = 200;

export interface NodeDraft {
  kind: AnalysisNodeKind;
  title: string;
  facts: Record<string, unknown>;
  local?: Record<string, unknown>;
  summary: string;
  source?: AnalysisNodeSource;
  createdBy: string;
  depth: number;
  relevance?: number;
  status?: AnalysisNode["status"];
  /** A fixed id (B, A) instead of the next one of the kind. */
  id?: string;
}

const PREFIX: Record<AnalysisNodeKind, string> = {
  brief: "B",
  allocation: "A",
  holding: "H",
  question: "Q",
  finding: "F",
  theme: "T",
  suggestion: "S",
  report: "R",
  news: "N",
  indicator: "N",
  metric: "N",
  calc: "N",
  macro: "N",
  company: "N",
  event: "N",
};

/** Kinds the model writes; every other kind comes from the app. */
export const MODEL_KINDS: ReadonlySet<AnalysisNodeKind> = new Set(["question", "finding", "theme", "suggestion", "report"]);

export function cutText(text: string, max: number): string {
  const clean = (text || "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3).trimEnd()}...` : clean;
}

/** A node summary within the limit of its kind, ended at a sentence when it has to be cut. */
export function cutSummary(text: string, kind: AnalysisNodeKind): string {
  const max = SUMMARY_MAX_BY_KIND[kind] ?? SUMMARY_MAX_CHARS;
  const cut = cutText(text, max);
  if (!cut.endsWith("...")) return cut;
  const head = cut.slice(0, -3);
  const end = Math.max(...[...head.matchAll(/[.!?。！？؟](?=\s|$)/gu)].map((m) => m.index ?? -1), -1);
  return end >= max / 2 ? head.slice(0, end + 1) : cut;
}

export class RunGraph {
  private readonly nodeMap = new Map<string, AnalysisNode>();
  private readonly edgeList: AnalysisEdge[] = [];
  private readonly edgeKeys = new Set<string>();
  private readonly counters = new Map<string, number>();
  private pendingNodes = new Map<string, AnalysisNode>();
  private pendingEdges: AnalysisEdge[] = [];
  private edgeCounter = 0;

  constructor(
    public readonly runId: string,
    nodes: readonly AnalysisNode[] = [],
    edges: readonly AnalysisEdge[] = [],
  ) {
    for (const n of nodes) {
      this.nodeMap.set(n.id, n);
      const m = /^([A-Z])(\d+)$/.exec(n.id);
      if (m) this.counters.set(m[1]!, Math.max(this.counters.get(m[1]!) ?? 0, Number(m[2])));
    }
    for (const e of edges) {
      this.edgeList.push(e);
      this.edgeKeys.add(`${e.sourceId}>${e.targetId}>${e.type}`);
      const m = /^E(\d+)$/.exec(e.id);
      if (m) this.edgeCounter = Math.max(this.edgeCounter, Number(m[1]));
    }
  }

  get nodes(): AnalysisNode[] {
    return [...this.nodeMap.values()];
  }

  get edges(): AnalysisEdge[] {
    return [...this.edgeList];
  }

  get size(): number {
    return this.nodeMap.size;
  }

  has(id: string): boolean {
    return this.nodeMap.has(id);
  }

  get(id: string): AnalysisNode | undefined {
    return this.nodeMap.get(id);
  }

  byKind(...kinds: AnalysisNodeKind[]): AnalysisNode[] {
    return this.nodes.filter((n) => kinds.includes(n.kind));
  }

  /** The holding node of a symbol, case-insensitive. */
  holding(symbol: string): AnalysisNode | undefined {
    const key = symbol.trim().toUpperCase();
    return this.nodes.find((n) => n.kind === "holding" && String(n.facts.symbol ?? "").toUpperCase() === key);
  }

  /** Adds a node after the privacy check. Throws `PrivacyError` when the facts carry a non-percentage number. */
  addNode(draft: NodeDraft): AnalysisNode {
    assertPercentOnly(draft.facts);
    let id = draft.id;
    if (!id || this.nodeMap.has(id)) {
      const prefix = PREFIX[draft.kind];
      const next = (this.counters.get(prefix) ?? 0) + 1;
      this.counters.set(prefix, next);
      id = `${prefix}${next}`;
    }
    const node: AnalysisNode = {
      id,
      runId: this.runId,
      kind: draft.kind,
      title: cutText(draft.title, TITLE_MAX_CHARS),
      facts: draft.facts,
      local: draft.local,
      summary: cutSummary(draft.summary, draft.kind),
      source: draft.source,
      createdBy: draft.createdBy,
      depth: Math.max(0, Math.round(draft.depth)),
      relevance: Math.min(1, Math.max(0, draft.relevance ?? 0.5)),
      status: draft.status ?? "ready",
      createdAt: new Date().toISOString(),
    };
    this.nodeMap.set(id, node);
    this.pendingNodes.set(id, node);
    return node;
  }

  /** Changes a stored node (a question closed, relevance moved). Facts pass the privacy check again. */
  updateNode(id: string, patch: Partial<Pick<AnalysisNode, "facts" | "summary" | "relevance" | "status" | "title">>): AnalysisNode | undefined {
    const node = this.nodeMap.get(id);
    if (!node) return undefined;
    if (patch.facts) assertPercentOnly(patch.facts);
    const next: AnalysisNode = {
      ...node,
      ...patch,
      summary: patch.summary !== undefined ? cutSummary(patch.summary, node.kind) : node.summary,
      title: patch.title !== undefined ? cutText(patch.title, TITLE_MAX_CHARS) : node.title,
    };
    this.nodeMap.set(id, next);
    this.pendingNodes.set(id, next);
    return next;
  }

  /** Adds an edge between two known nodes. Returns null for an unknown id, a self loop or a duplicate. */
  addEdge(sourceId: string, targetId: string, type: AnalysisEdgeType, rationale = ""): AnalysisEdge | null {
    if (!this.nodeMap.has(sourceId) || !this.nodeMap.has(targetId) || sourceId === targetId) return null;
    const key = `${sourceId}>${targetId}>${type}`;
    if (this.edgeKeys.has(key)) return null;
    this.edgeKeys.add(key);
    const edge: AnalysisEdge = {
      id: `E${++this.edgeCounter}`,
      runId: this.runId,
      sourceId,
      targetId,
      type,
      rationale: cutText(rationale, RATIONALE_MAX_CHARS),
      createdAt: new Date().toISOString(),
    };
    this.edgeList.push(edge);
    this.pendingEdges.push(edge);
    return edge;
  }

  /** Edges that touch a node. */
  edgesOf(id: string): AnalysisEdge[] {
    return this.edgeList.filter((e) => e.sourceId === id || e.targetId === id);
  }

  /** Writes the new and changed nodes and edges. */
  flush(): void {
    if (this.pendingNodes.size === 0 && this.pendingEdges.length === 0) return;
    analysisRepo.insertNodes([...this.pendingNodes.values()]);
    analysisRepo.insertEdges(this.pendingEdges);
    this.pendingNodes = new Map();
    this.pendingEdges = [];
  }
}
