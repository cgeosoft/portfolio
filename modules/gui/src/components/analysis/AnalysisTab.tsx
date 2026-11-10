/**
 * The Analysis tab. Its home holds every analysis in a table by month, with
 * the brief and the suggestions and summary of the last analysis at the side.
 * Opening an analysis or the full list of suggestions fills the page, with
 * Back to the home.
 *
 * An open analysis shows its stages as a stepper over one graph: each stage has
 * its own panel and lights up its nodes. A running analysis fills in by
 * polling; the shown stage follows it until a stage is picked, and picking one
 * only changes what is on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, ArrowLeft, BrainCircuit, GitCompare, Loader2, Play, Settings, Square, Trash2 } from "lucide-react";
import type { AnalysisNodeKind, AnalysisPhase, AnalysisRunListItem, CompareAnalysisRunsResponse, GetAnalysisRunResponse, GetSuggestionsResponse, ListAnalysisRunsResponse, AppTheme } from "portfolio-shared/api-types";
import type { FinancialPortfolioData } from "portfolio-shared/portfolio";
import type { PortfolioSuggestion } from "portfolio-shared/suggestions";
import { api } from "../../api";
import { getLocale, t } from "../../i18n";
import { isPageHidden } from "../../visibility";
import { showToast } from "../common/Toaster";
import type { InAppLinkRenderer } from "../common/SafeMarkdown";
import { SuggestionsPage } from "../portfolio/SuggestionsPage";
import { renderHoldingAnchor } from "../portfolio/holding-links";
import { AnalysisGraph, KindFilters } from "./AnalysisGraph";
import { BriefCard } from "./BriefCard";
import { LastAnalysis } from "./LastAnalysis";
import { NodeDetails } from "./NodeDetails";
import { RunList } from "./RunList";
import { StageBar, StagePanel } from "./RunStages";
import { WhyPathPanel, whyPath } from "./WhyPath";
import { defaultStage, lastCompletedRun, nodesByStage, stageDurations, stageStates, type AnalysisStage } from "./analysis-stages";
import type { GuidedSectionId } from "./guided-sections";
import { OPEN_ANALYSIS_NODE_EVENT, capabilityNote, useAiCapability, type OpenAnalysisNodeDetail } from "./shared";

export { GUIDED_FILL_SECTIONS, resolveGuidedSection, saveGuidedSection, savedGuidedSection, type GuidedSectionId } from "./guided-sections";

const POLL_MS = 2_000;

const BUTTON =
  "h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-slate-800 bg-slate-950 text-xs font-bold text-slate-300 hover:bg-slate-900 hover:border-slate-700 hover:text-slate-50 transition-colors cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed";
const ACCENT_BUTTON =
  "h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed";

function fmtWhen(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── runs ────────────────────────────────────────────────────────────────────

/**
 * True when a poll brought nothing new for the open run. Nodes, edges and steps are only added
 * or change their status, so the run fields, the counts, the node statuses and the live line decide.
 */
function sameRunDetail(a: GetAnalysisRunResponse, b: GetAnalysisRunResponse): boolean {
  if (a.run.id !== b.run.id || a.run.updatedAt !== b.run.updatedAt || a.run.status !== b.run.status || a.run.phase !== b.run.phase) return false;
  if (a.run.stale !== b.run.stale || a.run.briefChanged !== b.run.briefChanged) return false;
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length || a.steps.length !== b.steps.length) return false;
  if (a.live?.phase !== b.live?.phase || a.live?.message !== b.live?.message || a.live?.since !== b.live?.since) return false;
  if (Boolean(a.report) !== Boolean(b.report) || (a.suggestions?.length ?? 0) !== (b.suggestions?.length ?? 0)) return false;
  for (let i = 0; i < a.nodes.length; i++) {
    const x = a.nodes[i]!;
    const y = b.nodes[i]!;
    if (x.id !== y.id || x.status !== y.status || x.relevance !== y.relevance) return false;
  }
  return true;
}

/** The analysis open per portfolio; survives leaving the tab. `null` is the home. */
const pickedRuns = new Map<string, string | null>();

/** The runs of a portfolio and the picked one in full, polled while a run is going. */
function useRuns(portfolioId: string | null) {
  const [list, setList] = useState<ListAnalysisRunsResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<GetAnalysisRunResponse | null>(null);
  const [finishedStamp, setFinishedStamp] = useState("");
  const lastActive = useRef<string | undefined>(undefined);

  const selectRun = useCallback(
    (id: string | null) => {
      if (portfolioId) pickedRuns.set(portfolioId, id);
      setSelectedRunId(id);
    },
    [portfolioId],
  );

  const loadList = useCallback(async () => {
    if (!portfolioId) return;
    try {
      const res = await api.listAnalysisRuns(portfolioId);
      setList(res);
      // A run that just ended changes the suggestions.
      if (lastActive.current && !res.activeRunId) setFinishedStamp(new Date().toISOString());
      lastActive.current = res.activeRunId;
    } catch {
      // The next poll or reload tries again.
    }
  }, [portfolioId]);

  useEffect(() => {
    setList(null);
    setLoaded(null);
    setSelectedRunId(portfolioId ? (pickedRuns.get(portfolioId) ?? null) : null);
    lastActive.current = undefined;
    void loadList();
  }, [portfolioId, loadList]);

  // A deleted or expired run falls back to the home.
  const runId = selectedRunId && (!list || list.runs.some((r) => r.id === selectedRunId)) ? selectedRunId : null;
  const wanted = useRef(runId);
  wanted.current = runId;

  const loadDetail = useCallback(async () => {
    if (!runId) {
      setLoaded(null);
      return;
    }
    try {
      const res = await api.getAnalysisRun(runId);
      // A poll with nothing new keeps the object on screen, so the graph and the panels do not render again.
      if (wanted.current === runId) setLoaded((current) => (current && sameRunDetail(current, res) ? current : res));
    } catch {
      // A failed poll keeps the open run on screen; the next one tries again.
      setLoaded((current) => (current?.run.id === runId ? current : null));
    }
  }, [runId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, finishedStamp]);

  const running = Boolean(list?.activeRunId);
  const watching = running && runId === list?.activeRunId;
  // Each poll starts POLL_MS after the one before has answered, so slow answers do not stack.
  // A hidden window sends no requests.
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      timer = null;
      if (!isPageHidden()) await Promise.all([loadList(), watching ? loadDetail() : undefined]);
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, watching, loadList, loadDetail]);

  const detail = loaded?.run.id === runId ? loaded : null;
  return { list, runId, detail, selectRun, reload: loadList, finishedStamp, running };
}

// ── pieces ──────────────────────────────────────────────────────────────────

function RunBadges({ run }: { run: AnalysisRunListItem }) {
  return (
    <>
      {run.briefChanged && <span className="px-1.5 py-0.5 rounded-sm border border-cream/40 bg-cream/10 text-cream text-[10px] font-bold uppercase tracking-wider">{t("analysis.run.briefChanged")}</span>}
      {run.stale && <span className="px-1.5 py-0.5 rounded-sm border border-cream/40 bg-cream/10 text-cream text-[10px] font-bold uppercase tracking-wider">{t("analysis.run.stale")}</span>}
    </>
  );
}

interface HomeHeaderProps {
  activeRunId?: string;
  canRun: boolean;
  starting: boolean;
  onStart: () => void;
  onOpenRun: (id: string) => void;
}

/** The head of the home, laid out like the other pages. */
function HomeHeader({ activeRunId, canRun, starting, onStart, onOpenRun }: HomeHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pb-3 border-b border-slate-800/80 shrink-0">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-widest font-mono min-w-0">
          <BrainCircuit className="w-4 h-4 text-[#DD3C73] shrink-0" />
          <span className="truncate">{t("analysis.run.title")}</span>
        </h2>
        <p className="pl-6 text-[11px] text-slate-400 mt-0.5 font-mono">{t("analysis.run.subtitle")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        {activeRunId && (
          <span className="inline-flex items-center gap-2 text-xs text-slate-300">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#DD3C73]" />
            {t("analysis.actions.running")}
            <button type="button" onClick={() => onOpenRun(activeRunId)} className="font-bold uppercase tracking-wider text-[11px] text-[#DD3C73] hover:underline cursor-pointer">
              {t("analysis.run.watch")}
            </button>
          </span>
        )}
        <button type="button" onClick={onStart} disabled={!canRun || starting} className={ACCENT_BUTTON}>
          {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {t("analysis.run.start")}
        </button>
      </div>
    </div>
  );
}

interface CapabilityBannerProps {
  note: string;
  noToolCalling: boolean;
  onProbe: () => void;
  onOpenSettings: () => void;
}

/** Why a run cannot start, with the way to fix it. */
function CapabilityBanner({ note, noToolCalling, onProbe, onOpenSettings }: CapabilityBannerProps) {
  return (
    <div className="shrink-0 rounded-xl border border-cream/40 bg-cream/10 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-cream">
      <div className="flex items-start gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
        <span>{note}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {noToolCalling && (
          <button type="button" onClick={onProbe} className="font-bold uppercase tracking-wider hover:underline cursor-pointer">
            {t("analysis.capability.retest")}
          </button>
        )}
        <button type="button" onClick={onOpenSettings} className="inline-flex items-center gap-1 font-bold uppercase tracking-wider hover:underline cursor-pointer">
          <Settings className="w-3.5 h-3.5" />
          {t("analysis.capability.openSettings")}
        </button>
      </div>
    </div>
  );
}

interface RunSummaryProps {
  run: AnalysisRunListItem;
  comparison: CompareAnalysisRunsResponse | null;
  onCancel: () => void;
  onCompare: () => void;
  onDelete: () => void;
}

/** The status of an open analysis, its stats and what can be done with it. */
function RunSummary({ run, comparison, onCancel, onCompare, onDelete }: RunSummaryProps) {
  return (
    <section className="cx-card shrink-0 mt-auto p-3 space-y-2 text-[11px] text-slate-400 lg:max-h-[45%] overflow-y-auto custom-scrollbar">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-baseline gap-x-2">
          <span className={`font-bold text-xs ${run.status === "failed" ? "text-rose-400" : run.status === "running" ? "text-[#DD3C73]" : "text-slate-100"}`}>{t(`analysis.run.status.${run.status}`)}</span>
          <span>{fmtWhen(run.startedAt)}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {run.status === "running" && (
            <button type="button" onClick={onCancel} className={BUTTON}>
              <Square className="w-3.5 h-3.5" />
              {t("analysis.run.cancel")}
            </button>
          )}
          {run.status === "completed" && (
            <button type="button" onClick={onCompare} aria-pressed={Boolean(comparison)} className={BUTTON}>
              <GitCompare className="w-3.5 h-3.5" />
              {t("analysis.history.compare")}
            </button>
          )}
          {run.status !== "running" && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t("common.delete")}
              title={t("common.delete")}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-slate-800/40 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <div>
        {t(`analysis.history.trigger.${run.trigger === "schedule" ? "schedule" : "manual"}`)} · {run.provider ?? ""}
        {run.model ? ` ${run.model}` : ""}
      </div>
      {run.status !== "running" && <div>{t("analysis.run.counts", { findings: run.findingsCount, suggestions: run.suggestionsCount, steps: run.stepCount, tools: run.toolCount })}</div>}
      <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
        <RunBadges run={run} />
      </div>
      {run.error && (
        <div className="flex items-start gap-2 text-xs text-rose-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{run.error}</span>
        </div>
      )}
      {run.notes.length > 0 && (
        <ul className="text-slate-500 space-y-0.5">
          {run.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {comparison && <ComparisonView comparison={comparison} />}
    </section>
  );
}

/** Back to the home, at the head of every full page. */
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={BUTTON}>
      <ArrowLeft className="w-3.5 h-3.5" />
      {t("common.back")}
    </button>
  );
}

// ── main ────────────────────────────────────────────────────────────────────

interface AnalysisTabProps {
  section: GuidedSectionId;
  onSectionChange: (id: GuidedSectionId) => void;
  portfolioId: string | null;
  portfolioName?: string;
  portfolioData: FinancialPortfolioData | null;
  currency: string;
  hideValues: boolean;
  theme?: AppTheme;
  /** Open suggestions, shown next to the Suggestions entry. */
  suggestionsCount?: number;
  onSuggestionsChange?: (data: GetSuggestionsResponse) => void;
  onOpenSettings: () => void;
}

export function AnalysisTab({
  section,
  onSectionChange,
  portfolioId,
  portfolioName,
  portfolioData,
  currency,
  hideValues,
  suggestionsCount = 0,
  onSuggestionsChange,
  onOpenSettings,
}: AnalysisTabProps) {
  const { capability, probe } = useAiCapability();
  const runs = useRuns(portfolioId);
  const { selectRun, detail } = runs;
  const [starting, setStarting] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [whySuggestion, setWhySuggestion] = useState<PortfolioSuggestion | null>(null);
  const [hiddenKinds, setHiddenKinds] = useState<Set<AnalysisNodeKind>>(new Set());
  const [comparison, setComparison] = useState<CompareAnalysisRunsResponse | null>(null);
  /** The stage picked by hand; null follows the run. */
  const [pickedStage, setPickedStage] = useState<AnalysisStage | null>(null);

  const note = capabilityNote(capability);
  const canRun = !note && !runs.running && Boolean(portfolioId);

  const phase: AnalysisPhase = detail?.live?.phase ?? detail?.run.phase ?? "seed";
  const status = detail?.run.status ?? "running";
  const stage = pickedStage ?? defaultStage(phase, status);
  const stages = useMemo(() => nodesByStage(detail?.nodes ?? [], detail?.steps ?? []), [detail]);
  const stageNodes = stages.get(stage) ?? [];
  const stageIds = useMemo(() => new Set(stageNodes.map((n) => n.id)), [stageNodes]);

  // Each analysis opens on its own stage, without the last one's comparison.
  useEffect(() => {
    setPickedStage(null);
    setComparison(null);
  }, [runs.runId]);

  const openRun = useCallback(
    (id: string | null) => {
      selectRun(id);
      setSelectedNode(null);
      setWhySuggestion(null);
      onSectionChange("runs");
    },
    [onSectionChange, selectRun],
  );

  // Links from other views: open a run, a node or the path of a suggestion.
  const pendingFocus = useRef<OpenAnalysisNodeDetail | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<OpenAnalysisNodeDetail>).detail ?? {};
      pendingFocus.current = d;
      if (d.runId) selectRun(d.runId);
      onSectionChange("runs");
    };
    window.addEventListener(OPEN_ANALYSIS_NODE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ANALYSIS_NODE_EVENT, onOpen);
  }, [onSectionChange, selectRun]);
  useEffect(() => {
    const focus = pendingFocus.current;
    if (!focus || !detail || (focus.runId && detail.run.id !== focus.runId)) return;
    pendingFocus.current = null;
    if (focus.suggestionId) {
      const s = detail.suggestions?.find((x) => x.id === focus.suggestionId);
      setWhySuggestion(s ?? null);
      setSelectedNode(null);
    } else if (focus.nodeId) {
      setWhySuggestion(null);
      setSelectedNode(focus.nodeId);
    }
  }, [detail]);

  const path = useMemo(() => (whySuggestion && detail ? whyPath(whySuggestion, detail.nodes, detail.edges) : null), [whySuggestion, detail]);

  const start = async () => {
    if (!portfolioId) return;
    setStarting(true);
    try {
      const res = await api.startAnalysisRun(portfolioId, currency);
      await runs.reload();
      openRun(res.run.id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!runs.list?.activeRunId) return;
    try {
      await api.cancelAnalysisRun(runs.list.activeRunId);
      await runs.reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const remove = async (id: string) => {
    if (!portfolioId) return;
    try {
      await api.deleteAnalysisRun(portfolioId, id);
      selectRun(null);
      await runs.reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const compare = async (id: string) => {
    if (comparison) {
      setComparison(null);
      return;
    }
    try {
      setComparison(await api.compareAnalysisRun(id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const openWhy = useCallback(
    (s: PortfolioSuggestion) => {
      if (!s.runId) return;
      pendingFocus.current = { runId: s.runId, suggestionId: s.id };
      selectRun(s.runId);
      onSectionChange("runs");
      if (detail?.run.id === s.runId) {
        setWhySuggestion(detail.suggestions?.find((x) => x.id === s.id) ?? s);
        setSelectedNode(null);
        pendingFocus.current = null;
      }
    },
    [detail, onSectionChange, selectRun],
  );

  const pickStage = (next: AnalysisStage) => {
    setSelectedNode(null);
    setWhySuggestion(null);
    // The live stage hands the view back to the run.
    setPickedStage(status === "running" && next === phase ? null : next);
  };

  // Node links in the short report open the node beside it.
  const renderLink: InAppLinkRenderer = useCallback((href, children) => {
    const m = /^#node\/([A-Z]\d*)$/.exec(href ?? "");
    if (m) {
      return (
        <button
          type="button"
          onClick={() => {
            setWhySuggestion(null);
            setSelectedNode(m[1]!);
          }}
          className="text-[#DD3C73] underline underline-offset-2 hover:text-accent-bright cursor-pointer font-mono text-[11px]"
        >
          {children}
        </button>
      );
    }
    return renderHoldingAnchor(href, children, () => null);
  }, []);

  if (!portfolioId) return null;

  let body: ReactNode = null;

  const goHome = () => openRun(null);

  if (section === "runs" && !runs.runId) {
    const allRuns = runs.list?.runs ?? [];
    body = (
      <div className="flex-1 min-h-0 flex flex-col gap-3.5">
        <HomeHeader activeRunId={runs.list?.activeRunId} canRun={canRun} starting={starting} onStart={() => void start()} onOpenRun={openRun} />
        {note && !runs.list?.activeRunId && <CapabilityBanner note={note} noToolCalling={capability?.reason === "no_tool_calling"} onProbe={() => void probe()} onOpenSettings={onOpenSettings} />}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 lg:grid-rows-[minmax(0,1fr)] gap-3 overflow-y-auto lg:overflow-hidden custom-scrollbar">
          <div className="lg:col-span-3 min-w-0 min-h-0 flex flex-col">
            <RunList runs={allRuns} onOpen={openRun} />
          </div>
          <aside className="lg:col-span-2 min-w-0 min-h-0 space-y-3 lg:overflow-y-auto custom-scrollbar">
            <BriefCard portfolioId={portfolioId} portfolioName={portfolioName} aiReady={Boolean(capability?.aiReady)} />
            <LastAnalysis
              runId={lastCompletedRun(allRuns)?.id}
              suggestionsCount={suggestionsCount}
              onOpenRun={openRun}
              onWhy={openWhy}
              onOpenSuggestions={() => onSectionChange("suggestions")}
            />
          </aside>
        </div>
      </div>
    );
  } else if (section === "runs" && !detail) {
    body = (
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <div className="shrink-0">
          <BackButton onClick={goHome} />
        </div>
        <div className="cx-card flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
        </div>
      </div>
    );
  } else if (section === "runs" && detail) {
    const run = detail.run;
    const selected = selectedNode ? detail.nodes.find((n) => n.id === selectedNode) : undefined;
    body = (
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <div className="shrink-0 grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,42rem)_1fr] items-center gap-2">
          <div className="justify-self-start">
            <BackButton onClick={goHome} />
          </div>
          <StageBar states={stageStates(phase, status)} status={status} counts={stages} durations={stageDurations(detail.steps)} selected={stage} onSelect={pickStage} />
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 lg:grid-rows-[minmax(0,1fr)] gap-3 overflow-y-auto lg:overflow-hidden">
          <div className="lg:col-span-3 cx-card min-h-[360px] min-w-0 flex flex-col p-2">
            <div className="flex-1 min-h-0">
              <AnalysisGraph
                nodes={detail.nodes}
                edges={detail.edges}
                selectedId={selectedNode}
                onSelect={(id) => {
                  setSelectedNode(id);
                  if (id) setWhySuggestion(null);
                }}
                highlight={path?.ids ?? (stage === "report" ? null : stageIds)}
                hiddenKinds={hiddenKinds}
              />
            </div>
            <div className="pt-2 border-t border-line">
              <KindFilters
                nodes={detail.nodes}
                hidden={hiddenKinds}
                onToggle={(k) =>
                  setHiddenKinds((prev) => {
                    const next = new Set(prev);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return next;
                  })
                }
              />
            </div>
          </div>
          <aside className="lg:col-span-2 min-w-0 min-h-0 flex flex-col gap-3">
            {whySuggestion && path ? (
              <WhyPathPanel suggestion={whySuggestion} path={path} onSelect={(id) => setSelectedNode(id)} />
            ) : selected ? (
              <NodeDetails node={selected} nodes={detail.nodes} edges={detail.edges} hideValues={hideValues} onSelect={setSelectedNode} onClose={() => setSelectedNode(null)} />
            ) : (
              <StagePanel detail={detail} stage={stage} nodes={stageNodes} onSelectNode={setSelectedNode} onWhy={openWhy} onOpenSuggestions={() => onSectionChange("suggestions")} renderLink={renderLink} />
            )}
            {whySuggestion && selected && (
              <div className="mt-3 min-h-0 flex flex-col">
                <NodeDetails node={selected} nodes={detail.nodes} edges={detail.edges} hideValues={hideValues} onSelect={setSelectedNode} onClose={() => setSelectedNode(null)} />
              </div>
            )}
            <RunSummary run={run} comparison={comparison?.currentRunId === run.id ? comparison : null} onCancel={() => void cancel()} onCompare={() => void compare(run.id)} onDelete={() => void remove(run.id)} />
          </aside>
        </div>
      </div>
    );
  } else if (section === "suggestions") {
    body = (
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <div className="shrink-0">
          <BackButton onClick={goHome} />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <SuggestionsPage
            portfolioId={portfolioId}
            portfolioData={portfolioData}
            currency={currency}
            hideValues={hideValues}
            onDataChange={onSuggestionsChange}
            showGenerate={capability?.reason === "no_tool_calling" || capability?.reason === "turned_off"}
            onWhy={openWhy}
            reloadKey={runs.finishedStamp}
          />
        </div>
      </div>
    );
  }

  return <div className="font-mono flex-1 min-w-0 min-h-0 flex flex-col">{body}</div>;
}

function ComparisonView({ comparison }: { comparison: CompareAnalysisRunsResponse }) {
  if (!comparison.previousRunId) return <p className="text-[11px] text-slate-500">{t("analysis.history.noPrevious")}</p>;
  const block = (title: string, items: { id: string; title: string }[], tone: string) =>
    items.length > 0 && (
      <div>
        <div className={`text-[10px] font-bold uppercase tracking-wider ${tone}`}>{title}</div>
        <ul className="text-xs text-slate-300 list-disc pl-4">
          {items.map((f) => (
            <li key={f.id}>{f.title}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
      {block(t("analysis.history.newFindings"), comparison.newFindings, "text-[#DD3C73]")}
      {block(t("analysis.history.resolvedFindings"), comparison.resolvedFindings, "text-mint")}
      {block(t("analysis.history.keptFindings"), comparison.keptFindings, "text-slate-400")}
      {comparison.changedWeights.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("analysis.history.weights")}</div>
          <ul className="text-xs text-slate-300">
            {comparison.changedWeights.map((w) => (
              <li key={w.symbol}>
                {w.symbol}: {w.previousWeight.toFixed(1)}% → {w.currentWeight.toFixed(1)}% <span className={w.diff > 0 ? "text-mint" : "text-rose-400"}>({w.diff > 0 ? "+" : ""}{w.diff.toFixed(1)} pp)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {comparison.newFindings.length + comparison.resolvedFindings.length + comparison.changedWeights.length === 0 && <p className="text-[11px] text-slate-500">{t("analysis.history.noChange")}</p>}
    </div>
  );
}
