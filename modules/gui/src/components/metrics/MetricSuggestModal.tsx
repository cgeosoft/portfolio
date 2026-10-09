import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import type { MetricEvaluation, MetricListing, SuggestPortfolioMetricsResponse } from "portfolio-shared/api-types";
import { METRIC_SLOT_CAPACITY, type MetricSlot, type PortfolioMetricPreference } from "portfolio-shared/metrics";
import { api } from "../../api";
import { MetricCompactTile, MetricLargeCard } from "./MetricCard";
import { smallButton } from "./MetricLibrary";
import { displayMetric } from "./metric-view";

interface MetricSuggestModalProps {
  isOpen: boolean;
  portfolioId: string;
  prefs: PortfolioMetricPreference[];
  listings: MetricListing[];
  evaluations: Record<string, MetricEvaluation>;
  currency: string;
  hideValues: boolean;
  isSaving: boolean;
  onClose: () => void;
  onReplace: (next: PortfolioMetricPreference[]) => void;
}

const SLOT_LABEL: Record<MetricSlot, string> = { large: "Large cards", compact: "Compact tiles" };

type Mark = "new" | "out" | null;

/** Asks the assistant for a dashboard layout and previews it with live values. Saves only on Replace. */
export function MetricSuggestModal({
  isOpen,
  portfolioId,
  prefs,
  listings,
  evaluations,
  currency,
  hideValues,
  isSaving,
  onClose,
  onReplace,
}: MetricSuggestModalProps) {
  const [suggestion, setSuggestion] = useState<SuggestPortfolioMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [requestNonce, setRequestNonce] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setSuggestion(null);
    setError(null);
    setIsLoading(true);
    api
      .suggestPortfolioMetrics({ portfolioId, baseCurrency: currency })
      .then((res) => {
        if (!cancelled) setSuggestion(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // currency is read once per request; a change while open does not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, portfolioId, requestNonce]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const retry = useCallback(() => setRequestNonce((n) => n + 1), []);

  if (!isOpen) return null;

  const listingById = new Map(listings.map((l) => [l.id, l]));
  const ctx = { currency, hideValues };
  const currentIds = (slot: MetricSlot) => prefs
      .filter((p) => p.added && p.slot === slot && listingById.has(p.id))
      .sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
      .map((p) => p.id);
  const suggestedIds = (slot: MetricSlot) => (suggestion ? suggestion[slot].filter((id) => listingById.has(id)) : []);
  const isUnchanged =
    suggestion !== null &&
    (["large", "compact"] as const).every((slot) => currentIds(slot).join(",") === suggestedIds(slot).join(","));

  const renderItem = (id: string, slot: MetricSlot, mark: Mark) => {
    const listing = listingById.get(id)!;
    const display = displayMetric(evaluations[id], ctx);
    const ring = mark === "new" ? "ring-1 ring-[#DD3C73]/70" : mark === "out" ? "opacity-40" : "";
    return (
      <div key={id} className={`relative min-w-0 rounded-xl ${ring}`}>
        {slot === "large" ? (
          <MetricLargeCard listing={listing} display={display} />
        ) : (
          <div className="p-3 rounded-xl bg-widget/60 border border-line text-xs">
            <MetricCompactTile listing={listing} display={display} />
          </div>
        )}
        {mark && (
          <span
            className={`absolute -top-2 right-2 px-1.5 rounded text-[9px] font-bold uppercase tracking-wider ${
              mark === "new" ? "bg-[#DD3C73] text-white" : "bg-slate-700 text-slate-300"
            }`}
          >
            {mark === "new" ? "New" : "Out"}
          </span>
        )}
      </div>
    );
  };

  const renderRow = (label: string, ids: string[], slot: MetricSlot, markOf: (id: string) => Mark) => (
    <div className="space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {label} · {ids.length}/{METRIC_SLOT_CAPACITY[slot]}
      </div>
      {ids.length === 0 ? (
        <div className="py-3 text-center rounded-xl border border-dashed border-slate-800 text-slate-600 text-[10px] uppercase tracking-wider">Empty</div>
      ) : (
        <div className={slot === "large" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"}>
          {ids.map((id) => renderItem(id, slot, markOf(id)))}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-suggest-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-5xl flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Sparkles className="w-4 h-4 text-[#DD3C73] shrink-0" />
            <div className="min-w-0">
              <h2 id="metric-suggest-title" className="text-sm font-bold text-slate-100 uppercase tracking-wider truncate">
                Auto choose metrics
              </h2>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">The assistant picks cards and tiles from your allocation</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">
          {isLoading && (
            <div className="py-16 flex flex-col items-center gap-3 text-slate-400 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-[#DD3C73]" />
              <span>Waiting for the assistant…</span>
            </div>
          )}

          {!isLoading && error && (
            <div className="py-10 text-center space-y-3">
              <div className="text-xs text-rose-400">{error}</div>
              <div className="text-[10px] text-slate-500">Check the assistant under Settings, then try again.</div>
            </div>
          )}

          {!isLoading && suggestion && (
            <>
              {suggestion.reason && (
                <div className="p-3 rounded-xl border border-[#DD3C73]/30 bg-[#DD3C73]/10 text-xs text-slate-200">{suggestion.reason}</div>
              )}
              {isUnchanged && <div className="text-xs text-slate-400">The assistant suggests the layout you already have.</div>}
              {(["large", "compact"] as const).map((slot) => {
                const current = currentIds(slot);
                const next = suggestedIds(slot);
                return (
                  <section key={slot} className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200 pb-2 border-b border-slate-800/80">{SLOT_LABEL[slot]}</h3>
                    {renderRow("Current", current, slot, (id) => (next.includes(id) ? null : "out"))}
                    {renderRow("Suggested", next, slot, (id) => (current.includes(id) ? null : "new"))}
                  </section>
                );
              })}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3 shrink-0">
          <button type="button" onClick={retry} disabled={isLoading} className={smallButton} title="Ask the assistant again">
            <RefreshCw className="w-3 h-3" />
            <span>Try again</span>
          </button>
          <button type="button" onClick={onClose} className={smallButton}>
            <span>Cancel</span>
          </button>
          <button
            type="button"
            disabled={!suggestion || isLoading || isSaving || isUnchanged}
            onClick={() => suggestion && onReplace(suggestion.metrics)}
            className="h-7 inline-flex items-center gap-1.5 px-3 rounded-md border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-[10px] font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider font-mono disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-3 h-3" />
            <span>Replace</span>
          </button>
        </div>
      </div>
    </div>
  );
}
