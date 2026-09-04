import { useState, useRef, useCallback } from "react";
import {
  ArrowLeft,
  FileText,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { rpc } from "../../rpc";

export interface TermsPageProps {
  onBack: () => void;
  webpageUrl?: string;
}

export function TermsPage({ onBack, webpageUrl = "http://localhost:3000" }: TermsPageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const cleanBaseUrl = (webpageUrl || "http://localhost:3000").replace(/\/+$/, "");
  const termsUrl = `${cleanBaseUrl}/terms`;

  const handleReload = useCallback(() => {
    setIsLoading(true);
    setLoadFailed(false);
    if (iframeRef.current) {
      iframeRef.current.src = termsUrl;
    }
  }, [termsUrl]);

  const handleOpenBrowser = useCallback(async () => {
    try {
      await rpc.request.openExternalUrl({ url: termsUrl });
    } catch {
      window.open(termsUrl, "_blank");
    }
  }, [termsUrl]);

  return (
    <div className="flex-1 w-full max-w-full flex flex-col font-mono min-h-0 space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800 shrink-0">

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleReload}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer focus:outline-none"
            title="Reload Terms of Use"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-[#DD3C73]" : ""}`} />
            <span className="hidden sm:inline">Reload</span>
          </button>

          <button
            type="button"
            onClick={handleOpenBrowser}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-[#DD3C73] transition-colors cursor-pointer focus:outline-none"
            title="Open Terms in Web Browser"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Open in Browser</span>
          </button>

          <div className="flex text-xs font-bold text-slate-400 uppercase tracking-widest items-center gap-1.5 min-w-0">
            <ShieldCheck className="w-4 h-4 text-[#DD3C73] shrink-0" />
            <span className="truncate">Terms of Use</span>
          </div>
        </div>
      </div>

      {/* Frame Container */}
      <div className="flex-1 min-h-[500px] h-[calc(100vh-160px)] relative rounded-2xl overflow-hidden border border-slate-800 bg-[#111726] shadow-2xl flex flex-col">
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0b0f19]/80 backdrop-blur-sm gap-3">
            <RefreshCw className="w-6 h-6 text-[#DD3C73] animate-spin" />
            <span className="text-xs text-slate-400 tracking-wider">
              Loading Terms of Use from {termsUrl}...
            </span>
          </div>
        )}

        {/* Error Fallback */}
        {loadFailed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-[#0b0f19]">
            <div className="w-12 h-12 rounded-2xl bg-[#DD3C73]/10 border border-[#DD3C73]/30 flex items-center justify-center text-[#DD3C73]">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="max-w-md space-y-1">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                Unable to Load Terms Page
              </h3>
              <p className="text-xs text-slate-400">
                Could not connect to <code className="text-[#DD3C73]">{termsUrl}</code>. Ensure your local dev server or website is reachable.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleReload}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={handleOpenBrowser}
                className="px-4 py-2 bg-[#DD3C73] hover:bg-[#DD3C73]/90 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <span>Open in Browser</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Embedded IFrame */}
        <iframe
          ref={iframeRef}
          src={termsUrl}
          title="Terms of Use"
          className="w-full h-full flex-1 border-0 rounded-2xl bg-[#0b0f19]"
          onLoad={() => {
            setIsLoading(false);
          }}
          onError={() => {
            setIsLoading(false);
            setLoadFailed(true);
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
