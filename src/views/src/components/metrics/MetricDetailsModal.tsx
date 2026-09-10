import { useEffect } from "react";
import { BadgeCheck, ExternalLink, ShieldAlert, X } from "lucide-react";
import type { MetricListing } from "../../../../shared/rpc-types";
import { rpc } from "../../rpc";
import { getMetricAccentClass, getMetricIcon } from "../portfolio/metrics-catalog";
import { ScopeBadges } from "./ScopeBadges";

interface MetricDetailsModalProps {
  listing: MetricListing | null;
  onClose: () => void;
}

/** Manifest details of a metric module: what it shows, why, who wrote it, and what data it reads. */
export function MetricDetailsModal({ listing, onClose }: MetricDetailsModalProps) {
  useEffect(() => {
    if (!listing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [listing, onClose]);

  if (!listing) return null;
  const { manifest } = listing;
  const Icon = getMetricIcon(manifest.icon);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-details-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0">
              <Icon className={`w-4.5 h-4.5 ${getMetricAccentClass(manifest.accent)}`} />
            </div>
            <div className="min-w-0">
              <h2 id="metric-details-title" className="text-sm font-bold text-slate-100 uppercase tracking-wider truncate">
                {manifest.name}
              </h2>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                {manifest.category} · v{manifest.version} · {manifest.license}
              </div>
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

        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {listing.verified ? (
              <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                <BadgeCheck className="w-3 h-3" /> Reviewed in repository
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-amber-500/50 bg-amber-500/10 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                <ShieldAlert className="w-3 h-3" /> Unverified · installed from URL
              </span>
            )}
            <ScopeBadges scopes={manifest.scopes} size="sm" />
          </div>

          <section className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">What it shows</div>
            <p className="text-slate-300 leading-relaxed">{manifest.description}</p>
          </section>
          <section className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Why it matters</div>
            <p className="text-slate-300 leading-relaxed">{manifest.importance}</p>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Developer</div>
              {manifest.developer.url ? (
                <button
                  type="button"
                  onClick={() => void rpc.request.openExternalUrl({ url: manifest.developer.url! })}
                  className="inline-flex items-center gap-1 text-[#DD3C73] hover:underline cursor-pointer mt-0.5"
                >
                  <span>{manifest.developer.name}</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              ) : (
                <div className="text-slate-300 mt-0.5">{manifest.developer.name}</div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Source</div>
              <div className="text-slate-300 mt-0.5 break-all">
                {listing.source === "builtin" ? "Bundled with the application" : listing.sourceUrl || "URL"}
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Module SHA-256</div>
              <div className="text-slate-500 mt-0.5 break-all text-[10px]">{listing.sha256}</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Sandbox limits</div>
              <div className="text-slate-400 mt-0.5">
                {manifest.runtime.memoryPages * 64} KiB memory · {manifest.runtime.timeoutMs} ms per run · no file, network, or
                system access
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
