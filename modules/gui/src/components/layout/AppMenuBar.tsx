import { useState, useRef, useEffect, useCallback } from "react";
import type { PortfolioItem } from "portfolio-shared/portfolio";
import { reloadPage } from "../portfolio/utils";
import { AppIcon } from "../common/AppIcon";
import {
  FolderPlus,
  FileSpreadsheet,
  Download,
  Power,
  PlusCircle,
  FolderCog,
  Settings,
  PieChart,
  Gauge,
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
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sun,
  Moon,
  Lock,
} from "lucide-react";
import type { AppTheme } from "portfolio-shared/api-types";

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
  onSelectTab: (tab: "overview" | "metrics" | "reports" | "transactions") => void;
  activeTab: string;
  hideCurrencyValues: boolean;
  onToggleHideCurrency: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onReload?: () => void;
  onAnalyzePortfolio: () => void;
  onOpenSetupWizard: () => void;
  onQuit: () => void;
  isAssistantOpen?: boolean;
  onToggleAssistant?: () => void;
  updateInfo?: { hasUpdate: boolean; latestVersion: string } | null;
  onCheckForUpdates?: () => void;
  zoomLevel?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  theme?: AppTheme;
  onToggleTheme?: () => void;
  /** App lock is on: shows the lock button at the right edge and the File → Lock entry. */
  pinEnabled?: boolean;
  onLock?: () => void;
}

type MenuKey = "file" | "portfolio" | "view" | "help" | null;

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
  onQuit,
  isAssistantOpen,
  onToggleAssistant,
  updateInfo,
  onCheckForUpdates,
  zoomLevel = 1.0,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  theme = "dark",
  onToggleTheme,
  pinEnabled = false,
  onLock,
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

  const run = (fn: () => void) => () => {
    closeMenu();
    fn();
  };

  // File: portfolios as documents (create, switch, manage, import/export) plus app-level session items.
  const fileItems: MenuItemDef[] = [
    { label: "New Portfolio...", shortcut: "Ctrl+N", icon: FolderPlus, action: run(onNewPortfolio) },
    ...(portfolios && portfolios.length > 1
      ? [
          { type: "header", label: "Switch Portfolio" } satisfies MenuItemDef,
          ...portfolios.map(
            (p) =>
              ({
                label: p.name,
                checked: p.id === activePortfolio?.id,
                action: run(() => onSelectPortfolio?.(p.id)),
              }) satisfies MenuItemDef,
          ),
        ]
      : []),
    { label: "Manage Portfolios...", icon: FolderCog, action: run(onManagePortfolios) },
    { type: "separator" },
    { label: "Import Transactions (CSV)...", shortcut: "Ctrl+I", icon: FileSpreadsheet, action: run(onImportCsv), disabled: !activePortfolio },
    { label: "Export Portfolio...", shortcut: "Ctrl+E", icon: Download, action: run(onExportPortfolio), disabled: !activePortfolio },
    { type: "separator" },
    { label: "Preferences...", shortcut: "Ctrl+,", icon: Settings, action: run(() => onOpenSettings()) },
    { type: "separator" },
    ...(pinEnabled ? [{ label: "Lock Portfolio", icon: Lock, action: run(() => onLock?.()) } satisfies MenuItemDef] : []),
    { label: "Quit Portfolio", shortcut: "Ctrl+Q", icon: Power, action: run(onQuit) },
  ];

  // Portfolio: actions that change or analyze the active portfolio's data.
  const portfolioItems: MenuItemDef[] = [
    { label: "Add Transaction...", shortcut: "Ctrl+T", icon: PlusCircle, action: run(onAddTransaction), disabled: !activePortfolio },
    { label: isRefreshing ? "Refreshing Market Quotes..." : "Refresh Market Quotes", icon: RefreshCw, action: run(onRefresh), disabled: isRefreshing || !activePortfolio },
    { type: "separator" },
    { label: "Analyze with AI...", icon: Sparkles, action: run(onAnalyzePortfolio), disabled: !activePortfolio },
  ];

  // View: what is on screen (page, panels, masking, zoom, theme) — never data mutations.
  const zoom = zoomLevel ?? 1;
  const nextTheme = theme === "light" ? "Dark" : "Light";
  const viewItems: MenuItemDef[] = [
    { label: "Overview", icon: PieChart, checked: activeTab === "overview", action: run(() => onSelectTab("overview")) },
    { label: "Metrics", icon: Gauge, checked: activeTab === "metrics", action: run(() => onSelectTab("metrics")) },
    { label: "Transactions", icon: History, checked: activeTab === "transactions", action: run(() => onSelectTab("transactions")) },
    { label: "Reports", icon: FileText, checked: activeTab === "reports", action: run(() => onSelectTab("reports")) },
    { type: "separator" },
    ...(onToggleAssistant
      ? [{ label: "Assistant Sidebar", shortcut: "Ctrl+J", icon: Sparkles, checked: !!isAssistantOpen, action: run(onToggleAssistant) } satisfies MenuItemDef]
      : []),
    { label: "Mask Currency Values", shortcut: "Ctrl+H", icon: hideCurrencyValues ? Eye : EyeOff, checked: hideCurrencyValues, action: run(onToggleHideCurrency) },
    { type: "separator" },
    { label: "Zoom In", shortcut: "Ctrl++", icon: ZoomIn, action: run(() => onZoomIn?.()), disabled: zoom >= 2.5 },
    { label: "Zoom Out", shortcut: "Ctrl+-", icon: ZoomOut, action: run(() => onZoomOut?.()), disabled: zoom <= 0.5 },
    { label: `Reset Zoom (${Math.round(zoom * 100)}%)`, shortcut: "Ctrl+0", icon: RotateCcw, action: run(() => onZoomReset?.()), disabled: Math.abs(zoom - 1) < 0.01 },
    { type: "separator" },
    { label: `Switch to ${nextTheme} Theme`, shortcut: "Ctrl+Shift+L", icon: theme === "light" ? Moon : Sun, action: run(() => onToggleTheme?.()) },
    { type: "separator" },
    { label: "Reload", shortcut: "Ctrl+R", icon: RotateCw, action: run(() => (onReload ? onReload() : void reloadPage())) },
  ];

  const helpItems: MenuItemDef[] = [
    { label: "Keyboard Shortcuts...", icon: Keyboard, action: run(() => onOpenSettings("about")) },
    { label: "Setup Wizard...", icon: HelpCircle, action: run(onOpenSetupWizard) },
    { label: "Support Ticket...", icon: LifeBuoy, action: run(() => onOpenSettings("support")) },
    { type: "separator" },
    {
      label: updateInfo?.hasUpdate ? `Update Available (v${updateInfo.latestVersion})...` : "Check for Updates...",
      icon: RefreshCw,
      action: run(() => (onCheckForUpdates ? onCheckForUpdates() : onOpenSettings("about"))),
    },
    { label: "About Portfolio", icon: Info, action: run(() => onOpenSettings("about")) },
  ];

  const menus: { key: MenuKey; label: string; accessKey: string; items: MenuItemDef[] }[] = [
    { key: "file", label: "File", accessKey: "f", items: fileItems },
    { key: "portfolio", label: "Portfolio", accessKey: "p", items: portfolioItems },
    { key: "view", label: "View", accessKey: "v", items: viewItems },
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

      // Alt shortcuts (Alt+F, Alt+P, Alt+V, Alt+H)
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
    <div ref={menuBarRef} className="app-menubar flex" role="menubar" aria-label="Application menu">
      <div className="flex items-center gap-1.5 pl-1 pr-2 text-slate-500 select-none" title="Portfolio">
        <AppIcon className="w-3.5 h-3.5 text-accent-400" />
      </div>
      {menus.map((menu) => {
        const isOpen = activeMenu === menu.key;
        return (
          <div key={menu.key} className="relative">
            <button
              type="button"
              onClick={() => handleMenuClick(menu.key)}
              onMouseEnter={() => handleMenuMouseEnter(menu.key)}
              className="app-menubar-trigger"
              data-open={isOpen}
              aria-haspopup="true"
              aria-expanded={isOpen}
            >
              {menu.label}
            </button>

            {isOpen && (
              <div className="app-menu" role="menu">
                {menu.items.map((item, idx) => {
                  if (item.type === "separator") return <div key={`sep-${idx}`} className="app-menu-separator" />;
                  if (item.type === "header") {
                    return (
                      <div key={`hdr-${idx}`} className="px-2.5 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                        {item.label}
                      </div>
                    );
                  }
                  const Icon = item.icon;
                  const actionIndex = actionableItems.indexOf(item);
                  return (
                    <button
                      key={`item-${idx}`}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      onClick={item.action}
                      onMouseEnter={() => setHighlightedIndex(actionIndex)}
                      data-highlighted={actionIndex >= 0 && actionIndex === highlightedIndex}
                      className="app-menu-item group"
                    >
                      <span className="flex items-center gap-2.5 min-w-0 pr-3">
                        {item.checked !== undefined ? (
                          <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">{item.checked && <Check className="w-3.5 h-3.5 text-accent-400" />}</span>
                        ) : Icon ? (
                          <Icon className="w-3.5 h-3.5 text-slate-400 group-hover:text-accent-300 shrink-0" />
                        ) : (
                          <span className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.shortcut && <span className="app-menu-shortcut">{item.shortcut}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {pinEnabled && (
        <button
          type="button"
          onClick={() => {
            closeMenu();
            onLock?.();
          }}
          className="app-menubar-trigger app-menubar-lock"
          title="Lock Portfolio"
          aria-label="Lock Portfolio"
        >
          <Lock className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
