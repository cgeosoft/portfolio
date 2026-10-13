import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  Lightbulb,
  RefreshCw,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import type { FinancialPortfolioData } from "portfolio-shared/portfolio";
import type { GetSuggestionsResponse } from "portfolio-shared/api-types";
import {
  compareSuggestions,
  evaluateSuggestion,
  marketForSymbol,
  projectTargetPortfolio,
  type PortfolioSuggestion,
  type SuggestionEvaluation,
  type SuggestionStatus,
  type TargetPortfolio,
} from "portfolio-shared/suggestions";
import { api } from "../../api";
import { showToast } from "../common/Toaster";
import { getLocale, t } from "../../i18n";
import { fmtCurrency, formatTimeAgo } from "./utils";
import { HoldingLink } from "./holding-links";

interface SuggestionsPageProps {
  portfolioId: string | null | undefined;
  portfolioData: FinancialPortfolioData | null;
  currency: string;
  hideValues?: boolean;
  /** Receives every loaded or changed result, so the header badge follows the page. */
  onDataChange?: (data: GetSuggestionsResponse) => void;
}

/** How often the page asks for the result while a generation runs. */
const POLL_MS = 2_000;

/** localStorage key of the "hide done" choice on this device. */
const HIDE_DONE_KEY = "portfolio_suggestions_hide_done";

function loadHideDone(): boolean {
  try {
    return localStorage.getItem(HIDE_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

interface Row {
  s: PortfolioSuggestion;
  ev: SuggestionEvaluation;
}

const ACTIONS: readonly string[] = ["increase", "decrease", "open", "close"];

const actionLabel = (action: PortfolioSuggestion["action"]) => t(`assistant.suggestions.action.${action}`);
const statusLabel = (status: SuggestionStatus) => t(`assistant.suggestions.status.${status}`);

/** "decrease AAPL" for a funding link; a key with an unknown action shows as sent. */
function linkLabel(action: string, symbol: string): string {
  return ACTIONS.includes(action) ? t(`assistant.suggestions.linkAction.${action}`, { symbol }) : `${action} ${symbol}`;
}

/** A suggestion key (`action:SYMBOL`) as a funding link. */
function keyLabel(key: string): string {
  const at = key.indexOf(":");
  return at < 0 ? key : linkLabel(key.slice(0, at), key.slice(at + 1));
}

const STATUS_CLASS: Record<SuggestionStatus, string> = {
  active: "border-[#DD3C73]/40 bg-[#DD3C73]/10 text-[#DD3C73]",
  done: "border-mint/40 bg-mint/10 text-mint",
  cancelled: "border-cream/40 bg-cream/10 text-cream",
  superseded: "border-line bg-widget text-slate-400",
  dismissed: "border-line bg-widget text-slate-400",
};

const pp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)} pp`;
const pct = (n: number) => `${n.toFixed(2)}%`;
const isSell = (s: PortfolioSuggestion) => s.action === "decrease" || s.action === "close";

function fmtShares(n: number, hideValues: boolean): string {
  if (hideValues) return "••";
  const abs = Math.abs(n);
  return abs.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(abs) ? 0 : 4 });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function rangeText(min?: number, max?: number, unit = ""): string {
  if (min !== undefined && max !== undefined) return t("assistant.suggestions.range.between", { min: `${min}${unit}`, max: `${max}${unit}` });
  if (min !== undefined) return t("assistant.suggestions.range.above", { min: `${min}${unit}` });
  return t("assistant.suggestions.range.below", { max: `${max}${unit}` });
}

/** Rebalancing ideas from the assistant, with amounts computed here from live prices. */
export function SuggestionsPage({ portfolioId, portfolioData, currency, hideValues = false, onDataChange }: SuggestionsPageProps) {
  const [data, setData] = useState<GetSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(loadHideDone);

  const dataStamp = portfolioData?.summary?.lastUpdated ?? "";

  const load = useCallback(async () => {
    if (!portfolioId) return;
    try {
      setData(await api.getSuggestions(portfolioId, currency));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [portfolioId, currency]);

  // Reload with the portfolio data, so "Transactions changed" follows imports and edits.
  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load, dataStamp]);

  useEffect(() => {
    if (data) onDataChange?.(data);
  }, [data, onDataChange]);

  const running = data?.generation.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const generate = async () => {
    if (!portfolioId) return;
    setError(null);
    try {
      const generation = await api.generateSuggestions({ portfolioId, baseCurrency: currency });
      setData((prev) => (prev ? { ...prev, generation } : prev));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setStatus = async (s: PortfolioSuggestion, status: "active" | "done" | "dismissed") => {
    if (!portfolioId) return;
    setBusyId(s.id);
    try {
      const updated = await api.updateSuggestionStatus({ portfolioId, suggestionId: s.id, status, baseCurrency: currency });
      setData((prev) => (prev ? { ...prev, suggestions: prev.suggestions.map((x) => (x.id === updated.id ? updated : x)) } : prev));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  const holdings = useMemo(() => portfolioData?.holdings ?? [], [portfolioData]);
  const totalValue = portfolioData?.summary?.totalPortfolioValue || portfolioData?.summary?.totalValue;

  const rows: Row[] = useMemo(() => {
    const quotes = data?.quotes ?? [];
    return [...(data?.suggestions ?? [])]
      .sort(compareSuggestions)
      .map((s) => ({ s, ev: evaluateSuggestion(s, marketForSymbol(s.symbol, holdings, quotes), totalValue) }));
  }, [data, holdings, totalValue]);

  // The list keeps open suggestions and the ones done since the last generation, ticked, in priority order.
  // Older done ones and the cancelled, superseded and dismissed ones go to the history.
  const { listed, current, past } = useMemo(() => {
    const since = data?.generatedAt ?? "";
    const inList = (r: Row) => r.ev.status === "active" || (r.ev.status === "done" && (r.s.status === "active" || (r.s.resolvedAt ?? "") >= since));
    return {
      listed: rows.filter(inList),
      current: rows.filter((r) => r.ev.status === "active"),
      past: rows.filter((r) => !inList(r)),
    };
  }, [rows, data?.generatedAt]);

  const target: TargetPortfolio = useMemo(
    () =>
      projectTargetPortfolio(
        holdings.map((h) => ({ symbol: h.symbol, name: h.name, weight: h.weightPercent, isCash: h.assetType === "Cash" })),
        current.filter((r) => !excluded.has(r.s.id)).map((r) => r.s),
      ),
    [holdings, current, excluded],
  );

  const toggleHideDone = () => {
    const next = !hideDone;
    setHideDone(next);
    try {
      localStorage.setItem(HIDE_DONE_KEY, next ? "1" : "0");
    } catch {
      // localStorage unavailable: the choice lasts until the window closes.
    }
  };

  // Done suggestions stay in the list, ticked, unless the user hides them.
  const doneCount = listed.filter((r) => r.ev.status === "done").length;
  const shown = hideDone ? listed.filter((r) => r.ev.status !== "done") : listed;

  const toggleExcluded = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hasAny = (data?.suggestions.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3.5 flex-1 min-h-0 font-mono">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80 shrink-0">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-widest min-w-0">
            <Lightbulb className="w-4 h-4 text-[#DD3C73] shrink-0" />
            <span className="truncate">{t("assistant.suggestions.title")}</span>
          </h2>
          <p className="pl-6 text-[11px] text-slate-400 mt-0.5">
            {data?.generatedAt ? `${t("assistant.suggestions.generated", { time: formatTimeAgo(data.generatedAt) })} ` : ""}
            {t("assistant.suggestions.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasAny && doneCount > 0 && (
            <button
              type="button"
              onClick={toggleHideDone}
              aria-pressed={hideDone}
              className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-slate-800 bg-slate-950 text-xs font-bold text-slate-300 hover:bg-slate-900 hover:border-slate-700 hover:text-slate-50 transition-colors cursor-pointer uppercase tracking-wider"
            >
              {hideDone ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {hideDone ? t("assistant.suggestions.showDone", { count: doneCount }) : t("assistant.suggestions.hideDone", { count: doneCount })}
            </button>
          )}
          <button
            type="button"
            onClick={() => void generate()}
            disabled={running || !portfolioId}
            className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {running ? t("assistant.suggestions.generating") : hasAny ? t("assistant.suggestions.recalculate") : t("assistant.suggestions.generate")}
          </button>
        </div>
      </div>

      {/* Banners */}
      {data?.stale && !running && (
        <div className="rounded-xl border border-cream/40 bg-cream/10 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs text-cream shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t("assistant.suggestions.stale")}</span>
          </div>
          <button type="button" onClick={() => void generate()} className="font-bold uppercase tracking-wider hover:underline cursor-pointer shrink-0">
            {t("assistant.suggestions.recalculate")}
          </button>
        </div>
      )}
      {(error || data?.generation.status === "fail") && (
        <div className="rounded-xl border border-[#DD3C73]/40 bg-[#DD3C73]/10 px-3.5 py-2.5 flex items-center gap-2 text-xs text-[#DD3C73] shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="min-w-0 break-words">{error || data?.generation.error || t("assistant.suggestions.generationFailed")}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="cx-card flex-1 flex flex-col items-center justify-center min-h-0 p-10 text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-[#DD3C73] mb-3" />
          <div className="text-xs font-bold uppercase tracking-wider text-slate-300">{t("assistant.suggestions.loading")}</div>
        </div>
      ) : !hasAny ? (
        <div className="cx-card flex-1 flex flex-col items-center justify-center min-h-0 p-10 text-center">
          <div className="w-12 h-12 rounded-2xl border border-[#DD3C73]/30 bg-[#DD3C73]/10 flex items-center justify-center text-[#DD3C73] mb-4">
            {running ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Lightbulb className="w-6 h-6" />}
          </div>
          <div className="text-sm font-bold uppercase tracking-wider text-slate-100 mb-2">
            {running ? t("assistant.suggestions.generatingTitle") : data?.generatedAt ? t("assistant.suggestions.noChangeTitle") : t("assistant.suggestions.emptyTitle")}
          </div>
          <p className="max-w-md text-xs text-slate-400 leading-relaxed">
            {running ? t("assistant.suggestions.generatingDescription") : data?.generatedAt ? data.summary || t("assistant.suggestions.noneActive") : t("assistant.suggestions.emptyDescription")}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
          {/* Target portfolio, first on narrow screens */}
          <aside className="lg:order-2 lg:w-80 xl:w-96 lg:shrink-0 min-h-0 flex flex-col">
            <TargetPanel target={target} open={targetOpen} onToggle={() => setTargetOpen((v) => !v)} activeCount={current.length - current.filter((r) => excluded.has(r.s.id)).length} />
          </aside>

          {/* List */}
          <div className="lg:order-1 flex-1 min-w-0 min-h-0 overflow-y-auto custom-scrollbar space-y-3 pr-1">
            {data?.summary && <p className="text-xs text-slate-300 leading-relaxed">{data.summary}</p>}
            {(data?.notes.length ?? 0) > 0 && (
              <ul className="text-[11px] text-slate-500 space-y-0.5">
                {data!.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}

            {shown.length === 0 && (
              <div className="cx-card p-6 text-center text-xs text-slate-400">{t("assistant.suggestions.noneActive")}</div>
            )}
            {shown.map((r) =>
              r.ev.status === "active" ? (
                <SuggestionCard
                  key={r.s.id}
                  row={r}
                  all={rows}
                  currency={currency}
                  hideValues={hideValues}
                  busy={busyId === r.s.id}
                  excluded={excluded.has(r.s.id)}
                  onToggleExcluded={() => toggleExcluded(r.s.id)}
                  onCheck={() => void setStatus(r.s, "done")}
                  onDismiss={() => void setStatus(r.s, "dismissed")}
                />
              ) : (
                // A manual tick can be taken back; a reached target cannot.
                <SuggestionCard
                  key={r.s.id}
                  row={r}
                  all={rows}
                  currency={currency}
                  hideValues={hideValues}
                  busy={busyId === r.s.id}
                  onCheck={r.s.status === "done" ? () => void setStatus(r.s, "active") : undefined}
                />
              ),
            )}

            {past.length > 0 && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${historyOpen ? "" : "-rotate-90"}`} />
                  {t("assistant.suggestions.history", { count: past.length })}
                </button>
                {historyOpen && (
                  <div className="mt-2 space-y-2">
                    {past.map((r) => (
                      <SuggestionCard
                        key={r.s.id}
                        row={r}
                        all={rows}
                        currency={currency}
                        hideValues={hideValues}
                        busy={busyId === r.s.id}
                        compact
                        onReopen={r.s.status === "done" || r.s.status === "dismissed" ? () => void setStatus(r.s, "active") : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── suggestion card ─────────────────────────────────────────────────────────

interface SuggestionCardProps {
  row: Row;
  all: Row[];
  currency: string;
  hideValues: boolean;
  busy: boolean;
  compact?: boolean;
  excluded?: boolean;
  onToggleExcluded?: () => void;
  /** Ticks an open suggestion, or unticks one the user marked done. */
  onCheck?: () => void;
  onDismiss?: () => void;
  onReopen?: () => void;
}

function SuggestionCard({ row, all, currency, hideValues, busy, compact, excluded, onToggleExcluded, onCheck, onDismiss, onReopen }: SuggestionCardProps) {
  const { s, ev } = row;
  const sell = isSell(s);
  const active = ev.status === "active";
  const done = ev.status === "done";
  const Arrow = sell ? ArrowDownRight : ArrowUpRight;
  const tone = sell ? "text-rose-400" : "text-mint";

  // Links between buys and sells: a buy names its sources, a sell lists the buys it funds.
  const links = sell
    ? all
        .filter((o) => o.ev.status === "active" && o.s.fundedBy.some((f) => f.key === s.key))
        .map((o) => ({ label: linkLabel(o.s.action, o.s.symbol), weight: o.s.fundedBy.find((f) => f.key === s.key)!.weight }))
    : s.fundedBy.map((f) => ({ label: f.key === "CASH" ? t("assistant.suggestions.cashLink") : keyLabel(f.key), weight: f.weight }));

  const v = s.validity;
  const validity = [
    t("assistant.suggestions.validity.until", { date: fmtDate(v.expiresAt) }),
    v.price ? t("assistant.suggestions.validity.price", { range: rangeText(v.price.min, v.price.max), currency: v.price.currency }) : "",
    v.weight ? t("assistant.suggestions.validity.weight", { range: rangeText(v.weight.min, v.weight.max, "%") }) : "",
  ].filter(Boolean);

  return (
    <div className={`cx-card p-3.5 ${compact || done ? "opacity-75" : ""} ${excluded ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        {/* Done checkbox */}
        {compact ? (
          <span className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 ${ev.status === "done" ? "border-mint/60 text-mint" : "border-line text-slate-500"}`}>
            {ev.status === "done" ? <Check className="w-3.5 h-3.5" /> : <X className="w-3 h-3" />}
          </span>
        ) : (
          <button
            type="button"
            onClick={onCheck}
            disabled={busy || !onCheck}
            title={done ? (onCheck ? t("assistant.suggestions.markNotDone") : ev.reason) : t("assistant.suggestions.markDone")}
            aria-label={done ? t("assistant.suggestions.markNotDone") : t("assistant.suggestions.markDone")}
            aria-pressed={done}
            className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 cursor-pointer disabled:cursor-default ${
              done ? "border-mint/60 bg-mint/15 text-mint" : "border-slate-600 hover:border-mint"
            }`}
          >
            {busy ? <RefreshCw className="w-3 h-3 animate-spin text-slate-400" /> : done ? <Check className="w-3.5 h-3.5" /> : null}
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
            <span className="px-1.5 py-0.5 rounded border border-line bg-widget text-slate-300">{t("assistant.suggestions.priority", { priority: s.priority })}</span>
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-line bg-widget ${tone}`}>
              <Arrow className="w-3 h-3" />
              {actionLabel(s.action)}
            </span>
            <span className="text-slate-100 text-xs normal-case tracking-normal">
              <HoldingLink reference={s.symbol} />
            </span>
            <span className="text-slate-500 normal-case tracking-normal font-normal truncate max-w-[220px]" title={s.name}>
              {s.name}
            </span>
            {!active && <span className={`px-1.5 py-0.5 rounded border ${STATUS_CLASS[ev.status]}`}>{statusLabel(ev.status)}</span>}
          </div>

          <div className={`mt-1 text-sm font-bold text-slate-100 font-sans ${done ? "line-through decoration-slate-500" : ""}`}>{s.title}</div>

          {/* The amounts, computed here */}
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
            {ev.deltaShares !== undefined && ev.deltaShares !== 0 && (
              <span className={`font-bold ${tone}`}>
                {t(sell ? "assistant.suggestions.sellShares" : "assistant.suggestions.buyShares", {
                  count: Math.abs(ev.deltaShares),
                  shares: fmtShares(ev.deltaShares, hideValues),
                })}
              </span>
            )}
            {ev.deltaValue !== undefined && (
              <span className={`${tone}`}>{fmtCurrency(Math.abs(ev.deltaValue), currency, hideValues)}</span>
            )}
            <span className="text-slate-400">
              {t("assistant.suggestions.weightChange", { from: pct(active ? ev.currentWeight : s.fromWeight), to: pct(s.targetWeight) })}
              {active && <span className="text-slate-500"> ({pp(ev.deltaWeight)})</span>}
            </span>
            {ev.deltaShares === undefined && active && <span className="text-cream text-[11px]">{t("assistant.suggestions.noPrice")}</span>}
          </div>

          {active && ev.progress > 0 && ev.progress < 1 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 max-w-[220px] rounded-full bg-widget overflow-hidden">
                <div className="h-full rounded-full bg-mint" style={{ width: `${Math.round(ev.progress * 100)}%` }} />
              </div>
              <span className="text-[10px] text-slate-400">{t("assistant.suggestions.progress", { percent: Math.round(ev.progress * 100) })}</span>
            </div>
          )}

          {!compact && s.why && <p className="mt-2 text-xs text-slate-300 leading-relaxed font-sans">{s.why}</p>}

          {!compact && links.length > 0 && (
            <div className="mt-1.5 text-[11px] text-slate-400">
              {t(sell ? "assistant.suggestions.funds" : "assistant.suggestions.fundedBy", {
                links: links.map((l) => `${l.label} ${l.weight.toFixed(2)} pp`).join(", "),
              })}
            </div>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-slate-500">
            <Clock className="w-3 h-3" />
            {!active && ev.reason ? <span className="text-slate-400">{ev.reason}</span> : <span>{t("assistant.suggestions.validity.valid", { conditions: validity.join(", ") })}</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {onToggleExcluded && (
            <button
              type="button"
              onClick={onToggleExcluded}
              title={excluded ? t("assistant.suggestions.include") : t("assistant.suggestions.exclude")}
              aria-label={excluded ? t("assistant.suggestions.include") : t("assistant.suggestions.exclude")}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 cursor-pointer"
            >
              {excluded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              title={t("assistant.suggestions.dismiss")}
              aria-label={t("assistant.suggestions.dismiss")}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-[#DD3C73] hover:bg-slate-800/40 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {onReopen && (
            <button
              type="button"
              onClick={onReopen}
              disabled={busy}
              title={t("assistant.suggestions.reopen")}
              aria-label={t("assistant.suggestions.reopen")}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── target portfolio ────────────────────────────────────────────────────────

function TargetPanel({ target, open, onToggle, activeCount }: { target: TargetPortfolio; open: boolean; onToggle: () => void; activeCount: number }) {
  const changed = target.rows.filter((r) => Math.abs(r.deltaWeight) >= 0.005);
  const newCount = target.rows.filter((r) => r.isNew).length;
  const cash = target.cash;

  return (
    <div className="cx-card p-3.5 flex flex-col min-h-0 lg:h-full">
      {/* Summary, a toggle on narrow screens */}
      <button type="button" onClick={onToggle} className="flex items-center justify-between gap-2 text-left cursor-pointer lg:cursor-default w-full">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{t("assistant.suggestions.target.title")}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {newCount > 0
              ? t("assistant.suggestions.target.summaryNew", { count: activeCount, from: pct(cash.currentWeight), to: pct(cash.targetWeight), newCount })
              : t("assistant.suggestions.target.summary", { count: activeCount, from: pct(cash.currentWeight), to: pct(cash.targetWeight) })}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 lg:hidden transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>

      <div className={`${open ? "flex" : "hidden"} lg:flex flex-col min-h-0 flex-1 mt-3`}>
        {target.warnings.map((w) => (
          <div key={w} className="mb-2 rounded-lg border border-cream/40 bg-cream/10 px-2.5 py-1.5 text-[11px] text-cream flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{w}</span>
          </div>
        ))}

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500 text-[10px] uppercase tracking-wider">
                <th className="text-left font-bold pb-1.5">{t("assistant.suggestions.target.holding")}</th>
                <th className="text-right font-bold pb-1.5">{t("assistant.suggestions.target.now")}</th>
                <th className="text-right font-bold pb-1.5">{t("assistant.suggestions.target.target")}</th>
                <th className="text-right font-bold pb-1.5">{t("assistant.suggestions.target.change")}</th>
              </tr>
            </thead>
            <tbody>
              {target.rows.map((r) => {
                const moved = Math.abs(r.deltaWeight) >= 0.005;
                return (
                  <tr key={r.symbol} className={`border-t border-line ${moved ? "" : "text-slate-500"}`}>
                    <td className={`py-1 pr-2 min-w-0 ${r.isClosed ? "line-through" : ""}`}>
                      <span className={moved ? "text-slate-200" : ""}>{r.symbol}</span>
                      {r.isNew && <span className="ml-1 px-1 rounded border border-mint/40 bg-mint/10 text-mint text-[9px] font-bold uppercase">{t("assistant.suggestions.target.new")}</span>}
                    </td>
                    <td className="py-1 text-right">{pct(r.currentWeight)}</td>
                    <td className={`py-1 text-right ${moved ? "text-slate-100 font-bold" : ""}`}>{pct(r.targetWeight)}</td>
                    <td className={`py-1 text-right ${!moved ? "" : r.deltaWeight > 0 ? "text-mint" : "text-rose-400"}`}>{moved ? pp(r.deltaWeight) : ""}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-slate-600">
                <td className="py-1 pr-2 text-slate-200 font-bold">{t("assistant.suggestions.target.cash")}</td>
                <td className="py-1 text-right">{pct(cash.currentWeight)}</td>
                <td className={`py-1 text-right font-bold ${cash.targetWeight < 0 ? "text-[#DD3C73]" : "text-slate-100"}`}>{pct(cash.targetWeight)}</td>
                <td className={`py-1 text-right ${Math.abs(cash.deltaWeight) < 0.005 ? "" : cash.deltaWeight > 0 ? "text-mint" : "text-rose-400"}`}>
                  {Math.abs(cash.deltaWeight) >= 0.005 ? pp(cash.deltaWeight) : ""}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-2 pt-2 border-t border-line grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wider text-slate-500">
          <div>
            {t("assistant.suggestions.target.sold")}<div className="text-xs text-rose-400 font-bold normal-case">{target.sold.toFixed(2)} pp</div>
          </div>
          <div>
            {t("assistant.suggestions.target.bought")}<div className="text-xs text-mint font-bold normal-case">{target.bought.toFixed(2)} pp</div>
          </div>
          <div>
            {t("assistant.suggestions.target.cash")}<div className="text-xs text-slate-200 font-bold normal-case">{pp(cash.deltaWeight)}</div>
          </div>
        </div>
        {changed.length === 0 && <div className="mt-2 text-[11px] text-slate-500">{t("assistant.suggestions.target.noChange")}</div>}
      </div>
    </div>
  );
}
