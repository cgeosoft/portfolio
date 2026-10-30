import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  FinancialPortfolioData,
  PortfolioTransaction,
  PortfolioReport,
  PortfolioItem,
} from "portfolio-shared/portfolio";
import { Header, type PortfolioTabKey } from "./components/layout/Header";
import { AppMenuBar } from "./components/layout/AppMenuBar";
import { CreatePortfolioModal } from "./components/portfolio/CreatePortfolioModal";
import { StatCard } from "./components/portfolio/StatCard";
import { PortfolioChartCard } from "./components/portfolio/PortfolioChartCard";
import { AllocationCard } from "./components/portfolio/AllocationCard";
import { HoldingsTableCard } from "./components/portfolio/HoldingsTableCard";
import {
  AnalysisPage,
  resolveAnalysisSection,
  saveAnalysisSection,
  savedAnalysisSection,
  type AnalysisSectionId,
} from "./components/portfolio/AnalysisPage";
import { TransactionsCard } from "./components/portfolio/TransactionsCard";
import { ReportsCard } from "./components/portfolio/ReportsCard";
import { SponsorBannerCard } from "./components/portfolio/SponsorBannerCard";
import { SETUP_STEP_AFTER_TERMS, type SetupStep } from "./components/common/setup-steps";
import { UpdatePopover } from "./components/common/UpdatePopover";
import { Toaster } from "./components/common/Toaster";
import { DEFAULT_SETTINGS_SECTION, resolveSettingsSection, type SettingsSection } from "./components/settings/settings-nav";
import { CONFIG_CHANGED_EVENT } from "./components/settings/SettingsFields";
import { WebsitePage, type WebsitePageId } from "./components/common/WebsitePage";
import { BottomBar } from "./components/layout/BottomBar";
import type { MetricKey } from "./components/portfolio/MetricInfoModal";
import { MetricDashboard } from "./components/metrics/MetricDashboard";
import { MetricsTab } from "./components/metrics/MetricsTab";
import { AssistantSidebar } from "./components/portfolio/AssistantSidebar";
import { HoldingLinksHost } from "./components/portfolio/holding-links";
import { reloadPage } from "./components/portfolio/utils";
import { WEBPAGE_URL } from "./environment";
import type {
  DesktopConfig,
  GetPortfoliosResponse,
  GetAppInfoResponse,
  PortfolioChatMessage,
  AssistantConversationSummary,
  AppUpdateInfo,
  MetricEvaluation,
  MetricListing,
  MetricRepositoryListing,
  AppTheme,
  GetSuggestionsResponse,
} from "portfolio-shared/api-types";
import { countActiveSuggestions } from "portfolio-shared/suggestions";
import { rpc, ensureRpcReady, clientLogger, onUpdateAvailable } from "./rpc";
import { api, setUnauthorizedHandler } from "./api";
import { LockScreen } from "./components/common/LockScreen";
import { APP_VERSION } from "./environment";
import { hideBootLoader } from "./bootLoader";
import {
  getDefaultMetricPreferences,
  type PortfolioMetricPreference,
} from "portfolio-shared/metrics";
import { RefreshCw, AlertTriangle } from "lucide-react";

// The largest views that most sessions never open load on first use, not with the app.
const SettingsPage = lazy(() => import("./components/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ManagePortfoliosPage = lazy(() => import("./components/portfolio/ManagePortfoliosPage").then((m) => ({ default: m.ManagePortfoliosPage })));
const ImportCsvPage = lazy(() => import("./components/portfolio/ImportCsvPage").then((m) => ({ default: m.ImportCsvPage })));
const AnalyzePortfolioModal = lazy(() => import("./components/portfolio/AnalyzePortfolioModal").then((m) => ({ default: m.AnalyzePortfolioModal })));
// Dialogs load on their first open and stay mounted after it, so they keep their state when closed.
const SetupWizardPage = lazy(() => import("./components/common/SetupWizardPage").then((m) => ({ default: m.SetupWizardPage })));
const ChangelogModal = lazy(() => import("./components/common/ChangelogModal").then((m) => ({ default: m.ChangelogModal })));
const SupportTicketModal = lazy(() => import("./components/settings/SupportTicketModal").then((m) => ({ default: m.SupportTicketModal })));
const TransactionModal = lazy(() => import("./components/portfolio/TransactionModal").then((m) => ({ default: m.TransactionModal })));
const MetricInfoModal = lazy(() => import("./components/portfolio/MetricInfoModal").then((m) => ({ default: m.MetricInfoModal })));
const MetricDetailsModal = lazy(() => import("./components/metrics/MetricDetailsModal").then((m) => ({ default: m.MetricDetailsModal })));
const ExportPortfolioModal = lazy(() => import("./components/portfolio/ExportPortfolioModal").then((m) => ({ default: m.ExportPortfolioModal })));

/** The overview sponsor banner. Off until the first sponsor signs; users cannot hide it. */
const SPONSOR_BANNER_ENABLED = false;

/**
 * `?onboarding` opens the setup wizard even when setup is complete. The desktop shell adds it
 * when started with `PORTFOLIO_ONBOARDING=1`. Read once and dropped from the address, so a
 * reload does not open the wizard again.
 */
const FORCE_ONBOARDING = new URLSearchParams(window.location.search).has("onboarding");
if (FORCE_ONBOARDING) {
  window.history.replaceState(null, "", window.location.pathname + window.location.hash);
}

/** Shown while the code of a lazy page loads. */
function PageLoading() {
  return (
    <div className="flex items-center justify-center py-16">
      <RefreshCw className="w-5 h-5 text-accent-400 animate-spin" />
    </div>
  );
}

/** True from the first time `open` is true: a lazy modal mounts on first use and keeps its state after. */
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened;
}

/**
 * How `loadData` fetches: `initial` is the first load of a portfolio, `reload` re-reads it
 * after an edit (the service clears its caches itself), `refresh` also asks the providers
 * for new quotes.
 */
type LoadMode = "initial" | "reload" | "refresh";

const VALID_TABS: readonly string[] = ["overview", "analysis", "reports", "transactions"];
const INFO_MODAL_KEYS: readonly string[] = [
  "totalGain",
  "valuation",
  "todayReturn",
  "realizedIncome",
  "cashReserves",
  "capitalInjected",
  "dividends",
  "topPerformer",
];

function getTabFromHash(hash: string): PortfolioTabKey {
  // `#analysis/<section>` opens a page of the Analysis tab.
  const cleanHash = hash.replace(/^#/, "").toLowerCase().trim().split("/")[0]!;
  if (cleanHash === "charts" || cleanHash === "holdings") return "overview";
  if (cleanHash === "logs") return "transactions";
  // Suggestions was a tab of its own before it moved under Analysis.
  if (cleanHash === "suggestions") return "analysis";
  if (VALID_TABS.includes(cleanHash)) {
    return cleanHash as PortfolioTabKey;
  }
  return "overview";
}

/** The Analysis page a hash names: `#analysis/<section>`, or `#suggestions` from before it moved there. */
function analysisSectionFromHash(hash: string): AnalysisSectionId | null {
  const [tab, section] = hash.replace(/^#/, "").toLowerCase().trim().split("/");
  if (tab === "suggestions") return "suggestions";
  return tab === "analysis" ? resolveAnalysisSection(section) : null;
}

export default function App() {
  const [view, setView] = useState<"dashboard" | "settings" | "portfolios" | WebsitePageId>(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.toLowerCase();
      // The Portfolios page left Preferences; keep the old link working.
      if (hash === "#portfolios" || hash === "#settings/portfolios") return "portfolios";
      // Metrics moved from a top-level tab to Preferences; keep old links working.
      if (hash === "#metrics") return "settings";
      if (hash.startsWith("#settings")) return "settings";
      if (hash === "#terms") return "terms";
      if (hash === "#sponsorship") return "sponsorship";
    }
    return "dashboard";
  });

  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.toLowerCase();
      if (hash.startsWith("#settings/")) {
        // Pages of earlier releases resolve to where they moved.
        const sec = resolveSettingsSection(hash.replace("#settings/", ""));
        if (sec) return sec;
      }
      if (hash === "#metrics") return "metrics";
    }
    return DEFAULT_SETTINGS_SECTION;
  });

  const [activeTab, setActiveTab] = useState<PortfolioTabKey>(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      return getTabFromHash(window.location.hash);
    }
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("portfolio_active_tab");
      if (saved) return getTabFromHash(saved);
    }
    return "overview";
  });

  const [analysisSection, setAnalysisSection] = useState<AnalysisSectionId>(
    () => (typeof window !== "undefined" && analysisSectionFromHash(window.location.hash)) || savedAnalysisSection(),
  );

  // Moving between Analysis pages replaces the URL so a reload reopens the same page.
  const handleAnalysisSectionChange = useCallback((section: AnalysisSectionId) => {
    setAnalysisSection(section);
    saveAnalysisSection(section);
    if (typeof window !== "undefined") {
      const newHash = `#analysis/${section}`;
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, []);

  const handleTabChange = useCallback((tab: PortfolioTabKey) => {
    setView("dashboard");
    setActiveTab(tab);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("portfolio_active_tab", tab);
    }
    if (typeof window !== "undefined") {
      const newHash = `#${tab}`;
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, []);

  const handleOpenSettings = useCallback((section: SettingsSection = DEFAULT_SETTINGS_SECTION) => {
    setSettingsSection(section);
    setView("settings");
    if (typeof window !== "undefined") {
      const newHash = section === DEFAULT_SETTINGS_SECTION ? "#settings" : `#settings/${section}`;
      if (window.location.hash !== newHash) {
        window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, []);

  // Moving between Settings pages replaces the URL so a reload reopens the same page.
  const handleSettingsSectionChange = useCallback((section: SettingsSection) => {
    setSettingsSection(section);
    if (typeof window !== "undefined") {
      const newHash = section === DEFAULT_SETTINGS_SECTION ? "#settings" : `#settings/${section}`;
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, []);

  // The Portfolios page sits above the open portfolio: Back returns to the page that opened it.
  const portfoliosReturnHashRef = useRef<string | null>(null);
  const handleOpenManagePortfolios = useCallback(() => {
    setView("portfolios");
    if (typeof window !== "undefined" && window.location.hash !== "#portfolios") {
      portfoliosReturnHashRef.current = window.location.hash || null;
      window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#portfolios`);
    }
  }, []);

  // Terms of Use and Sponsorship: website pages in a frame, opened from the status bar.
  const handleOpenWebsitePage = useCallback((page: WebsitePageId) => {
    setView(page);
    if (typeof window !== "undefined") {
      const newHash = `#${page}`;
      if (window.location.hash !== newHash) {
        window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, []);
  const handleOpenTerms = useCallback(() => handleOpenWebsitePage("terms"), [handleOpenWebsitePage]);
  const handleOpenSponsorship = useCallback(() => handleOpenWebsitePage("sponsorship"), [handleOpenWebsitePage]);

  const handleNavigateDashboard = useCallback((tab?: PortfolioTabKey) => {
    setView("dashboard");
    const targetTab = tab || activeTab;
    setActiveTab(targetTab);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("portfolio_active_tab", targetTab);
    }
    if (typeof window !== "undefined") {
      const newHash = `#${targetTab}`;
      if (window.location.hash !== newHash) {
        window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, [activeTab]);

  // Back from the Portfolios page: the page that opened it, else the dashboard.
  const handleLeavePortfolios = useCallback(() => {
    const back = portfoliosReturnHashRef.current;
    portfoliosReturnHashRef.current = null;
    if (back && back !== "#portfolios") {
      window.location.hash = back;
      return;
    }
    handleNavigateDashboard();
  }, [handleNavigateDashboard]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleRouting = () => {
      const hash = window.location.hash.toLowerCase();
      if (hash === "#portfolios" || hash === "#settings/portfolios") {
        if (hash !== "#portfolios") window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#portfolios`);
        setView("portfolios");
      } else if (hash === "#metrics") {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#settings/metrics`);
        setSettingsSection("metrics");
        setView("settings");
      } else if (hash.startsWith("#settings")) {
        setSettingsSection(resolveSettingsSection(hash.split("/")[1]) ?? DEFAULT_SETTINGS_SECTION);
        setView("settings");
      } else if (hash === "#terms") {
        setView("terms");
      } else if (hash === "#sponsorship") {
        setView("sponsorship");
      } else {
        setView("dashboard");
        const saved = typeof localStorage !== "undefined" ? localStorage.getItem("portfolio_active_tab") : null;
        const tab = window.location.hash ? getTabFromHash(window.location.hash) : saved ? getTabFromHash(saved) : "overview";
        setActiveTab(tab);
        const section = analysisSectionFromHash(window.location.hash);
        if (section) setAnalysisSection(section);
      }
    };
    window.addEventListener("hashchange", handleRouting);
    window.addEventListener("popstate", handleRouting);
    return () => {
      window.removeEventListener("hashchange", handleRouting);
      window.removeEventListener("popstate", handleRouting);
    };
  }, []);

  // Multi-portfolio state
  const [portfolios, setPortfolios] = useState<PortfolioItem[]>([]);
  /** Set once the first portfolios list request has finished, with or without portfolios. */
  const [portfoliosLoaded, setPortfoliosLoaded] = useState(false);
  const [activePortfolioId, setActivePortfolioId] = useState<string | null>(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("selected_portfolio_id") || null;
    }
    return null;
  });

  const [portfolioData, setPortfolioData] = useState<FinancialPortfolioData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reports, setReports] = useState<PortfolioReport[]>([]);
  const [suggestions, setSuggestions] = useState<GetSuggestionsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingSlowWarning, setLoadingSlowWarning] = useState(false);
  const [currency, setCurrency] = useState<string>(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("selected_currency") || "EUR";
    }
    return "EUR";
  });

  useEffect(() => {
    if (typeof localStorage !== "undefined" && currency) {
      localStorage.setItem("selected_currency", currency);
    }
  }, [currency]);

  // Privacy Mode Toggle State. Masked until the saved setting arrives with the config: the
  // desktop window gets a new origin (random port) on every start, so localStorage is empty,
  // and a failed config load keeps the values masked instead of showing them.
  const [hideCurrencyValues, setHideCurrencyValues] = useState<boolean>(true);

  // Zoom State & Persistence (50% to 250%)
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("portfolio_zoom_level");
      if (saved) {
        const val = parseFloat(saved);
        if (Number.isFinite(val) && val >= 0.5 && val <= 2.5) {
          return Math.round(val * 100) / 100;
        }
      }
    }
    return 1.0;
  });

  const applyZoom = useCallback((zoom: number) => {
    const clamped = Math.min(2.5, Math.max(0.5, Math.round(zoom * 100) / 100));
    if (typeof document !== "undefined") {
      document.documentElement.style.zoom = String(clamped);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("resize"));
      }
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("portfolio_zoom_level", String(clamped));
    }
    rpc.request.saveConfig({ zoomLevel: clamped }).catch(() => {});
  }, []);

  // Show the saved zoom at once; the config load may still change it.
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.style.zoom = String(zoomLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleZoomIn = useCallback(() => {
    const zoomSteps = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5];
    setZoomLevel((prev) => {
      const next = zoomSteps.find((lvl) => lvl > prev + 0.01) ?? 2.5;
      const target = Math.min(2.5, Math.round(next * 100) / 100);
      applyZoom(target);
      return target;
    });
  }, [applyZoom]);

  const handleZoomOut = useCallback(() => {
    const zoomSteps = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5];
    setZoomLevel((prev) => {
      const smaller = zoomSteps.filter((lvl) => lvl < prev - 0.01);
      const next = smaller.length > 0 ? smaller[smaller.length - 1]! : 0.5;
      const target = Math.max(0.5, Math.round(next * 100) / 100);
      applyZoom(target);
      return target;
    });
  }, [applyZoom]);

  const handleZoomReset = useCallback(() => {
    setZoomLevel(1.0);
    applyZoom(1.0);
  }, [applyZoom]);

  const handleZoomSet = useCallback((zoom: number) => {
    setZoomLevel(Math.min(2.5, Math.max(0.5, Math.round(zoom * 100) / 100)));
    applyZoom(zoom);
  }, [applyZoom]);

  // Theme State & Persistence ("dark" | "light" | "system")
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("portfolio_theme");
      if (saved === "dark" || saved === "light" || saved === "system") {
        return saved;
      }
    }
    return "dark";
  });

  const applyTheme = useCallback((newTheme: AppTheme) => {
    if (typeof document === "undefined") return;
    let resolved = newTheme;
    if (newTheme === "system") {
      resolved = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    const root = document.documentElement;
    const metaScheme = document.querySelector('meta[name="color-scheme"]');
    const metaColor = document.querySelector('meta[name="theme-color"]');
    if (resolved === "light") {
      root.classList.remove("dark");
      root.classList.add("light");
      if (metaScheme) metaScheme.setAttribute("content", "light");
      if (metaColor) metaColor.setAttribute("content", "#f8fafc");
    } else {
      root.classList.remove("light");
      root.classList.add("dark");
      if (metaScheme) metaScheme.setAttribute("content", "dark");
      if (metaColor) metaColor.setAttribute("content", "#090b10");
    }
  }, []);

  const handleThemeChange = useCallback(
    (newTheme: AppTheme) => {
      setTheme(newTheme);
      applyTheme(newTheme);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("portfolio_theme", newTheme);
      }
      rpc.request.saveConfig({ theme: newTheme }).catch(() => {});
    },
    [applyTheme],
  );

  const handleToggleTheme = useCallback(() => {
    const next: AppTheme = theme === "light" ? "dark" : "light";
    handleThemeChange(next);
  }, [theme, handleThemeChange]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [theme, applyTheme]);

  // Assistant Chat & Conversations State
  const [isAssistantOpen, setIsAssistantOpen] = useState<boolean>(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("portfolio_assistant_open") === "true";
    }
    return false;
  });
  const [conversations, setConversations] = useState<AssistantConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<PortfolioChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [assistantProvider, setAssistantProvider] = useState<string | undefined>(undefined);
  const [assistantModel, setAssistantModel] = useState<string | undefined>(undefined);

  // The list carries no messages: each conversation loads when it is opened.
  // A newer open wins over a slower earlier one.
  const conversationOpenRef = useRef(0);
  const openConversation = useCallback(async (portfolioId: string, convId: string | null) => {
    const ticket = ++conversationOpenRef.current;
    setCurrentConversationId(convId);
    setChatMessages([]);
    setChatError(null);
    if (!convId) return;
    try {
      await ensureRpcReady();
      const res = await rpc.request.getAssistantConversation({ portfolioId, conversationId: convId });
      if (ticket === conversationOpenRef.current) setChatMessages(res.conversation.messages);
    } catch (err) {
      console.error("Failed to load assistant conversation:", err);
    }
  }, []);

  const loadConversations = useCallback(async (portfolioId: string) => {
    try {
      await ensureRpcReady();
      const res = await rpc.request.getAssistantConversations({ portfolioId });
      const convs = res.conversations || [];
      setConversations(convs);
      await openConversation(portfolioId, convs[0]?.id ?? null);
    } catch (err) {
      console.error("Failed to load assistant conversations:", err);
    }
  }, [openConversation]);

  useEffect(() => {
    if (activePortfolioId) {
      void loadConversations(activePortfolioId);
    }
  }, [activePortfolioId, loadConversations]);

  const handleToggleAssistant = useCallback(() => {
    setIsAssistantOpen((prev) => {
      const next = !prev;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("portfolio_assistant_open", String(next));
      }
      return next;
    });
  }, []);

  const handleCloseAssistant = useCallback(() => {
    setIsAssistantOpen(false);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("portfolio_assistant_open", "false");
    }
  }, []);

  const handleSelectConversation = useCallback(
    (convId: string) => {
      if (activePortfolioId && conversations.some((c) => c.id === convId)) void openConversation(activePortfolioId, convId);
    },
    [activePortfolioId, conversations, openConversation],
  );

  const handleNewChat = useCallback(() => {
    conversationOpenRef.current++;
    setCurrentConversationId(null);
    setChatMessages([]);
    setChatError(null);
  }, []);

  const handleDeleteConversation = useCallback(
    async (convId: string) => {
      if (!activePortfolioId) return;
      try {
        await ensureRpcReady();
        await rpc.request.deleteAssistantConversation({
          portfolioId: activePortfolioId,
          conversationId: convId,
        });
        const next = conversations.filter((c) => c.id !== convId);
        setConversations(next);
        if (currentConversationId === convId) void openConversation(activePortfolioId, next[0]?.id ?? null);
      } catch (err) {
        console.error("Failed to delete assistant conversation:", err);
      }
    },
    [activePortfolioId, conversations, currentConversationId, openConversation],
  );

  const handleClearChat = useCallback(async () => {
    if (currentConversationId && activePortfolioId) {
      await handleDeleteConversation(currentConversationId);
    } else {
      setChatMessages([]);
      setChatError(null);
    }
  }, [currentConversationId, activePortfolioId, handleDeleteConversation]);

  // Sends the given history to the assistant and appends the reply. The
  // backend persists the full history it receives plus the reply, so this
  // serves both new messages and regeneration (history truncated first).
  const submitChatMessages = useCallback(
    async (updatedMessages: PortfolioChatMessage[]): Promise<boolean> => {
      if (!activePortfolioId) {
        setChatError("Please select or create a portfolio first.");
        return false;
      }
      // A conversation still loading must not replace this history when it arrives.
      conversationOpenRef.current++;
      setChatMessages(updatedMessages);
      setIsChatLoading(true);
      setChatError(null);

      try {
        await ensureRpcReady();
        const res = await rpc.request.chatWithPortfolio({
          portfolioId: activePortfolioId,
          conversationId: currentConversationId || undefined,
          messages: updatedMessages,
        });
        const fullMessages = [...updatedMessages, res.message];
        setChatMessages(fullMessages);
        setCurrentConversationId(res.conversationId);
        if (res.provider) setAssistantProvider(res.provider);
        if (res.model) setAssistantModel(res.model);

        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === res.conversationId);
          const updatedConv: AssistantConversationSummary = {
            id: res.conversationId,
            portfolioId: activePortfolioId,
            title: res.title,
            messageCount: fullMessages.length,
            createdAt: idx >= 0 ? prev[idx].createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          if (idx >= 0) {
            const copy = [...prev];
            copy.splice(idx, 1);
            return [updatedConv, ...copy];
          }
          return [updatedConv, ...prev];
        });
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setChatError(msg);
        return false;
      } finally {
        setIsChatLoading(false);
      }
    },
    [activePortfolioId, currentConversationId],
  );

  const handleSendChatMessage = useCallback(
    async (userText: string) => {
      const userMsg: PortfolioChatMessage = { role: "user", content: userText };
      await submitChatMessages([...chatMessages, userMsg]);
    },
    [chatMessages, submitChatMessages],
  );

  // Drops the trailing assistant reply and asks the model again. The old
  // reply is restored if the request fails so nothing is lost.
  const handleRegenerateChatMessage = useCallback(async () => {
    const last = chatMessages[chatMessages.length - 1];
    if (!last || last.role !== "assistant") return;
    const ok = await submitChatMessages(chatMessages.slice(0, -1));
    if (!ok) setChatMessages(chatMessages);
  }, [chatMessages, submitChatMessages]);

  // Session: automatic login without a PIN, the lock screen otherwise; the
  // Terms of Use gate on first run.
  const [authState, setAuthState] = useState<"loading" | "locked" | "terms" | "ready" | "error">("loading");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  /** Whether the app lock is on; drives the lock button in the menu bar. */
  const [pinEnabled, setPinEnabled] = useState(false);

  const authStateRef = useRef(authState);
  authStateRef.current = authState;
  /** Silent re-logins after a lost session; more than a few a minute means the cookie does not stick. */
  const silentLogins = useRef<number[]>([]);
  const recovering = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // A 401 while ready: the session is gone (expired, revoked, or the cookie
    // was replaced). Lock only when a PIN is set; without one, log in again.
    setUnauthorizedHandler(() => {
      if (authStateRef.current !== "ready" || recovering.current) return;
      recovering.current = true;
      void (async () => {
        try {
          const status = await api.authStatus();
          if (cancelled) return;
          setPinEnabled(status.pinEnabled);
          if (status.pinEnabled) {
            setAuthState("locked");
            return;
          }
          const now = Date.now();
          silentLogins.current = silentLogins.current.filter((t) => now - t < 60_000);
          if (silentLogins.current.length >= 3) {
            setAuthError("The session keeps getting lost. Another tab or instance on this address may be replacing the cookie.");
            setAuthState("error");
            return;
          }
          silentLogins.current.push(now);
          const session = await api.login();
          if (!cancelled && !session.hasAcceptedTerms) setAuthState("terms");
        } catch (err) {
          if (cancelled) return;
          setAuthError(err instanceof Error ? err.message : String(err));
          setAuthState("error");
        } finally {
          recovering.current = false;
        }
      })();
    });
    (async () => {
      setAuthState("loading");
      setAuthError(null);
      const reachable = await ensureRpcReady(15_000);
      if (cancelled) return;
      if (!reachable) {
        setAuthError("The Portfolio service did not answer.");
        setAuthState("error");
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) {
          setPinEnabled(me.pinEnabled);
          setAuthState(me.hasAcceptedTerms ? "ready" : "terms");
        }
        return;
      } catch {
        // No session yet.
      }
      try {
        const status = await api.authStatus();
        if (cancelled) return;
        setPinEnabled(status.pinEnabled);
        if (status.pinEnabled) {
          setAuthState("locked");
        } else {
          const session = await api.login();
          if (!cancelled) setAuthState(session.hasAcceptedTerms ? "ready" : "terms");
        }
      } catch (err) {
        if (cancelled) return;
        setAuthError(err instanceof Error ? err.message : String(err));
        setAuthState("error");
      }
    })();
    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, [authAttempt]);

  const handleUnlock = useCallback(async (pin: string) => {
    const res = await api.login(pin);
    setPinEnabled(res.pinEnabled);
    if (!res.hasAcceptedTerms) {
      setAuthState("terms");
      return;
    }
    setAuthState("ready");
    setAuthAttempt((n) => n + 1);
  }, []);

  /**
   * First run, from the Terms of Use step of the setup wizard: record the acceptance, then load the workspace.
   * The workspace reopens the wizard at the step after the Terms unless setup was completed before.
   */
  const handleAcceptTerms = useCallback(async () => {
    await api.acceptTerms();
    setSetupWizardStartStep(SETUP_STEP_AFTER_TERMS);
    setAuthState("ready");
    setAuthAttempt((n) => n + 1);
  }, []);

  /** Drop the session and show the PIN prompt again. */
  const handleLock = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The session cookie is cleared server-side anyway; the lock screen asks for the PIN regardless.
    }
    setAuthState("locked");
  }, []);

  // App Info & Quotes Sync State
  const [appVersion, setAppVersion] = useState(APP_VERSION || "0.4.0");
  const [isDevMode, setIsDevMode] = useState(false);
  const [webpageUrl, setWebpageUrl] = useState(WEBPAGE_URL);
  const [devEmail, setDevEmail] = useState<string | undefined>(undefined);
  const [lastQuotesSync, setLastQuotesSync] = useState<string | undefined>(undefined);

  // Window title: "Portfolio | <portfolio name> | Dev".
  const activePortfolioName = portfolios.find((p) => p.id === activePortfolioId)?.name;
  useEffect(() => {
    document.title = ["Portfolio", activePortfolioName, isDevMode ? "Dev" : undefined].filter(Boolean).join(" | ");
  }, [activePortfolioName, isDevMode]);
  const [quotesIntervalMins, setQuotesIntervalMins] = useState<number | undefined>(undefined);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);

  const toggleHideCurrencyValues = () => {
    setHideCurrencyValues((prev) => {
      const next = !prev;
      rpc.request.saveConfig({ hideCurrencyValues: next }).catch(() => {});
      return next;
    });
  };

  const handleDismissUpdate = useCallback((ver: string) => {
    setDismissedUpdateVersion(ver);
    rpc.request.saveConfig({ dismissedUpdateVersion: ver }).catch(() => {});
    setIsChangelogModalOpen(false);
  }, []);

  // Popover visibility: show when update is available and not dismissed
  const showUpdatePopover = updateInfo?.hasUpdate && dismissedUpdateVersion !== updateInfo.latestVersion;

  // Modals state
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);
  /** 2 once step 1 of the wizard accepted the Terms of Use, so the reopened wizard goes on from there. */
  const [setupWizardStartStep, setSetupWizardStartStep] = useState<SetupStep>(1);
  const openSetupWizard = useCallback(() => {
    setSetupWizardStartStep(1);
    setIsSetupWizardOpen(true);
  }, []);
  const [isSupportTicketOpen, setIsSupportTicketOpen] = useState(false);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<PortfolioTransaction | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const importModalMounted = useOpenedOnce(isImportModalOpen);
  const [isAnalyzeModalOpen, setIsAnalyzeModalOpen] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isMetricModalOpen, setIsMetricModalOpen] = useState(false);
  const [selectedMetricKey, setSelectedMetricKey] = useState<MetricKey>("totalGain");
  const setupWizardMounted = useOpenedOnce(isSetupWizardOpen);
  const supportTicketMounted = useOpenedOnce(isSupportTicketOpen);
  const txModalMounted = useOpenedOnce(isTxModalOpen);
  const changelogModalMounted = useOpenedOnce(isChangelogModalOpen);
  const exportModalMounted = useOpenedOnce(isExportModalOpen);
  const metricModalMounted = useOpenedOnce(isMetricModalOpen);

  const handleOpenMetricModal = useCallback((metricKey: MetricKey) => {
    setSelectedMetricKey(metricKey);
    setIsMetricModalOpen(true);
  }, []);

  // Overview metric selection of the active portfolio (metrics marketplace)
  const [metricPreferences, setMetricPreferences] = useState<PortfolioMetricPreference[]>(
    getDefaultMetricPreferences,
  );

  // Runs only once the session exists: on a cold start the requests would
  // otherwise race the login and fail with a 401.
  useEffect(() => {
    if (!activePortfolioId) {
      setMetricPreferences(getDefaultMetricPreferences());
      return;
    }
    if (authState !== "ready") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await rpc.request.getPortfolioMetrics({ portfolioId: activePortfolioId });
        if (!cancelled && res?.metrics) {
          setMetricPreferences(res.metrics);
        }
      } catch (err) {
        clientLogger.log("warning", "metrics_load", `Failed to load metric selection: ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePortfolioId, authState]);

  // Metric modules: installed listings, marketplace repository, and live sandbox results
  const [metricListings, setMetricListings] = useState<MetricListing[]>([]);
  const [metricRepository, setMetricRepository] = useState<MetricRepositoryListing[]>([]);
  const [metricEvaluations, setMetricEvaluations] = useState<Record<string, MetricEvaluation>>({});
  const [isSavingMetrics, setIsSavingMetrics] = useState(false);
  const [metricDetails, setMetricDetails] = useState<MetricListing | null>(null);
  const metricDetailsMounted = useOpenedOnce(metricDetails !== null);
  const [metricRetryNonce, setMetricRetryNonce] = useState(0);
  const [metricRetryIds, setMetricRetryIds] = useState<string[]>([]);

  const loadMetricCatalog = useCallback(async () => {
    try {
      const res = await rpc.request.getMetricCatalog({});
      setMetricListings(res.installed);
      setMetricRepository(res.repository);
    } catch (err) {
      clientLogger.log("warning", "metrics_catalog", `Failed to load the metric catalog: ${String(err)}`);
    }
  }, []);

  // Opening the metrics settings re-reads the catalog, so a provider key added
  // since start-up enables the metrics that need it.
  const isMetricSettingsOpen = view === "settings" && settingsSection === "metrics";
  useEffect(() => {
    if (authState === "ready") void loadMetricCatalog();
  }, [loadMetricCatalog, authState, isMetricSettingsOpen]);

  // The metrics settings show a value for every installed metric; elsewhere only added ones run.
  const addedMetricIds = (
    isMetricSettingsOpen ? metricListings.map((listing) => listing.id) : metricPreferences.filter((pref) => pref.added).map((pref) => pref.id)
  ).join(",");
  const portfolioDataStamp = portfolioData?.summary?.lastUpdated ?? "";
  // Metrics that read provider data (FMP fundamentals) can take seconds on a cold cache.
  const fundamentalMetricIds = metricListings
    .filter((listing) => listing.scopesGranted.includes("market.fundamentals"))
    .map((listing) => listing.id)
    .join(",");

  // Re-run the modules whenever the data, the selection, or the currency changes.
  // Results are cached in the main process, so unchanged inputs cost nothing.
  // Portfolio-only metrics come back first; provider-backed ones follow.
  useEffect(() => {
    if (!activePortfolioId || !portfolioData?.summary || !addedMetricIds) {
      setMetricEvaluations({});
      return;
    }
    let cancelled = false;
    const retry = metricRetryIds;
    const slow = new Set(fundamentalMetricIds ? fundamentalMetricIds.split(",") : []);
    const added = addedMetricIds.split(",");
    const fast = added.filter((id) => !slow.has(id));
    const late = added.filter((id) => slow.has(id));
    const evaluate = async (ids: string[]) => {
      if (ids.length === 0) return;
      const res = await rpc.request.evaluatePortfolioMetrics({
        portfolioId: activePortfolioId,
        baseCurrency: currency,
        ids,
        retry: retry.length > 0 ? retry : undefined,
      });
      if (cancelled) return;
      setMetricEvaluations((prev) => {
        const next: Record<string, MetricEvaluation> = {};
        for (const id of added) if (prev[id] && !ids.includes(id)) next[id] = prev[id];
        for (const result of res.results) next[result.id] = result;
        return next;
      });
    };
    void (async () => {
      try {
        await evaluate(fast);
        await evaluate(late);
        if (!cancelled && retry.length > 0) {
          setMetricRetryIds([]);
          void loadMetricCatalog();
        }
      } catch (err) {
        if (!cancelled) clientLogger.log("warning", "metrics_evaluate", `Failed to evaluate metrics: ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortfolioId, portfolioDataStamp, addedMetricIds, fundamentalMetricIds, currency, metricRetryNonce]);

  const handleSaveMetrics = useCallback(
    async (next: PortfolioMetricPreference[]) => {
      if (!activePortfolioId) return;
      const previous = metricPreferences;
      setMetricPreferences(next);
      setIsSavingMetrics(true);
      try {
        const res = await rpc.request.savePortfolioMetrics({ portfolioId: activePortfolioId, metrics: next });
        setMetricPreferences(res.metrics);
      } catch (err) {
        setMetricPreferences(previous);
        clientLogger.log("warning", "metrics_save", `Failed to save the metric selection: ${String(err)}`);
      } finally {
        setIsSavingMetrics(false);
      }
    },
    [activePortfolioId, metricPreferences],
  );

  const handleResetMetrics = useCallback(async () => {
    if (!activePortfolioId) return;
    setIsSavingMetrics(true);
    try {
      const res = await rpc.request.savePortfolioMetrics({ portfolioId: activePortfolioId, reset: true });
      setMetricPreferences(res.metrics);
    } catch (err) {
      clientLogger.log("warning", "metrics_save", `Failed to reset the metric selection: ${String(err)}`);
    } finally {
      setIsSavingMetrics(false);
    }
  }, [activePortfolioId]);

  const handleMetricInstalled = useCallback(
    (metric: MetricListing) => {
      setMetricListings((prev) => [...prev.filter((l) => l.id !== metric.id), metric]);
      void loadMetricCatalog();
    },
    [loadMetricCatalog],
  );

  const handleMetricUninstall = useCallback(
    async (id: string) => {
      try {
        await rpc.request.uninstallMetric({ id });
        setMetricPreferences((prev) => prev.filter((pref) => pref.id !== id));
        await loadMetricCatalog();
      } catch (err) {
        clientLogger.log("warning", "metrics_uninstall", `Failed to uninstall metric: ${String(err)}`);
      }
    },
    [loadMetricCatalog],
  );

  const handleMetricRetry = useCallback((id: string) => {
    setMetricRetryIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setMetricRetryNonce((n) => n + 1);
  }, []);

  /** Built-in metrics open the illustrated explanation; everything else opens its manifest. */
  const handleMetricInfo = useCallback(
    (listing: MetricListing) => {
      const info = listing.manifest.info;
      if (listing.source === "builtin" && info && INFO_MODAL_KEYS.includes(info)) {
        handleOpenMetricModal(info as MetricKey);
      } else {
        setMetricDetails(listing);
      }
    },
    [handleOpenMetricModal],
  );

  const handleQuitApp = useCallback(async () => {
    try {
      await rpc.request.quitApp({});
    } catch {
      if (typeof window !== "undefined") {
        window.close();
      }
    }
  }, []);

  // Reusable retry wrapper for startup RPC calls with per-attempt timeout and logging.
  // A timed-out attempt is aborted (when `fn` passes the signal on), so a slow service
  // does not get a second and third copy of the same request while the first still runs.
  const callWithRetry = async <T,>(
    name: string,
    fn: (signal: AbortSignal) => Promise<T>,
    retries = 3,
    delayMs = 250,
    attemptTimeoutMs = 3500,
  ): Promise<T> => {
    let lastError: unknown;
    for (let i = 0; i < retries; i++) {
      const attemptStart = performance.now();
      const attempt = new AbortController();
      const timer = setTimeout(
        () => attempt.abort(new Error(`RPC "${name}" attempt timed out after ${attemptTimeoutMs}ms`)),
        attemptTimeoutMs,
      );
      try {
        // Debug lines stay in the console; only retries reach the service log.
        clientLogger.log(
          i === 0 ? "debug" : "info",
          `${name}:attempt`,
          `Starting RPC "${name}" (attempt ${i + 1}/${retries}, timeout=${attemptTimeoutMs}ms)`,
        );
        // Calls that ignore the signal still give up on time.
        const timedOut = new Promise<never>((_, reject) => {
          attempt.signal.addEventListener("abort", () => reject(attempt.signal.reason), { once: true });
        });
        const res = await Promise.race([fn(attempt.signal), timedOut]);
        const dur = Math.round(performance.now() - attemptStart);
        clientLogger.log(
          i === 0 ? "debug" : "success",
          `${name}:success`,
          `RPC "${name}" succeeded on attempt ${i + 1} in ${dur}ms`,
          dur,
        );
        return res;
      } catch (err) {
        const dur = Math.round(performance.now() - attemptStart);
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        clientLogger.log("warning", `${name}:retry`, `RPC "${name}" attempt ${i + 1}/${retries} failed after ${dur}ms: ${msg}`, dur);
      } finally {
        clearTimeout(timer);
      }
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
    const finalMsg = lastError instanceof Error ? lastError.message : String(lastError);
    clientLogger.log("error", `${name}:failed`, `RPC "${name}" failed after all ${retries} attempts: ${finalMsg}`);
    throw lastError;
  };

  // Check setup status and load initial config on mount
  useEffect(() => {
    const initApp = async () => {
      clientLogger.log("info", "initApp:start", "Initializing application config and system info");
      await ensureRpcReady();
      try {
        const config = await callWithRetry<DesktopConfig>("getConfig", (signal) => rpc.request.getConfig({ signal }), 3, 200, 3000);
        if (config.baseCurrency) setCurrency(config.baseCurrency);
        setHideCurrencyValues(config.hideCurrencyValues === true);
        if (config.llmProvider) setAssistantProvider(config.llmProvider);
        if (config.llmModel) setAssistantModel(config.llmModel);
        setQuotesIntervalMins(config.marketQuotesInterval ?? 15);
        if (config.zoomLevel !== undefined && Number.isFinite(config.zoomLevel)) {
          const clamped = Math.min(2.5, Math.max(0.5, Math.round(config.zoomLevel * 100) / 100));
          setZoomLevel(clamped);
          if (typeof document !== "undefined") {
            document.documentElement.style.zoom = String(clamped);
          }
          if (typeof localStorage !== "undefined") {
            localStorage.setItem("portfolio_zoom_level", String(clamped));
          }
        }
        if (config.theme) {
          setTheme(config.theme);
          applyTheme(config.theme);
          if (typeof localStorage !== "undefined") {
            localStorage.setItem("portfolio_theme", config.theme);
          }
        }

        if (!config.setupCompleted || FORCE_ONBOARDING) {
          setIsSetupWizardOpen(true);
        }
        if (config.dismissedUpdateVersion) {
          setDismissedUpdateVersion(config.dismissedUpdateVersion);
        }
      } catch (e) {
        clientLogger.log("error", "initApp:config_error", `Failed to load initial config: ${e}`);
        console.error("Failed to load initial config:", e);
      }

      try {
        const appInfo = await callWithRetry<GetAppInfoResponse>("getAppInfo", (signal) => rpc.request.getAppInfo({ signal }), 3, 200, 3000);
        if (appInfo.version && appInfo.version !== "0.0.0") setAppVersion(appInfo.version);
        else if (appInfo.majorMinor && appInfo.majorMinor !== "0.0") setAppVersion(appInfo.majorMinor);
        else if (APP_VERSION) setAppVersion(APP_VERSION);
        setIsDevMode(appInfo.isDev);
        if (appInfo.webpageUrl) setWebpageUrl(appInfo.webpageUrl);
        if (appInfo.devEmail) setDevEmail(appInfo.devEmail);
        if (appInfo.lastQuotesSync) setLastQuotesSync(appInfo.lastQuotesSync);
      } catch (e) {
        clientLogger.log("error", "initApp:appInfo_error", `Failed to load app info: ${e}`);
        console.error("Failed to load app info:", e);
      }

      try {
        // Trigger a fresh update check on startup, not just read cached info
        const uInfo = await rpc.request.checkForUpdates({ force: false });
        if (uInfo) setUpdateInfo(uInfo);
      } catch (e) {
        clientLogger.log("warning", "initApp:updateInfo_warning", `Could not retrieve update info: ${e}`);
      }
    };
    if (authState === "ready") initApp();
  }, [authState]);

  // A newer version found later: rpc.ts polls the update info every 10 minutes.
  useEffect(() => {
    onUpdateAvailable((info: AppUpdateInfo) => {
      setUpdateInfo(info);
    });
  }, []);

  // Load portfolios list
  const loadPortfolios = useCallback(async () => {
    try {
      clientLogger.log("info", "loadPortfolios:start", "Loading portfolios list from database");
      await ensureRpcReady();
      const data = await callWithRetry<GetPortfoliosResponse>("getPortfolios", (signal) => rpc.request.getPortfolios({ signal }), 3, 200, 3000);
      const list: PortfolioItem[] = data.portfolios || [];
      setPortfolios(list);
      // Ids only: portfolio names are personal data and stay out of the logs.
      clientLogger.log("info", "loadPortfolios:received", `Received ${list.length} portfolio(s)`, undefined, {
        portfolioIds: list.map((p) => p.id),
        activePortfolioId,
      });

      if (list.length > 0) {
        const targetId =
          (activePortfolioId && list.some((p) => p.id === activePortfolioId) && activePortfolioId) ||
          list[0]!.id;

        if (targetId !== activePortfolioId) {
          clientLogger.log("info", "loadPortfolios:select_active", `Setting active portfolio to ${targetId}`);
          setActivePortfolioId(targetId);
          if (typeof localStorage !== "undefined") {
            localStorage.setItem("selected_portfolio_id", targetId);
          }
        }
      } else {
        clientLogger.log("warning", "loadPortfolios:empty", "No portfolios found in database");
        if (activePortfolioId) {
          setActivePortfolioId(null);
          setPortfolioData(null);
          if (typeof localStorage !== "undefined") {
            localStorage.removeItem("selected_portfolio_id");
          }
        }
      }
    } catch (e) {
      clientLogger.log("error", "loadPortfolios:error", `Error loading portfolios: ${e}`);
      console.error("Error loading portfolios:", e);
    } finally {
      setPortfoliosLoaded(true);
    }
  }, [activePortfolioId]);

  useEffect(() => {
    if (authState === "ready") loadPortfolios();
  }, [loadPortfolios, authState]);

  // Fetch reports for active portfolio
  const loadReports = useCallback(async () => {
    if (!activePortfolioId) return;
    try {
      await ensureRpcReady();
      const res = await rpc.request.getReports({ portfolioId: activePortfolioId });
      setReports(res.reports || []);
    } catch (e) {
      console.error("Error loading reports:", e);
    }
  }, [activePortfolioId]);

  // Fetch suggestions for the header badge; the Suggestions page keeps it current while open.
  const loadSuggestions = useCallback(async () => {
    if (!activePortfolioId) return;
    try {
      setSuggestions(await api.getSuggestions(activePortfolioId, currency));
    } catch (e) {
      console.error("Error loading suggestions:", e);
    }
  }, [activePortfolioId, currency]);

  const suggestionsCount = useMemo(() => {
    if (!suggestions || suggestions.portfolioId !== activePortfolioId) return 0;
    const summary = portfolioData?.summary;
    return countActiveSuggestions(
      suggestions.suggestions,
      portfolioData?.holdings ?? [],
      suggestions.quotes,
      summary?.totalPortfolioValue || summary?.totalValue,
    );
  }, [suggestions, activePortfolioId, portfolioData]);

  // Fetch portfolio data
  const loadData = useCallback(
    async (mode: LoadMode = "initial") => {
      if (!activePortfolioId) {
        clientLogger.log("warning", "loadData:skipped", "loadData called but activePortfolioId is null");
        return;
      }
      // A reload after an edit or a refresh keeps the data on screen and shows the refresh spinner.
      const inBackground = mode !== "initial";
      if (inBackground) setIsRefreshing(true);
      else setIsLoading(true);

      const loadStart = performance.now();
      clientLogger.log(
        "info",
        "loadData:start",
        `Loading portfolio data (id=${activePortfolioId}, currency=${currency}, mode=${mode})`,
      );

      setLoadError(null);
      try {
        await ensureRpcReady();
        const data = await callWithRetry<FinancialPortfolioData>(
          `getPortfolioData:${activePortfolioId.slice(0, 8)}`,
          (signal) =>
            rpc.request.getPortfolioData({
              portfolioId: activePortfolioId,
              baseCurrency: currency,
              refresh: mode === "refresh",
              signal,
            }),
          // A cold first load builds the data from market sources and can take well over
          // a few seconds; a short timeout showed an error while the service was still working.
          2,
          250,
          30000,
        );
        const dur = Math.round(performance.now() - loadStart);
        setPortfolioData(data);
        setLoadError(null);
        // Counts only: balances never go to the logs.
        clientLogger.log(
          "success",
          "loadData:success",
          `Portfolio data loaded (${data.holdings?.length ?? 0} holdings) in ${dur}ms`,
          dur,
          {
            portfolioId: activePortfolioId,
            holdingsCount: data.holdings?.length ?? 0,
          },
        );
        if (data.summary?.lastUpdated) {
          setLastQuotesSync(data.summary.lastUpdated);
          if (mode === "refresh") {
            rpc.request.saveConfig({ lastQuotesSync: data.summary.lastUpdated }).catch(() => {});
          }
        }
      } catch (e) {
        const dur = Math.round(performance.now() - loadStart);
        const errMsg = e instanceof Error ? e.message : String(e);
        clientLogger.log(
          "error",
          "loadData:error",
          `Failed to load portfolio data after ${dur}ms: ${errMsg}`,
          dur,
        );
        console.error("Error loading portfolio data:", e);
        setLoadError(errMsg);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
      void loadReports();
      void loadSuggestions();
    },
    [activePortfolioId, currency, loadReports, loadSuggestions],
  );

  // One refresh at a time: a click while one runs does nothing.
  const isSyncingRef = useRef(false);
  isSyncingRef.current = isRefreshing;
  const handleSyncQuotes = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    if (activePortfolioId) {
      await loadData("refresh");
    } else {
      setIsRefreshing(true);
      try {
        await ensureRpcReady();
        const res = await rpc.request.syncQuotes({});
        if (res.lastSync) setLastQuotesSync(res.lastSync);
      } catch (e) {
        console.error("Error syncing quotes:", e);
      } finally {
        setIsRefreshing(false);
      }
    }
  }, [activePortfolioId, loadData]);

  useEffect(() => {
    if (activePortfolioId) {
      loadData();
    }
  }, [activePortfolioId, currency, loadData]);

  // Background quotes refresh timer based on configured interval. The interval comes from the
  // config initApp loads and from Settings (CONFIG_CHANGED_EVENT below); the timer calls the
  // current loadData through a ref, so switching portfolio or currency does not restart it.
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;
  useEffect(() => {
    if (authState !== "ready" || !quotesIntervalMins || quotesIntervalMins <= 0) return;
    const timer = setInterval(() => {
      // Timed refresh only: skip it while every market of the holdings is closed. A manual refresh never asks.
      void api
        .getMarketStatus()
        .catch(() => null)
        .then((status) => {
          if (status && !status.anyOpen) return;
          void loadDataRef.current("refresh");
        });
    }, quotesIntervalMins * 60 * 1000);
    return () => clearInterval(timer);
  }, [authState, quotesIntervalMins]);

  // Catalog settings saved in Settings apply here without a reload.
  useEffect(() => {
    const onConfigChanged = (e: Event) => {
      const detail = (e as CustomEvent<Partial<DesktopConfig>>).detail;
      if (typeof detail?.marketQuotesInterval === "number") setQuotesIntervalMins(detail.marketQuotesInterval);
    };
    window.addEventListener(CONFIG_CHANGED_EVENT, onConfigChanged);
    return () => window.removeEventListener(CONFIG_CHANGED_EVENT, onConfigChanged);
  }, []);

  // Portfolio Switching & Management
  const handleSelectPortfolio = (id: string) => {
    if (id === activePortfolioId) {
      if (!portfolioData && !isLoading) {
        void loadData();
      }
      return;
    }
    setActivePortfolioId(id);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("selected_portfolio_id", id);
    }
    setPortfolioData(null);
  };

  const handlePortfolioCreated = (newP: PortfolioItem) => {
    setPortfolios((prev) => [...prev, newP]);
    handleSelectPortfolio(newP.id);
  };

  const handlePortfolioUpdated = (updated: PortfolioItem) => {
    setPortfolios((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    if (activePortfolioId === updated.id && updated.baseCurrency) {
      setCurrency(updated.baseCurrency);
    }
  };

  const handlePortfolioDeleted = async (id: string) => {
    const remaining = portfolios.filter((p) => p.id !== id);
    setPortfolios(remaining);
    if (activePortfolioId !== id) return;
    setReports([]);
    setSuggestions(null);
    if (remaining.length > 0) {
      handleSelectPortfolio(remaining[0]!.id);
      return;
    }
    // The last portfolio is gone: drop its state, then replace it with an empty one.
    setActivePortfolioId(null);
    setPortfolioData(null);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("selected_portfolio_id");
    }
    try {
      const fresh = await rpc.request.createPortfolio({ name: "Main Portfolio", baseCurrency: currency });
      handlePortfolioCreated(fresh);
    } catch (e) {
      console.error("Error creating replacement portfolio:", e);
      await loadPortfolios();
    }
  };

  // Transaction Actions
  const handleSaveTransaction = async (txData: Partial<PortfolioTransaction>) => {
    const targetId = activePortfolioId || portfolios[0]?.id;
    if (!targetId) return;

    await rpc.request.manageTransactions({
      portfolioId: targetId,
      action: txData.id ? "edit" : "add",
      transaction: txData,
      transactionId: txData.id,
    });

    // The service clears its caches on a change; a reload needs no new quotes from the providers.
    await loadData("reload");
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!confirm("Are you sure you want to delete this transaction?")) return;
    const targetId = activePortfolioId || portfolios[0]?.id;
    if (!targetId) return;

    await rpc.request.manageTransactions({
      portfolioId: targetId,
      action: "delete",
      transactionId: id,
    });
    await loadData("reload");
  };

  const handleDeleteReport = async (id: string) => {
    if (!confirm("Are you sure you want to delete this report?")) return;
    const targetId = activePortfolioId || portfolios[0]?.id;
    if (!targetId) return;

    const res = await rpc.request.deleteReport({ portfolioId: targetId, reportId: id });
    if (res.success) {
      setReports((prev) => prev.filter((r) => r.id !== id));
    }
  };

  const handleSetupComplete = useCallback(async () => {
    setIsSetupWizardOpen(false);
    await loadPortfolios();
  }, [loadPortfolios]);

  const handleReload = useCallback(() => {
    clientLogger.log("info", "app_reload", "Reloading application requested by user");
    setIsRefreshing(true);
    void reloadPage(() => {
      setLoadError(null);
      void loadData("refresh");
    });
  }, [loadData]);

  const activePortfolio =
    portfolios.find((p) => p.id === activePortfolioId) ||
    (portfolioData?.portfolio ? (portfolioData.portfolio as PortfolioItem) : null) ||
    portfolios[0] ||
    null;

  // Global Keyboard Shortcuts (Ctrl+N, Ctrl+T, Ctrl+I, Ctrl+E, Ctrl+R, Ctrl+H, Ctrl+,, Ctrl+Q)
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          (activeEl as HTMLElement).isContentEditable);

      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      if (e.key === "F5" || (isCmdOrCtrl && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        if (e.repeat) return;
        if (!isCmdOrCtrl) {
          handleReload();
          return;
        }
        // The desktop shell opens a navigation made with Ctrl/Cmd held in a new window,
        // so reload only after the modifier is released.
        const onRelease = (up: KeyboardEvent) => {
          if (up.key !== "Control" && up.key !== "Meta") return;
          window.removeEventListener("keyup", onRelease, true);
          window.removeEventListener("blur", onBlur);
          setTimeout(handleReload, 0);
        };
        const onBlur = () => {
          window.removeEventListener("keyup", onRelease, true);
          window.removeEventListener("blur", onBlur);
        };
        window.addEventListener("keyup", onRelease, true);
        window.addEventListener("blur", onBlur);
        return;
      }

      // Zoom Shortcuts: Ctrl++ / Cmd++, Ctrl+- / Cmd+-, Ctrl+0 / Cmd+0
      if (isCmdOrCtrl) {
        if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") {
          e.preventDefault();
          handleZoomIn();
          return;
        }
        if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract" || (e.code === "Minus" && !e.shiftKey)) {
          e.preventDefault();
          handleZoomOut();
          return;
        }
        if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") {
          e.preventDefault();
          handleZoomReset();
          return;
        }
      }

      if (isInput) return;

      if (isCmdOrCtrl) {
        const key = e.key.toLowerCase();
        if (key === "n") {
          e.preventDefault();
          setIsCreateModalOpen(true);
        } else if (key === "t") {
          e.preventDefault();
          setEditingTx(null);
          setIsTxModalOpen(true);
        } else if (key === "i") {
          e.preventDefault();
          setIsImportModalOpen(true);
        } else if (key === "e") {
          e.preventDefault();
          setIsExportModalOpen(true);
        } else if (key === "h") {
          e.preventDefault();
          toggleHideCurrencyValues();
        } else if (key === ",") {
          e.preventDefault();
          handleOpenSettings();
        } else if (key === "q") {
          e.preventDefault();
          void handleQuitApp();
        } else if (key === "l" && e.shiftKey) {
          e.preventDefault();
          handleToggleTheme();
        }
      }
    };

    window.addEventListener("keydown", handleGlobalShortcuts);
    return () => window.removeEventListener("keydown", handleGlobalShortcuts);
  }, [handleOpenSettings, handleQuitApp, handleReload, loadData, handleZoomIn, handleZoomOut, handleZoomReset, handleToggleTheme]);

  // Mouse Wheel Zoom (Ctrl + Wheel)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          handleZoomIn();
        } else if (e.deltaY > 0) {
          handleZoomOut();
        }
      }
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [handleZoomIn, handleZoomOut]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (isLoading && !portfolioData) {
      clientLogger.log("info", "sync_screen:shown", "Showing 'Synchronizing Portfolio & Market Quotes...' overlay");
      timer = setTimeout(() => {
        clientLogger.log("warning", "sync_screen:slow_warning", "Market data fetch exceeded 3500ms, showing 'Continue Offline' prompt");
        setLoadingSlowWarning(true);
      }, 3500);
    } else {
      setLoadingSlowWarning(false);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isLoading, portfolioData]);

  // The boot loader of index.html stays until the first screen has its data: the lock or terms
  // screen, or the dashboard with its portfolio (or its error, the empty state, or the slow
  // market data prompt). Other views need no portfolio data.
  const firstScreenReady =
    authState === "locked" ||
    authState === "terms" ||
    authState === "error" ||
    (authState === "ready" &&
      (view !== "dashboard" ||
        portfolioData !== null ||
        loadError !== null ||
        loadingSlowWarning ||
        (portfoliosLoaded && !activePortfolioId)));
  useEffect(() => {
    if (firstScreenReady) hideBootLoader();
  }, [firstScreenReady]);

  if (authState !== "ready") {
    if (authState === "loading") {
      return (
        <div className="h-dvh flex items-center justify-center bg-[var(--app-bg)]">
          <RefreshCw className="w-6 h-6 text-accent-400 animate-spin" />
        </div>
      );
    }
    if (authState === "terms") {
      return (
        <Suspense fallback={null}>
          <SetupWizardPage
            isOpen
            termsPending
            onAcceptTerms={handleAcceptTerms}
            webpageUrl={webpageUrl}
            onComplete={() => {}}
            onClose={() => {}}
          />
        </Suspense>
      );
    }
    return (
      <LockScreen
        locked={authState === "locked"}
        authError={authError}
        onUnlock={handleUnlock}
        onRetry={() => setAuthAttempt((n) => n + 1)}
      />
    );
  }

  if (isLoading && !portfolioData && view === "dashboard") {
    return (
      <div className="h-dvh min-h-0 overflow-hidden bg-[var(--app-bg)] text-[var(--text-main)] flex flex-col w-full max-w-full min-w-0">
        <AppMenuBar
          portfolios={portfolios}
          activePortfolio={activePortfolio}
          onSelectPortfolio={handleSelectPortfolio}
          onNewPortfolio={() => setIsCreateModalOpen(true)}
          onImportCsv={() => setIsImportModalOpen(true)}
          onExportPortfolio={() => setIsExportModalOpen(true)}
          onAddTransaction={() => {
            setEditingTx(null);
            setIsTxModalOpen(true);
          }}
          onManagePortfolios={handleOpenManagePortfolios}
          onOpenSettings={handleOpenSettings}
          onSelectTab={handleTabChange}
          activeTab={activeTab}
          hideCurrencyValues={hideCurrencyValues}
          onToggleHideCurrency={toggleHideCurrencyValues}
          onRefresh={() => loadData("refresh")}
          isRefreshing={true}
          onReload={handleReload}
          onAnalyzePortfolio={() => setIsAnalyzeModalOpen(true)}
          onOpenSetupWizard={openSetupWizard}
          onReportIssue={() => setIsSupportTicketOpen(true)}
          onQuit={handleQuitApp}
          zoomLevel={zoomLevel}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          pinEnabled={pinEnabled}
          onLock={handleLock}
        />
        <Header
          currency={currency}
          onChangeCurrency={setCurrency}
          activePortfolio={activePortfolio}
          portfolios={portfolios}
          onChangePortfolio={handleSelectPortfolio}
          onOpenManagePortfolios={handleOpenManagePortfolios}
          onRefresh={() => loadData("refresh")}
          isRefreshing={true}
          onOpenSettings={handleOpenSettings}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          activeView={view}
          onNavigateDashboard={handleNavigateDashboard}
          reportsCount={reports.length}
          transactionsCount={0}
          suggestionsCount={suggestionsCount}
        />
        <div className="flex-1 flex flex-col items-center justify-center space-y-3 p-8">
          <RefreshCw className="w-8 h-8 text-[#DD3C73] animate-spin" />
          <p className="text-xs text-slate-400 font-mono tracking-wider uppercase">
            Synchronizing Portfolio &amp; Market Quotes...
          </p>
          {loadingSlowWarning && (
            <div className="flex flex-col items-center space-y-2 pt-2">
              <p className="text-xs text-slate-500 font-mono">Market data response is taking longer than usual.</p>
              <button
                type="button"
                onClick={() => {
                  setIsLoading(false);
                  setIsRefreshing(false);
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition-colors border border-slate-700 cursor-pointer font-mono"
              >
                Continue Offline
              </button>
            </div>
          )}
        </div>
        <BottomBar
          version={appVersion}
          lastQuotesSync={lastQuotesSync}
          onOpenTerms={handleOpenTerms}
          onOpenSponsorship={handleOpenSponsorship}
          onSyncQuotes={handleSyncQuotes}
          isSyncingQuotes={isRefreshing}
          quotesIntervalMins={quotesIntervalMins}
          portfolios={portfolios}
          activePortfolio={activePortfolio}
          onSelectPortfolio={handleSelectPortfolio}
          onManagePortfolios={handleOpenManagePortfolios}
          hideCurrencyValues={hideCurrencyValues}
          onToggleHideCurrency={toggleHideCurrencyValues}
        />
      </div>
    );
  }

  if (!isLoading && loadError && !portfolioData && view === "dashboard") {
    return (
      <div className="h-dvh min-h-0 overflow-hidden bg-[var(--app-bg)] text-[var(--text-main)] flex flex-col w-full max-w-full min-w-0">
        <AppMenuBar
          portfolios={portfolios}
          activePortfolio={activePortfolio}
          onSelectPortfolio={handleSelectPortfolio}
          onNewPortfolio={() => setIsCreateModalOpen(true)}
          onImportCsv={() => setIsImportModalOpen(true)}
          onExportPortfolio={() => setIsExportModalOpen(true)}
          onAddTransaction={() => {
            setEditingTx(null);
            setIsTxModalOpen(true);
          }}
          onManagePortfolios={handleOpenManagePortfolios}
          onOpenSettings={handleOpenSettings}
          onSelectTab={handleTabChange}
          activeTab={activeTab}
          hideCurrencyValues={hideCurrencyValues}
          onToggleHideCurrency={toggleHideCurrencyValues}
          onRefresh={() => loadData("refresh")}
          isRefreshing={isRefreshing}
          onReload={handleReload}
          onAnalyzePortfolio={() => setIsAnalyzeModalOpen(true)}
          onOpenSetupWizard={openSetupWizard}
          onReportIssue={() => setIsSupportTicketOpen(true)}
          onQuit={handleQuitApp}
          zoomLevel={zoomLevel}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          pinEnabled={pinEnabled}
          onLock={handleLock}
        />
        <Header
          currency={currency}
          onChangeCurrency={setCurrency}
          activePortfolio={activePortfolio}
          portfolios={portfolios}
          onChangePortfolio={handleSelectPortfolio}
          onOpenManagePortfolios={handleOpenManagePortfolios}
          onRefresh={() => loadData("refresh")}
          isRefreshing={isRefreshing}
          onOpenSettings={handleOpenSettings}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          activeView={view}
          onNavigateDashboard={handleNavigateDashboard}
          reportsCount={reports.length}
          transactionsCount={0}
          suggestionsCount={suggestionsCount}
        />
        <div className="flex-1 flex flex-col items-center justify-center space-y-4 p-8 text-center max-w-md mx-auto">
          <div className="p-3 rounded-full bg-rose-500/10 border border-rose-500/30 text-[#DD3C73]">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Synchronization Failed</h3>
            <p className="text-xs text-slate-400 font-sans max-w-sm">{loadError}</p>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => void loadData()}
              className="px-4 py-2 bg-[#DD3C73] hover:bg-[#DD3C73]/90 text-white rounded text-xs font-mono transition-colors flex items-center gap-2 cursor-pointer shadow-lg shadow-[#DD3C73]/20"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Sync
            </button>
            <button
              type="button"
              onClick={handleReload}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-mono transition-colors border border-slate-700 cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
        <BottomBar
          version={appVersion}
          lastQuotesSync={lastQuotesSync}
          onOpenTerms={handleOpenTerms}
          onOpenSponsorship={handleOpenSponsorship}
          onSyncQuotes={handleSyncQuotes}
          isSyncingQuotes={isRefreshing}
          quotesIntervalMins={quotesIntervalMins}
          portfolios={portfolios}
          activePortfolio={activePortfolio}
          onSelectPortfolio={handleSelectPortfolio}
          onManagePortfolios={handleOpenManagePortfolios}
          hideCurrencyValues={hideCurrencyValues}
          onToggleHideCurrency={toggleHideCurrencyValues}
        />
      </div>
    );
  }

  const summary = portfolioData?.summary;
  const holdings = portfolioData?.holdings || [];
  const chartHistory = portfolioData?.chartHistory || [];
  const transactions = portfolioData?.transactions || [];

  const metricsPage = (
    <MetricsTab
      portfolioId={activePortfolioId || null}
      portfolioName={activePortfolio?.name}
      prefs={metricPreferences}
      listings={metricListings}
      repository={metricRepository}
      evaluations={metricEvaluations}
      currency={currency}
      hideValues={hideCurrencyValues}
      isSaving={isSavingMetrics}
      onSave={(next) => void handleSaveMetrics(next)}
      onReset={() => void handleResetMetrics()}
      onInfo={handleMetricInfo}
      onInstalled={handleMetricInstalled}
      onUninstall={handleMetricUninstall}
      onRetry={handleMetricRetry}
    />
  );

  return (
    <div className="h-dvh min-h-0 overflow-hidden bg-[var(--app-bg)] text-[var(--text-main)] flex flex-col w-full max-w-full min-w-0">
      {/* Application Menu Bar (Native HTML Menu for Linux); hidden on the Portfolios page and the CSV import page */}
      {view !== "portfolios" && !isImportModalOpen && (
      <AppMenuBar
        portfolios={portfolios}
        activePortfolio={activePortfolio}
        onSelectPortfolio={(id) => {
          handleSelectPortfolio(id);
          if (view !== "dashboard") handleNavigateDashboard();
        }}
        onNewPortfolio={() => setIsCreateModalOpen(true)}
        onImportCsv={() => setIsImportModalOpen(true)}
        onExportPortfolio={() => setIsExportModalOpen(true)}
        onAddTransaction={() => {
          setEditingTx(null);
          setIsTxModalOpen(true);
        }}
        onManagePortfolios={handleOpenManagePortfolios}
        onOpenSettings={handleOpenSettings}
        onSelectTab={handleTabChange}
        activeTab={activeTab}
        hideCurrencyValues={hideCurrencyValues}
        onToggleHideCurrency={toggleHideCurrencyValues}
        onRefresh={() => loadData("refresh")}
        isRefreshing={isRefreshing}
        onReload={handleReload}
        onAnalyzePortfolio={() => setIsAnalyzeModalOpen(true)}
        onOpenSetupWizard={openSetupWizard}
        onReportIssue={() => setIsSupportTicketOpen(true)}
        onQuit={handleQuitApp}
        isAssistantOpen={isAssistantOpen}
        onToggleAssistant={handleToggleAssistant}
        updateInfo={updateInfo}
        onCheckForUpdates={() => handleOpenSettings("about")}
        zoomLevel={zoomLevel}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        pinEnabled={pinEnabled}
        onLock={handleLock}
      />
      )}

      {/* Main Content Area & Assistant Sidebar */}
      <div className={`flex-1 flex min-h-0 overflow-hidden relative ${view === "portfolios" ? "" : "p-2 sm:p-3"}`}>
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {/* Main Menu / Navigation Bar (Header) - pushed when assistant sidebar is shown; hidden on the Portfolios page */}
          {view !== "portfolios" && (
          <Header
            currency={currency}
            onChangeCurrency={setCurrency}
            activePortfolio={activePortfolio}
            portfolios={portfolios}
            onChangePortfolio={handleSelectPortfolio}
            onOpenManagePortfolios={handleOpenManagePortfolios}
            onRefresh={() => loadData("refresh")}
            isRefreshing={isRefreshing}
            onOpenSettings={handleOpenSettings}
            lastUpdated={summary?.lastUpdated}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            activeView={view}
            onNavigateDashboard={handleNavigateDashboard}
            reportsCount={reports.length}
            transactionsCount={transactions.length}
            suggestionsCount={suggestionsCount}
            isAssistantOpen={isAssistantOpen}
            onToggleAssistant={handleToggleAssistant}
          />
          )}

          <Toaster />

          {/* Update Available Popover (bottom-right corner) */}
          <UpdatePopover
            isVisible={Boolean(showUpdatePopover)}
            latestVersion={updateInfo?.latestVersion || ""}
            currentVersion={appVersion}
            onShowChangelog={() => setIsChangelogModalOpen(true)}
            onDismiss={() => {
              if (updateInfo?.latestVersion) {
                handleDismissUpdate(updateInfo.latestVersion);
              }
            }}
          />

          {/* Changelog Modal */}
          {changelogModalMounted && (
            <Suspense fallback={null}>
              <ChangelogModal
                isOpen={isChangelogModalOpen && Boolean(updateInfo?.hasUpdate)}
                onClose={() => setIsChangelogModalOpen(false)}
                latestVersion={updateInfo?.latestVersion || ""}
                currentVersion={appVersion}
                releaseName={updateInfo?.releaseName || `v${updateInfo?.latestVersion || ""}`}
                releaseUrl={updateInfo?.releaseUrl || `https://github.com/cgeosoft/portfolio/releases`}
                releaseNotes={updateInfo?.releaseNotes || ""}
              />
            </Suspense>
          )}

          {/* Main View Router */}
          {view === "settings" && (
        <main className="flex-1 w-full container max-w-screen-xl mx-auto px-2 sm:px-6 lg:px-8 pt-2 pb-6 sm:pb-8 overflow-y-auto min-h-0 custom-scrollbar">
          <Suspense fallback={<PageLoading />}>
            <SettingsPage
              onBack={() => handleNavigateDashboard()}
              initialSection={settingsSection}
              onSectionChange={handleSettingsSectionChange}
              portfolios={portfolios}
              theme={theme}
              onChangeTheme={handleThemeChange}
              zoomLevel={zoomLevel}
              onChangeZoom={handleZoomSet}
              onPinEnabledChange={setPinEnabled}
              onReportIssue={() => setIsSupportTicketOpen(true)}
              metrics={metricsPage}
            />
          </Suspense>
        </main>
      )}

      {view === "portfolios" && (
        <Suspense fallback={<PageLoading />}>
          <ManagePortfoliosPage
            portfolios={portfolios}
            activePortfolio={activePortfolio}
            onSelectPortfolio={handleSelectPortfolio}
            onPortfolioCreated={handlePortfolioCreated}
            onPortfolioUpdated={handlePortfolioUpdated}
            onPortfolioDeleted={handlePortfolioDeleted}
            onBack={handleLeavePortfolios}
            onOpenDashboard={() => handleNavigateDashboard()}
          />
        </Suspense>
      )}

      {(view === "terms" || view === "sponsorship") && (
        <main className="flex-1 w-full container max-w-screen-2xl mx-auto px-2 sm:px-6 lg:px-8 pt-2 pb-6 sm:pb-8 flex flex-col min-h-0 overflow-y-auto custom-scrollbar">
          <WebsitePage key={view} page={view} onBack={() => handleNavigateDashboard()} webpageUrl={webpageUrl} />
        </main>
      )}

      {view === "dashboard" && (
        <main
          className={`flex-1 w-full container max-w-screen-2xl mx-auto px-2 sm:px-6 lg:px-8 pt-2 space-y-6 min-w-0 ${
            activeTab === "transactions" || activeTab === "reports" || (activeTab === "analysis" && analysisSection === "suggestions")
              ? "flex flex-col h-full min-h-0 pb-2 sm:pb-3 overflow-hidden"
              : "pb-6 sm:pb-8 overflow-y-auto min-h-0 custom-scrollbar"
          }`}
        >
          {/* TAB: OVERVIEW (Charts & Holdings) */}
          {activeTab === "overview" && (
            <>
              {/* Dashboard metrics, chosen under Settings → Dashboard Cards */}
              <MetricDashboard
                prefs={metricPreferences}
                listings={metricListings}
                evaluations={metricEvaluations}
                currency={currency}
                hideValues={hideCurrencyValues}
                onInfo={handleMetricInfo}
                onOpenMetrics={() => handleOpenSettings("metrics")}
              />

              {/* Sponsor Banner Box */}
              {SPONSOR_BANNER_ENABLED && <SponsorBannerCard webpageUrl={webpageUrl} devEmail={devEmail} theme={theme} />}

              {/* Charts & Allocation Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 min-w-0">
                  <PortfolioChartCard chartHistory={chartHistory} currency={currency} hideValues={hideCurrencyValues} theme={theme} />
                </div>
                <div className="min-w-0">
                  <AllocationCard
                    theme={theme}
                    hideValues={hideCurrencyValues}
                    summary={summary || {
                      totalValue: 0,
                      totalCost: 0,
                      totalGainLossDollar: 0,
                      totalGainLossPercent: 0,
                      dayGainLossDollar: 0,
                      dayGainLossPercent: 0,
                      totalGainSinceStartDollar: 0,
                      totalGainSinceStartPercent: 0,
                      totalCashInjected: 0,
                      cashBalance: 0,
                      totalPortfolioValue: 0,
                      realizedPnL: 0,
                      totalDividends: 0,
                      totalInterest: 0,
                      totalFees: 0,
                      totalTaxes: 0,
                      stockWeightPercent: 0,
                      etfWeightPercent: 0,
                      cryptoWeightPercent: 0,
                      cashWeightPercent: 0,
                      baseCurrency: currency,
                      lastUpdated: new Date().toISOString(),
                    }}
                    holdings={holdings}
                  />
                </div>
              </div>

              {/* Holdings Table */}
              <HoldingsTableCard
                holdings={holdings}
                currency={currency}
                hideValues={hideCurrencyValues}
                summary={summary}
                portfolioId={activePortfolioId}
                onSymbolsChanged={() => loadData("reload")}
                warnings={portfolioData?.warnings}
              />
            </>
          )}

          {/* TAB: ANALYSIS (exposure, income and events, markets, suggestions; one at a time) */}
          {activeTab === "analysis" && (
            <AnalysisPage
              section={analysisSection}
              onSectionChange={handleAnalysisSectionChange}
              portfolioId={activePortfolioId}
              portfolioData={portfolioData}
              currency={currency}
              hideValues={hideCurrencyValues}
              theme={theme}
              dataVersion={summary?.lastUpdated}
              suggestionsCount={suggestionsCount}
              onSuggestionsChange={setSuggestions}
            />
          )}

          {/* TAB: REPORTS */}
          {activeTab === "reports" && (
            <div className="flex-1 flex flex-col min-h-0">
              <ReportsCard
                reports={reports}
                portfolioData={portfolioData}
                currency={currency}
                portfolioId={activePortfolioId || undefined}
                portfolioName={activePortfolio?.name}
                onRefreshReports={loadReports}
                onDeleteReport={handleDeleteReport}
                hideValues={hideCurrencyValues}
              />
            </div>
          )}

          {/* TAB: TRANSACTIONS */}
          {activeTab === "transactions" && (
            <div className="flex-1 flex flex-col min-h-0">
              <TransactionsCard
                transactions={transactions}
                currency={currency}
                hideValues={hideCurrencyValues}
                onOpenAddModal={() => {
                  setEditingTx(null);
                  setIsTxModalOpen(true);
                }}
                onOpenEditModal={(tx: PortfolioTransaction) => {
                  setEditingTx(tx);
                  setIsTxModalOpen(true);
                }}
                onDeleteTransaction={handleDeleteTransaction}
                onOpenImportModal={() => setIsImportModalOpen(true)}
              />
            </div>
          )}
        </main>
      )}
        </div>

        {/* Assistant Sidebar (Persistent across all views & tabs, closed on the Portfolios page) */}
        <AssistantSidebar
          isOpen={isAssistantOpen && view !== "portfolios"}
          onClose={handleCloseAssistant}
          portfolio={activePortfolio}
          portfolioData={portfolioData}
          onOpenSettings={() => handleOpenSettings("assistant")}
          conversations={conversations}
          currentConversationId={currentConversationId}
          onSelectConversation={handleSelectConversation}
          onNewChat={handleNewChat}
          onDeleteConversation={handleDeleteConversation}
          messages={chatMessages}
          onSendMessage={handleSendChatMessage}
          onRegenerateMessage={handleRegenerateChatMessage}
          onClearMessages={handleClearChat}
          isLoading={isChatLoading}
          error={chatError}
          activeProvider={assistantProvider}
          activeModel={assistantModel}
          hideValues={hideCurrencyValues}
        />
      </div>

      {/* Bottom Status Bar */}
      <BottomBar
        version={appVersion}
        lastQuotesSync={summary?.lastUpdated || lastQuotesSync}
        onOpenTerms={handleOpenTerms}
        onOpenSponsorship={handleOpenSponsorship}
        onSyncQuotes={handleSyncQuotes}
        isSyncingQuotes={isRefreshing}
        quotesIntervalMins={quotesIntervalMins}
        portfolios={portfolios}
        activePortfolio={activePortfolio}
        onSelectPortfolio={(id) => {
          handleSelectPortfolio(id);
          if (view !== "dashboard") handleNavigateDashboard();
        }}
        onManagePortfolios={handleOpenManagePortfolios}
        hideCurrencyValues={hideCurrencyValues}
        onToggleHideCurrency={toggleHideCurrencyValues}
      />

      {/* Modals */}
      {setupWizardMounted && (
        <Suspense fallback={null}>
          <SetupWizardPage
            isOpen={isSetupWizardOpen}
            startStep={setupWizardStartStep}
            webpageUrl={webpageUrl}
            onComplete={handleSetupComplete}
            onClose={() => setIsSetupWizardOpen(false)}
          />
        </Suspense>
      )}

      {supportTicketMounted && (
        <Suspense fallback={null}>
          <SupportTicketModal isOpen={isSupportTicketOpen} onClose={() => setIsSupportTicketOpen(false)} />
        </Suspense>
      )}

      {txModalMounted && (
        <Suspense fallback={null}>
          <TransactionModal
            isOpen={isTxModalOpen}
            onClose={() => {
              setIsTxModalOpen(false);
              setEditingTx(null);
            }}
            onSave={handleSaveTransaction}
            transaction={editingTx}
          />
        </Suspense>
      )}

      {/* Mounted from the first open on: the import keeps its file and mapping when closed */}
      {importModalMounted && (
        <Suspense fallback={null}>
          <ImportCsvPage
            isOpen={isImportModalOpen}
            onClose={() => setIsImportModalOpen(false)}
            portfolioId={activePortfolioId || undefined}
            portfolioName={activePortfolio?.name}
            baseCurrency={currency}
            onSuccess={() => loadData("reload")}
          />
        </Suspense>
      )}

      {/* Mounted while open; it starts a fresh wizard on every open anyway */}
      {isAnalyzeModalOpen && (
        <Suspense fallback={null}>
          <AnalyzePortfolioModal
            isOpen
            onClose={() => setIsAnalyzeModalOpen(false)}
            portfolioData={portfolioData}
            portfolioId={activePortfolioId || undefined}
            hideCurrencyValues={hideCurrencyValues}
            onReportGenerated={async () => {
              await loadReports();
              handleTabChange("reports");
            }}
          />
        </Suspense>
      )}

      {metricModalMounted && (
        <Suspense fallback={null}>
          <MetricInfoModal
            isOpen={isMetricModalOpen}
            onClose={() => setIsMetricModalOpen(false)}
            selectedMetricKey={selectedMetricKey}
            onSelectMetricKey={setSelectedMetricKey}
            summary={summary}
            currency={currency}
            hideCurrencyValues={hideCurrencyValues}
          />
        </Suspense>
      )}

      {metricDetailsMounted && (
        <Suspense fallback={null}>
          <MetricDetailsModal listing={metricDetails} onClose={() => setMetricDetails(null)} />
        </Suspense>
      )}

      {/* Holding details, opened from any instrument reference */}
      <HoldingLinksHost holdings={portfolioData?.holdings} transactions={portfolioData?.transactions} />

      <CreatePortfolioModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onPortfolioCreated={handlePortfolioCreated}
      />

      {exportModalMounted && (
        <Suspense fallback={null}>
          <ExportPortfolioModal
            isOpen={isExportModalOpen}
            onClose={() => setIsExportModalOpen(false)}
            portfolio={activePortfolio}
          />
        </Suspense>
      )}
    </div>
  );
}
