/**
 * The evidence graph of the website: the newest finished Guided Analysis of
 * the demo portfolio, laid out with the app's own radial tree. Only titles,
 * summaries and links go out: no `facts` and no `local` values.
 */
import type { AnalysisEdge, AnalysisNode, GetAnalysisRunResponse, ListAnalysisRunsResponse } from "portfolio-shared/api-types";
import type { PortfolioSuggestion } from "portfolio-shared/suggestions";
import { ANALYSIS_STAGES, fmtStageTime, nodesByStage, stageDurations } from "../../modules/gui/src/components/analysis/analysis-stages";
import { radialLayout } from "../../modules/gui/src/components/analysis/graph-layout";
import { whyPath } from "../../modules/gui/src/components/analysis/WhyPath";
import type { Api } from "./app";

const round = (v: number) => Math.round(v * 10) / 10;

function nodeOut(n: AnalysisNode, stage: string, layout: ReturnType<typeof radialLayout>) {
  const p = layout.positions.get(n.id)!;
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    summary: n.summary ?? "",
    stage,
    x: round(p.x),
    y: round(p.y),
    side: p.side,
    parent: layout.parents.get(n.id) ?? null,
    relevance: n.relevance,
    stance: typeof n.facts.stance === "string" ? n.facts.stance : undefined,
    failed: n.status === "failed" || undefined,
  };
}

function suggestionOut(s: PortfolioSuggestion, nodes: readonly AnalysisNode[], edges: readonly AnalysisEdge[]) {
  const path = whyPath(s, nodes, edges);
  return {
    id: s.id,
    node: path.suggestionNode?.id ?? null,
    symbol: s.symbol,
    title: s.title,
    why: s.why ?? "",
    from: s.fromWeight,
    to: s.targetWeight,
    goal: path.goal ?? null,
    findings: path.findings.map((n) => n.id),
    support: path.support.map((n) => n.id),
    counter: path.counter.map((n) => n.id),
  };
}

export async function runData(api: Api, portfolioId: string) {
  const { runs } = await api.call<ListAnalysisRunsResponse>("GET", `/api/portfolios/${portfolioId}/analysis/runs`);
  const last = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).find((r) => r.status === "completed");
  if (!last) return null;
  const detail = await api.call<GetAnalysisRunResponse>("GET", `/api/analysis/runs/${last.id}`);
  const nodes = detail.nodes.filter((n) => n.status !== "pruned");
  const ids = new Set(nodes.map((n) => n.id));
  const edges = detail.edges.filter((e) => ids.has(e.sourceId) && ids.has(e.targetId));
  const layout = radialLayout(nodes, edges);
  const byStage = nodesByStage(nodes, detail.steps);
  const durations = stageDurations(detail.steps);
  const stageOf = new Map(ANALYSIS_STAGES.flatMap((stage) => byStage.get(stage)!.map((n) => [n.id, stage] as const)));
  return {
    run: { steps: detail.run.stepCount, tools: detail.run.toolCount, nodes: nodes.length, summary: detail.run.summary ?? "" },
    stages: ANALYSIS_STAGES.map((id) => ({ id, nodes: byStage.get(id)!.length, time: durations.has(id) ? fmtStageTime(durations.get(id)!) : null })),
    rings: layout.rings.map(round),
    bounds: layout.bounds,
    nodes: nodes.map((n) => nodeOut(n, stageOf.get(n.id)!, layout)),
    edges: edges.map((e) => ({ s: e.sourceId, t: e.targetId, type: e.type, tree: layout.parents.get(e.sourceId) === e.targetId || layout.parents.get(e.targetId) === e.sourceId })),
    suggestions: (detail.suggestions ?? []).map((s) => suggestionOut(s, nodes, edges)),
    report: detail.report?.content ?? "",
  };
}
