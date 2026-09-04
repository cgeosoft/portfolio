import { useState, useRef, useEffect } from "react";
import type { PortfolioItem } from "../../types/portfolio";
import {
  BriefcaseBusiness,
  RefreshCw,
  Settings,
  ChevronDown,
  Check,
  Eye,
  EyeOff,
  PieChart,
  FileText,
  History,
  Users,
} from "lucide-react";

export type PortfolioTabKey = "overview" | "reports" | "transactions";

interface HeaderProps {
  currency?: string;
  onChangeCurrency?: (c: string) => void;
  activePortfolio: PortfolioItem | null;
  portfolios: PortfolioItem[];
  onChangePortfolio: (id: string) => void;
  onOpenManagePortfolios: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenSettings: () => void;
  lastUpdated?: string;
  activeTab?: PortfolioTabKey;
  onTabChange?: (tab: PortfolioTabKey) => void;
  activeView?: "dashboard" | "settings" | "terms" | "portfolios";
  onNavigateDashboard?: (tab?: PortfolioTabKey) => void;
  reportsCount?: number;
  transactionsCount?: number;
  hideCurrencyValues?: boolean;
  onToggleHideCurrency?: () => void;
}

export function Header({
  activePortfolio,
  portfolios,
  onChangePortfolio,
  onOpenManagePortfolios,
  onRefresh,
  isRefreshing,
  onOpenSettings,
  activeTab = "overview",
  onTabChange,
  activeView = "dashboard",
  onNavigateDashboard,
  reportsCount = 0,
  transactionsCount = 0,
  hideCurrencyValues = false,
  onToggleHideCurrency,
}: HeaderProps) {
  const [isPortfolioDropdownOpen, setIsPortfolioDropdownOpen] = useState(false);
  const portfolioMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (portfolioMenuRef.current && !portfolioMenuRef.current.contains(e.target as Node)) {
        setIsPortfolioDropdownOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsPortfolioDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handlePageClick = (tabId: PortfolioTabKey) => {
    if (activeView !== "dashboard" && onNavigateDashboard) {
      onNavigateDashboard(tabId);
    } else if (onTabChange) {
      onTabChange(tabId);
    }
  };

  const handleLogoClick = () => {
    if (onNavigateDashboard) {
      onNavigateDashboard("overview");
    } else if (onTabChange) {
      onTabChange("overview");
    }
  };

  const tabs = [
    { id: "overview" as PortfolioTabKey, label: "Overview", icon: PieChart },
    {
      id: "reports" as PortfolioTabKey,
      label: "Reports",
      icon: FileText,
      badge: reportsCount > 0 ? reportsCount : null,
    },
    {
      id: "transactions" as PortfolioTabKey,
      label: "Transactions",
      icon: History,
      badge: transactionsCount > 0 ? transactionsCount : null,
    },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-30 px-3 sm:px-6 py-2.5 flex items-center justify-between font-mono select-none gap-2 sm:gap-3 max-w-full">
      <button
        onClick={handleLogoClick}
        className="h-8 flex items-center gap-2 cursor-pointer group focus:outline-none shrink-0"
        title="Go to Dashboard"
      >
        <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#341B83] via-[#243C8F] to-[#DD3C73] p-[1px] shadow-sm shadow-[#DD3C73]/20 flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
          <div className="w-full h-full bg-slate-950 rounded-[7px] flex items-center justify-center">
            <BriefcaseBusiness className="w-3.5 h-3.5 text-[#DD3C73]" />
          </div>
        </div>

        <div className="flex items-center">
          <span className="font-bold text-xs sm:text-sm tracking-wider uppercase bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent group-hover:text-[#DD3C73] transition-colors">
            Portfolio
          </span>
        </div>
      </button>

      <nav aria-label="Page navigation" className="hidden md:flex items-center h-8 bg-slate-900/80 border border-slate-800 p-0.5 rounded-lg shadow-inner">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeView === "dashboard" && activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handlePageClick(tab.id)}
              className={`h-7 flex items-center gap-1.5 px-3 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                isActive
                  ? "bg-[#DD3C73]/15 text-[#DD3C73] border border-[#DD3C73]/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
              }`}
            >
              <Icon className="w-3 h-3" />
              <span>
                {tab.label}
                {tab.badge !== null && tab.badge !== undefined && ` (${tab.badge})`}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink min-w-0">
        {onToggleHideCurrency && (
          <button
            onClick={onToggleHideCurrency}
            className={`h-8 w-8 shrink-0 flex items-center justify-center border rounded-lg transition-all cursor-pointer ${
              hideCurrencyValues
                ? "border-[#E3EACD]/40 bg-[#E3EACD]/10 text-[#E3EACD] shadow-sm shadow-[#E3EACD]/10"
                : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200 hover:border-slate-700"
            }`}
            title={hideCurrencyValues ? "Show numbers" : "Hide financial values for privacy"}
          >
            {hideCurrencyValues ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}

        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-8 w-8 shrink-0 flex items-center justify-center bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-300 hover:text-[#DD3C73] transition-colors cursor-pointer disabled:opacity-50"
          title="Refresh Market Quotes"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-[#DD3C73]" : ""}`} />
        </button>

        <div className="relative shrink min-w-0" ref={portfolioMenuRef}>
          <button
            onClick={() => setIsPortfolioDropdownOpen((prev) => !prev)}
            className="h-8 flex items-center gap-1 sm:gap-1.5 bg-slate-900/90 hover:bg-slate-800/90 border border-slate-700/80 hover:border-[#DD3C73]/50 px-2 sm:px-2.5 rounded-lg text-xs font-bold text-[#DD3C73] transition-all cursor-pointer shadow-sm min-w-0 max-w-[90px] sm:max-w-[170px]"
            title="Switch Portfolio"
          >
            {activePortfolio?.isShared ? (
              <Users className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
            ) : (
              <BriefcaseBusiness className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
            )}
            <span className="truncate">
              {activePortfolio?.name || "Main Portfolio"}
            </span>
            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform shrink-0 ${isPortfolioDropdownOpen ? "rotate-180" : ""}`} />
          </button>

          {isPortfolioDropdownOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 font-mono">
              <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center justify-between border-b border-slate-800/80">
                <span>Portfolios ({portfolios.length})</span>
                <button
                  onClick={() => {
                    setIsPortfolioDropdownOpen(false);
                    onOpenManagePortfolios();
                  }}
                  className="text-[10px] text-[#DD3C73] hover:text-[#e65f8e] transition-colors cursor-pointer font-bold tracking-wider hover:underline"
                >
                  Manage
                </button>
              </div>

              <div className="max-h-56 overflow-y-auto custom-scrollbar my-1">
                {portfolios.map((p) => {
                  const isActive = activePortfolio?.id === p.id;
                  const Icon = p.isShared ? Users : BriefcaseBusiness;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        onChangePortfolio(p.id);
                        setIsPortfolioDropdownOpen(false);
                        if (activeView !== "dashboard" && onNavigateDashboard) {
                          onNavigateDashboard();
                        }
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-slate-800/60 transition-colors cursor-pointer ${
                        isActive ? "bg-[#DD3C73]/10 text-[#DD3C73] font-bold" : "text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate min-w-0 flex-1">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-[#DD3C73]" : "text-slate-500"}`} />
                        <span className="truncate">{p.name}</span>
                        {p.isShared && (
                          <span className="text-[10px] text-slate-500 font-normal shrink-0">
                            (shared)
                          </span>
                        )}
                      </div>
                      {isActive && <Check className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onOpenManagePortfolios}
          className={`h-8 w-8 shrink-0 flex items-center justify-center border rounded-lg transition-all cursor-pointer ${
            activeView === "portfolios"
              ? "bg-[#DD3C73]/20 border-[#DD3C73]/50 text-[#DD3C73]"
              : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200 hover:border-slate-700"
          }`}
          title="Manage Portfolios"
        >
          <BriefcaseBusiness className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onOpenSettings}
          className={`h-8 w-8 shrink-0 flex items-center justify-center border rounded-lg transition-all cursor-pointer ${
            activeView === "settings"
              ? "bg-[#DD3C73]/20 border-[#DD3C73]/50 text-[#DD3C73]"
              : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200 hover:border-slate-700"
          }`}
          title="Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
