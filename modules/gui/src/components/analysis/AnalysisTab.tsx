/**
 * The Analysis tab. The sidebar holds the brief, every analysis by month, and
 * the two lists that span analyses (open suggestions, stored reports).
 *
 * With no analysis picked the page offers a new one. A picked analysis shows
 * its stages as a track over one graph: each stage has its own panel and lights
 * up its nodes. A running analysis fills in by polling; the shown stage follows
 * it until a stage is picked, and picking one only changes what is on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, BrainCircuit, FileText, GitCompare, Lightbulb, Loader2, Play, Settings, Square, Trash2 } from "lucide-react";
import type { AnalysisNodeKind, AnalysisPhase, AnalysisRunListItem, CompareAnalysisRunsResponse, GetAnalysisRunResponse, GetSuggestionsResponse, ListAnalysisRunsResponse, AppTheme } from "portfolio-shared/api-types";
import type { FinancialPortfolioData, PortfolioReport } from "portfolio-shared/portfolio";
import type { PortfolioSuggestion } from "portfolio-shared/suggestions";
import { api } from "../../api";
import { getLocale, t } from "../../i18n";
import { showToast } from "../common/Toaster";
import type { InAppLinkRenderer } from "../common/SafeMarkdown";
import { SidebarEntry, type SidebarSection } from "../settings/SettingsPrimitives";
import { ReportsCard } from "../portfolio/ReportsCard";
import { SuggestionsPage } from "../portfolio/SuggestionsPage";
import { renderHoldingAnchor } from "../portfolio/holding-links";
import { AnalysisGraph, KindFilters } from "./AnalysisGraph";
import { BriefCard } from "./BriefCard";
import { NodeDetails } from "./NodeDetails";
import { RunList } from "./RunList";
import { StageBar, StagePanel } from "./RunStages";
import { WhyPathPanel, whyPath } from "./WhyPath";
import { defaultStage, nodesByStage, stageDurations, stageStates, type AnalysisStage } from "./analysis-stages";
import { OPEN_ANALYSIS_NODE_EVENT, capabilityNote, useAiCapability, type OpenAnalysisNodeDetail } from "./shared";

export type GuidedSectionId = "runs" | "suggestions" | "reports";

/** The lists under the analyses. */
const LISTS: (SidebarSection & { id: GuidedSectionId })[] = [
  { id: "suggestions", labelKey: "analysis.sections.suggestions", icon: Lightbulb },
  { id: "reports", labelKey: "analysis.sections.reports", icon: FileText },
];

const NEW_ANALYSIS: SidebarSection = { id: "new", labelKey: "analysis.run.start", icon: Play };

const STORAGE_KEY = "portfolio_guided_section";
const POLL_MS = 2_000;

/** Overview, Graph and History were pages before; each now lives in an analysis. */
const OLD_SECTIONS = new Set(["overview", "graph", "history"]);

export function resolveGuidedSection(id: string | undefined): GuidedSectionId | null {
  if (id === "runs" || (id && OLD_SECTIONS.has(id))) return "runs";
  return LISTS.some((s) => s.id === id) ? (id as GuidedSectionId) : null;
}

export function savedGuidedSection(): GuidedSectionId {
  try {
    return resolveGuidedSection(localStorage.getItem(STORAGE_KEY) ?? undefined) ?? "runs";
  } catch {
    return "runs";
  }
}

export function saveGuidedSection(id: GuidedSectionId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/** Pages that fill the height and scroll inside. */
export const GUIDED_FILL_SECTIONS: ReadonlySet<GuidedSectionId> = new Set(["runs", "suggestions", "reports"]);

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

/** The analysis picked per portfolio; survives leaving the tab. `null` is the new-analysis page. */
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
      // A run that just ended changes the suggestions and the reports.
      if (lastActive.current && !res.activeRunId) setFinishedStamp(new Date().toISOString());
      lastActive.current = res.activeRunId;
      // Nothing picked yet on this portfolio: a running analysis is what to show.
      if (res.activeRunId && !pickedRuns.has(portfolioId)) selectRun(res.activeRunId);
    } catch {
      // The next poll or reload tries again.
    }
  }, [portfolioId, selectRun]);

  useEffect(() => {
    setList(null);
    setLoaded(null);
    setSelectedRunId(portfolioId ? (pickedRuns.get(portfolioId) ?? null) : null);
    lastActive.current = undefined;
    void loadList();
  }, [portfolioId, loadList]);

  // A deleted or expired run falls back to the new-analysis page.
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
      if (wanted.current === runId) setLoaded(res);
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
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void loadList();
      if (watching) void loadDetail();
    }, POLL_MS);
    return () => clearInterval(timer);
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

interface NewAnalysisProps {
  hasRuns: boolean;
  activeRunId?: string;
  note: string | null;
  canRun: boolean;
  starting: boolean;
  noToolCalling: boolean;
  onStart: () => void;
  onOpenRun: (id: string) => void;
  onProbe: () => void;
  onOpenSettings: () => void;
}

function NewAnalysis({ hasRuns, activeRunId, note, canRun, starting, noToolCalling, onStart, onOpenRun, onProbe, onOpenSettings }: NewAnalysisProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="cx-card p-6 space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-100">
            <BrainCircuit className="w-4 h-4 text-[#DD3C73] shrink-0" />
            {t("analysis.run.title")}
          </h3>
          <p className="pl-6 text-xs text-slate-400 mt-1 leading-relaxed max-w-2xl font-sans">{t("analysis.run.subtitle")}</p>
          {!hasRuns && !note && <p className="pl-6 text-xs text-slate-400 mt-1 leading-relaxed max-w-2xl font-sans">{t("analysis.run.empty")}</p>}
        </div>

        {note && !activeRunId && (
          <div className="rounded-xl border border-cream/40 bg-cream/10 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-cream">
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
        )}

        <div className="pl-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onStart} disabled={!canRun || starting} className={ACCENT_BUTTON}>
            {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {t("analysis.run.start")}
          </button>
          {activeRunId && (
            <span className="inline-flex items-center gap-2 text-xs text-slate-300">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#DD3C73]" />
              {t("analysis.actions.running")}
              <button type="button" onClick={() => onOpenRun(activeRunId)} className="font-bold uppercase tracking-wider text-[11px] text-[#DD3C73] hover:underline cursor-pointer">
                {t("analysis.run.watch")}
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
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
  reports: PortfolioReport[];
  onRefreshReports: () => Promise<void>;
  onDeleteReport: (id: string) => void;
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
  reports,
  onRefreshReports,
  onDeleteReport,
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

  // A finished run changes the reports.
  useEffect(() => {
    if (runs.finishedStamp) void onRefreshReports();
  }, [runs.finishedStamp, onRefreshReports]);

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

  if (section === "runs" && !runs.runId) {
    body = (
      <NewAnalysis
        hasRuns={(runs.list?.runs.length ?? 0) > 0}
        activeRunId={runs.list?.activeRunId}
        note={note}
        canRun={canRun}
        starting={starting}
        noToolCalling={capability?.reason === "no_tool_calling"}
        onStart={() => void start()}
        onOpenRun={openRun}
        onProbe={() => void probe()}
        onOpenSettings={onOpenSettings}
      />
    );
  } else if (section === "runs" && !detail) {
    body = (
      <div className="cx-card flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      </div>
    );
  } else if (section === "runs" && detail) {
    const run = detail.run;
    const selected = selectedNode ? detail.nodes.find((n) => n.id === selectedNode) : undefined;
    body = (
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <StageBar states={stageStates(phase, status)} status={status} counts={stages} durations={stageDurations(detail.steps)} selected={stage} onSelect={pickStage} />
        <div className="shrink-0 space-y-2">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 min-w-0">
              <span className={`font-bold text-xs ${run.status === "failed" ? "text-rose-400" : run.status === "running" ? "text-[#DD3C73]" : "text-slate-100"}`}>{t(`analysis.run.status.${run.status}`)}</span>
              <span>{fmtWhen(run.startedAt)}</span>
              <span>
                · {t(`analysis.history.trigger.${run.trigger === "schedule" ? "schedule" : "manual"}`)} · {run.provider ?? ""}
                {run.model ? ` ${run.model}` : ""}
              </span>
              {run.status !== "running" && <span>· {t("analysis.run.counts", { findings: run.findingsCount, suggestions: run.suggestionsCount, steps: run.stepCount, tools: run.toolCount })}</span>}
              <RunBadges run={run} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {run.status === "running" && (
                <button type="button" onClick={() => void cancel()} className={BUTTON}>
                  <Square className="w-3.5 h-3.5" />
                  {t("analysis.run.cancel")}
                </button>
              )}
              {run.status === "completed" && (
                <button type="button" onClick={() => void compare(run.id)} aria-pressed={Boolean(comparison)} className={BUTTON}>
                  <GitCompare className="w-3.5 h-3.5" />
                  {t("analysis.history.compare")}
                </button>
              )}
              {run.status !== "running" && (
                <button
                  type="button"
                  onClick={() => void remove(run.id)}
                  aria-label={t("common.delete")}
                  title={t("common.delete")}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-slate-800/40 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          {run.error && (
            <div className="flex items-start gap-2 text-xs text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{run.error}</span>
            </div>
          )}
          {run.notes.length > 0 && (
            <ul className="text-[11px] text-slate-500 space-y-0.5 max-h-16 overflow-y-auto custom-scrollbar">
              {run.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {comparison?.currentRunId === run.id && (
            <div className="max-h-48 overflow-y-auto custom-scrollbar">
              <ComparisonView comparison={comparison} />
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3">
          <div className="cx-card flex-1 min-h-[360px] min-w-0 flex flex-col p-2">
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
          <aside className={`shrink-0 min-h-0 flex flex-col max-h-[60vh] lg:max-h-none ${stage === "report" ? "lg:w-1/2" : "lg:w-80 xl:w-96"}`}>
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
          </aside>
        </div>
      </div>
    );
  } else if (section === "suggestions") {
    body = (
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
    );
  } else if (section === "reports") {
    body = (
      <div className="flex-1 flex flex-col min-h-0">
        <ReportsCard
          reports={reports}
          portfolioData={portfolioData}
          currency={currency}
          portfolioId={portfolioId}
          portfolioName={portfolioName}
          onRefreshReports={onRefreshReports}
          onDeleteReport={onDeleteReport}
          hideValues={hideValues}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 font-mono flex-1 min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <aside className="w-full min-h-0 flex flex-col gap-3 max-h-[40vh] lg:max-h-none overflow-y-auto custom-scrollbar">
        <BriefCard portfolioId={portfolioId} portfolioName={portfolioName} aiReady={Boolean(capability?.aiReady)} compact />
        <SidebarEntry section={NEW_ANALYSIS} isActive={section === "runs" && !runs.runId} onSelect={() => openRun(null)} />
        <RunList runs={runs.list?.runs ?? []} selectedId={section === "runs" ? runs.runId : null} onSelect={openRun} />
        <nav className="space-y-1 mt-auto pt-3 border-t border-line" aria-label={t("layout.tabs.analysis")}>
          {LISTS.map((sec) => (
            <SidebarEntry key={sec.id} section={sec} isActive={section === sec.id} onSelect={() => onSectionChange(sec.id)} badge={sec.id === "suggestions" && suggestionsCount > 0 ? suggestionsCount : undefined} />
          ))}
        </nav>
      </aside>
      <div className="min-w-0 min-h-0 flex flex-col">{body}</div>
    </div>
  );
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
