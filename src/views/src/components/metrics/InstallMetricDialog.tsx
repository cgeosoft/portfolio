import { useEffect, useState } from "react";
import { AlertCircle, Download, Link, Loader2, ShieldAlert, X } from "lucide-react";
import type { MetricListing, PreviewMetricInstallResponse } from "../../../../shared/rpc-types";
import { rpc } from "../../rpc";
import { getMetricAccentClass, getMetricIcon } from "../portfolio/metrics-catalog";
import { ScopeConsentList } from "./ScopeBadges";

interface InstallMetricDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onInstalled: (metric: MetricListing) => void;
}

/**
 * Install a metric module from a URL. The dialog fetches the manifest and
 * module, shows the requested data scopes, and installs only after the user
 * accepts them. Anything installed this way stays marked as unverified.
 */
export function InstallMetricDialog({ isOpen, onClose, onInstalled }: InstallMetricDialogProps) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PreviewMetricInstallResponse | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = isFetching || isInstalling;

  useEffect(() => {
    if (isOpen) {
      setUrl("");
      setPreview(null);
      setAccepted(false);
      setError(null);
      setIsFetching(false);
      setIsInstalling(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const handleFetch = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setIsFetching(true);
    setError(null);
    setPreview(null);
    setAccepted(false);
    try {
      setPreview(await rpc.request.previewMetricInstall({ url: trimmed }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetching(false);
    }
  };

  const handleInstall = async () => {
    if (!preview || !accepted) return;
    setIsInstalling(true);
    setError(null);
    try {
      const res = await rpc.request.installMetric({ url: preview.url, grantedScopes: preview.manifest.scopes });
      onInstalled(res.metric);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsInstalling(false);
    }
  };

  const manifest = preview?.manifest;
  const Icon = manifest ? getMetricIcon(manifest.icon) : Download;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-metric-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="relative w-full max-w-lg flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-[#DD3C73]/15 border border-[#DD3C73]/30 text-[#DD3C73] shrink-0">
              <Download className="w-4 h-4" />
            </div>
            <h2 id="install-metric-title" className="text-sm font-bold text-slate-100 uppercase tracking-wider truncate">
              Install metric from URL
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar text-xs">
          <div className="space-y-1.5">
            <label htmlFor="metric-url" className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Manifest URL
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  id="metric-url"
                  type="url"
                  value={url}
                  disabled={busy}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleFetch();
                  }}
                  placeholder="https://example.com/my-metric/manifest.yml"
                  className="w-full h-9 pl-8 pr-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:border-[#DD3C73]/60 disabled:opacity-60"
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={() => void handleFetch()}
                disabled={busy || !url.trim()}
                className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-800 text-xs font-bold text-slate-200 hover:bg-slate-800/60 transition-all cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>Fetch</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              The URL must point at a <code>manifest.yml</code> whose <code>module</code> block names the .wasm file and its SHA-256.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl flex items-start gap-2 text-rose-400 bg-rose-950/40 border border-rose-800/50">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">{error}</span>
            </div>
          )}

          {preview && manifest && (
            <>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                    <Icon className={`w-4 h-4 ${getMetricAccentClass(manifest.accent)}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-100 truncate">{manifest.name}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                      {manifest.category} · v{manifest.version} · {manifest.license} · by {manifest.developer.name}
                    </div>
                    <p className="text-slate-400 mt-1.5 leading-relaxed">{manifest.summary}</p>
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 break-all">
                  {(preview.size / 1024).toFixed(1)} KiB · sha256 {preview.sha256}
                </div>
                {preview.conflict === "builtin" && (
                  <div className="text-rose-400 text-[11px]">
                    The id <code>{manifest.id}</code> belongs to a built-in metric and cannot be replaced.
                  </div>
                )}
                {preview.conflict === "installed" && (
                  <div className="text-amber-300 text-[11px]">
                    Replaces the installed version {preview.installedVersion} of <code>{manifest.id}</code>.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">This metric asks to read</div>
                <ScopeConsentList scopes={manifest.scopes} />
              </div>

              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 flex items-start gap-2 text-amber-200">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
                <div className="min-w-0 text-[11px] leading-relaxed">
                  Nobody has reviewed this module. It runs in a sandbox with no file, network, or system access and can only
                  return a number and a label, but it receives the data listed above. It stays marked{" "}
                  <strong>UNVERIFIED</strong>.
                </div>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={busy || preview.conflict === "builtin"}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-0.5 accent-[#DD3C73]"
                />
                <span className="text-slate-300 text-[11px]">
                  I grant this module the data scopes listed above and accept that it is unverified.
                </span>
              </label>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-8 px-3 rounded-lg border border-slate-800 text-xs font-bold text-slate-300 hover:bg-slate-800/60 transition-all cursor-pointer uppercase tracking-wider disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleInstall()}
            disabled={!preview || !accepted || busy || preview.conflict === "builtin"}
            className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isInstalling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span>Install</span>
          </button>
        </div>
      </div>
    </div>
  );
}
