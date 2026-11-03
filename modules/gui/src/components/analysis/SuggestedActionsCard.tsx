/**
 * Suggested actions on the Overview: the open suggestions by priority (the
 * top 3, then "show all"), each with its action, symbol, weight change and
 * the one-line why. Done and Dismiss work in place; Why opens the reasoning
 * path in the Analysis tab. The header shows the date of the last run, the
 * "stale" and "brief changed" badges, and Run analysis.
 *
 * Without an AI provider the card offers the brief form and a link to
 * Settings; with a model that cannot call tools, Run is disabled with the
 * same link.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Check, Lightbulb, Loader2, Network, Pencil, Play, Settings, X } from "lucide-react";
import type { AnalysisRunListItem, GetSuggestionsResponse } from "portfolio-shared/api-types";
import type { FinancialPortfolioData } from "portfolio-shared/portfolio";
import { compareSuggestions, evaluateSuggestion, marketForSymbol, type PortfolioSuggestion } from "portfolio-shared/suggestions";
import { api } from "../../api";
import { t } from "../../i18n";
import { showToast } from "../common/Toaster";
import { HoldingLink } from "../portfolio/holding-links";
import { formatTimeAgo } from "../portfolio/utils";
import { BriefEditorModal } from "./BriefEditorModal";
import { usePortfolioBrief } from "./BriefCard";
import { capabilityNote, openAnalysisNode, useAiCapability } from "./shared";

const TOP = 3;
const POLL_MS = 3_000;

interface SuggestedActionsCardProps {
  portfolioId: string | null;
  portfolioName?: string;
  portfolioData: FinancialPortfolioData | null;
  currency: string;
  suggestions: GetSuggestionsResponse | null;
  onSuggestionsChange: (data: GetSuggestionsResponse) => void;
  /** Opens the Analysis tab, on a page. */
  onOpenAnalysis: (section: "overview" | "suggestions" | "graph") => void;
  onOpenSettings: () => void;
}

const BUTTON =
  "h-7 inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-slate-800 bg-slate-950 text-[10px] font-bold text-slate-300 hover:bg-slate-900 hover:border-slate-700 hover:text-slate-50 transition-colors cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed";
const ACCENT_BUTTON =
  "h-7 inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-[10px] font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed";

export function SuggestedActionsCard({ portfolioId, portfolioName, portfolioData, currency, suggestions, onSuggestionsChange, onOpenAnalysis, onOpenSettings }: SuggestedActionsCardProps) {
  const { capability } = useAiCapability();
  const { brief } = usePortfolioBrief(portfolioId);
  const [lastRun, setLastRun] = useState<AnalysisRunListItem | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const activeRef = useRef<string | undefined>(undefined);

  const loadRuns = useCallback(async () => {
    if (!portfolioId) return;
    try {
      const res = await api.listAnalysisRuns(portfolioId);
      setLastRun(res.runs.find((r) => r.status === "completed") ?? null);
      // A run that ended changed the suggestions.
      if (activeRef.current && !res.activeRunId) void api.getSuggestions(portfolioId, currency).then(onSuggestionsChange).catch(() => {});
      activeRef.current = res.activeRunId;
      setActiveRunId(res.activeRunId);
    } catch {
      // The card stays as it is.
    }
  }, [portfolioId, currency, onSuggestionsChange]);

  useEffect(() => {
    setLastRun(null);
    setActiveRunId(undefined);
    activeRef.current = undefined;
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!activeRunId) return;
    const timer = setInterval(() => void loadRuns(), POLL_MS);
    return () => clearInterval(timer);
  }, [activeRunId, loadRuns]);

  const holdings = useMemo(() => portfolioData?.holdings ?? [], [portfolioData]);
  const totalValue = portfolioData?.summary?.totalPortfolioValue || portfolioData?.summary?.totalValue;
  const open = useMemo(() => {
    if (!suggestions || suggestions.portfolioId !== portfolioId) return [];
    return [...suggestions.suggestions]
      .sort(compareSuggestions)
      .map((s) => ({ s, ev: evaluateSuggestion(s, marketForSymbol(s.symbol, holdings, suggestions.quotes), totalValue) }))
      .filter((r) => r.ev.status === "active");
  }, [suggestions, portfolioId, holdings, totalValue]);
  const shown = showAll ? open : open.slice(0, TOP);

  if (!portfolioId) return null;

  const note = capabilityNote(capability);
  const noAi = capability !== null && (capability.reason === "not_configured" || capability.reason === "not_verified");

  const setStatus = async (s: PortfolioSuggestion, status: "done" | "dismissed") => {
    setBusyId(s.id);
    try {
      await api.updateSuggestionStatus({ portfolioId, suggestionId: s.id, status, baseCurrency: currency });
      onSuggestionsChange(await api.getSuggestions(portfolioId, currency));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  const run = async () => {
    setStarting(true);
    try {
      const res = await api.startAnalysisRun(portfolioId, currency);
      activeRef.current = res.run.id;
      setActiveRunId(res.run.id);
      onOpenAnalysis("overview");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="cx-card p-4 font-mono">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-100">
            <Lightbulb className="w-4 h-4 text-[#DD3C73] shrink-0" />
            {t("analysis.actions.title")}
            {open.length > 0 && <span className="text-slate-500">({open.length})</span>}
          </h3>
          <div className="pl-6 mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            {activeRunId ? (
              <span className="inline-flex items-center gap-1 text-[#DD3C73]">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t("analysis.actions.running")}
              </span>
            ) : lastRun ? (
              <span>{t("analysis.actions.lastRun", { time: formatTimeAgo(lastRun.endedAt ?? lastRun.startedAt) })}</span>
            ) : (
              <span>{t("analysis.actions.noRun")}</span>
            )}
            {lastRun?.stale && <span className="px-1.5 py-0.5 rounded-sm border border-cream/40 bg-cream/10 text-cream text-[9px] font-bold uppercase tracking-wider">{t("analysis.run.stale")}</span>}
            {lastRun?.briefChanged && <span className="px-1.5 py-0.5 rounded-sm border border-cream/40 bg-cream/10 text-cream text-[9px] font-bold uppercase tracking-wider">{t("analysis.run.briefChanged")}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!noAi && (
            <button type="button" onClick={() => void run()} disabled={Boolean(note) || Boolean(activeRunId) || starting} title={note ?? undefined} className={ACCENT_BUTTON}>
              {starting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {t("analysis.actions.run")}
            </button>
          )}
          {(noAi || note) && (
            <button type="button" onClick={onOpenSettings} className={BUTTON}>
              <Settings className="w-3 h-3" />
              {t("analysis.capability.openSettings")}
            </button>
          )}
        </div>
      </div>

      {noAi && (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
          <span>{t("analysis.actions.noAi")}</span>
          <button type="button" onClick={() => setBriefOpen(true)} className={BUTTON}>
            <Pencil className="w-3 h-3" />
            {brief ? t("analysis.brief.edit") : t("analysis.brief.write")}
          </button>
        </div>
      )}
      {!noAi && note && <p className="mt-2 text-[11px] text-cream">{note}</p>}

      {open.length === 0 && !noAi && (
        <p className="mt-3 text-xs text-slate-400">{lastRun ? suggestions?.summary || t("analysis.actions.none") : t("analysis.actions.firstRun")}</p>
      )}

      {shown.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-800/70">
          {shown.map(({ s, ev }) => {
            const sell = s.action === "decrease" || s.action === "close";
            const Arrow = sell ? ArrowDownRight : ArrowUpRight;
            return (
              <li key={s.id} className="py-2.5 flex items-start gap-3">
                <span className={`mt-0.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm border border-line bg-widget text-[10px] font-bold uppercase tracking-wider shrink-0 ${sell ? "text-rose-400" : "text-mint"}`}>
                  <Arrow className="w-3 h-3" />
                  {t(`assistant.suggestions.action.${s.action}`)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-bold text-slate-100">
                      <HoldingLink reference={s.symbol} />
                    </span>
                    <span className="text-slate-400">
                      {ev.currentWeight.toFixed(1)}% → {s.targetWeight.toFixed(1)}%
                    </span>
                    <span className="text-slate-200 font-sans font-semibold">{s.title}</span>
                  </div>
                  {s.why && <p className="text-[11px] text-slate-400 font-sans truncate" title={s.why}>{s.why}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {s.evidence && s.runId && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenAnalysis("graph");
                        // The Analysis tab mounts first, then picks up the request.
                        setTimeout(() => openAnalysisNode({ runId: s.runId, suggestionId: s.id }), 0);
                      }}
                      className={BUTTON}
                      title={t("analysis.why.button")}
                    >
                      <Network className="w-3 h-3" />
                      {t("analysis.why.button")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void setStatus(s, "done")}
                    disabled={busyId === s.id}
                    title={t("assistant.suggestions.markDone")}
                    aria-label={t("assistant.suggestions.markDone")}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-mint hover:bg-slate-800/40 cursor-pointer"
                  >
                    {busyId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void setStatus(s, "dismissed")}
                    disabled={busyId === s.id}
                    title={t("assistant.suggestions.dismiss")}
                    aria-label={t("assistant.suggestions.dismiss")}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-[#DD3C73] hover:bg-slate-800/40 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open.length > TOP && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 cursor-pointer">
          {showAll ? t("analysis.actions.showFewer") : t("analysis.actions.showAll", { count: open.length })}
        </button>
      )}
      {open.length > 0 && (
        <button type="button" onClick={() => onOpenAnalysis("suggestions")} className="mt-1 ml-3 text-[11px] font-bold uppercase tracking-wider text-[#DD3C73] hover:underline cursor-pointer">
          {t("analysis.actions.openList")}
        </button>
      )}

      <BriefEditorModal isOpen={briefOpen} onClose={() => setBriefOpen(false)} portfolioId={portfolioId} portfolioName={portfolioName} brief={brief} />
    </div>
  );
}
