import { AlertTriangle, Info, Loader2 } from "lucide-react";
import type { MetricListing } from "../../../../shared/rpc-types";
import { getMetricAccentClass, getMetricIcon } from "../portfolio/metrics-catalog";
import { StatCard } from "../portfolio/StatCard";
import { metricShortTitle, metricTitle, type MetricDisplay } from "./metric-view";

interface MetricCardProps {
  listing: MetricListing;
  display: MetricDisplay;
  onInfo?: () => void;
}

function failureLabel(display: Extract<MetricDisplay, { kind: "failed" }>): string {
  if (display.status === "quarantined") return "Stopped";
  if (display.status === "missing") return "Not installed";
  return "Error";
}

/** Large dashboard card of a metric module. */
export function MetricLargeCard({ listing, display, onInfo }: MetricCardProps) {
  const Icon = getMetricIcon(listing.manifest.icon);
  const icon = <Icon className={`w-5 h-5 ${getMetricAccentClass(listing.manifest.accent)}`} />;
  if (display.kind === "ok") {
    return <StatCard title={metricTitle(listing)} value={display.value} subValue={display.sub} icon={icon} onInfo={onInfo} />;
  }
  if (display.kind === "pending") {
    return <StatCard title={metricTitle(listing)} value="…" subValue="Calculating" subValueClass="text-slate-500" icon={icon} onInfo={onInfo} />;
  }
  return (
    <StatCard
      title={metricTitle(listing)}
      value={failureLabel(display)}
      subValue={display.error}
      subValueClass="text-rose-400"
      icon={icon}
      onInfo={onInfo}
      hint={display.error}
    />
  );
}

/** Compact dashboard tile of a metric module. */
export function MetricCompactTile({ listing, display, onInfo }: MetricCardProps) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1 min-w-0">
        <span className="truncate whitespace-nowrap" title={metricTitle(listing)}>
          {metricShortTitle(listing)}
        </span>
        {onInfo && (
          <button onClick={onInfo} className="hover:text-slate-300 shrink-0" aria-label={`Explanation for ${metricTitle(listing)}`}>
            <Info className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
      {display.kind === "ok" && <div className={`font-bold mt-0.5 truncate ${display.valueClass}`}>{display.value}</div>}
      {display.kind === "pending" && (
        <div className="font-bold mt-0.5 text-slate-600 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>…</span>
        </div>
      )}
      {display.kind === "failed" && (
        <div className="font-bold mt-0.5 text-rose-400 flex items-center gap-1 truncate" title={display.error}>
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span className="truncate">{failureLabel(display)}</span>
        </div>
      )}
    </div>
  );
}
