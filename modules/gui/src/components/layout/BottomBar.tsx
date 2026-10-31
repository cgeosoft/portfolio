import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, ExternalLink, ChevronUp, Check, Eye, EyeOff } from "lucide-react";
import { openExternal, VENDOR_URL } from "../../environment";
import { formatTimeAgo } from "../portfolio/utils";
import { PortfolioDot } from "../portfolio/portfolioColor";
import { getLocale, t } from "../../i18n";

import type { PortfolioItem } from "portfolio-shared/portfolio";

export { formatTimeAgo };

export interface BottomBarProps {
  version: string;
  lastQuotesSync?: string;
  onOpenTerms: () => void;
  onOpenSponsorship: () => void;
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
}

export function BottomBar({
  version,
  lastQuotesSync,
  onOpenTerms,
  onOpenSponsorship,
  onSyncQuotes,
  isSyncingQuotes = false,
  quotesIntervalMins,
  portfolios,
  activePortfolio,
  onSelectPortfolio,
  onManagePortfolios,
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
    lastSyncDate && !Number.isNaN(lastSyncDate.getTime()) ? lastSyncDate.toLocaleString(getLocale()) : t("layout.bottomBar.never");
  const intervalLabel =
    quotesIntervalMins === undefined
      ? t("common.unknown")
      : quotesIntervalMins <= 0
        ? t("layout.bottomBar.intervalOff")
        : quotesIntervalMins >= 60 && quotesIntervalMins % 60 === 0
          ? t("layout.bottomBar.everyHours", { hours: quotesIntervalMins / 60 })
          : t("layout.bottomBar.everyMinutes", { minutes: quotesIntervalMins });
  // Like the organization chip of FintechCrafts Management: shown whenever a portfolio is open.
  const showPortfolioPicker = !!portfolios && portfolios.length > 0 && !!activePortfolio;

  return (
    <footer
      className="app-bottombar text-slate-400"
      role="contentinfo"
      aria-label={t("layout.bottomBar.statusBar")}
    >
      {/* Left side: portfolio v<version> - cgeosoft - sponsorship - terms of use */}
      <div className="flex items-center gap-1.5 min-w-0 truncate">
        <span className="text-slate-300">
          portfolio v{version}
        </span>
        <span className="text-slate-600">-</span>
        <button
          type="button"
          onClick={handleOpenCgeosoft}
          className="text-slate-400 hover:text-accent-300 transition-colors inline-flex items-center gap-1 focus:outline-hidden cursor-pointer"
          title={t("layout.bottomBar.openVendor")}
        >
          <span>cgeosoft</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
        </button>
        <span className="text-slate-600">-</span>
        <button
          type="button"
          onClick={onOpenSponsorship}
          className="text-slate-400 hover:text-accent-300 transition-colors focus:outline-hidden cursor-pointer"
          title={t("layout.bottomBar.openSponsorship")}
        >
          {t("layout.bottomBar.sponsorship")}
        </button>
        <span className="text-slate-600">-</span>
        <button
          type="button"
          onClick={onOpenTerms}
          className="text-slate-400 hover:text-accent-300 transition-colors focus:outline-hidden cursor-pointer"
          title={t("layout.bottomBar.openTerms")}
        >
          {t("layout.bottomBar.terms")}
        </button>
      </div>

      {/* Right side: portfolio picker, privacy, then the quotes refresh set */}
      <div className="flex items-center gap-2 shrink-0 pl-2">
        {showPortfolioPicker && (
          <div ref={portfolioMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsPortfolioMenuOpen((open) => !open)}
              className="px-1.5 py-0.5 rounded-sm flex items-center gap-1.5 max-w-[200px] text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 transition-colors focus:outline-hidden cursor-pointer"
              aria-haspopup="listbox"
              aria-expanded={isPortfolioMenuOpen}
              title={t("layout.bottomBar.switchPortfolio")}
            >
              <PortfolioDot portfolio={activePortfolio} />
              <span className="truncate">{activePortfolio?.name || "Main Portfolio"}</span>
              <ChevronUp className="w-3 h-3 shrink-0 text-slate-400" />
            </button>

            {isPortfolioMenuOpen && (
              <div className="app-menu app-menu-up" style={{ left: "auto", right: 0, width: "16rem" }} role="listbox">
                <div className="flex items-center justify-between px-2.5 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                  <span>{t("layout.bottomBar.portfoliosCount", { count: portfolios.length })}</span>
                  {onManagePortfolios && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsPortfolioMenuOpen(false);
                        onManagePortfolios();
                      }}
                      className="text-[#DD3C73] hover:text-accent-bright hover:underline cursor-pointer"
                    >
                      {t("layout.bottomBar.manage")}
                    </button>
                  )}
                </div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                  {portfolios.map((p) => {
                    const isActive = p.id === activePortfolio?.id;
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
                          <PortfolioDot portfolio={p} />
                          <span className="truncate">{p.name}</span>
                          {p.isShared && <span className="text-[10px] text-slate-500 shrink-0">{t("layout.bottomBar.shared")}</span>}
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
            className={`px-1.5 py-0.5 rounded flex items-center gap-1.5 transition-colors focus:outline-hidden cursor-pointer hover:bg-slate-800/60 ${
              hideCurrencyValues ? "text-cream hover:text-[#f0f5db]" : "hover:text-accent-300"
            }`}
            title={hideCurrencyValues ? t("layout.bottomBar.privacyShowTitle", { shortcut: "Ctrl+H" }) : t("layout.bottomBar.privacyHideTitle", { shortcut: "Ctrl+H" })}
            aria-label={hideCurrencyValues ? t("layout.bottomBar.privacyShowLabel") : t("layout.bottomBar.privacyHideLabel")}
            aria-pressed={hideCurrencyValues}
          >
            {hideCurrencyValues ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{hideCurrencyValues ? t("layout.bottomBar.privacyOn") : t("layout.bottomBar.privacy")}</span>
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
            aria-label={isSyncingQuotes ? t("layout.bottomBar.refreshingLabel") : t("layout.bottomBar.refreshLabel")}
            className={`px-1.5 py-0.5 rounded flex items-center gap-1.5 transition-colors focus:outline-hidden ${
              isSyncingQuotes ? "cursor-default" : "cursor-pointer hover:bg-slate-800/60 hover:text-accent-300"
            }`}
          >
            <span className="text-slate-300 font-medium">{isSyncingQuotes ? t("layout.bottomBar.refreshing") : relativeTime}</span>
            <RefreshCw className={`w-3 h-3 ${isSyncingQuotes ? "animate-spin text-accent-400" : "text-slate-400"}`} />
          </button>

          {isSyncInfoOpen && (
            <div className="app-menu app-menu-up pointer-events-none" style={{ left: "auto", right: 0, width: "16rem" }} role="tooltip">
              <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">{t("layout.bottomBar.quotes.title")}</div>
              <dl className="px-2.5 pb-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-slate-500">{t("layout.bottomBar.quotes.status")}</dt>
                <dd className={`text-right ${isSyncingQuotes ? "text-accent-300" : "text-slate-200"}`}>
                  {isSyncingQuotes ? t("layout.bottomBar.quotes.refreshing") : t("layout.bottomBar.quotes.idle")}
                </dd>
                <dt className="text-slate-500">{t("layout.bottomBar.quotes.lastRefresh")}</dt>
                <dd className="text-right text-slate-200">{lastSyncLabel}</dd>
                <dt className="text-slate-500">{t("layout.bottomBar.quotes.age")}</dt>
                <dd className="text-right text-slate-200">{relativeTime}</dd>
                <dt className="text-slate-500">{t("layout.bottomBar.quotes.autoRefresh")}</dt>
                <dd className="text-right text-slate-200">{intervalLabel}</dd>
              </dl>
              <div className="app-menu-separator" />
              <div className="px-2.5 pb-1 text-[10px] text-slate-500">
                {isSyncingQuotes ? t("layout.bottomBar.quotes.running") : t("layout.bottomBar.quotes.clickToRefresh")}
              </div>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
