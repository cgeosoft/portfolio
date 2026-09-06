import { useState, useRef, useEffect } from "react";
import type { PortfolioItem } from "../../types/portfolio";
import {
  TrendingUp,
  ChevronDown,
  Check,
  PieChart,
  FileText,
  History,
  Users,
  Bot,
} from "lucide-react";

export type PortfolioTabKey = "overview" | "reports" | "transactions";

interface HeaderProps {
  currency?: string;
  onChangeCurrency?: (c: string) => void;
  activePortfolio: PortfolioItem | null;
  portfolios: PortfolioItem[];
  onChangePortfolio: (id: string) => void;
  onOpenManagePortfolios?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onOpenSettings?: () => void;
  lastUpdated?: string;
  activeTab?: PortfolioTabKey;
  onTabChange?: (tab: PortfolioTabKey) => void;
  activeView?: "dashboard" | "settings" | "terms" | "portfolios";
  onNavigateDashboard?: (tab?: PortfolioTabKey) => void;
  reportsCount?: number;
  transactionsCount?: number;
  hideCurrencyValues?: boolean;
  onToggleHideCurrency?: () => void;
  isAssistantOpen?: boolean;
  onToggleAssistant?: () => void;
}

export function Header({
  activePortfolio,
  portfolios,
  onChangePortfolio,
  onOpenManagePortfolios,
  activeTab = "overview",
  onTabChange,
  activeView = "dashboard",
  onNavigateDashboard,
  reportsCount = 0,
  transactionsCount = 0,
  isAssistantOpen,
  onToggleAssistant,
}: HeaderProps) {
  const [isPortfolioDropdownOpen, setIsPortfolioDropdownOpen] = useState(false);
  const portfolioMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        portfolioMenuRef.current &&
        !portfolioMenuRef.current.contains(e.target as Node)
      ) {
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

  const tabs = [
    { id: "overview" as PortfolioTabKey, label: "Overview", icon: PieChart },
    {
      id: "transactions" as PortfolioTabKey,
      label: "Transactions",
      icon: History,
      badge: transactionsCount > 0 ? transactionsCount : null,
    },
    {
      id: "reports" as PortfolioTabKey,
      label: "Reports",
      icon: FileText,
      badge: reportsCount > 0 ? reportsCount : null,
    },
  ];

  return (
    <header className="sticky top-0 z-30 px-3 sm:px-6 py-1.5 flex items-center justify-center font-mono select-none gap-1.5 shrink-0 w-full bg-transparent">
      <nav aria-label="Page navigation" className="flex items-center gap-1">
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
                {tab.badge !== null &&
                  tab.badge !== undefined &&
                  ` (${tab.badge})`}
              </span>
            </button>
          );
        })}

        {onToggleAssistant && (
          <button
            type="button"
            onClick={onToggleAssistant}
            className={`h-7 flex items-center gap-1.5 px-3 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
              isAssistantOpen
                ? "bg-[#DD3C73]/15 text-[#DD3C73] border border-[#DD3C73]/40 shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
            }`}
            title={
              isAssistantOpen
                ? "Close Assistant (Ctrl+J)"
                : "Open Assistant (Ctrl+J)"
            }
            aria-label="Toggle Assistant"
          >
            <Bot className="w-3 h-3" />
            <span>Assistant</span>
          </button>
        )}
      </nav>

      {portfolios && portfolios.length > 1 && (
        <div className="relative shrink-0" ref={portfolioMenuRef}>
          <button
            onClick={() => setIsPortfolioDropdownOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={isPortfolioDropdownOpen}
            className="h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-bold text-[#DD3C73] hover:text-[#e65f8e] hover:bg-slate-800/40 border border-transparent transition-all cursor-pointer min-w-0 max-w-[170px]"
            title="Switch Portfolio"
          >
            {activePortfolio?.isShared ? (
              <Users className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
            ) : (
              <TrendingUp className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
            )}
            <span className="truncate">
              {activePortfolio?.name || "Main Portfolio"}
            </span>
            <ChevronDown
              className={`w-3 h-3 text-slate-400 transition-transform shrink-0 ${isPortfolioDropdownOpen ? "rotate-180" : ""}`}
            />
          </button>

          {isPortfolioDropdownOpen && (
            <div className="absolute left-0 mt-1.5 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 font-mono">
              <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center justify-between border-b border-slate-800/80">
                <span>Portfolios ({portfolios.length})</span>
                {onOpenManagePortfolios && (
                  <button
                    onClick={() => {
                      setIsPortfolioDropdownOpen(false);
                      onOpenManagePortfolios();
                    }}
                    className="text-[10px] text-[#DD3C73] hover:text-[#e65f8e] transition-colors cursor-pointer font-bold tracking-wider hover:underline"
                  >
                    Manage
                  </button>
                )}
              </div>

              <div className="max-h-56 overflow-y-auto custom-scrollbar my-1">
                {portfolios.map((p) => {
                  const isActive = activePortfolio?.id === p.id;
                  const Icon = p.isShared ? Users : TrendingUp;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        onChangePortfolio(p.id);
                        setIsPortfolioDropdownOpen(false);
                        if (
                          activeView !== "dashboard" &&
                          onNavigateDashboard
                        ) {
                          onNavigateDashboard();
                        }
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-slate-800/60 transition-colors cursor-pointer ${
                        isActive
                          ? "bg-[#DD3C73]/10 text-[#DD3C73] font-bold"
                          : "text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate min-w-0 flex-1">
                        <Icon
                          className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-[#DD3C73]" : "text-slate-500"}`}
                        />
                        <span className="truncate">{p.name}</span>
                        {p.isShared && (
                          <span className="text-[10px] text-slate-500 font-normal shrink-0">
                            (shared)
                          </span>
                        )}
                      </div>
                      {isActive && (
                        <Check className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
