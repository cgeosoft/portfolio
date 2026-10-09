import { useMemo, useState } from "react";
import { BadgeCheck, Download, Library, Loader2, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";
import type { MetricListing, MetricRepositoryListing } from "portfolio-shared/api-types";
import type { MetricManifest } from "portfolio-shared/metric-manifest";
import { getMetricIcon } from "../portfolio/metrics-catalog";
import { InstallMetricDialog } from "./InstallMetricDialog";
import { UNAVAILABLE_LABEL, metricUnavailableReason, type MetricDisplay } from "./metric-view";

export const smallButton =
  "h-7 inline-flex items-center gap-1 px-2 rounded-md border border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-mono";

export function VerifiedBadge({ listing }: { listing: MetricListing }) {
  return listing.verified ? (
    <span
      className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-[9px] font-bold uppercase tracking-wider text-emerald-300 shrink-0"
      title="Reviewed in the metrics repository"
    >
      <BadgeCheck className="w-2.5 h-2.5" /> Verified
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 text-[9px] font-bold uppercase tracking-wider text-amber-300 shrink-0"
      title="Installed from a URL. Nobody reviewed this module."
    >
      <ShieldAlert className="w-2.5 h-2.5" /> Unverified
    </span>
  );
}

export interface MetricRow {
  id: string;
  manifest: MetricManifest;
  /** The installed module; null when the repository lists a metric this build does not ship. */
  listing: MetricListing | null;
}

/** Every metric the user can pick: the repository, plus URL installs the repository does not know. */
export function buildMetricRows(repository: readonly MetricRepositoryListing[], listings: readonly MetricListing[]): MetricRow[] {
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const rows: MetricRow[] = repository.map((entry) => ({ id: entry.id, manifest: entry.manifest, listing: listingById.get(entry.id) ?? null }));
  const known = new Set(repository.map((entry) => entry.id));
  for (const listing of listings) {
    if (!known.has(listing.id)) rows.push({ id: listing.id, manifest: listing.manifest, listing });
  }
  return rows;
}

interface MetricLibraryProps {
  listings: MetricListing[];
  repository: MetricRepositoryListing[];
  display: (id: string) => MetricDisplay;
  onInfo: (listing: MetricListing) => void;
  onInstalled: (metric: MetricListing) => void;
  onUninstall: (id: string) => Promise<void>;
  onRetry: (id: string) => void;
}

const CATEGORY_KEY = "portfolio_metrics_category";

function readCategory(): string {
  try {
    return localStorage.getItem(CATEGORY_KEY) || "All";
  } catch {
    return "All";
  }
}

/** All metrics, one row each, sorted by name: see their value, install more from a URL. */
export function MetricLibrary({ listings, repository, display, onInfo, onInstalled, onUninstall, onRetry }: MetricLibraryProps) {
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [category, setCategory] = useState<string>(readCategory);
  const [uninstalling, setUninstalling] = useState<string | null>(null);

  const rows = useMemo(() => buildMetricRows(repository, listings), [repository, listings]);
  const categories = useMemo(() => ["All", ...new Set(rows.map((row) => row.manifest.category))], [rows]);
  const shown = rows
    .filter((row) => category === "All" || row.manifest.category === category)
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

  const selectCategory = (name: string) => {
    setCategory(name);
    try {
      localStorage.setItem(CATEGORY_KEY, name);
    } catch {
      // Keeping the filter is a convenience only.
    }
  };

  const uninstall = async (id: string) => {
    setUninstalling(id);
    try {
      await onUninstall(id);
    } finally {
      setUninstalling(null);
    }
  };

  return (
    <section className="cx-card p-5 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-widest font-mono min-w-0">
            <Library className="w-4 h-4 text-[#DD3C73] shrink-0" />
            <span className="truncate">Metrics</span>
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
            Metrics are reviewed and bundled with the application. Metrics from a URL are not.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsInstallOpen(true)}
          className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider font-mono shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install from URL</span>
        </button>
      </div>

      {categories.length > 2 && (
        <div className="flex flex-nowrap items-center gap-0.5 overflow-x-auto">
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => selectCategory(name)}
              aria-pressed={category === name}
              className={`h-6 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                category === name ? "bg-[#DD3C73]/15 text-[#DD3C73] border-[#DD3C73]/40" : "text-slate-500 hover:text-slate-300 border-transparent hover:bg-slate-800/40"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col divide-y divide-slate-800">
        {shown.map((row) => {
          const { manifest, listing } = row;
          const Icon = getMetricIcon(manifest.icon);
          const value = listing ? display(row.id) : null;
          const unavailable = metricUnavailableReason(listing) ?? (value?.kind === "unavailable" ? value.reason : null);
          return (
            <div
              key={row.id}
              className={`py-4 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5 ${
                unavailable ? "opacity-50" : ""
              }`}
            >
              <button
                type="button"
                disabled={!listing}
                onClick={() => listing && onInfo(listing)}
                className="flex items-start gap-3 min-w-0 flex-1 text-left cursor-pointer disabled:cursor-default group"
                title={listing ? "Details" : undefined}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
                    <span className="text-sm font-bold text-slate-100 truncate group-enabled:group-hover:text-white">{manifest.name}</span>
                    {listing && <VerifiedBadge listing={listing} />}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5 pl-[22px] line-clamp-2">{manifest.summary}</p>
                </div>
              </button>

              {((value?.kind === "failed" && value.status === "quarantined") || listing?.source === "url") && (
                <div className="flex items-center gap-1 shrink-0">
                  {value?.kind === "failed" && value.status === "quarantined" && (
                    <button type="button" onClick={() => onRetry(row.id)} className={smallButton} title="Run this module again" aria-label={`Retry ${manifest.name}`}>
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                  {listing?.source === "url" && (
                    <button
                      type="button"
                      disabled={uninstalling === row.id}
                      onClick={() => void uninstall(row.id)}
                      className={`${smallButton} hover:text-rose-300 hover:border-rose-500/40`}
                      title="Uninstall this module"
                      aria-label={`Uninstall ${manifest.name}`}
                    >
                      {uninstalling === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              )}

              <div className="lg:w-36 shrink-0 min-w-0 lg:text-right">
                {unavailable && (
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate" title={unavailable}>
                    {UNAVAILABLE_LABEL}
                  </div>
                )}
                {!unavailable && value?.kind === "ok" && (
                  <>
                    <div className={`text-xs font-bold truncate ${value.valueClass}`}>{value.value}</div>
                    {value.sub && <div className="text-[10px] text-slate-500 truncate">{value.sub}</div>}
                  </>
                )}
                {!unavailable && value?.kind === "pending" && <Loader2 className="w-4 h-4 animate-spin text-slate-600 lg:ml-auto" />}
                {!unavailable && value?.kind === "failed" && (
                  <div className="text-[10px] text-rose-400 truncate" title={value.error}>
                    {value.status === "quarantined" ? "Stopped: " : "Error: "}
                    {value.error}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <div className="py-8 text-center text-slate-500 text-xs">No metrics in this category.</div>}
      </div>

      <InstallMetricDialog isOpen={isInstallOpen} onClose={() => setIsInstallOpen(false)} onInstalled={onInstalled} />
    </section>
  );
}
