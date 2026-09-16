import { Sliders } from "lucide-react";
import type { MetricEvaluation, MetricListing } from "portfolio-shared/api-types";
import type { PortfolioMetricPreference } from "portfolio-shared/metrics";
import { MetricCompactTile, MetricLargeCard } from "./MetricCard";
import { displayMetric } from "./metric-view";

interface MetricDashboardProps {
  prefs: PortfolioMetricPreference[];
  listings: MetricListing[];
  evaluations: Record<string, MetricEvaluation>;
  currency: string;
  hideValues: boolean;
  onInfo: (listing: MetricListing) => void;
  onOpenMetricsTab: () => void;
}

/** The slotted metrics of the portfolio, as shown at the top of the Overview tab. */
export function MetricDashboard({ prefs, listings, evaluations, currency, hideValues, onInfo, onOpenMetricsTab }: MetricDashboardProps) {
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const slotted = prefs.filter((pref) => pref.added && pref.slot && listingById.has(pref.id));
  const large = slotted.filter((pref) => pref.slot === "large");
  const compact = slotted.filter((pref) => pref.slot === "compact");
  const ctx = { currency, hideValues };

  return (
    <>
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono truncate">Portfolio Metrics</div>
        <button
          type="button"
          onClick={onOpenMetricsTab}
          className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md border border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-[#6366f1] hover:border-[#6366f1]/40 hover:bg-[#6366f1]/10 transition-all cursor-pointer shrink-0"
          title="Choose the metrics of this portfolio"
        >
          <Sliders className="w-3 h-3" />
          <span>Customize Metrics</span>
        </button>
      </div>

      {large.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {large.map((pref) => {
            const listing = listingById.get(pref.id)!;
            return (
              <MetricLargeCard key={pref.id} listing={listing} display={displayMetric(evaluations[pref.id], ctx)} onInfo={() => onInfo(listing)} />
            );
          })}
        </div>
      )}

      {compact.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-4 rounded-2xl bg-[#131722]/60 border border-[#1e293b] text-xs">
          {compact.map((pref) => {
            const listing = listingById.get(pref.id)!;
            return (
              <MetricCompactTile key={pref.id} listing={listing} display={displayMetric(evaluations[pref.id], ctx)} onInfo={() => onInfo(listing)} />
            );
          })}
        </div>
      )}

      {slotted.length === 0 && (
        <div className="p-6 rounded-2xl bg-[#131722]/60 border border-[#1e293b] text-center space-y-3">
          <div className="text-xs text-slate-400 font-mono">No metrics are on the dashboard of this portfolio.</div>
          <button
            type="button"
            onClick={onOpenMetricsTab}
            className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#6366f1]/40 bg-[#6366f1]/15 text-xs font-bold text-[#6366f1] hover:bg-[#6366f1]/25 transition-all cursor-pointer uppercase tracking-wider font-mono"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Open Metrics</span>
          </button>
        </div>
      )}
    </>
  );
}
