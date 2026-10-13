import { AlertTriangle, Info, KeyRound, Loader2 } from "lucide-react";
import type { MetricListing } from "portfolio-shared/api-types";
import { getMetricAccentClass, getMetricIcon } from "../portfolio/metrics-catalog";
import { StatCard } from "../portfolio/StatCard";
import { t } from "../../i18n";
import { metricShortTitle, metricTitle, type MetricDisplay } from "./metric-view";

interface MetricCardProps {
  listing: MetricListing;
  display: MetricDisplay;
  onInfo?: () => void;
}

/**
 * Why a metric cannot be added or run (a provider without an API key), or null.
 * Lives here, not in metric-view.ts, so that file stays free of the i18n module for its tests.
 */
export function metricUnavailableReason(listing: MetricListing | null | undefined): string | null {
  return listing?.status === "unavailable" ? listing.statusReason || t("metrics.unavailable.reason") : null;
}

/** Short label of a disabled metric, for tiles and badges. */
export function unavailableLabel(): string {
  return t("metrics.unavailable.label");
}

function failureLabel(display: Extract<MetricDisplay, { kind: "failed" }>): string {
  if (display.status === "quarantined") return t("metrics.card.stopped");
  if (display.status === "missing") return t("metrics.card.notInstalled");
  return t("metrics.card.error");
}

/** Large dashboard card of a metric module. */
export function MetricLargeCard({ listing, display, onInfo }: MetricCardProps) {
  const Icon = getMetricIcon(listing.manifest.icon);
  const icon = <Icon className={`w-5 h-5 ${getMetricAccentClass(listing.manifest.accent)}`} />;
  if (display.kind === "ok") {
    return <StatCard title={metricTitle(listing)} value={display.value} subValue={display.sub} icon={icon} onInfo={onInfo} />;
  }
  if (display.kind === "unavailable") {
    return (
      <div className="opacity-50" title={display.reason}>
        <StatCard title={metricTitle(listing)} value={unavailableLabel()} subValue={display.reason} subValueClass="text-slate-500" icon={icon} onInfo={onInfo} hint={display.reason} />
      </div>
    );
  }
  if (display.kind === "pending") {
    return <StatCard title={metricTitle(listing)} value="…" subValue={t("metrics.card.calculating")} subValueClass="text-slate-500" icon={icon} onInfo={onInfo} />;
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
    <div className={`min-w-0 ${display.kind === "unavailable" ? "opacity-50" : ""}`}>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1 min-w-0">
        <span className="truncate whitespace-nowrap" title={metricTitle(listing)}>
          {metricShortTitle(listing)}
        </span>
        {onInfo && (
          <button onClick={onInfo} className="hover:text-slate-300 shrink-0" aria-label={t("metrics.card.explanationFor", { name: metricTitle(listing) })}>
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
      {display.kind === "unavailable" && (
        <div className="font-bold mt-0.5 text-slate-500 flex items-center gap-1 truncate" title={display.reason}>
          <KeyRound className="w-3 h-3 shrink-0" />
          <span className="truncate">{unavailableLabel()}</span>
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
