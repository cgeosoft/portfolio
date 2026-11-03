/**
 * The reasoning path of a suggestion: the brief field it serves, the
 * findings it acts on, and the evidence behind them, counter-evidence
 * included. `whyPathIds` gives the node ids the graph highlights.
 */
import { ArrowDown, Network } from "lucide-react";
import type { AnalysisEdge, AnalysisNode } from "portfolio-shared/api-types";
import type { PortfolioSuggestion } from "portfolio-shared/suggestions";
import { t } from "../../i18n";
import { kindLabel } from "./shared";

export interface WhyPathData {
  suggestionNode?: AnalysisNode;
  goal?: string;
  findings: AnalysisNode[];
  support: AnalysisNode[];
  counter: AnalysisNode[];
  ids: Set<string>;
}

/** The path of a suggestion in its run's graph. */
export function whyPath(suggestion: PortfolioSuggestion, nodes: readonly AnalysisNode[], edges: readonly AnalysisEdge[]): WhyPathData {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const suggestionNode = nodes.find((n) => n.kind === "suggestion" && n.facts.suggestionId === suggestion.id) ?? nodes.find((n) => n.kind === "suggestion" && n.facts.symbol === suggestion.symbol && n.facts.action === suggestion.action);
  const findingIds = suggestion.evidence?.findings ?? edges.filter((e) => e.type === "motivates" && e.targetId === suggestionNode?.id).map((e) => e.sourceId);
  const findings = findingIds.map((id) => byId.get(id)).filter((n): n is AnalysisNode => Boolean(n));
  const support = new Map<string, AnalysisNode>();
  const counter = new Map<string, AnalysisNode>();
  for (const id of suggestion.evidence?.nodes ?? []) {
    const n = byId.get(id);
    if (n) support.set(id, n);
  }
  for (const f of findings) {
    for (const e of edges) {
      if (e.targetId !== f.id) continue;
      const n = byId.get(e.sourceId);
      if (!n) continue;
      if (e.type === "supports") support.set(n.id, n);
      if (e.type === "contradicts") counter.set(n.id, n);
    }
  }
  const ids = new Set<string>(["B", ...findings.map((f) => f.id), ...support.keys(), ...counter.keys()]);
  if (suggestionNode) ids.add(suggestionNode.id);
  return { suggestionNode, goal: suggestion.evidence?.goal ?? (typeof findings[0]?.facts.briefField === "string" ? findings[0].facts.briefField : undefined), findings, support: [...support.values()], counter: [...counter.values()], ids };
}

function NodeRow({ node, onSelect, tone = "text-slate-200" }: { node: AnalysisNode; onSelect: (id: string) => void; tone?: string }) {
  return (
    <button type="button" onClick={() => onSelect(node.id)} className="w-full text-left rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 hover:border-slate-700 cursor-pointer">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {node.id} · {kindLabel(node.kind)}
      </div>
      <div className={`text-xs font-semibold ${tone}`}>{node.title}</div>
      {node.summary && <div className="text-[11px] text-slate-400 leading-relaxed mt-0.5 font-sans">{node.summary}</div>}
    </button>
  );
}

const Step = () => (
  <div className="flex justify-center text-slate-600">
    <ArrowDown className="w-3.5 h-3.5" />
  </div>
);

export function WhyPathPanel({ suggestion, path, onSelect, onShowGraph }: { suggestion: PortfolioSuggestion; path: WhyPathData; onSelect: (id: string) => void; onShowGraph?: () => void }) {
  return (
    <div className="cx-card p-3.5 flex flex-col gap-2 min-h-0 overflow-y-auto custom-scrollbar text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("analysis.why.title")}</div>
          <div className="text-sm font-bold text-slate-100 font-sans">{suggestion.title}</div>
        </div>
        {onShowGraph && (
          <button type="button" onClick={onShowGraph} className="h-7 inline-flex items-center gap-1 px-2 rounded-md border border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:border-slate-700 cursor-pointer shrink-0">
            <Network className="w-3 h-3" />
            {t("analysis.why.showGraph")}
          </button>
        )}
      </div>
      <div className="rounded-lg border border-accent-500/30 bg-accent-500/10 px-2.5 py-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-accent-300">{t("analysis.why.goal")}</div>
        <div className="text-xs text-slate-100">{path.goal ? t(`analysis.brief.fields.${path.goal}`) : t("analysis.why.generalGoal")}</div>
      </div>
      {path.findings.length > 0 && (
        <>
          <Step />
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("analysis.why.findings")}</div>
          {path.findings.map((f) => (
            <NodeRow key={f.id} node={f} onSelect={onSelect} tone={f.facts.stance === "risk" ? "text-rose-300" : f.facts.stance === "opportunity" ? "text-mint" : "text-slate-200"} />
          ))}
        </>
      )}
      {path.support.length > 0 && (
        <>
          <Step />
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("analysis.why.evidence")}</div>
          {path.support.map((n) => (
            <NodeRow key={n.id} node={n} onSelect={onSelect} />
          ))}
        </>
      )}
      {path.counter.length > 0 && (
        <>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-rose-400">{t("analysis.why.counter")}</div>
          {path.counter.map((n) => (
            <NodeRow key={n.id} node={n} onSelect={onSelect} tone="text-rose-300" />
          ))}
        </>
      )}
      {path.findings.length === 0 && <p className="text-slate-500">{t("analysis.why.none")}</p>}
    </div>
  );
}
