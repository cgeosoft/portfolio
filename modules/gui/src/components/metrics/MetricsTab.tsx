import { useCallback, useMemo, useState, type DragEvent } from "react";
import { GripHorizontal, LayoutGrid, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import type { MetricEvaluation, MetricListing, MetricRepositoryListing } from "portfolio-shared/api-types";
import {
  METRIC_SLOT_CAPACITY,
  countMetricSlots,
  withMetricPlaced,
  withMetricSlot,
  type MetricSlot,
  type PortfolioMetricPreference,
} from "portfolio-shared/metrics";
import { MetricLibrary, smallButton } from "./MetricLibrary";
import { MetricCompactTile, MetricLargeCard } from "./MetricCard";
import { MetricPickerModal } from "./MetricPickerModal";
import { MetricSuggestModal } from "./MetricSuggestModal";
import { displayMetric, metricTitle, type MetricDisplay } from "./metric-view";

interface MetricsTabProps {
  portfolioId: string | null;
  prefs: PortfolioMetricPreference[];
  listings: MetricListing[];
  repository: MetricRepositoryListing[];
  evaluations: Record<string, MetricEvaluation>;
  currency: string;
  hideValues: boolean;
  isSaving: boolean;
  onSave: (next: PortfolioMetricPreference[]) => void;
  onReset: () => void;
  onInfo: (listing: MetricListing) => void;
  onInstalled: (metric: MetricListing) => void;
  onUninstall: (id: string) => Promise<void>;
  onRetry: (id: string) => void;
}

const SLOT_LABEL: Record<MetricSlot, string> = { large: "Large cards", compact: "Compact tiles" };

/** A dashboard place: the metric on it, or null when it is empty. */
interface Place {
  slot: MetricSlot;
  index: number;
  id: string | null;
}

/** Preferences → Metrics: the dashboard places on top, every metric below. */
export function MetricsTab({
  portfolioId,
  prefs,
  listings,
  repository,
  evaluations,
  currency,
  hideValues,
  isSaving,
  onSave,
  onReset,
  onInfo,
  onInstalled,
  onUninstall,
  onRetry,
}: MetricsTabProps) {
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [picking, setPicking] = useState<Place | null>(null);
  const [dragging, setDragging] = useState<Place | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const listingById = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const used = countMetricSlots(prefs);
  const added = prefs.filter((pref) => pref.added && listingById.has(pref.id));
  const isEmpty = !added.some((pref) => pref.slot);
  const ctx = { currency, hideValues };
  const display = (id: string): MetricDisplay => displayMetric(evaluations[id], ctx);
  const closePicker = useCallback(() => setPicking(null), []);

  const placedIds = new Set(added.filter((pref) => pref.slot).map((pref) => pref.id));
  const candidates = listings.filter((listing) => !placedIds.has(listing.id));

  const placeKey = (place: Place) => `${place.slot}:${place.index}`;

  const removeFromDashboard = (id: string) => {
    const next = withMetricSlot(prefs, id, null);
    if (next) onSave(next);
  };

  const pick = (id: string) => {
    if (!picking) return;
    const next = withMetricPlaced(prefs, id, picking.slot, picking.index);
    if (next) onSave(next);
    setPicking(null);
  };

  /** Move the dragged metric onto a place. A metric already there swaps with it; the others stay put. */
  const drop = (from: Place, to: Place) => {
    if (!from.id || (from.slot === to.slot && from.index === to.index)) return;
    const next = withMetricPlaced(prefs, from.id, to.slot, to.index);
    if (next) onSave(next);
  };

  const dropHandlers = (place: Place) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropTarget !== placeKey(place)) setDropTarget(placeKey(place));
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging) drop(dragging, place);
      setDragging(null);
      setDropTarget(null);
    },
  });

  if (!portfolioId) {
    return (
      <div className="cx-card p-10 text-center text-slate-500 font-mono text-xs">Create a portfolio first to choose its metrics.</div>
    );
  }

  return (
    <div className="space-y-6 font-mono">
      <section className="cx-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-widest min-w-0">
              <LayoutGrid className="w-4 h-4 text-[#DD3C73] shrink-0" />
              <span className="truncate">Dashboard</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Shown on the Overview tab. Drag a card by its header to move it, click an empty place to fill it.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isSaving || added.length === 0}
              onClick={() => setIsSuggestOpen(true)}
              className={`${smallButton} border-[#DD3C73]/40 text-[#DD3C73] hover:text-[#DD3C73] hover:bg-[#DD3C73]/15 ${
                isEmpty && !isSaving && added.length > 0 ? "cx-attention-pulse" : ""
              }`}
              title="Let the assistant choose cards and tiles from your allocation"
            >
              <Sparkles className="w-3 h-3" />
              <span>Auto choose</span>
            </button>
            <button type="button" disabled={isSaving} onClick={onReset} className={smallButton} title="Restore the default dashboard">
              <RotateCcw className="w-3 h-3" />
              <span>Defaults</span>
            </button>
          </div>
        </div>

        {(["large", "compact"] as const).map((slot) => {
          const slotted = added.filter((pref) => pref.slot === slot);
          const places: Place[] = Array.from({ length: METRIC_SLOT_CAPACITY[slot] }, (_, index) => ({
            slot,
            index,
            id: slotted.find((pref) => pref.place === index)?.id ?? null,
          }));
          const minHeight = slot === "large" ? "min-h-[120px]" : "min-h-[88px]";
          return (
            <div key={slot} className="space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {SLOT_LABEL[slot]} · {used[slot]}/{METRIC_SLOT_CAPACITY[slot]}
              </div>
              <div className={slot === "large" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4"}>
                {places.map((place) => {
                  const key = placeKey(place);
                  const isTarget = dropTarget === key && dragging !== null && placeKey(dragging) !== key;
                  const listing = place.id ? listingById.get(place.id) : undefined;

                  if (!place.id || !listing) {
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={isSaving}
                        onClick={() => setPicking(place)}
                        {...dropHandlers(place)}
                        className={`${minHeight} rounded-xl border border-dashed flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-wider transition-colors cursor-pointer disabled:cursor-not-allowed ${
                          isTarget
                            ? "border-[#DD3C73]/70 bg-[#DD3C73]/10 text-[#DD3C73]"
                            : "border-slate-800 text-slate-600 hover:border-[#DD3C73]/50 hover:text-[#DD3C73] hover:bg-[#DD3C73]/5"
                        }`}
                        aria-label={`Choose a metric for this ${slot === "large" ? "large card" : "compact tile"}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add metric</span>
                      </button>
                    );
                  }

                  const title = metricTitle(listing);
                  const isDragged = dragging !== null && placeKey(dragging) === key;
                  return (
                    <div
                      key={place.id}
                      {...dropHandlers(place)}
                      className={`cx-card overflow-hidden min-w-0 flex flex-col transition-all ${isDragged ? "opacity-40" : ""} ${
                        isTarget ? "ring-2 ring-[#DD3C73]/70" : ""
                      }`}
                    >
                      <div
                        draggable={!isSaving}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", place.id!);
                          const card = e.currentTarget.parentElement;
                          if (card) e.dataTransfer.setDragImage(card, 16, 12);
                          setDragging(place);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                        className="h-6 shrink-0 flex items-center justify-between gap-2 pl-2 pr-1 border-b border-line bg-slate-900/60 text-slate-500 cursor-grab active:cursor-grabbing hover:text-slate-300 transition-colors"
                        title="Drag to move"
                        aria-label={`Drag ${title} to another place`}
                        role="button"
                      >
                        <GripHorizontal className="w-3.5 h-3.5" />
                        <button
                          type="button"
                          disabled={isSaving}
                          draggable={false}
                          onClick={() => removeFromDashboard(listing.id)}
                          className="w-4 h-4 inline-flex items-center justify-center rounded text-slate-500 cursor-pointer hover:text-rose-300 hover:bg-rose-500/15 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Remove from the dashboard"
                          aria-label={`Remove ${title} from the dashboard`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      {slot === "large" ? (
                        <div className="flex-1 flex flex-col [&_.cx-card]:flex-1 [&_.cx-card]:border-0 [&_.cx-card]:rounded-none [&_.cx-card]:shadow-none">
                          <MetricLargeCard listing={listing} display={display(place.id)} onInfo={() => onInfo(listing)} />
                        </div>
                      ) : (
                        <div className="flex-1 p-3 text-xs">
                          <MetricCompactTile listing={listing} display={display(place.id)} onInfo={() => onInfo(listing)} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <MetricLibrary
        listings={listings}
        repository={repository}
        display={display}
        onInfo={onInfo}
        onInstalled={onInstalled}
        onUninstall={onUninstall}
        onRetry={onRetry}
      />

      <MetricPickerModal slot={picking?.slot ?? null} candidates={candidates} display={display} onPick={pick} onClose={closePicker} />

      <MetricSuggestModal
        isOpen={isSuggestOpen}
        portfolioId={portfolioId}
        prefs={prefs}
        listings={listings}
        evaluations={evaluations}
        currency={currency}
        hideValues={hideValues}
        isSaving={isSaving}
        onClose={() => setIsSuggestOpen(false)}
        onReplace={(next) => {
          onSave(next);
          setIsSuggestOpen(false);
        }}
      />
    </div>
  );
}
