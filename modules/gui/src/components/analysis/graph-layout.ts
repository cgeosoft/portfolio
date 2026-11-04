/**
 * Radial tree layout for the evidence graph. Every node hangs off one parent
 * and takes a wedge of its parent's angle, so evidence sits next to the
 * question or holding it belongs to, and a new node only widens its own branch.
 * The result depends on the nodes and edges alone: the same run always draws
 * the same way, and a growing run keeps its shape.
 */
import type { AnalysisEdge, AnalysisEdgeType, AnalysisNode } from "portfolio-shared/api-types";
import { KIND_ORDER } from "./shared";

export type LabelSide = "left" | "right" | "top" | "bottom";

export interface GraphPoint {
  x: number;
  y: number;
  side: LabelSide;
}

export interface GraphLayout {
  positions: ReadonlyMap<string, GraphPoint>;
  /** Parent of each node; roots have none. */
  parents: ReadonlyMap<string, string>;
  /** Ring radii, innermost first. */
  rings: readonly number[];
  bounds: { x1: number; y1: number; x2: number; y2: number };
}

/** The first edge type wins when a node has several parents at the same depth. */
const PARENT_PREFERENCE: Record<AnalysisEdgeType, number> = {
  answers: 0,
  derived_from: 1,
  about: 2,
  measures: 3,
  exposes: 4,
  motivates: 5,
  supports: 6,
  against_goal: 7,
  contradicts: 8,
};

const HUB_OFFSET = 52;
const RING_GAP = 118;
/** Arc length a node needs on a crowded ring. */
const NODE_ARC = 40;

/** Creation order; the numeric compare keeps n9 before n10. */
export function compareNodes(a: AnalysisNode, b: AnalysisNode): number {
  return a.createdAt.localeCompare(b.createdAt) || a.depth - b.depth || a.id.localeCompare(b.id, undefined, { numeric: true });
}

/** One parent per node: the closest lower node, else an older neighbour on the same depth. */
function pickParents(nodes: readonly AnalysisNode[], edges: readonly AnalysisEdge[]): Map<string, string> {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const best = new Map<string, { id: string; depth: number; preference: number; order: number }>();

  const offer = (child: AnalysisNode, parent: AnalysisNode, type: AnalysisEdgeType) => {
    if (child.depth === 0) return;
    const parentOrder = order.get(parent.id)!;
    if (parent.depth > child.depth || (parent.depth === child.depth && parentOrder > order.get(child.id)!)) return;
    const preference = PARENT_PREFERENCE[type];
    const current = best.get(child.id);
    const better =
      !current ||
      parent.depth > current.depth ||
      (parent.depth === current.depth && (preference < current.preference || (preference === current.preference && parentOrder < current.order)));
    if (better) best.set(child.id, { id: parent.id, depth: parent.depth, preference, order: parentOrder });
  };

  for (const e of edges) {
    const source = byId.get(e.sourceId);
    const target = byId.get(e.targetId);
    if (!source || !target || source.id === target.id) continue;
    offer(source, target, e.type);
    offer(target, source, e.type);
  }
  return new Map([...best].map(([id, p]) => [id, p.id]));
}

function sideOf(angle: number): LabelSide {
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  if (Math.abs(x) >= 0.18) return x > 0 ? "right" : "left";
  return y > 0 ? "bottom" : "top";
}

export function radialLayout(input: readonly AnalysisNode[], edges: readonly AnalysisEdge[]): GraphLayout {
  const nodes = [...input].sort(compareNodes);
  const parents = pickParents(nodes, edges);
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const kindRank = (n: AnalysisNode) => KIND_ORDER.indexOf(n.kind);

  const children = new Map<string, AnalysisNode[]>();
  const roots: AnalysisNode[] = [];
  for (const n of nodes) {
    const parent = parents.get(n.id);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), n]);
    else roots.push(n);
  }
  // Same kinds side by side, so a branch reads as one colour band.
  for (const list of children.values()) list.sort((a, b) => kindRank(a) - kindRank(b) || order.get(a.id)! - order.get(b.id)!);

  // A child always sits one ring outside its parent, whatever the depth says.
  const levels = new Map<string, number>();
  const measure = (n: AnalysisNode, level: number) => {
    const own = Math.max(level, n.depth);
    levels.set(n.id, own);
    for (const kid of children.get(n.id) ?? []) measure(kid, own + 1);
  };
  for (const root of roots) measure(root, 0);

  // Close the gaps between used levels, and widen a ring until its nodes fit.
  const used = [...new Set(levels.values())].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const level of levels.values()) counts.set(level, (counts.get(level) ?? 0) + 1);
  const hubs = roots.filter((r) => r.depth === 0).length;
  const radius = new Map<number, number>();
  let previous = 0;
  for (const level of used) {
    const r = level === 0 ? (hubs > 1 ? HUB_OFFSET : 0) : Math.max(previous + RING_GAP, ((counts.get(level) ?? 0) * NODE_ARC) / (2 * Math.PI));
    radius.set(level, r);
    previous = r;
  }

  // A leaf claims the same arc length on any ring, so inner rings do not crowd.
  const outer = Math.max(1, ...radius.values());
  const weights = new Map<string, number>();
  const weigh = (n: AnalysisNode): number => {
    const kids = children.get(n.id) ?? [];
    const weight = kids.length > 0 ? kids.reduce((sum, k) => sum + weigh(k), 0) : outer / Math.max(1, radius.get(levels.get(n.id)!) ?? 1);
    weights.set(n.id, weight);
    return weight;
  };
  const rootWeight = roots.reduce((sum, r) => sum + weigh(r), 0);

  const positions = new Map<string, GraphPoint>();
  const place = (n: AnalysisNode, start: number, span: number) => {
    const angle = start + span / 2;
    const r = radius.get(levels.get(n.id)!) ?? 0;
    positions.set(n.id, { x: r * Math.cos(angle), y: r * Math.sin(angle), side: r === 0 ? "bottom" : sideOf(angle) });
    let cursor = start;
    for (const kid of children.get(n.id) ?? []) {
      const share = (span * weights.get(kid.id)!) / weights.get(n.id)!;
      place(kid, cursor, share);
      cursor += share;
    }
  };
  // The first root, the brief, faces left.
  let cursor = roots.length > 0 ? Math.PI - (Math.PI * 2 * weights.get(roots[0]!.id)!) / rootWeight / 2 : 0;
  for (const root of roots) {
    const span = (Math.PI * 2 * weights.get(root.id)!) / rootWeight;
    place(root, cursor, span);
    cursor += span;
  }

  const points = [...positions.values()];
  const bounds = points.length
    ? {
        x1: Math.min(...points.map((p) => p.x)),
        y1: Math.min(...points.map((p) => p.y)),
        x2: Math.max(...points.map((p) => p.x)),
        y2: Math.max(...points.map((p) => p.y)),
      }
    : { x1: 0, y1: 0, x2: 0, y2: 0 };
  return { positions, parents, rings: used.map((l) => radius.get(l)!).filter((r) => r > HUB_OFFSET), bounds };
}
