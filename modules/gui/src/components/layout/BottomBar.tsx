import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import { openExternal, VENDOR_URL } from "../../environment";
import { formatTimeAgo } from "../portfolio/utils";

import type { AppUpdateInfo } from "portfolio-shared/api-types";

export { formatTimeAgo };

export interface BottomBarProps {
  version: string;
  lastQuotesSync?: string;
  onOpenTerms: () => void;
  onSyncQuotes: () => void | Promise<void>;
  isSyncingQuotes?: boolean;
  hideCurrencyValues?: boolean;
  onToggleHideCurrency?: () => void;
  updateInfo?: AppUpdateInfo | null;
  onOpenUpdate?: () => void;
}

export function BottomBar({
  version,
  lastQuotesSync,
  onOpenTerms,
  onSyncQuotes,
  isSyncingQuotes = false,
  hideCurrencyValues = false,
  onToggleHideCurrency,
  updateInfo,
  onOpenUpdate,
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

  const handleOpenCgeosoft = useCallback(() => {
    openExternal(VENDOR_URL);
  }, []);

  const isoTooltip = lastQuotesSync || "No quotes synchronization recorded";

  return (
    <footer
      className="app-bottombar text-slate-400"
      role="contentinfo"
      aria-label="Application Status Bar"
    >
      {/* Left side: portfolio v<version> - cgeosoft - terms of use */}
      <div className="flex items-center gap-1.5 min-w-0 truncate">
        <span className="text-slate-300">
          portfolio v{version}
        </span>
        {updateInfo?.hasUpdate && (
          <button
            type="button"
            onClick={
              onOpenUpdate ||
              (() => {
                if (updateInfo.releaseUrl) openExternal(updateInfo.releaseUrl);
              })
            }
            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-500/20 text-accent-300 border border-accent-500/40 hover:bg-accent-500/30 transition-colors cursor-pointer inline-flex items-center gap-1"
            title={`New version v${updateInfo.latestVersion} available`}
          >
            <span>v{updateInfo.latestVersion} available</span>
          </button>
        )}
        <span className="text-slate-600">-</span>
        <button
          type="button"
          onClick={handleOpenCgeosoft}
          className="text-slate-400 hover:text-accent-300 transition-colors inline-flex items-center gap-1 focus:outline-none cursor-pointer"
          title="Open cgeosoft.com in browser"
        >
          <span>cgeosoft</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
        </button>
        <span className="text-slate-600">-</span>
        <button
          type="button"
          onClick={onOpenTerms}
          className="text-slate-400 hover:text-accent-300 transition-colors focus:outline-none cursor-pointer"
          title="Open Terms of Use in app"
        >
          terms of use
        </button>
      </div>

      {/* Right side: Yahoo quotes sync info and resync button */}
      <div className="flex items-center gap-2 shrink-0 pl-2">
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
          className="p-1 rounded text-slate-400 hover:text-accent-300 hover:bg-slate-800/60 transition-colors focus:outline-none cursor-pointer disabled:opacity-50"
          title="Force resync quotes with Yahoo Finance"
          aria-label="Force resync quotes with Yahoo Finance"
        >
          <RefreshCw
            className={`w-3 h-3 ${isSyncingQuotes ? "animate-spin text-accent-400" : ""}`}
          />
        </button>
      </div>
    </footer>
  );
}
