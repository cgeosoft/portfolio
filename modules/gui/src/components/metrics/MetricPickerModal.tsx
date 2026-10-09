import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Search, X } from "lucide-react";
import type { MetricListing } from "portfolio-shared/api-types";
import type { MetricSlot } from "portfolio-shared/metrics";
import { getMetricAccentClass, getMetricIcon } from "../portfolio/metrics-catalog";
import { VerifiedBadge } from "./MetricLibrary";
import { UNAVAILABLE_LABEL, metricUnavailableReason, type MetricDisplay } from "./metric-view";

interface MetricPickerModalProps {
  /** Size of the empty place being filled; null closes the modal. */
  slot: MetricSlot | null;
  /** Installed metrics that are not on the dashboard. */
  candidates: MetricListing[];
  display: (id: string) => MetricDisplay;
  onPick: (id: string) => void;
  onClose: () => void;
}

const SLOT_NAME: Record<MetricSlot, string> = { large: "large card", compact: "compact tile" };

/** Choose a metric for an empty dashboard place. */
export function MetricPickerModal({ slot, candidates, display, onPick, onClose }: MetricPickerModalProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!slot) return;
    setQuery("");
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [slot, onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(({ manifest }) => `${manifest.name} ${manifest.category} ${manifest.summary}`.toLowerCase().includes(q));
  }, [candidates, query]);

  if (!slot) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-200 font-mono"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-picker-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden max-h-[80vh]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-[#DD3C73]/15 border border-[#DD3C73]/30 text-[#DD3C73] shrink-0">
              <LayoutGrid className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id="metric-picker-title" className="text-sm font-bold text-slate-100 uppercase tracking-wider truncate">
                Choose a metric
              </h2>
              <p className="text-[11px] text-slate-400 truncate">It fills this {SLOT_NAME[slot]} on the dashboard.</p>
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

        <div className="px-5 py-3 border-b border-slate-800/80 shrink-0">
          <label className="h-8 flex items-center gap-2 px-2.5 rounded-lg bg-slate-950/60 border border-slate-800 focus-within:border-[#DD3C73]/50">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search metrics"
              className="flex-1 min-w-0 bg-transparent text-xs text-slate-200 placeholder:text-slate-600 outline-none"
            />
          </label>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
          {shown.map((listing) => {
            const { manifest } = listing;
            const Icon = getMetricIcon(manifest.icon);
            const value = display(listing.id);
            const unavailable = metricUnavailableReason(listing) ?? (value?.kind === "unavailable" ? value.reason : null);
            return (
              <button
                key={listing.id}
                type="button"
                disabled={unavailable !== null}
                title={unavailable ?? undefined}
                onClick={() => onPick(listing.id)}
                className="w-full disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-950/40 disabled:hover:border-slate-800 p-3 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/50 hover:border-[#DD3C73]/40 flex items-center gap-3 text-left transition-colors cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                  <Icon className={`w-4 h-4 ${getMetricAccentClass(manifest.accent)}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200 truncate">{manifest.name}</span>
                    <VerifiedBadge listing={listing} />
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{manifest.summary}</p>
                </div>
                {unavailable && <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">{UNAVAILABLE_LABEL}</div>}
                {!unavailable && value?.kind === "ok" && <div className={`text-xs font-bold shrink-0 max-w-[30%] truncate ${value.valueClass}`}>{value.value}</div>}
              </button>
            );
          })}
          {shown.length === 0 && (
            <div className="py-10 text-center text-slate-500 text-xs">
              {candidates.length === 0 ? "Every installed metric is already on the dashboard." : "No metric matches the search."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
