import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, ExternalLink, ChevronUp, Check, TrendingUp, Users, Eye, EyeOff } from "lucide-react";
import { openExternal, VENDOR_URL } from "../../environment";
import { formatTimeAgo } from "../portfolio/utils";

import type { AppUpdateInfo } from "portfolio-shared/api-types";
import type { PortfolioItem } from "portfolio-shared/portfolio";

export { formatTimeAgo };

export interface BottomBarProps {
  version: string;
  lastQuotesSync?: string;
  onOpenTerms: () => void;
  onSyncQuotes: () => void | Promise<void>;
  isSyncingQuotes?: boolean;
  /** Background refresh interval in minutes (0 = manual only); undefined while unknown. */
  quotesIntervalMins?: number;
  portfolios?: PortfolioItem[];
  activePortfolio?: PortfolioItem | null;
  onSelectPortfolio?: (id: string) => void;
  onManagePortfolios?: () => void;
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
  quotesIntervalMins,
  portfolios,
  activePortfolio,
  onSelectPortfolio,
  onManagePortfolios,
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

  const [isSyncInfoOpen, setIsSyncInfoOpen] = useState(false);
  const [isPortfolioMenuOpen, setIsPortfolioMenuOpen] = useState(false);
  const portfolioMenuRef = useRef<HTMLDivElement>(null);

  // Close the portfolio menu on a click outside it or on Escape.
  useEffect(() => {
    if (!isPortfolioMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (portfolioMenuRef.current && !portfolioMenuRef.current.contains(e.target as Node)) setIsPortfolioMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsPortfolioMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isPortfolioMenuOpen]);

  // One refresh at a time: a click while one runs does nothing.
  const handleSyncClick = useCallback(() => {
    if (isSyncingQuotes) return;
    void onSyncQuotes();
  }, [isSyncingQuotes, onSyncQuotes]);

  const lastSyncDate = lastQuotesSync ? new Date(lastQuotesSync) : null;
  const lastSyncLabel =
    lastSyncDate && !Number.isNaN(lastSyncDate.getTime()) ? lastSyncDate.toLocaleString() : "Never";
  const intervalLabel =
    quotesIntervalMins === undefined
      ? "Unknown"
      : quotesIntervalMins <= 0
        ? "Off (manual only)"
        : quotesIntervalMins >= 60 && quotesIntervalMins % 60 === 0
          ? `Every ${quotesIntervalMins / 60} h`
          : `Every ${quotesIntervalMins} min`;
  const showPortfolioPicker = !!portfolios && portfolios.length > 1;

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

      {/* Right side: portfolio picker, privacy, then the quotes refresh set */}
      <div className="flex items-center gap-2 shrink-0 pl-2">
        {showPortfolioPicker && (
          <div ref={portfolioMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsPortfolioMenuOpen((open) => !open)}
              className="px-1.5 py-0.5 rounded flex items-center gap-1.5 max-w-[200px] text-[#DD3C73] hover:bg-slate-800/60 transition-colors focus:outline-none cursor-pointer"
              aria-haspopup="listbox"
              aria-expanded={isPortfolioMenuOpen}
              title="Switch Portfolio"
            >
              {activePortfolio?.isShared ? <Users className="w-3 h-3 shrink-0" /> : <TrendingUp className="w-3 h-3 shrink-0" />}
              <span className="truncate">{activePortfolio?.name || "Main Portfolio"}</span>
              <ChevronUp className="w-3 h-3 shrink-0 text-slate-400" />
            </button>

            {isPortfolioMenuOpen && (
              <div className="app-menu app-menu-up" style={{ left: "auto", right: 0, width: "16rem" }} role="listbox">
                <div className="flex items-center justify-between px-2.5 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                  <span>Portfolios ({portfolios.length})</span>
                  {onManagePortfolios && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsPortfolioMenuOpen(false);
                        onManagePortfolios();
                      }}
                      className="text-[#DD3C73] hover:text-accent-bright hover:underline cursor-pointer"
                    >
                      Manage
                    </button>
                  )}
                </div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                  {portfolios.map((p) => {
                    const isActive = p.id === activePortfolio?.id;
                    const Icon = p.isShared ? Users : TrendingUp;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => {
                          setIsPortfolioMenuOpen(false);
                          onSelectPortfolio?.(p.id);
                        }}
                        className="app-menu-item group"
                      >
                        <span className="flex items-center gap-2.5 min-w-0 pr-3">
                          <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-[#DD3C73]" : "text-slate-400"}`} />
                          <span className="truncate">{p.name}</span>
                          {p.isShared && <span className="text-[10px] text-slate-500 shrink-0">(shared)</span>}
                        </span>
                        {isActive && <Check className="w-3.5 h-3.5 text-accent-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {onToggleHideCurrency && (
          <button
            type="button"
            onClick={onToggleHideCurrency}
            className={`px-1.5 py-0.5 rounded flex items-center gap-1.5 transition-colors focus:outline-none cursor-pointer hover:bg-slate-800/60 ${
              hideCurrencyValues ? "text-cream hover:text-[#f0f5db]" : "hover:text-accent-300"
            }`}
            title={hideCurrencyValues ? "Show financial values (Privacy ON - Ctrl+H)" : "Hide financial values for privacy (Ctrl+H)"}
            aria-label={hideCurrencyValues ? "Show financial values" : "Hide financial values for privacy"}
            aria-pressed={hideCurrencyValues}
          >
            {hideCurrencyValues ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{hideCurrencyValues ? "privacy: on" : "privacy"}</span>
          </button>
        )}
        <div
          className="relative"
          onMouseEnter={() => setIsSyncInfoOpen(true)}
          onMouseLeave={() => setIsSyncInfoOpen(false)}
        >
          <button
            type="button"
            onClick={handleSyncClick}
            onFocus={() => setIsSyncInfoOpen(true)}
            onBlur={() => setIsSyncInfoOpen(false)}
            aria-disabled={isSyncingQuotes}
            aria-label={isSyncingQuotes ? "Refreshing market quotes" : "Refresh market quotes"}
            className={`px-1.5 py-0.5 rounded flex items-center gap-1.5 transition-colors focus:outline-none ${
              isSyncingQuotes ? "cursor-default" : "cursor-pointer hover:bg-slate-800/60 hover:text-accent-300"
            }`}
          >
            <span className="text-slate-300 font-medium">{isSyncingQuotes ? "refreshing" : relativeTime}</span>
            <RefreshCw className={`w-3 h-3 ${isSyncingQuotes ? "animate-spin text-accent-400" : "text-slate-400"}`} />
          </button>

          {isSyncInfoOpen && (
            <div className="app-menu app-menu-up pointer-events-none" style={{ left: "auto", right: 0, width: "16rem" }} role="tooltip">
              <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Market quotes</div>
              <dl className="px-2.5 pb-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-slate-500">Status</dt>
                <dd className={`text-right ${isSyncingQuotes ? "text-accent-300" : "text-slate-200"}`}>
                  {isSyncingQuotes ? "Refreshing..." : "Idle"}
                </dd>
                <dt className="text-slate-500">Last refresh</dt>
                <dd className="text-right text-slate-200">{lastSyncLabel}</dd>
                <dt className="text-slate-500">Age</dt>
                <dd className="text-right text-slate-200">{relativeTime}</dd>
                <dt className="text-slate-500">Auto refresh</dt>
                <dd className="text-right text-slate-200">{intervalLabel}</dd>
              </dl>
              <div className="app-menu-separator" />
              <div className="px-2.5 pb-1 text-[10px] text-slate-500">
                {isSyncingQuotes ? "A refresh is running." : "Click to refresh now."}
              </div>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
