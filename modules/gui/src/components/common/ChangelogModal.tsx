import { useEffect, useState, useRef } from "react";
import { X, Download, ExternalLink, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { Components } from "react-markdown";
import { api } from "../../api";
import { openExternal } from "../../environment";
import { SafeMarkdown } from "./SafeMarkdown";
import { t } from "../../i18n";

/** Styles of the release notes; module level, so the elements are not remounted on every render. */
const NOTES_MARKDOWN: Components = {
  h1: ({ node: _n, ...props }) => (
    <h1 className="text-xs font-bold uppercase tracking-wider text-[#DD3C73] border-b border-slate-800 pb-1 mt-3 mb-1.5 first:mt-0" {...props} />
  ),
  h2: ({ node: _n, ...props }) => (
    <h2 className="text-xs font-bold uppercase tracking-wider text-[#DD3C73] mt-3 mb-1.5 first:mt-0" {...props} />
  ),
  h3: ({ node: _n, ...props }) => (
    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-200 mt-3 mb-1 first:mt-0" {...props} />
  ),
  h4: ({ node: _n, ...props }) => (
    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-300 mt-2.5 mb-1 first:mt-0" {...props} />
  ),
  p: ({ node: _n, ...props }) => <p className="mb-2 text-[10px] text-slate-300 leading-relaxed" {...props} />,
  ul: ({ node: _n, ...props }) => (
    <ul className="list-disc list-outside pl-4 mb-2 space-y-0.5 text-[10px] text-slate-300" {...props} />
  ),
  ol: ({ node: _n, ...props }) => (
    <ol className="list-decimal list-outside pl-4 mb-2 space-y-0.5 text-[10px] text-slate-300" {...props} />
  ),
  li: ({ node: _n, ...props }) => <li className="text-slate-300 leading-relaxed" {...props} />,
  blockquote: ({ node: _n, ...props }) => (
    <blockquote className="border-l-2 border-[#DD3C73] bg-[#DD3C73]/5 px-2.5 py-1.5 my-2 text-[10px] text-slate-400 italic rounded-r" {...props} />
  ),
  strong: ({ node: _n, ...props }) => <strong className="font-bold text-slate-100" {...props} />,
  em: ({ node: _n, ...props }) => <em className="italic text-slate-200" {...props} />,
  code: ({ node: _n, ...props }) => (
    <code className="px-1 py-0.5 rounded-sm bg-slate-950 border border-slate-800 text-cream font-mono text-[10px]" {...props} />
  ),
  pre: ({ node: _n, ...props }) => (
    <pre
      className="my-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 overflow-x-auto text-[10px] leading-relaxed custom-scrollbar [&_code]:bg-transparent [&_code]:border-0 [&_code]:p-0 [&_code]:text-cream"
      {...props}
    />
  ),
  hr: ({ node: _n, ...props }) => <hr className="my-3 border-slate-800" {...props} />,
  table: ({ node: _n, ...props }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950">
      <table className="w-full border-collapse text-[10px]" {...props} />
    </div>
  ),
  thead: ({ node: _n, ...props }) => (
    <thead className="border-b border-slate-800 bg-slate-900 text-slate-400 uppercase tracking-wider" {...props} />
  ),
  tbody: ({ node: _n, ...props }) => <tbody className="divide-y divide-slate-800/60 text-slate-300" {...props} />,
  tr: ({ node: _n, ...props }) => <tr {...props} />,
  th: ({ node: _n, ...props }) => <th className="px-2 py-1.5 text-left font-bold text-slate-200" {...props} />,
  td: ({ node: _n, ...props }) => <td className="px-2 py-1.5 text-slate-400" {...props} />,
};

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
  latestVersion: string;
  currentVersion: string;
  releaseName: string;
  releaseUrl: string;
  releaseNotes: string;
}

type DownloadState = "idle" | "picking" | "downloading" | "done" | "browser" | "error";

/** How often the modal reads the progress of the service download. */
const POLL_MS = 500;

export function ChangelogModal({
  isOpen,
  onClose,
  latestVersion,
  currentVersion,
  releaseName,
  releaseUrl,
  releaseNotes,
}: ChangelogModalProps) {
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const [downloadError, setDownloadError] = useState("");
  const [downloadPath, setDownloadPath] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setDownloadState("idle");
      setDownloadError("");
      setDownloadPath("");
      setProgress(null);
      // A download started before the modal was closed keeps running in the service.
      api
        .getUpdateDownload()
        .then((state) => {
          if (state.status === "picking" || state.status === "downloading") void poll();
        })
        .catch(() => {});
    }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const fail = (message: string) => {
    setDownloadError(message || t("layout.changelog.downloadFailed"));
    setDownloadState("error");
  };

  /** Follows the download the service runs for the desktop window. */
  const poll = async () => {
    try {
      const state = await api.getUpdateDownload();
      if (state.status === "picking" || state.status === "downloading") {
        setDownloadState(state.status);
        setProgress(state.totalBytes ? Math.round(((state.receivedBytes ?? 0) / state.totalBytes) * 100) : null);
        pollRef.current = setTimeout(poll, POLL_MS);
      } else if (state.status === "done") {
        setDownloadPath(state.filePath || state.fileName || "");
        setDownloadState("done");
      } else if (state.status === "cancelled") {
        setDownloadState("idle");
      } else {
        fail(state.error || "");
      }
    } catch (err: unknown) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownload = async () => {
    stopPolling();
    setDownloadState("picking");
    setDownloadError("");
    setProgress(null);
    try {
      const result = await api.downloadUpdate(latestVersion, t("layout.changelog.folderTitle"));
      if (!result.success) {
        fail(result.error || "");
      } else if (result.started) {
        void poll();
      } else if (result.url) {
        // Another device: its browser downloads the installer.
        openExternal(result.url);
        setDownloadPath(result.fileName || result.url);
        setDownloadState("browser");
      }
    } catch (err: unknown) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  const busy = downloadState === "picking" || downloadState === "downloading";

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-lg max-h-[85vh] bg-widget border border-line rounded-2xl shadow-2xl p-6 sm:p-7 text-slate-100 font-mono flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-linear-to-tr from-plum via-royal to-[#DD3C73] p-[1.5px] shadow-lg shadow-[#DD3C73]/20 flex items-center justify-center shrink-0">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Download className="w-5 h-5 text-[#DD3C73]" />
              </div>
            </div>
            <div>
              <h2 id="changelog-modal-title" className="text-base font-bold tracking-wide text-slate-100">
                {releaseName || t("layout.changelog.version", { version: latestVersion })}
              </h2>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {t("layout.changelog.running", { version: currentVersion })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800/60 transition-colors focus:outline-hidden cursor-pointer"
            aria-label={t("layout.changelog.closeLabel")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Changelog body */}
        <div
          ref={notesRef}
          className="mt-4 flex-1 overflow-y-auto pr-2 custom-scrollbar"
        >
          {releaseNotes ? (
            <SafeMarkdown components={NOTES_MARKDOWN} links="web">
              {releaseNotes}
            </SafeMarkdown>
          ) : (
            <p className="text-[10px] text-slate-500 italic">
              {t("layout.changelog.noNotes")}{" "}
              <button
                type="button"
                onClick={() => openExternal(releaseUrl)}
                className="text-[#DD3C73] hover:underline cursor-pointer"
              >
                {t("layout.changelog.releasePage")}
              </button>
            </p>
          )}
        </div>

        {/* Download status */}
        {(downloadState === "done" || downloadState === "browser") && (
          <div className="mt-3 p-2.5 rounded-lg bg-mint/10 border border-mint/30 flex items-center gap-2 text-[10px] text-mint shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate" title={downloadPath}>
              {downloadState === "done"
                ? t("layout.changelog.downloadSaved", { path: downloadPath })
                : t("layout.changelog.downloadStarted", { path: downloadPath })}
            </span>
          </div>
        )}

        {downloadState === "error" && (
          <div className="mt-3 p-2.5 rounded-lg bg-[#DD3C73]/10 border border-[#DD3C73]/30 flex items-center gap-2 text-[10px] text-[#DD3C73] shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{downloadError}</span>
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => openExternal(releaseUrl)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <ExternalLink className="w-3 h-3" />
            {t("layout.changelog.releasePage")}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            className="px-3.5 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c93567] text-white text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
          >
            {busy ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                {downloadState === "picking"
                  ? t("layout.changelog.choosingFolder")
                  : progress !== null
                    ? t("layout.changelog.downloadingPercent", { percent: progress })
                    : t("layout.changelog.downloading")}
              </>
            ) : (
              <>
                <Download className="w-3 h-3" />
                {downloadState === "done" || downloadState === "browser" ? t("layout.changelog.downloadAgain") : t("layout.changelog.downloadLatest")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}