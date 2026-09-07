import { useState, useRef, useEffect, useCallback } from "react";
import type { PortfolioItem } from "../../types/portfolio";
import { reloadPage } from "../portfolio/utils.js";
import {
  FolderPlus,
  FileSpreadsheet,
  Download,
  Power,
  PlusCircle,
  FolderCog,
  Settings,
  PieChart,
  FileText,
  History,
  Eye,
  EyeOff,
  RefreshCw,
  RotateCw,
  Sparkles,
  HelpCircle,
  Info,
  Check,
  Keyboard,
  LifeBuoy,
} from "lucide-react";

export interface AppMenuBarProps {
  portfolios?: PortfolioItem[];
  activePortfolio: PortfolioItem | null;
  onSelectPortfolio?: (id: string) => void;
  onNewPortfolio: () => void;
  onImportCsv: () => void;
  onExportPortfolio: () => void;
  onAddTransaction: () => void;
  onManagePortfolios: () => void;
  onOpenSettings: (section?: any) => void;
  onSelectTab: (tab: "overview" | "reports" | "transactions") => void;
  activeTab: string;
  hideCurrencyValues: boolean;
  onToggleHideCurrency: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onReload?: () => void;
  onAnalyzePortfolio: () => void;
  onOpenSetupWizard: () => void;
  onOpenAbout: () => void;
  onQuit: () => void;
  isAssistantOpen?: boolean;
  onToggleAssistant?: () => void;
  updateInfo?: { hasUpdate: boolean; latestVersion: string } | null;
  onCheckForUpdates?: () => void;
}

type MenuKey = "file" | "edit" | "view" | "portfolio" | "help" | null;

interface MenuItemDef {
  type?: "item" | "separator" | "header";
  label?: string;
  shortcut?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: () => void;
  checked?: boolean;
  disabled?: boolean;
}

export function AppMenuBar({
  portfolios,
  activePortfolio,
  onSelectPortfolio,
  onNewPortfolio,
  onImportCsv,
  onExportPortfolio,
  onAddTransaction,
  onManagePortfolios,
  onOpenSettings,
  onSelectTab,
  activeTab,
  hideCurrencyValues,
  onToggleHideCurrency,
  onRefresh,
  isRefreshing,
  onReload,
  onAnalyzePortfolio,
  onOpenSetupWizard,
  onOpenAbout,
  onQuit,
  isAssistantOpen,
  onToggleAssistant,
  updateInfo,
  onCheckForUpdates,
}: AppMenuBarProps) {
  const [activeMenu, setActiveMenu] = useState<MenuKey>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const menuBarRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setActiveMenu(null);
    setHighlightedIndex(-1);
  }, []);

  // Dismiss on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeMenu]);

  // Menu items definition
  const fileItems: MenuItemDef[] = [
    {
      label: "New Portfolio...",
      shortcut: "Ctrl+N",
      icon: FolderPlus,
      action: () => {
        closeMenu();
        onNewPortfolio();
      },
    },
    {
      label: "Import Transactions (CSV)...",
      shortcut: "Ctrl+I",
      icon: FileSpreadsheet,
      action: () => {
        closeMenu();
        onImportCsv();
      },
    },
    {
      label: "Export Active Portfolio...",
      shortcut: "Ctrl+E",
      icon: Download,
      action: () => {
        closeMenu();
        onExportPortfolio();
      },
      disabled: !activePortfolio,
    },
    { type: "separator" },
    {
      label: "Quit Portfolio",
      shortcut: "Ctrl+Q",
      icon: Power,
      action: () => {
        closeMenu();
        onQuit();
      },
    },
  ];

  const editItems: MenuItemDef[] = [
    {
      label: "Add Transaction...",
      shortcut: "Ctrl+T",
      icon: PlusCircle,
      action: () => {
        closeMenu();
        onAddTransaction();
      },
      disabled: !activePortfolio,
    },
    {
      label: "Manage Portfolios...",
      icon: FolderCog,
      action: () => {
        closeMenu();
        onManagePortfolios();
      },
    },
    { type: "separator" },
    {
      label: "Preferences",
      shortcut: "Ctrl+,",
      icon: Settings,
      action: () => {
        closeMenu();
        onOpenSettings();
      },
    },
  ];

  const viewItems: MenuItemDef[] = [
    {
      label: "Overview (Dashboard)",
      icon: PieChart,
      checked: activeTab === "overview",
      action: () => {
        closeMenu();
        onSelectTab("overview");
      },
    },
    {
      label: "Transactions",
      icon: History,
      checked: activeTab === "transactions",
      action: () => {
        closeMenu();
        onSelectTab("transactions");
      },
    },
    {
      label: "Reports",
      icon: FileText,
      checked: activeTab === "reports",
      action: () => {
        closeMenu();
        onSelectTab("reports");
      },
    },
    {
      label: isAssistantOpen ? "Close Assistant Sidebar" : "Open Assistant Sidebar",
      shortcut: "Ctrl+J",
      icon: Sparkles,
      action: () => {
        closeMenu();
        onToggleAssistant?.();
      },
    },
    { type: "separator" },
    {
      label: "Reload Page",
      shortcut: "Ctrl+R",
      icon: RotateCw,
      action: () => {
        closeMenu();
        if (onReload) {
          onReload();
        } else {
          void reloadPage();
        }
      },
    },
    {
      label: isRefreshing ? "Refreshing Market Quotes..." : "Refresh Market Quotes",
      icon: RefreshCw,
      action: () => {
        closeMenu();
        onRefresh();
      },
      disabled: isRefreshing,
    },
    { type: "separator" },
    {
      label: hideCurrencyValues ? "Show Currency Values" : "Mask Currency Values (Privacy)",
      shortcut: "Ctrl+H",
      icon: hideCurrencyValues ? Eye : EyeOff,
      action: () => {
        closeMenu();
        onToggleHideCurrency();
      },
    },
  ];

  const portfolioItems: MenuItemDef[] = [
    {
      label: "Chat with Assistant...",
      shortcut: "Ctrl+J",
      icon: Sparkles,
      action: () => {
        closeMenu();
        if (!isAssistantOpen) {
          onToggleAssistant?.();
        }
      },
      disabled: !activePortfolio,
    },
    {
      label: "Analyze Portfolio (AI Report)...",
      icon: Sparkles,
      action: () => {
        closeMenu();
        onAnalyzePortfolio();
      },
      disabled: !activePortfolio,
    },
  ];

  const helpItems: MenuItemDef[] = [
    {
      label: "Setup Wizard...",
      icon: HelpCircle,
      action: () => {
        closeMenu();
        onOpenSetupWizard();
      },
    },
    {
      label: "Keyboard Shortcuts...",
      icon: Keyboard,
      action: () => {
        closeMenu();
        onOpenAbout();
      },
    },
    {
      label: "Support Ticket...",
      icon: LifeBuoy,
      action: () => {
        closeMenu();
        onOpenSettings("support");
      },
    },
    {
      label: updateInfo?.hasUpdate
        ? `Update Available (v${updateInfo.latestVersion})...`
        : "Check for Updates...",
      icon: RefreshCw,
      action: () => {
        closeMenu();
        if (onCheckForUpdates) {
          onCheckForUpdates();
        } else {
          onOpenSettings("about");
        }
      },
    },
    { type: "separator" },
    {
      label: "About Portfolio Desktop",
      icon: Info,
      action: () => {
        closeMenu();
        onOpenAbout();
      },
    },
  ];

  const menus: { key: MenuKey; label: string; accessKey: string; items: MenuItemDef[] }[] = [
    { key: "file", label: "File", accessKey: "f", items: fileItems },
    { key: "edit", label: "Edit", accessKey: "e", items: editItems },
    { key: "view", label: "View", accessKey: "v", items: viewItems },
    { key: "portfolio", label: "Portfolio", accessKey: "p", items: portfolioItems },
    { key: "help", label: "Help", accessKey: "h", items: helpItems },
  ];

  const activeMenuDef = menus.find((m) => m.key === activeMenu);
  const actionableItems = activeMenuDef
    ? activeMenuDef.items.filter((it) => it.type !== "separator" && it.type !== "header" && !it.disabled)
    : [];

  // Keyboard navigation within active dropdown & Alt accelerators
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global Ctrl+J / Cmd+J to toggle assistant
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        onToggleAssistant?.();
        return;
      }

      // Alt shortcuts (Alt+F, Alt+E, Alt+V, Alt+P, Alt+H)
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        const found = menus.find((m) => m.accessKey === key);
        if (found) {
          e.preventDefault();
          setActiveMenu((curr) => (curr === found.key ? null : found.key));
          setHighlightedIndex(0);
          return;
        }
      }

      if (!activeMenu) return;

      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        const currIndex = menus.findIndex((m) => m.key === activeMenu);
        const nextIndex = (currIndex + 1) % menus.length;
        setActiveMenu(menus[nextIndex]!.key);
        setHighlightedIndex(0);
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const currIndex = menus.findIndex((m) => m.key === activeMenu);
        const prevIndex = (currIndex - 1 + menus.length) % menus.length;
        setActiveMenu(menus[prevIndex]!.key);
        setHighlightedIndex(0);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (actionableItems.length === 0) return;
        setHighlightedIndex((prev) => (prev + 1) % actionableItems.length);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (actionableItems.length === 0) return;
        setHighlightedIndex((prev) => (prev - 1 + actionableItems.length) % actionableItems.length);
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < actionableItems.length) {
          actionableItems[highlightedIndex]?.action?.();
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeMenu, actionableItems, closeMenu, menus, highlightedIndex]);

  const handleMenuClick = (key: MenuKey) => {
    if (activeMenu === key) {
      closeMenu();
    } else {
      setActiveMenu(key);
      setHighlightedIndex(-1);
    }
  };

  const handleMenuMouseEnter = (key: MenuKey) => {
    // If any menu is already open, hover switches menu seamlessly
    if (activeMenu !== null && activeMenu !== key) {
      setActiveMenu(key);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div
      ref={menuBarRef}
      className="bg-[#080b13] border-b border-slate-800/80 px-2 py-0.5 flex items-center text-[11px] font-mono select-none z-40 relative shrink-0"
      role="menubar"
      aria-label="Application Menu"
    >
      {/* Menu Categories */}
      <div className="flex items-center gap-0.5">
        {menus.map((menu) => {
          const isOpen = activeMenu === menu.key;
          return (
            <div key={menu.key} className="relative">
              <button
                type="button"
                onClick={() => handleMenuClick(menu.key)}
                onMouseEnter={() => handleMenuMouseEnter(menu.key)}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer text-[11px] tracking-wide font-medium flex items-center gap-1 focus:outline-none ${
                  isOpen
                    ? "bg-[#DD3C73]/20 text-[#DD3C73] font-semibold"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/60"
                }`}
                aria-haspopup="true"
                aria-expanded={isOpen}
              >
                <span>{menu.label}</span>
              </button>

              {/* Dropdown Menu */}
              {isOpen && (
                <div
                  className="absolute left-0 top-full mt-0.5 w-60 sm:w-64 bg-[#111726] border border-[#1e293b] rounded-lg shadow-2xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100 backdrop-blur-md"
                  role="menu"
                >
                  {menu.items.map((item, idx) => {
                    if (item.type === "separator") {
                      return <div key={`sep-${idx}`} className="my-1 border-t border-slate-800/90" />;
                    }

                    if (item.type === "header") {
                      return (
                        <div
                          key={`hdr-${idx}`}
                          className="px-3 py-1 text-[9.5px] uppercase font-bold tracking-wider text-slate-500"
                        >
                          {item.label}
                        </div>
                      );
                    }

                    const Icon = item.icon;
                    const actionIndex = actionableItems.indexOf(item);
                    const isHighlighted = actionIndex === highlightedIndex;

                    return (
                      <button
                        key={`item-${idx}`}
                        type="button"
                        disabled={item.disabled}
                        onClick={item.action}
                        onMouseEnter={() => setHighlightedIndex(actionIndex)}
                        className={`w-full px-3 py-1.5 flex items-center justify-between text-left text-xs transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed group ${
                          isHighlighted
                            ? "bg-[#DD3C73]/20 text-white font-medium"
                            : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                        }`}
                        role="menuitem"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          {item.checked !== undefined ? (
                            <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                              {item.checked && <Check className="w-3.5 h-3.5 text-[#DD3C73]" />}
                            </div>
                          ) : Icon ? (
                            <Icon className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#DD3C73] shrink-0" />
                          ) : (
                            <div className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span className="truncate">{item.label}</span>
                        </div>

                        {item.shortcut && (
                          <span className="text-[10px] text-slate-500 font-mono tracking-tighter shrink-0 pl-2">
                            {item.shortcut}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
