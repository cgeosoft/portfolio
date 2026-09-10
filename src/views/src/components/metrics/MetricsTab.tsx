import { useMemo, useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  Download,
  EyeOff,
  Info,
  LayoutGrid,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RotateCcw,
  ShieldAlert,
  Store,
  Trash2,
  X,
} from "lucide-react";
import type { MetricEvaluation, MetricListing, MetricRepositoryListing } from "../../../../shared/rpc-types";
import {
  METRIC_SLOT_CAPACITY,
  countMetricSlots,
  withMetricAdded,
  withMetricMoved,
  withMetricRemoved,
  withMetricSlot,
  type MetricSlot,
  type PortfolioMetricPreference,
} from "../../../../shared/metrics";
import { getMetricAccentClass, getMetricIcon } from "../portfolio/metrics-catalog";
import { InstallMetricDialog } from "./InstallMetricDialog";
import { MetricCompactTile, MetricLargeCard } from "./MetricCard";
import { ScopeBadges } from "./ScopeBadges";
import { displayMetric, metricTitle, type MetricDisplay } from "./metric-view";

interface MetricsTabProps {
  hasPortfolio: boolean;
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

function VerifiedBadge({ listing }: { listing: MetricListing }) {
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

function SectionHeader({ icon: Icon, title, subtitle, actions }: { icon: typeof LayoutGrid; title: string; subtitle: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-widest min-w-0">
          <Icon className="w-4 h-4 text-[#DD3C73] shrink-0" />
          <span className="truncate">{title}</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

const smallButton =
  "h-7 inline-flex items-center gap-1 px-2 rounded-md border border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-mono";

/** The Metrics tab: dashboard slots, every metric added to the portfolio, and the marketplace. */
export function MetricsTab({
  hasPortfolio,
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
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [category, setCategory] = useState<string>("All");
  const [uninstalling, setUninstalling] = useState<string | null>(null);

  const listingById = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const used = countMetricSlots(prefs);
  const added = prefs.filter((pref) => pref.added && listingById.has(pref.id));
  const addedIds = new Set(added.map((pref) => pref.id));
  const ctx = { currency, hideValues };
  const display = (id: string): MetricDisplay => displayMetric(evaluations[id], ctx);

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

  const setSlot = (id: string, slot: MetricSlot | null) => {
    const next = withMetricSlot(prefs, id, slot);
    if (next) onSave(next);
  };

  const renderSlotControls = (pref: PortfolioMetricPreference) => {
    const canLarge = pref.slot === "large" || used.large < METRIC_SLOT_CAPACITY.large;
    const canCompact = pref.slot === "compact" || used.compact < METRIC_SLOT_CAPACITY.compact;
    return (
      <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-900 border border-slate-800">
        {([
          { id: "large" as MetricSlot, label: "Large", icon: Maximize2, enabled: canLarge, title: canLarge ? "Show as a large card" : "All large slots are taken" },
          { id: "compact" as MetricSlot, label: "Compact", icon: Minimize2, enabled: canCompact, title: canCompact ? "Show as a compact tile" : "All compact slots are taken" },
          { id: null, label: "Off", icon: EyeOff, enabled: true, title: "Keep in this tab, hide from the overview" },
        ] as const).map((option) => {
          const OptionIcon = option.icon;
          const selected = pref.slot === option.id;
          return (
            <button
              key={option.label}
              type="button"
              disabled={isSaving || !option.enabled}
              onClick={() => setSlot(pref.id, option.id)}
              aria-pressed={selected}
              title={option.title}
              className={`h-6 inline-flex items-center gap-1 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer font-mono disabled:opacity-40 disabled:cursor-not-allowed ${
                selected ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <OptionIcon className="w-3 h-3" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  if (!hasPortfolio) {
    return (
      <div className="cx-card p-10 text-center text-slate-500 font-mono text-xs">Create a portfolio first to choose its metrics.</div>
    );
  }

  return (
    <div className="space-y-6 font-mono">
      {/* 1. Dashboard slots */}
      <section className="cx-card p-5 sm:p-6 space-y-5">
        <SectionHeader
          icon={LayoutGrid}
          title="Dashboard"
          subtitle={`Shown on the Overview tab. ${used.large}/${METRIC_SLOT_CAPACITY.large} large cards and ${used.compact}/${METRIC_SLOT_CAPACITY.compact} compact tiles in use.`}
          actions={
            <button type="button" disabled={isSaving} onClick={onReset} className={smallButton} title="Restore the default dashboard">
              <RotateCcw className="w-3 h-3" />
              <span>Defaults</span>
            </button>
          }
        />

        {(["large", "compact"] as const).map((slot) => {
          const slotted = added.filter((pref) => pref.slot === slot);
          const free = METRIC_SLOT_CAPACITY[slot] - slotted.length;
          return (
            <div key={slot} className="space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {SLOT_LABEL[slot]} · {slotted.length}/{METRIC_SLOT_CAPACITY[slot]}
              </div>
              <div className={slot === "large" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"}>
                {slotted.map((pref, index) => {
                  const listing = listingById.get(pref.id)!;
                  return (
                    <div key={pref.id} className="min-w-0 flex flex-col gap-1.5">
                      {slot === "large" ? (
                        <MetricLargeCard listing={listing} display={display(pref.id)} onInfo={() => onInfo(listing)} />
                      ) : (
                        <div className="p-3 rounded-xl bg-[#111726]/60 border border-[#1e293b] text-xs">
                          <MetricCompactTile listing={listing} display={display(pref.id)} onInfo={() => onInfo(listing)} />
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-0.5">
                          <button type="button" disabled={isSaving || index === 0} onClick={() => onSave(withMetricMoved(prefs, pref.id, -1))} className={smallButton} title="Move earlier" aria-label={`Move ${metricTitle(listing)} earlier`}>
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button type="button" disabled={isSaving || index === slotted.length - 1} onClick={() => onSave(withMetricMoved(prefs, pref.id, 1))} className={smallButton} title="Move later" aria-label={`Move ${metricTitle(listing)} later`}>
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                        <button type="button" disabled={isSaving} onClick={() => setSlot(pref.id, null)} className={smallButton} title="Remove from the dashboard">
                          <X className="w-3 h-3" />
                          <span className="hidden sm:inline">Remove</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
                {Array.from({ length: free }, (_, i) => (
                  <div
                    key={`free-${slot}-${i}`}
                    className={`rounded-xl border border-dashed border-slate-800 text-slate-600 text-[10px] uppercase tracking-wider flex items-center justify-center ${
                      slot === "large" ? "min-h-[96px]" : "min-h-[52px]"
                    }`}
                  >
                    Free slot
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* 2. Added to this portfolio */}
      <section className="cx-card p-5 sm:p-6 space-y-4">
        <SectionHeader
          icon={Info}
          title={`Added to this portfolio (${added.length})`}
          subtitle="Every metric this portfolio runs. Choose which ones appear on the dashboard."
        />
        {added.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">No metrics added yet. Pick some from the marketplace below.</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {added.map((pref) => {
              const listing = listingById.get(pref.id)!;
              const { manifest } = listing;
              const Icon = getMetricIcon(manifest.icon);
              const shown = display(pref.id);
              return (
                <div key={pref.id} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                        <Icon className={`w-4 h-4 ${getMetricAccentClass(manifest.accent)}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-200 truncate">{manifest.name}</span>
                          <VerifiedBadge listing={listing} />
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5 truncate">
                          {manifest.category} · v{manifest.version} · {manifest.developer.name}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 min-w-0 max-w-[45%]">
                      {shown.kind === "ok" && (
                        <>
                          <div className={`text-sm font-bold truncate ${shown.valueClass}`}>{shown.value}</div>
                          {shown.sub && <div className="text-[10px] text-slate-500 truncate">{shown.sub}</div>}
                        </>
                      )}
                      {shown.kind === "pending" && <Loader2 className="w-4 h-4 animate-spin text-slate-600 ml-auto" />}
                      {shown.kind === "failed" && (
                        <div className="text-[10px] text-rose-400 truncate" title={shown.error}>
                          {shown.status === "quarantined" ? "Stopped: " : "Error: "}
                          {shown.error}
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">{manifest.summary}</p>
                  <ScopeBadges scopes={listing.scopesGranted} />

                  <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                    {renderSlotControls(pref)}
                    <div className="flex items-center gap-1">
                      {shown.kind === "failed" && shown.status === "quarantined" && (
                        <button type="button" onClick={() => onRetry(pref.id)} className={smallButton} title="Run this module again">
                          <RotateCcw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      )}
                      <button type="button" onClick={() => onInfo(listing)} className={smallButton} title="Details">
                        <Info className="w-3 h-3" />
                        <span>Details</span>
                      </button>
                      <button type="button" disabled={isSaving} onClick={() => onSave(withMetricRemoved(prefs, pref.id))} className={`${smallButton} hover:text-rose-300 hover:border-rose-500/40`} title="Remove from this portfolio">
                        <Trash2 className="w-3 h-3" />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. Marketplace */}
      <section className="cx-card p-5 sm:p-6 space-y-4">
        <SectionHeader
          icon={Store}
          title="Marketplace"
          subtitle="Metrics from the repository are reviewed and bundled with the application. Metrics from a URL are not."
          actions={
            <button
              type="button"
              onClick={() => setIsInstallOpen(true)}
              className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider font-mono"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install from URL</span>
            </button>
          }
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setCategory(name)}
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
      </section>

      <InstallMetricDialog isOpen={isInstallOpen} onClose={() => setIsInstallOpen(false)} onInstalled={onInstalled} />
    </div>
  );
}
