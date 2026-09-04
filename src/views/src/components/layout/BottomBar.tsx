import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ExternalLink, Eye, EyeOff } from "lucide-react";
import { rpc } from "../../rpc";
import { formatTimeAgo } from "../portfolio/utils";

export { formatTimeAgo };

export interface BottomBarProps {
  version: string;
  lastQuotesSync?: string;
  onOpenTerms: () => void;
  onSyncQuotes: () => void | Promise<void>;
  isSyncingQuotes?: boolean;
  hideCurrencyValues?: boolean;
  onToggleHideCurrency?: () => void;
}

export function BottomBar({
  version,
  lastQuotesSync,
  onOpenTerms,
  onSyncQuotes,
  isSyncingQuotes = false,
  hideCurrencyValues = false,
  onToggleHideCurrency,
}: BottomBarProps) {
  const [relativeTime, setRelativeTime] = useState<string>(() => formatTimeAgo(lastQuotesSync));

  // Update relative time periodically
  useEffect(() => {
    setRelativeTime(formatTimeAgo(lastQuotesSync));
    const interval = setInterval(() => {
      setRelativeTime(formatTimeAgo(lastQuotesSync));
    }, 30000);
    return () => clearInterval(interval);
  }, [lastQuotesSync]);

  const handleOpenCgeosoft = useCallback(async () => {
    try {
      await rpc.request.openExternalUrl({ url: "https://cgeosoft.com" });
    } catch {
      window.open("https://cgeosoft.com", "_blank");
    }
  }, []);

  const isoTooltip = lastQuotesSync || "No quotes synchronization recorded";

  return (
    <footer
      className="bg-[#080b13] border-t border-slate-800/80 px-3 py-1 flex items-center justify-between text-[11px] font-mono text-slate-400 select-none z-30 shrink-0"
      role="contentinfo"
      aria-label="Application Status Bar"
    >
      {/* Left side: portfolio v<version> - cgeosoft - terms of use */}
      <div className="flex items-center gap-1.5 min-w-0 truncate">
        <span className="text-slate-300">
          portfolio v{version}
        </span>
        <span className="text-slate-600">-</span>
        <button
          type="button"
          onClick={handleOpenCgeosoft}
          className="text-slate-400 hover:text-[#DD3C73] transition-colors inline-flex items-center gap-1 focus:outline-none cursor-pointer"
          title="Open cgeosoft.com in browser"
        >
          <span>cgeosoft</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
        </button>
        <span className="text-slate-600">-</span>
        <button
          type="button"
          onClick={onOpenTerms}
          className="text-slate-400 hover:text-[#DD3C73] transition-colors focus:outline-none cursor-pointer"
          title="Open Terms of Use in app"
        >
          terms of use
        </button>
      </div>

      {/* Right side: Privacy toggle, Yahoo quotes sync info and resync button */}
      <div className="flex items-center gap-2 shrink-0 pl-2">
        {onToggleHideCurrency && (
          <>
            <button
              type="button"
              onClick={onToggleHideCurrency}
              className={`p-1 rounded transition-colors focus:outline-none cursor-pointer flex items-center gap-1.5 ${
                hideCurrencyValues
                  ? "text-[#E3EACD] hover:text-[#f0f5db] hover:bg-[#E3EACD]/10"
                  : "text-slate-400 hover:text-[#DD3C73] hover:bg-slate-800/60"
              }`}
              title={hideCurrencyValues ? "Show financial values (Privacy ON - Ctrl+H)" : "Hide financial values for privacy (Ctrl+H)"}
              aria-label={hideCurrencyValues ? "Show financial values" : "Hide financial values for privacy"}
            >
              {hideCurrencyValues ? (
                <EyeOff className="w-3 h-3 text-[#E3EACD]" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
              <span className="hidden sm:inline">
                {hideCurrencyValues ? "privacy: on" : "privacy"}
              </span>
            </button>
            <span className="text-slate-700 hidden sm:inline">|</span>
          </>
        )}

        <div className="flex items-center gap-1.5" title={isoTooltip}>
          <span className="text-slate-500 hidden sm:inline">quotes:</span>
          <span className="text-slate-300 font-medium cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
            {relativeTime}
          </span>
        </div>

        <button
          type="button"
          onClick={onSyncQuotes}
          disabled={isSyncingQuotes}
          className="p-1 rounded text-slate-400 hover:text-[#DD3C73] hover:bg-slate-800/60 transition-colors focus:outline-none cursor-pointer disabled:opacity-50"
          title="Force resync quotes with Yahoo Finance"
          aria-label="Force resync quotes with Yahoo Finance"
        >
          <RefreshCw
            className={`w-3 h-3 ${isSyncingQuotes ? "animate-spin text-[#DD3C73]" : ""}`}
          />
        </button>
      </div>
    </footer>
  );
}
