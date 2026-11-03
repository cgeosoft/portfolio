/**
 * The Analysis tab: the home of Guided Analysis. A sidebar like Settings
 * picks one page at a time:
 *
 * - Overview: the brief, the Run button, the live run, the last short report.
 * - Suggestions: the full list, each with its reasoning path (Why).
 * - Graph: the evidence graph of a run, live while it runs.
 * - History: the last runs, with a comparison against the run before.
 * - Reports: the long report on demand and every stored report.
 *
 * The tab follows a running analysis by polling, as suggestion generation
 * did before.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Circle,
  FileText,
  GitCompare,
  History,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  Network,
  Play,
  Settings,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import { ANALYSIS_PHASES, type AnalysisNodeKind, type AnalysisRunListItem, type CompareAnalysisRunsResponse, type GetAnalysisRunResponse, type GetSuggestionsResponse, type ListAnalysisRunsResponse, type AppTheme } from "portfolio-shared/api-types";
import type { FinancialPortfolioData, PortfolioReport } from "portfolio-shared/portfolio";
import type { PortfolioSuggestion } from "portfolio-shared/suggestions";
import { api } from "../../api";
import { getLocale, t } from "../../i18n";
import { showToast } from "../common/Toaster";
import { SafeMarkdown, type InAppLinkRenderer } from "../common/SafeMarkdown";
import { SidebarEntry, type SidebarSection } from "../settings/SettingsPrimitives";
import { REPORT_MARKDOWN, ReportsCard } from "../portfolio/ReportsCard";
import { SuggestionsPage } from "../portfolio/SuggestionsPage";
import { renderHoldingAnchor, useHoldingLinkPlugin } from "../portfolio/holding-links";
import { formatTimeAgo } from "../portfolio/utils";
import { AnalysisGraph, KindFilters } from "./AnalysisGraph";
import { BriefCard } from "./BriefCard";
import { NodeDetails } from "./NodeDetails";
import { WhyPathPanel, whyPath } from "./WhyPath";
import { OPEN_ANALYSIS_NODE_EVENT, capabilityNote, phaseLabel, useAiCapability, type OpenAnalysisNodeDetail } from "./shared";

export type GuidedSectionId = "overview" | "suggestions" | "graph" | "history" | "reports";

const SECTIONS: (SidebarSection & { id: GuidedSectionId })[] = [
  { id: "overview", labelKey: "analysis.sections.overview", icon: LayoutDashboard },
  { id: "suggestions", labelKey: "analysis.sections.suggestions", icon: Lightbulb },
  { id: "graph", labelKey: "analysis.sections.graph", icon: Network },
  { id: "history", labelKey: "analysis.sections.history", icon: History },
  { id: "reports", labelKey: "analysis.sections.reports", icon: FileText },
];

const STORAGE_KEY = "portfolio_guided_section";
const POLL_MS = 2_000;

export function resolveGuidedSection(id: string | undefined): GuidedSectionId | null {
  return SECTIONS.some((s) => s.id === id) ? (id as GuidedSectionId) : null;
}

export function savedGuidedSection(): GuidedSectionId {
  try {
    return resolveGuidedSection(localStorage.getItem(STORAGE_KEY) ?? undefined) ?? "overview";
  } catch {
    return "overview";
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
export const GUIDED_FILL_SECTIONS: ReadonlySet<GuidedSectionId> = new Set(["suggestions", "graph", "reports"]);

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

/** The runs of a portfolio and the open one in full, polled while a run is going. */
function useRuns(portfolioId: string | null) {
  const [list, setList] = useState<ListAnalysisRunsResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GetAnalysisRunResponse | null>(null);
  const [finishedStamp, setFinishedStamp] = useState("");
  const lastActive = useRef<string | undefined>(undefined);

  const loadList = useCallback(async () => {
    if (!portfolioId) return;
    try {
      const res = await api.listAnalysisRuns(portfolioId);
      setList(res);
      // A run that just ended changes the suggestions and the reports.
      if (lastActive.current && !res.activeRunId) setFinishedStamp(new Date().toISOString());
      lastActive.current = res.activeRunId;
    } catch {
      // The next poll or reload tries again.
    }
  }, [portfolioId]);

  useEffect(() => {
    setList(null);
    setDetail(null);
    setSelectedRunId(null);
    lastActive.current = undefined;
    void loadList();
  }, [loadList]);

  const runId = selectedRunId ?? list?.activeRunId ?? list?.runs[0]?.id ?? null;

  const loadDetail = useCallback(async () => {
    if (!runId) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await api.getAnalysisRun(runId));
    } catch {
      setDetail(null);
    }
  }, [runId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, finishedStamp]);

  const running = Boolean(list?.activeRunId);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void loadList();
      void loadDetail();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, loadList, loadDetail]);

  return { list, runId, detail, setSelectedRunId, reload: loadList, finishedStamp, running };
}

// ── stepper and log ─────────────────────────────────────────────────────────

function PhaseStepper({ phase, status }: { phase: string; status: AnalysisRunListItem["status"] }) {
  const current = ANALYSIS_PHASES.indexOf(phase as (typeof ANALYSIS_PHASES)[number]);
  const done = phase === "done" || status === "completed";
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-bold uppercase tracking-wider">
      {ANALYSIS_PHASES.map((p, i) => {
        const state = done || i < current ? "done" : i === current ? (status === "running" ? "active" : "stopped") : "todo";
        return (
          <li key={p} className="flex items-center gap-1.5">
            {i > 0 && <span className="w-3 h-px bg-slate-700" aria-hidden="true" />}
            <span className={`inline-flex items-center gap-1 ${state === "done" ? "text-mint" : state === "active" ? "text-[#DD3C73]" : state === "stopped" ? "text-cream" : "text-slate-600"}`}>
              {state === "done" ? <CheckCircle2 className="w-3 h-3" /> : state === "active" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Circle className="w-3 h-3" />}
              {phaseLabel(p)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepLog({ detail }: { detail: GetAnalysisRunResponse }) {
  const steps = [...detail.steps].reverse();
  return (
    <div className="cx-card p-3.5 flex flex-col gap-2 min-h-0 overflow-y-auto custom-scrollbar text-xs">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("analysis.log.title", { count: detail.steps.length })}</div>
      {detail.live && (
        <div className="rounded-lg border border-[#DD3C73]/30 bg-[#DD3C73]/10 px-2.5 py-2 text-[#DD3C73] flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="min-w-0">{detail.live.message || phaseLabel(detail.live.phase)}</span>
        </div>
      )}
      {steps.length === 0 && <p className="text-slate-500">{t("analysis.log.empty")}</p>}
      <ul className="space-y-2">
        {steps.map((s) => {
          const actions = (s.actions ?? {}) as { calls?: { name: string; args?: Record<string, unknown>; questionId?: string }[] };
          const results = (s.results ?? {}) as { errors?: string[]; error?: string };
          return (
            <li key={s.id} className="border-l-2 border-slate-800 pl-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {s.stepIndex + 1}. {phaseLabel(s.phase)} · {(s.durationMs / 1000).toFixed(1)} s
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
    </div>
  );
}

function RunBadges({ run }: { run: AnalysisRunListItem }) {
  return (
    <>
      {run.briefChanged && <span className="px-1.5 py-0.5 rounded-sm border border-cream/40 bg-cream/10 text-cream text-[10px] font-bold uppercase tracking-wider">{t("analysis.run.briefChanged")}</span>}
      {run.stale && <span className="px-1.5 py-0.5 rounded-sm border border-cream/40 bg-cream/10 text-cream text-[10px] font-bold uppercase tracking-wider">{t("analysis.run.stale")}</span>}
    </>
  );
}

function statusText(run: AnalysisRunListItem): string {
  return t(`analysis.run.status.${run.status}`);
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
  const { setSelectedRunId } = runs;
  const [starting, setStarting] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [whySuggestion, setWhySuggestion] = useState<PortfolioSuggestion | null>(null);
  const [hiddenKinds, setHiddenKinds] = useState<Set<AnalysisNodeKind>>(new Set());
  const [comparison, setComparison] = useState<CompareAnalysisRunsResponse | null>(null);
  const holdingLinkPlugin = useHoldingLinkPlugin();

  const note = capabilityNote(capability);
  const canRun = !note && !runs.running && Boolean(portfolioId);
  const detail = runs.detail;
  const latestCompleted = runs.list?.runs.find((r) => r.status === "completed");

  // A finished run changes the reports.
  useEffect(() => {
    if (runs.finishedStamp) void onRefreshReports();
  }, [runs.finishedStamp, onRefreshReports]);

  // Links from other views: open a node or the path of a suggestion.
  const pendingFocus = useRef<OpenAnalysisNodeDetail | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<OpenAnalysisNodeDetail>).detail ?? {};
      pendingFocus.current = d;
      if (d.runId) setSelectedRunId(d.runId);
      onSectionChange("graph");
    };
    window.addEventListener(OPEN_ANALYSIS_NODE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ANALYSIS_NODE_EVENT, onOpen);
  }, [onSectionChange, setSelectedRunId]);
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
      runs.setSelectedRunId(res.run.id);
      setSelectedNode(null);
      setWhySuggestion(null);
      await runs.reload();
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

  const openWhy = useCallback(
    (s: PortfolioSuggestion) => {
      if (!s.runId) return;
      pendingFocus.current = { runId: s.runId, suggestionId: s.id };
      setSelectedRunId(s.runId);
      onSectionChange("graph");
      if (detail?.run.id === s.runId) {
        setWhySuggestion(detail.suggestions?.find((x) => x.id === s.id) ?? s);
        setSelectedNode(null);
        pendingFocus.current = null;
      }
    },
    [detail, onSectionChange, setSelectedRunId],
  );

  // Node links in the short report open the node in the graph.
  const renderLink: InAppLinkRenderer = useCallback(
    (href, children) => {
      const m = /^#node\/([A-Z]\d*)$/.exec(href ?? "");
      if (m) {
        return (
          <button
            type="button"
            onClick={() => {
              setWhySuggestion(null);
              setSelectedNode(m[1]!);
              if (latestCompleted) setSelectedRunId(latestCompleted.id);
              onSectionChange("graph");
            }}
            className="text-[#DD3C73] underline underline-offset-2 hover:text-accent-bright cursor-pointer font-mono text-[11px]"
          >
            {children}
          </button>
        );
      }
      return renderHoldingAnchor(href, children, () => null);
    },
    [latestCompleted, onSectionChange, setSelectedRunId],
  );

  // The overview shows the report of the newest completed run.
  const [latestReport, setLatestReport] = useState<GetAnalysisRunResponse | null>(null);
  // The open run's detail serves when it is the newest completed one; else one fetch per completed run.
  const latestDetail = detail && latestCompleted && detail.run.id === latestCompleted.id ? detail : null;
  useEffect(() => {
    if (!latestCompleted) {
      setLatestReport(null);
      return;
    }
    if (latestDetail) {
      setLatestReport(latestDetail);
      return;
    }
    let cancelled = false;
    void api
      .getAnalysisRun(latestCompleted.id)
      .then((res) => !cancelled && setLatestReport(res))
      .catch(() => !cancelled && setLatestReport(null));
    return () => {
      cancelled = true;
    };
  }, [latestCompleted?.id, latestCompleted?.updatedAt, latestDetail]);

  useEffect(() => {
    setComparison(null);
  }, [runs.runId]);

  if (!portfolioId) return null;

  const fill = GUIDED_FILL_SECTIONS.has(section);
  const activeRun = runs.list?.runs.find((r) => r.id === runs.list?.activeRunId);

  let body: ReactNode = null;

  if (section === "overview") {
    const shown = activeRun ?? latestCompleted ?? runs.list?.runs[0];
    body = (
      <div className="space-y-4">
        <BriefCard portfolioId={portfolioId} portfolioName={portfolioName} aiReady={Boolean(capability?.aiReady)} />

        <div className="cx-card p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-100">
                <BrainCircuit className="w-4 h-4 text-[#DD3C73] shrink-0" />
                {t("analysis.run.title")}
              </h3>
              <p className="pl-6 text-[11px] text-slate-500 mt-0.5">{t("analysis.run.subtitle")}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {runs.running ? (
                <button type="button" onClick={() => void cancel()} className={BUTTON}>
                  <Square className="w-3.5 h-3.5" />
                  {t("analysis.run.cancel")}
                </button>
              ) : (
                <button type="button" onClick={() => void start()} disabled={!canRun || starting} className={ACCENT_BUTTON}>
                  {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {runs.list?.runs.length ? t("analysis.run.runAgain") : t("analysis.run.start")}
                </button>
              )}
            </div>
          </div>

          {note && !runs.running && (
            <div className="rounded-xl border border-cream/40 bg-cream/10 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-cream">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                <span>{note}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {capability?.reason === "no_tool_calling" && (
                  <button type="button" onClick={() => void probe()} className="font-bold uppercase tracking-wider hover:underline cursor-pointer">
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

          {shown && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span className={shown.status === "failed" ? "text-rose-400" : shown.status === "running" ? "text-[#DD3C73]" : "text-slate-300"}>{statusText(shown)}</span>
                <span>· {fmtWhen(shown.startedAt)}</span>
                {shown.status !== "running" && (
                  <span>
                    · {t("analysis.run.counts", { findings: shown.findingsCount, suggestions: shown.suggestionsCount, steps: shown.stepCount, tools: shown.toolCount })}
                  </span>
                )}
                <RunBadges run={shown} />
              </div>
              <PhaseStepper phase={shown.phase} status={shown.status} />
              {shown.status === "running" && detail?.live && (
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#DD3C73]" />
                  {detail.live.message || phaseLabel(detail.live.phase)}
                  <button type="button" onClick={() => onSectionChange("graph")} className="ml-2 font-bold uppercase tracking-wider text-[11px] text-[#DD3C73] hover:underline cursor-pointer">
                    {t("analysis.run.watch")}
                  </button>
                </div>
              )}
              {shown.error && (
                <div className="flex items-start gap-2 text-xs text-rose-400">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{shown.error}</span>
                </div>
              )}
              {shown.notes.length > 0 && (
                <ul className="text-[11px] text-slate-500 space-y-0.5">
                  {shown.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!shown && !note && <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">{t("analysis.run.empty")}</p>}
        </div>

        {latestReport?.report && (
          <div className="cx-card p-4">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-100">
                <FileText className="w-4 h-4 text-[#DD3C73] shrink-0" />
                {t("analysis.report.title")}
              </h3>
              <span className="text-[11px] text-slate-500">{formatTimeAgo(latestReport.run.endedAt ?? latestReport.run.startedAt)}</span>
            </div>
            <div className="text-sm font-sans">
              <SafeMarkdown components={REPORT_MARKDOWN} remarkPlugin={holdingLinkPlugin} renderInAppLink={renderLink}>
                {latestReport.report.content}
              </SafeMarkdown>
            </div>
          </div>
        )}
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
  } else if (section === "graph") {
    const run = detail?.run;
    const selected = selectedNode ? detail?.nodes.find((n) => n.id === selectedNode) : undefined;
    body = (
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {(runs.list?.runs.length ?? 0) > 0 && (
              <select
                value={runs.runId ?? ""}
                onChange={(e) => {
                  runs.setSelectedRunId(e.target.value || null);
                  setSelectedNode(null);
                  setWhySuggestion(null);
                }}
                aria-label={t("analysis.graph.pickRun")}
                className="h-8 bg-slate-950 border border-slate-800 rounded-lg px-2 text-xs text-slate-200 font-mono"
              >
                {runs.list!.runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {fmtWhen(r.startedAt)} · {statusText(r)}
                  </option>
                ))}
              </select>
            )}
            {run && <PhaseStepper phase={run.phase} status={run.status} />}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {runs.running ? (
              <button type="button" onClick={() => void cancel()} className={BUTTON}>
                <Square className="w-3.5 h-3.5" />
                {t("analysis.run.cancel")}
              </button>
            ) : (
              <button type="button" onClick={() => void start()} disabled={!canRun || starting} className={ACCENT_BUTTON} title={note ?? undefined}>
                {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {t("analysis.run.start")}
              </button>
            )}
          </div>
        </div>
        {!detail ? (
          <div className="cx-card flex-1 flex flex-col items-center justify-center p-10 text-center">
            <Network className="w-8 h-8 text-slate-600 mb-3" />
            <p className="max-w-md text-xs text-slate-400">{note ?? t("analysis.graph.empty")}</p>
          </div>
        ) : (
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
                  highlight={path?.ids ?? null}
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
            <aside className="lg:w-80 xl:w-96 shrink-0 min-h-0 flex flex-col max-h-[60vh] lg:max-h-none">
              {whySuggestion && path ? (
                <WhyPathPanel suggestion={whySuggestion} path={path} onSelect={(id) => setSelectedNode(id)} />
              ) : selected ? (
                <NodeDetails node={selected} nodes={detail.nodes} edges={detail.edges} hideValues={hideValues} onSelect={setSelectedNode} onClose={() => setSelectedNode(null)} />
              ) : (
                <StepLog detail={detail} />
              )}
              {whySuggestion && selected && (
                <div className="mt-3 min-h-0 flex flex-col">
                  <NodeDetails node={selected} nodes={detail.nodes} edges={detail.edges} hideValues={hideValues} onSelect={setSelectedNode} onClose={() => setSelectedNode(null)} />
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    );
  } else if (section === "history") {
    const list = runs.list?.runs ?? [];
    body = (
      <div className="space-y-3">
        {list.length === 0 && <div className="cx-card p-6 text-center text-xs text-slate-400">{t("analysis.history.empty")}</div>}
        {list.map((r) => (
          <div key={r.id} className="cx-card p-3.5 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs min-w-0">
                {r.status === "completed" ? (
                  <CheckCircle2 className="w-4 h-4 text-mint shrink-0" />
                ) : r.status === "running" ? (
                  <Loader2 className="w-4 h-4 text-[#DD3C73] animate-spin shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-slate-500 shrink-0" />
                )}
                <span className="font-bold text-slate-100">{fmtWhen(r.startedAt)}</span>
                <span className="text-slate-400">{statusText(r)}</span>
                <span className="text-slate-500">
                  {t(`analysis.history.trigger.${r.trigger === "schedule" ? "schedule" : "manual"}`)} · {r.provider ?? ""}
                  {r.model ? ` ${r.model}` : ""}
                </span>
                <RunBadges run={r} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    runs.setSelectedRunId(r.id);
                    setSelectedNode(null);
                    setWhySuggestion(null);
                    onSectionChange("graph");
                  }}
                  className={BUTTON}
                >
                  <Network className="w-3.5 h-3.5" />
                  {t("analysis.history.openGraph")}
                </button>
                {r.status === "completed" && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        runs.setSelectedRunId(r.id);
                        setComparison(await api.compareAnalysisRun(r.id));
                      } catch (e) {
                        showToast(e instanceof Error ? e.message : String(e), "error");
                      }
                    }}
                    className={BUTTON}
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                    {t("analysis.history.compare")}
                  </button>
                )}
                {r.status !== "running" && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await api.deleteAnalysisRun(portfolioId, r.id);
                        if (runs.runId === r.id) runs.setSelectedRunId(null);
                        await runs.reload();
                      } catch (e) {
                        showToast(e instanceof Error ? e.message : String(e), "error");
                      }
                    }}
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-slate-800/40 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            {r.summary && <p className="text-xs text-slate-300 leading-relaxed font-sans">{r.summary}</p>}
            <div className="text-[11px] text-slate-500">{t("analysis.run.counts", { findings: r.findingsCount, suggestions: r.suggestionsCount, steps: r.stepCount, tools: r.toolCount })}</div>
            {comparison && comparison.currentRunId === r.id && <ComparisonView comparison={comparison} />}
          </div>
        ))}
      </div>
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
    <div className={`grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 font-mono ${fill ? "flex-1 min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]" : "items-start"}`}>
      <aside className="w-full lg:sticky lg:top-0">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <BrainCircuit className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>{t("layout.tabs.analysis")}</span>
        </div>
        <nav className="space-y-1 mt-1" aria-label={t("layout.tabs.analysis")}>
          {SECTIONS.map((sec) => (
            <SidebarEntry
              key={sec.id}
              section={sec}
              isActive={section === sec.id}
              onSelect={() => onSectionChange(sec.id)}
              badge={sec.id === "suggestions" && suggestionsCount > 0 ? suggestionsCount : undefined}
            />
          ))}
        </nav>
      </aside>
      <div className={`min-w-0 ${fill ? "min-h-0 flex flex-col" : ""}`}>{body}</div>
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
