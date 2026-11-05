/**
 * One analysis, stage by stage: the track above it and the panel of the
 * chosen stage. The panel only reads the run it is given, so looking at an
 * earlier stage leaves the run itself alone.
 */
import { Check, Loader2, Network, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { AnalysisNode, AnalysisRunStatus, GetAnalysisRunResponse } from "portfolio-shared/api-types";
import { isBriefEmpty } from "portfolio-shared/brief";
import type { PortfolioSuggestion } from "portfolio-shared/suggestions";
import { t } from "../../i18n";
import { SafeMarkdown, type InAppLinkRenderer } from "../common/SafeMarkdown";
import { HoldingLink, useHoldingLinkPlugin } from "../portfolio/holding-links";
import { ANALYSIS_STAGES, fmtStageTime, type AnalysisStage, type StageState } from "./analysis-stages";
import { briefLines } from "./BriefFields";
import { REPORT_MARKDOWN } from "./report-markdown";
import { KIND_ORDER, graphPalette, kindLabel, nodeColor, phaseLabel } from "./shared";

// ── stage track ─────────────────────────────────────────────────────────────

const NODE_TONE: Record<StageState, string> = {
  done: "border-mint/30 bg-mint/10 text-mint",
  active: "border-accent-500/50 bg-accent-500/10 text-accent-500",
  stopped: "border-cream/40 bg-cream/10 text-cream",
  todo: "border-line text-slate-600",
};

function StageNode({ state, position, selected }: { state: StageState; position: number; selected: boolean }) {
  const tone = selected ? "border-accent-500 bg-accent-500 text-white shadow-[0_0_0_4px_rgba(var(--accent-rgb),0.15)]" : NODE_TONE[state];
  return (
    <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold font-mono transition-colors ${tone}`}>
      {state === "done" && <Check className="w-3.5 h-3.5" />}
      {state === "active" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {state === "stopped" && <X className="w-3.5 h-3.5" />}
      {state === "todo" && position}
    </span>
  );
}

/** What a stage reports under its name: its state while unfinished, its result after. */
function StageMeta({ state, status, count, durationMs }: { state: StageState; status: AnalysisRunStatus; count: number; durationMs: number }) {
  if (state === "todo") return null;
  if (state !== "done") return <span className={`hidden sm:block truncate text-[10px] ${state === "active" ? "text-accent-500" : "text-cream"}`}>{t(`analysis.run.status.${status}`)}</span>;
  return (
    <span className="hidden sm:flex items-center justify-center gap-1 text-[10px] text-slate-500 font-mono">
      {count > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Network className="w-2.5 h-2.5" aria-hidden="true" />
          {count}
        </span>
      )}
      {count > 0 && durationMs > 0 && <span aria-hidden="true">·</span>}
      {durationMs > 0 && <span className="truncate">{fmtStageTime(durationMs)}</span>}
    </span>
  );
}

interface StageBarProps {
  states: Record<AnalysisStage, StageState>;
  status: AnalysisRunStatus;
  counts: ReadonlyMap<AnalysisStage, AnalysisNode[]>;
  durations: ReadonlyMap<AnalysisStage, number>;
  selected: AnalysisStage;
  onSelect: (stage: AnalysisStage) => void;
}

/** Arrow keys walk the stages a run reached, in reading order. */
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]:not(:disabled)")];
  const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
  const forward = document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
  const backward = forward === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
  const to = e.key === forward ? at + 1 : e.key === backward ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
  if (to === null || tabs.length === 0) return;
  e.preventDefault();
  const tab = tabs[(to + tabs.length) % tabs.length]!;
  tab.focus();
  tab.click();
}

export function StageBar({ states, status, counts, durations, selected, onSelect }: StageBarProps) {
  return (
    <div role="tablist" aria-label={t("analysis.run.title")} onKeyDown={moveFocus} className="flex justify-center shrink-0">
      {ANALYSIS_STAGES.map((stage, i) => {
        const state = states[stage];
        const active = stage === selected;
        const last = i === ANALYSIS_STAGES.length - 1;
        return (
          <div key={stage} className="relative flex-1 min-w-0 max-w-28">
            {!last && <span className={`absolute top-3 start-[calc(50%+16px)] w-[calc(100%-32px)] h-px ${state === "done" ? "bg-mint/30" : "bg-line"}`} aria-hidden="true" />}
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              disabled={state === "todo"}
              title={t(`analysis.stages.${stage}`)}
              onClick={() => onSelect(stage)}
              className={`group w-full flex flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-500 ${state === "todo" ? "cursor-not-allowed" : "cursor-pointer"}`}
            >
              <StageNode state={state} position={i + 1} selected={active} />
              <span className="w-full min-w-0 px-1 text-center">
                <span className={`block truncate text-[10px] font-bold uppercase sm:tracking-wider transition-colors ${active ? "text-accent-500" : state === "todo" ? "text-slate-600" : "text-slate-300 group-hover:text-slate-50"}`}>{phaseLabel(stage)}</span>
                <StageMeta state={state} status={status} count={counts.get(stage)?.length ?? 0} durationMs={durations.get(stage) ?? 0} />
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── panel ───────────────────────────────────────────────────────────────────

function NodeList({ nodes, onSelect }: { nodes: readonly AnalysisNode[]; onSelect: (id: string) => void }) {
  const palette = graphPalette();
  return (
    <div className="space-y-3">
      {KIND_ORDER.map((kind) => {
        const ofKind = nodes.filter((n) => n.kind === kind);
        if (ofKind.length === 0) return null;
        return (
          <section key={kind}>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {kindLabel(kind)} ({ofKind.length})
            </h4>
            <ul className="mt-1 space-y-0.5">
              {ofKind.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => onSelect(n.id)} className="w-full flex items-start gap-2 -mx-1.5 px-1.5 py-1 rounded-md text-left hover:bg-slate-800/40 cursor-pointer">
                    <span className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: nodeColor(n, palette) }} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className={`block font-sans ${n.status === "failed" ? "text-slate-500" : "text-slate-200"}`}>{n.title}</span>
                      {n.summary && <span className="block font-sans text-[11px] text-slate-500 line-clamp-2">{n.summary}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function BriefUsed({ detail }: { detail: GetAnalysisRunResponse }) {
  const brief = detail.run.briefSnapshot;
  const lines = briefLines(brief);
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("analysis.brief.title")}</h4>
      {isBriefEmpty(brief) && <p className="text-slate-500">{t("analysis.brief.emptySubtitle")}</p>}
      {brief.prose && <p className="text-slate-200 leading-relaxed font-sans whitespace-pre-line">{brief.prose}</p>}
      {lines.length > 0 && (
        <dl className="space-y-1">
          {lines.map((l) => (
            <div key={l.label} className="flex gap-2 min-w-0">
              <dt className="text-slate-500 shrink-0">{l.label}</dt>
              <dd className="text-slate-200 min-w-0">{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function Suggestions({ suggestions, onWhy }: { suggestions: readonly PortfolioSuggestion[]; onWhy: (s: PortfolioSuggestion) => void }) {
  return (
    <ul className="space-y-2">
      {suggestions.map((s) => (
        <li key={s.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2 min-w-0">
              <span className="font-bold text-slate-100">
                <HoldingLink reference={s.symbol} />
              </span>
              <span className="text-slate-400">
                {s.fromWeight.toFixed(1)}% → {s.targetWeight.toFixed(1)}%
              </span>
            </div>
            {s.evidence && (
              <button type="button" onClick={() => onWhy(s)} className="inline-flex items-center gap-1 shrink-0 text-[11px] font-bold uppercase tracking-wider text-accent-500 hover:underline cursor-pointer">
                <Network className="w-3 h-3" />
                {t("analysis.why.button")}
              </button>
            )}
          </div>
          <div className="font-sans font-semibold text-slate-200">{s.title}</div>
          {s.why && <p className="font-sans text-[11px] text-slate-400 leading-relaxed">{s.why}</p>}
        </li>
      ))}
    </ul>
  );
}

function Report({ detail, renderLink }: { detail: GetAnalysisRunResponse; renderLink: InAppLinkRenderer }) {
  const holdingLinkPlugin = useHoldingLinkPlugin();
  if (!detail.report) return null;
  return (
    <div className="text-sm font-sans">
      <SafeMarkdown components={REPORT_MARKDOWN} remarkPlugin={holdingLinkPlugin} renderInAppLink={renderLink}>
        {detail.report.content}
      </SafeMarkdown>
    </div>
  );
}

function Steps({ detail, stage }: { detail: GetAnalysisRunResponse; stage: AnalysisStage }) {
  const steps = detail.steps.filter((s) => s.phase === stage).reverse();
  const live = detail.live?.phase === stage ? detail.live : undefined;
  if (steps.length === 0 && !live) return null;
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("analysis.log.title", { count: steps.length })}</h4>
      {live && (
        <div className="rounded-lg border border-accent-500/30 bg-accent-500/10 px-2.5 py-2 text-accent-500 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="min-w-0">{live.message || phaseLabel(live.phase)}</span>
        </div>
      )}
      <ul className="space-y-2">
        {steps.map((s) => {
          const actions = (s.actions ?? {}) as { calls?: { name: string; args?: Record<string, unknown>; questionId?: string }[] };
          const results = (s.results ?? {}) as { errors?: string[]; error?: string };
          return (
            <li key={s.id} className="border-l-2 border-slate-800 pl-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {s.stepIndex + 1}. {(s.durationMs / 1000).toFixed(1)} s
              </div>
              {s.requestSummary && <div className="text-slate-400">{s.requestSummary}</div>}
              {s.note && <div className="text-slate-200 font-sans">{s.note}</div>}
              {(actions.calls ?? []).length > 0 && (
                <ul className="mt-0.5 text-[11px] text-slate-400">
                  {actions.calls!.map((c, i) => (
                    <li key={i} className="font-mono">
                      {c.name}({Object.values(c.args ?? {}).filter((v) => typeof v === "string" || typeof v === "number").join(", ")}){c.questionId ? ` → ${c.questionId}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {results.error && <div className="text-rose-400 text-[11px]">{results.error}</div>}
              {(results.errors ?? []).map((e) => (
                <div key={e} className="text-cream text-[11px]">
                  {e}
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface StagePanelProps {
  detail: GetAnalysisRunResponse;
  stage: AnalysisStage;
  nodes: readonly AnalysisNode[];
  onSelectNode: (id: string) => void;
  onWhy: (s: PortfolioSuggestion) => void;
  onOpenSuggestions: () => void;
  renderLink: InAppLinkRenderer;
}

export function StagePanel({ detail, stage, nodes, onSelectNode, onWhy, onOpenSuggestions, renderLink }: StagePanelProps) {
  const suggestions = detail.suggestions ?? [];
  return (
    <div className="cx-card p-3.5 lg:flex-1 flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto custom-scrollbar text-xs">
      {stage !== "report" && <p className="font-sans text-slate-400">{t(`analysis.stages.${stage}`)}</p>}
      {stage === "seed" && <BriefUsed detail={detail} />}
      {stage === "report" && <Report detail={detail} renderLink={renderLink} />}
      {stage === "suggest" && suggestions.length > 0 && (
        <div className="space-y-2">
          <Suggestions suggestions={suggestions} onWhy={onWhy} />
          <button type="button" onClick={onOpenSuggestions} className="text-[11px] font-bold uppercase tracking-wider text-accent-500 hover:underline cursor-pointer">
            {t("analysis.actions.openList")}
          </button>
        </div>
      )}
      {stage === "suggest" && suggestions.length === 0 && nodes.length === 0 && detail.run.status === "completed" && <p className="text-slate-400">{t("analysis.actions.none")}</p>}
      {stage !== "report" && !(stage === "suggest" && suggestions.length > 0) && <NodeList nodes={nodes} onSelect={onSelectNode} />}
      <Steps detail={detail} stage={stage} />
    </div>
  );
}
