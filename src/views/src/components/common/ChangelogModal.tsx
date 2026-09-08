import { useEffect, useState, useRef } from "react";
import { X, Download, ExternalLink, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { rpc } from "../../rpc";

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
  latestVersion: string;
  currentVersion: string;
  releaseName: string;
  releaseUrl: string;
  releaseNotes: string;
}

type DownloadState = "idle" | "downloading" | "done" | "error";

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
  const notesRef = useRef<HTMLDivElement>(null);

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
    }
  }, [isOpen]);

  const handleDownload = async () => {
    setDownloadState("downloading");
    setDownloadError("");
    try {
      const result = await rpc.request.downloadUpdate({ version: latestVersion });
      if (result.success && result.filePath) {
        setDownloadPath(result.filePath);
        setDownloadState("done");
      } else {
        setDownloadError(result.error || "Download failed");
        setDownloadState("error");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDownloadError(msg);
      setDownloadState("error");
    }
  };

  // Simple markdown-to-plaintext rendering for the changelog body
  const renderReleaseNotes = (notes: string) => {
    if (!notes) return null;
    // Split by double newlines for paragraphs
    const blocks = notes.split(/\n{2,}/).filter((b) => b.trim());
    return blocks.map((block, i) => {
      const trimmed = block.trim();
      // Heading
      if (/^#{1,3}\s/.test(trimmed)) {
        const text = trimmed.replace(/^#{1,3}\s+/, "");
        return (
          <h4 key={i} className="text-xs font-bold text-slate-200 mt-3 mb-1 first:mt-0">
            {text}
          </h4>
        );
      }
      // Unordered list
      if (/^[-*]\s/.test(trimmed)) {
        const items = trimmed.split(/\n/).filter((l) => /^[-*]\s/.test(l.trim()));
        return (
          <ul key={i} className="list-disc list-inside space-y-0.5 text-[10px] text-slate-300 leading-relaxed">
            {items.map((item, j) => (
              <li key={j}>{item.replace(/^[-*]\s+/, "")}</li>
            ))}
          </ul>
        );
      }
      // Normal paragraph
      return (
        <p key={i} className="text-[10px] text-slate-300 leading-relaxed">
          {trimmed}
        </p>
      );
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-lg max-h-[85vh] bg-[#111726] border border-[#1e293b] rounded-2xl shadow-2xl p-6 sm:p-7 text-slate-100 font-mono flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#341B83] via-[#243C8F] to-[#DD3C73] p-[1.5px] shadow-lg shadow-[#DD3C73]/20 flex items-center justify-center shrink-0">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Download className="w-5 h-5 text-[#DD3C73]" />
              </div>
            </div>
            <div>
              <h2 id="changelog-modal-title" className="text-base font-bold tracking-wide text-slate-100">
                {releaseName || `Version ${latestVersion}`}
              </h2>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Currently running v{currentVersion}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800/60 transition-colors focus:outline-none cursor-pointer"
            aria-label="Close changelog dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Changelog body */}
        <div
          ref={notesRef}
          className="mt-4 flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2"
        >
          {releaseNotes ? (
            renderReleaseNotes(releaseNotes)
          ) : (
            <p className="text-[10px] text-slate-500 italic">
              No release notes available.{" "}
              <button
                type="button"
                onClick={() => rpc.request.openExternalUrl({ url: releaseUrl }).catch(() => {})}
                className="text-[#DD3C73] hover:underline cursor-pointer"
              >
                View on GitHub
              </button>
            </p>
          )}
        </div>

        {/* Download status */}
        {downloadState === "done" && (
          <div className="mt-3 p-2.5 rounded-lg bg-[#A7E2C0]/10 border border-[#A7E2C0]/30 flex items-center gap-2 text-[10px] text-[#A7E2C0] shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Downloaded to {downloadPath}</span>
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
            onClick={() => rpc.request.openExternalUrl({ url: releaseUrl }).catch(() => {})}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <ExternalLink className="w-3 h-3" />
            View on GitHub
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors cursor-pointer"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloadState === "downloading"}
              className="px-3.5 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c93567] text-white text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
            >
              {downloadState === "downloading" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="w-3 h-3" />
                  {downloadState === "done" ? "Download Again" : "Download Latest Version"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}