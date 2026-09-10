import { useEffect, useState, useRef } from "react";
import { X, Download, ExternalLink, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
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
          className="mt-4 flex-1 overflow-y-auto pr-2 custom-scrollbar"
        >
          {releaseNotes ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
              components={{
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
                a: ({ node: _n, href, children, ...props }) => (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      if (href) rpc.request.openExternalUrl({ url: href }).catch(() => {});
                    }}
                    className="text-[#DD3C73] underline underline-offset-2 hover:text-[#e8558a] transition-colors cursor-pointer"
                    {...props}
                  >
                    {children}
                  </a>
                ),
                strong: ({ node: _n, ...props }) => <strong className="font-bold text-slate-100" {...props} />,
                em: ({ node: _n, ...props }) => <em className="italic text-slate-200" {...props} />,
                code: ({ node: _n, ...props }) => (
                  <code className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-[#E3EACD] font-mono text-[10px]" {...props} />
                ),
                pre: ({ node: _n, ...props }) => (
                  <pre
                    className="my-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 overflow-x-auto text-[10px] leading-relaxed custom-scrollbar [&_code]:bg-transparent [&_code]:border-0 [&_code]:p-0 [&_code]:text-[#E3EACD]"
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
                img: ({ node: _n, ...props }) => <img className="max-w-full rounded-lg my-2" {...props} />,
              }}
            >
              {releaseNotes}
            </ReactMarkdown>
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