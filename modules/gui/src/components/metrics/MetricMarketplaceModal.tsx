import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Download, Info, Loader2, Plus, ShieldAlert, Store, Trash2, X } from "lucide-react";
import type { MetricListing, MetricRepositoryListing } from "portfolio-shared/api-types";
import { withMetricAdded, withMetricRemoved, type PortfolioMetricPreference } from "portfolio-shared/metrics";
import { getMetricAccentClass, getMetricIcon } from "../portfolio/metrics-catalog";
import { InstallMetricDialog } from "./InstallMetricDialog";
import { ScopeBadges } from "./ScopeBadges";

export const smallButton =
  "h-7 inline-flex items-center gap-1 px-2 rounded-md border border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-mono";

export function VerifiedBadge({ listing }: { listing: MetricListing }) {
  return listing.verified ? (
    <span
      className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-[9px] font-bold uppercase tracking-wider text-emerald-300"
      title="Reviewed in the metrics repository"
    >
      <BadgeCheck className="w-2.5 h-2.5" /> Verified
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 text-[9px] font-bold uppercase tracking-wider text-amber-300"
      title="Installed from a URL. Nobody reviewed this module."
    >
      <ShieldAlert className="w-2.5 h-2.5" /> Unverified
    </span>
  );
}

interface MetricMarketplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefs: PortfolioMetricPreference[];
  listings: MetricListing[];
  repository: MetricRepositoryListing[];
  isSaving: boolean;
  onSave: (next: PortfolioMetricPreference[]) => void;
  onInfo: (listing: MetricListing) => void;
  onInstalled: (metric: MetricListing) => void;
  onUninstall: (id: string) => Promise<void>;
}

/** The metrics repository plus URL installs: add a metric to the portfolio or install one from a URL. */
export function MetricMarketplaceModal({
  isOpen,
  onClose,
  prefs,
  listings,
  repository,
  isSaving,
  onSave,
  onInfo,
  onInstalled,
  onUninstall,
}: MetricMarketplaceModalProps) {
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [category, setCategory] = useState<string>(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("portfolio_metrics_category") || "All";
    }
    return "All";
  });
  const [uninstalling, setUninstalling] = useState<string | null>(null);

  const handleSelectCategory = (name: string) => {
    setCategory(name);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("portfolio_metrics_category", name);
    }
  };

  const listingById = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const addedIds = new Set(prefs.filter((pref) => pref.added).map((pref) => pref.id));

  // Marketplace rows: the repository, plus URL installs the repository does not know.
  const marketplace = useMemo(() => {
    const rows: { id: string; listing: MetricListing | null; entry: MetricRepositoryListing | null }[] = repository.map((entry) => ({
      id: entry.id,
      entry,
      listing: listingById.get(entry.id) ?? null,
    }));
    const known = new Set(repository.map((entry) => entry.id));
    for (const listing of listings) {
      if (!known.has(listing.id)) rows.push({ id: listing.id, entry: null, listing });
    }
    return rows;
  }, [repository, listings, listingById]);
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const row of marketplace) set.add((row.entry ?? row.listing)!.manifest.category);
    return ["All", ...set];
  }, [marketplace]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isInstallOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isInstallOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-marketplace-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-6xl flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden h-[85vh]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-[#DD3C73]/15 border border-[#DD3C73]/30 text-[#DD3C73] shrink-0">
              <Store className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id="metric-marketplace-title" className="text-sm font-bold text-slate-100 uppercase tracking-wider truncate">
                Metrics Marketplace
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Metrics from the repository are reviewed and bundled with the application. Metrics from a URL are not.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsInstallOpen(true)}
              className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider font-mono"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install from URL</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-slate-800/80 flex flex-wrap items-center gap-1.5 shrink-0">
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => handleSelectCategory(name)}
              aria-pressed={category === name}
              className={`h-6 px-2.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer border ${
                category === name
                  ? "bg-[#DD3C73]/15 text-[#DD3C73] border-[#DD3C73]/40"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:bg-slate-800/40"
              }`}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {marketplace
              .filter((row) => category === "All" || (row.entry ?? row.listing)!.manifest.category === category)
              .map((row) => {
                const manifest = (row.entry ?? row.listing)!.manifest;
                const Icon = getMetricIcon(manifest.icon);
                const installed = row.listing;
                const isAdded = addedIds.has(row.id);
                const available = Boolean(installed);
                return (
                  <div key={row.id} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                        <Icon className={`w-4 h-4 ${getMetricAccentClass(manifest.accent)}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-200 truncate">{manifest.name}</span>
                          {installed && <VerifiedBadge listing={installed} />}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5 truncate">
                          {manifest.category} · v{manifest.version} · {manifest.developer.name}
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed flex-1">{manifest.summary}</p>
                    <ScopeBadges scopes={manifest.scopes} />
                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        {installed && (
                          <button type="button" onClick={() => onInfo(installed)} className={smallButton} title="Details">
                            <Info className="w-3 h-3" />
                          </button>
                        )}
                        {installed?.source === "url" && (
                          <button
                            type="button"
                            disabled={uninstalling === row.id}
                            onClick={async () => {
                              setUninstalling(row.id);
                              try {
                                await onUninstall(row.id);
                              } finally {
                                setUninstalling(null);
                              }
                            }}
                            className={`${smallButton} hover:text-rose-300 hover:border-rose-500/40`}
                            title="Uninstall this module"
                          >
                            {uninstalling === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            <span>Uninstall</span>
                          </button>
                        )}
                      </div>
                      {isAdded ? (
                        <button type="button" disabled={isSaving} onClick={() => onSave(withMetricRemoved(prefs, row.id))} className={smallButton} title="Remove from this portfolio">
                          <X className="w-3 h-3" />
                          <span>Added</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isSaving || !available}
                          onClick={() => onSave(withMetricAdded(prefs, row.id, manifest.display.defaultSize))}
                          title={available ? "Add to this portfolio" : "Not available in this build"}
                          className="h-7 inline-flex items-center gap-1 px-2.5 rounded-md border border-[#DD3C73]/40 bg-[#DD3C73]/10 text-[10px] font-bold uppercase tracking-wider text-[#DD3C73] hover:bg-[#DD3C73]/20 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-mono"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      <InstallMetricDialog isOpen={isInstallOpen} onClose={() => setIsInstallOpen(false)} onInstalled={onInstalled} />
    </div>
  );
}
