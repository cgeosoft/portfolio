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
  onOpenMetrics: () => void;
}

/** The slotted metrics of the portfolio, as shown at the top of the Overview tab. */
export function MetricDashboard({ prefs, listings, evaluations, currency, hideValues, onInfo, onOpenMetrics }: MetricDashboardProps) {
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const slotted = prefs.filter((pref) => pref.added && pref.slot && listingById.has(pref.id));
  const byPlace = (a: PortfolioMetricPreference, b: PortfolioMetricPreference) => (a.place ?? 0) - (b.place ?? 0);
  const large = slotted.filter((pref) => pref.slot === "large").sort(byPlace);
  const compact = slotted.filter((pref) => pref.slot === "compact").sort(byPlace);
  const ctx = { currency, hideValues };

  return (
    <>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-4 rounded-2xl bg-widget/60 border border-line text-xs">
          {compact.map((pref) => {
            const listing = listingById.get(pref.id)!;
            return (
              <MetricCompactTile key={pref.id} listing={listing} display={displayMetric(evaluations[pref.id], ctx)} onInfo={() => onInfo(listing)} />
            );
          })}
        </div>
      )}

      {slotted.length === 0 && (
        <div className="p-6 rounded-2xl bg-widget/60 border border-line text-center space-y-3">
          <div className="text-xs text-slate-400 font-mono">No metrics are on the dashboard of this portfolio.</div>
          <button
            type="button"
            onClick={onOpenMetrics}
            className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider font-mono"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Open Metrics</span>
          </button>
        </div>
      )}
    </>
  );
}
