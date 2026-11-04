/**
 * Comparison of two runs: new, resolved and kept findings, and the holdings
 * whose weight moved. Findings of different runs have different ids, so they
 * match by brief field and either a similar title or the same holdings.
 */
import type { AnalysisNode, CompareAnalysisRunsResponse, WeightDriftComparison } from "portfolio-shared/api-types";

/** Smallest weight move worth listing, in percentage points. */
export const WEIGHT_DRIFT_PP = 1;

const words = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

const symbolsOf = (n: AnalysisNode) => new Set(Array.isArray(n.facts.symbols) ? (n.facts.symbols as unknown[]).filter((s): s is string => typeof s === "string") : []);

export function sameFinding(a: AnalysisNode, b: AnalysisNode): boolean {
  if ((a.facts.briefField ?? "general") !== (b.facts.briefField ?? "general")) return false;
  if (jaccard(words(a.title), words(b.title)) >= 0.4) return true;
  const sa = symbolsOf(a);
  const sb = symbolsOf(b);
  return a.facts.stance === b.facts.stance && sa.size > 0 && [...sa].some((s) => sb.has(s));
}

function weights(nodes: readonly AnalysisNode[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind !== "holding") continue;
    const symbol = String(n.facts.symbol ?? "");
    const w = Number(n.facts.weightPercent);
    if (symbol && Number.isFinite(w)) out.set(symbol, w);
  }
  return out;
}

export function compareRuns(
  currentRunId: string,
  current: readonly AnalysisNode[],
  previousRunId: string | undefined,
  previous: readonly AnalysisNode[] | null,
): CompareAnalysisRunsResponse {
  const findings = (nodes: readonly AnalysisNode[]) => nodes.filter((n) => n.kind === "finding" && n.status === "ready");
  const now = findings(current);
  if (!previous) return { currentRunId, newFindings: now, resolvedFindings: [], keptFindings: [], changedWeights: [] };
  const before = findings(previous);
  const kept = now.filter((f) => before.some((b) => sameFinding(f, b)));
  const added = now.filter((f) => !kept.includes(f));
  const resolved = before.filter((b) => !now.some((f) => sameFinding(f, b)));

  const wNow = weights(current);
  const wBefore = weights(previous);
  const changed: WeightDriftComparison[] = [];
  for (const symbol of new Set([...wNow.keys(), ...wBefore.keys()])) {
    const cur = wNow.get(symbol) ?? 0;
    const prev = wBefore.get(symbol) ?? 0;
    const diff = Math.round((cur - prev) * 100) / 100;
    if (Math.abs(diff) >= WEIGHT_DRIFT_PP) changed.push({ symbol, previousWeight: prev, currentWeight: cur, diff });
  }
  changed.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { currentRunId, previousRunId, newFindings: added, resolvedFindings: resolved, keptFindings: kept, changedWeights: changed };
}
