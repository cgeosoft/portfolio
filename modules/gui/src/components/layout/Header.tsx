import { Fragment } from "react";
import type { PortfolioItem } from "portfolio-shared/portfolio";
import {
  PieChart,
  FileText,
  History,
  Bot,
  Gauge,
  Settings,
} from "lucide-react";

export type PortfolioTabKey = "overview" | "metrics" | "reports" | "transactions";

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
  activeTab = "overview",
  onTabChange,
  activeView = "dashboard",
  onNavigateDashboard,
  onOpenSettings,
  reportsCount = 0,
  transactionsCount = 0,
  isAssistantOpen,
  onToggleAssistant,
}: HeaderProps) {
  const handlePageClick = (tabId: PortfolioTabKey) => {
    if (activeView !== "dashboard" && onNavigateDashboard) {
      onNavigateDashboard(tabId);
    } else if (onTabChange) {
      onTabChange(tabId);
    }
  };

  const tabs = [
    { id: "overview" as PortfolioTabKey, label: "Overview", icon: PieChart },
    { id: "metrics" as PortfolioTabKey, label: "Metrics", icon: Gauge },
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
            <Fragment key={tab.id}>
              <button
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
              {tab.id === "overview" && (
                <div
                  className="h-4 w-px bg-slate-800 shrink-0 mx-0.5"
                  aria-hidden="true"
                />
              )}
            </Fragment>
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

        {onOpenSettings && (
          <>
            <div
              className="h-4 w-px bg-slate-800 shrink-0 mx-0.5"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => onOpenSettings()}
              className={`h-7 w-7 flex items-center justify-center rounded-md transition-all cursor-pointer ${
                activeView === "settings"
                  ? "bg-[#DD3C73]/15 text-[#DD3C73] border border-[#DD3C73]/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
              }`}
              title="Settings (Ctrl+,)"
              aria-label="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </nav>
    </header>
  );
}
