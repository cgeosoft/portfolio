import { useState, useEffect, useCallback } from "react";
import type {
  FinancialPortfolioData,
  PortfolioTransaction,
  PortfolioReport,
  PortfolioItem,
} from "../../types/portfolio";
import { Header, type PortfolioTabKey } from "./components/layout/Header";
import { AppMenuBar } from "./components/layout/AppMenuBar";
import { CreatePortfolioModal } from "./components/portfolio/CreatePortfolioModal";
import { ExportPortfolioModal } from "./components/portfolio/ExportPortfolioModal";
import { StatCard } from "./components/portfolio/StatCard";
import { PortfolioChartCard } from "./components/portfolio/PortfolioChartCard";
import { AllocationCard } from "./components/portfolio/AllocationCard";
import { HoldingsTableCard } from "./components/portfolio/HoldingsTableCard";
import { TransactionsCard } from "./components/portfolio/TransactionsCard";
import { ReportsCard } from "./components/portfolio/ReportsCard";
import { TransactionModal } from "./components/portfolio/TransactionModal";
import { ImportCsvModal } from "./components/portfolio/ImportCsvModal";
import { AnalyzePortfolioModal } from "./components/portfolio/AnalyzePortfolioModal";
import { SponsorBannerCard } from "./components/portfolio/SponsorBannerCard";
import { SetupWizardModal } from "./components/common/SetupWizardModal";
import { UpdatePopover } from "./components/common/UpdatePopover";
import { ChangelogModal } from "./components/common/ChangelogModal";
import { SettingsPage, type SettingsSection } from "./components/settings/SettingsPage";
import { TermsPage } from "./components/common/TermsPage";
import { BottomBar } from "./components/layout/BottomBar";
import { MetricInfoModal, type MetricKey } from "./components/portfolio/MetricInfoModal";
import { METRIC_CATALOG_BY_KEY, type MetricContext } from "./components/portfolio/metrics-catalog";
import { AssistantSidebar } from "./components/portfolio/AssistantSidebar";
import { reloadPage } from "./components/portfolio/utils";
import { WEBPAGE_URL } from "./environment";
import type {
  DesktopConfig,
  GetPortfoliosResponse,
  GetAppInfoResponse,
  PortfolioChatMessage,
  AssistantConversation,
  AppUpdateInfo,
} from "../../shared/rpc-types";
import { rpc, ensureRpcReady, clientLogger, forceFallbackToNativeBridge, onUpdateAvailable } from "./rpc";
import {
  getDefaultMetricPreferences,
  type PortfolioMetricPreference,
} from "../../shared/metrics";
import { RefreshCw, Info, Sliders, AlertTriangle } from "lucide-react";

const VALID_TABS: readonly string[] = ["overview", "reports", "transactions"];

function getTabFromHash(hash: string): PortfolioTabKey {
  const cleanHash = hash.replace(/^#/, "").toLowerCase().trim();
  if (cleanHash === "charts" || cleanHash === "holdings") return "overview";
  if (cleanHash === "logs") return "transactions";
  if (VALID_TABS.includes(cleanHash)) {
    return cleanHash as PortfolioTabKey;
  }
  return "overview";
}

export default function App() {
  const [view, setView] = useState<"dashboard" | "settings" | "portfolios" | "terms">(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.toLowerCase();
      if (hash === "#portfolios") return "settings";
      if (hash.startsWith("#settings")) return "settings";
      if (hash === "#terms") return "terms";
    }
    return "dashboard";
  });

  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.toLowerCase();
      if (hash.startsWith("#settings/")) {
        const sec = hash.replace("#settings/", "") as SettingsSection;
        if (["general", "portfolios", "metrics", "assistant", "support", "about"].includes(sec)) {
          return sec;
        }
      }
      if (hash === "#portfolios") return "portfolios";
    }
    return "general";
  });

  const [activeTab, setActiveTab] = useState<PortfolioTabKey>(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      return getTabFromHash(window.location.hash);
    }
    return "overview";
  });

  const handleTabChange = useCallback((tab: PortfolioTabKey) => {
    setView("dashboard");
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const newHash = `#${tab}`;
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, []);

  const handleOpenSettings = useCallback((section: SettingsSection = "general") => {
    setSettingsSection(section);
    setView("settings");
    if (typeof window !== "undefined") {
      const newHash = section === "general" ? "#settings" : `#settings/${section}`;
      if (window.location.hash !== newHash) {
        window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, []);

  const handleOpenManagePortfolios = useCallback(() => {
    handleOpenSettings("portfolios");
  }, [handleOpenSettings]);

  const handleOpenTerms = useCallback(() => {
    setView("terms");
    if (typeof window !== "undefined") {
      const newHash = "#terms";
      if (window.location.hash !== newHash) {
        window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, []);

  const handleNavigateDashboard = useCallback((tab?: PortfolioTabKey) => {
    setView("dashboard");
    const targetTab = tab || activeTab;
    setActiveTab(targetTab);
    if (typeof window !== "undefined") {
      const newHash = `#${targetTab}`;
      if (window.location.hash !== newHash) {
        window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleRouting = () => {
      const hash = window.location.hash.toLowerCase();
      if (hash === "#portfolios") {
        setSettingsSection("portfolios");
        setView("settings");
      } else if (hash.startsWith("#settings")) {
        const parts = hash.split("/");
        if (parts[1] && ["general", "portfolios", "metrics", "assistant", "support", "about"].includes(parts[1])) {
          setSettingsSection(parts[1] as SettingsSection);
        } else {
          setSettingsSection("general");
        }
        setView("settings");
      } else if (hash === "#terms") {
        setView("terms");
      } else {
        setView("dashboard");
        setActiveTab(getTabFromHash(window.location.hash));
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
  const [activePortfolioId, setActivePortfolioId] = useState<string | null>(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("selected_portfolio_id") || null;
    }
    return null;
  });

  const [portfolioData, setPortfolioData] = useState<FinancialPortfolioData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reports, setReports] = useState<PortfolioReport[]>([]);
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

  // Privacy Mode Toggle State
  const [hideCurrencyValues, setHideCurrencyValues] = useState<boolean>(false);

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

  // Assistant Chat & Conversations State
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<PortfolioChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [assistantProvider, setAssistantProvider] = useState<string | undefined>(undefined);
  const [assistantModel, setAssistantModel] = useState<string | undefined>(undefined);

  const loadConversations = useCallback(async (portfolioId: string) => {
    try {
      await ensureRpcReady();
      const res = await rpc.request.getAssistantConversations({ portfolioId });
      const convs = res.conversations || [];
      setConversations(convs);
      if (convs.length > 0) {
        setCurrentConversationId(convs[0].id);
        setChatMessages(convs[0].messages);
      } else {
        setCurrentConversationId(null);
        setChatMessages([]);
      }
    } catch (err) {
      console.error("Failed to load assistant conversations:", err);
    }
  }, []);

  useEffect(() => {
    if (activePortfolioId) {
      void loadConversations(activePortfolioId);
    }
  }, [activePortfolioId, loadConversations]);

  const handleToggleAssistant = useCallback(() => {
    setIsAssistantOpen((prev) => !prev);
  }, []);

  const handleSelectConversation = useCallback(
    (convId: string) => {
      const found = conversations.find((c) => c.id === convId);
      if (found) {
        setCurrentConversationId(found.id);
        setChatMessages(found.messages);
        setChatError(null);
      }
    },
    [conversations],
  );

  const handleNewChat = useCallback(() => {
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
        setConversations((prev) => {
          const next = prev.filter((c) => c.id !== convId);
          if (currentConversationId === convId) {
            if (next.length > 0) {
              setCurrentConversationId(next[0].id);
              setChatMessages(next[0].messages);
            } else {
              setCurrentConversationId(null);
              setChatMessages([]);
            }
          }
          return next;
        });
      } catch (err) {
        console.error("Failed to delete assistant conversation:", err);
      }
    },
    [activePortfolioId, currentConversationId],
  );

  const handleClearChat = useCallback(async () => {
    if (currentConversationId && activePortfolioId) {
      await handleDeleteConversation(currentConversationId);
    } else {
      setChatMessages([]);
      setChatError(null);
    }
  }, [currentConversationId, activePortfolioId, handleDeleteConversation]);

  const handleSendChatMessage = useCallback(
    async (userText: string) => {
      if (!activePortfolioId) {
        setChatError("Please select or create a portfolio first.");
        return;
      }
      const userMsg: PortfolioChatMessage = { role: "user", content: userText };
      const updatedMessages = [...chatMessages, userMsg];
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
          const updatedConv: AssistantConversation = {
            id: res.conversationId,
            portfolioId: activePortfolioId,
            title: res.title,
            messages: fullMessages,
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setChatError(msg);
      } finally {
        setIsChatLoading(false);
      }
    },
    [activePortfolioId, chatMessages, currentConversationId],
  );

  // App Info & Quotes Sync State
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [webpageUrl, setWebpageUrl] = useState(WEBPAGE_URL);
  const [devEmail, setDevEmail] = useState<string | undefined>(undefined);
  const [lastQuotesSync, setLastQuotesSync] = useState<string | undefined>(undefined);
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
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<PortfolioTransaction | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAnalyzeModalOpen, setIsAnalyzeModalOpen] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isMetricModalOpen, setIsMetricModalOpen] = useState(false);
  const [selectedMetricKey, setSelectedMetricKey] = useState<MetricKey>("totalGain");

  const handleOpenMetricModal = useCallback((metricKey: MetricKey) => {
    setSelectedMetricKey(metricKey);
    setIsMetricModalOpen(true);
  }, []);

  // Overview metric selection of the active portfolio (metrics marketplace)
  const [metricPreferences, setMetricPreferences] = useState<PortfolioMetricPreference[]>(
    getDefaultMetricPreferences,
  );

  useEffect(() => {
    if (!activePortfolioId) {
      setMetricPreferences(getDefaultMetricPreferences());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await ensureRpcReady();
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
  }, [activePortfolioId]);

  const handleMetricsSaved = useCallback(
    (portfolioId: string, metrics: PortfolioMetricPreference[]) => {
      if (portfolioId === activePortfolioId) {
        setMetricPreferences(metrics);
      }
    },
    [activePortfolioId],
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

  // Reusable retry wrapper for startup RPC calls with per-attempt timeout and logging
  const callWithRetry = async <T,>(
    name: string,
    fn: () => Promise<T>,
    retries = 3,
    delayMs = 250,
    attemptTimeoutMs = 3500,
  ): Promise<T> => {
    let lastError: unknown;
    for (let i = 0; i < retries; i++) {
      const attemptStart = performance.now();
      try {
        clientLogger.log(
          "info",
          `${name}:attempt`,
          `Starting RPC "${name}" (attempt ${i + 1}/${retries}, timeout=${attemptTimeoutMs}ms)`,
        );
        const attemptPromise = fn();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`RPC "${name}" attempt timed out after ${attemptTimeoutMs}ms`)), attemptTimeoutMs)
        );
        const res = await Promise.race([attemptPromise, timeoutPromise]);
        const dur = Math.round(performance.now() - attemptStart);
        clientLogger.log("success", `${name}:success`, `RPC "${name}" succeeded on attempt ${i + 1} in ${dur}ms`, dur);
        return res;
      } catch (err) {
        const dur = Math.round(performance.now() - attemptStart);
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        clientLogger.log("warning", `${name}:retry`, `RPC "${name}" attempt ${i + 1}/${retries} failed after ${dur}ms: ${msg}`, dur);
        
        // Socket stall watchdog: force fallback to native WebKitGTK bridge immediately on first failure
        forceFallbackToNativeBridge();

        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
        }
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
        const config = await callWithRetry<DesktopConfig>("getConfig", () => rpc.request.getConfig({}), 3, 200, 3000);
        if (config.baseCurrency) setCurrency(config.baseCurrency);
        if (config.hideCurrencyValues !== undefined) setHideCurrencyValues(config.hideCurrencyValues);
        if (config.llmProvider) setAssistantProvider(config.llmProvider);
        if (config.llmModel) setAssistantModel(config.llmModel);
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

        if (!config.setupCompleted) {
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
        const appInfo = await callWithRetry<GetAppInfoResponse>("getAppInfo", () => rpc.request.getAppInfo({}), 3, 200, 3000);
        if (appInfo.version) setAppVersion(appInfo.version);
        else if (appInfo.majorMinor) setAppVersion(appInfo.majorMinor);
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
    initApp();
  }, []);

  // Periodic update check every 1 hour in webview
  useEffect(() => {
    const updateTimer = setInterval(() => {
      rpc.request.getUpdateInfo({}).then((uInfo: AppUpdateInfo) => {
        if (uInfo) setUpdateInfo(uInfo);
      }).catch(() => {});
    }, 60 * 60 * 1000);
    return () => clearInterval(updateTimer);
  }, []);

  // Listen for push messages from Bun when a new update is detected
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
      const data = await callWithRetry<GetPortfoliosResponse>("getPortfolios", () => rpc.request.getPortfolios({}), 3, 200, 3000);
      const list: PortfolioItem[] = data.portfolios || [];
      setPortfolios(list);
      clientLogger.log("info", "loadPortfolios:received", `Received ${list.length} portfolio(s)`, undefined, {
        portfolios: list.map((p) => ({ id: p.id, name: p.name })),
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
      }
    } catch (e) {
      clientLogger.log("error", "loadPortfolios:error", `Error loading portfolios: ${e}`);
      console.error("Error loading portfolios:", e);
    }
  }, [activePortfolioId]);

  useEffect(() => {
    loadPortfolios();
  }, [loadPortfolios]);

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

  // Fetch portfolio data
  const loadData = useCallback(
    async (forceRefresh = false) => {
      if (!activePortfolioId) {
        clientLogger.log("warning", "loadData:skipped", "loadData called but activePortfolioId is null");
        return;
      }
      if (forceRefresh) setIsRefreshing(true);
      else setIsLoading(true);

      const loadStart = performance.now();
      clientLogger.log(
        "info",
        "loadData:start",
        `Loading portfolio data (id=${activePortfolioId}, currency=${currency}, forceRefresh=${forceRefresh})`,
      );

      setLoadError(null);
      try {
        await ensureRpcReady();
        const data = await callWithRetry<FinancialPortfolioData>(
          `getPortfolioData:${activePortfolioId.slice(0, 8)}`,
          () =>
            rpc.request.getPortfolioData({
              portfolioId: activePortfolioId,
              baseCurrency: currency,
              refresh: forceRefresh,
            }),
          forceRefresh ? 2 : 3,
          250,
          forceRefresh ? 30000 : 4000,
        );
        const dur = Math.round(performance.now() - loadStart);
        setPortfolioData(data);
        setLoadError(null);
        clientLogger.log(
          "success",
          "loadData:success",
          `Portfolio data loaded (${data.holdings?.length ?? 0} holdings, totalValue=${data.summary?.totalValue}) in ${dur}ms`,
          dur,
          {
            portfolioId: activePortfolioId,
            holdingsCount: data.holdings?.length ?? 0,
            totalValue: data.summary?.totalValue,
          },
        );
        if (data.summary?.lastUpdated) {
          setLastQuotesSync(data.summary.lastUpdated);
          if (forceRefresh) {
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
    },
    [activePortfolioId, currency, loadReports],
  );

  const handleSyncQuotes = useCallback(async () => {
    if (activePortfolioId) {
      await loadData(true);
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

  // Background quotes refresh timer based on configured interval
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      try {
        await ensureRpcReady();
        const cfg = await rpc.request.getConfig({});
        if (cfg.llmProvider) setAssistantProvider(cfg.llmProvider);
        if (cfg.llmModel) setAssistantModel(cfg.llmModel);
        const intervalMins = cfg.marketQuotesInterval ?? 15;
        if (intervalMins > 0) {
          timer = setInterval(() => {
            void loadData(true);
          }, intervalMins * 60 * 1000);
        }
      } catch (err) {
        console.warn("Failed to schedule background quotes refresh:", err);
      }
    })();

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [loadData]);

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
    if (remaining.length > 0) {
      setPortfolios(remaining);
      if (activePortfolioId === id) {
        handleSelectPortfolio(remaining[0]!.id);
      }
    } else {
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

    await loadData(true);
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
    await loadData(true);
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
      void loadData(true);
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
        handleReload();
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
        }
      }
    };

    window.addEventListener("keydown", handleGlobalShortcuts);
    return () => window.removeEventListener("keydown", handleGlobalShortcuts);
  }, [handleOpenSettings, handleQuitApp, handleReload, loadData, handleZoomIn, handleZoomOut, handleZoomReset]);

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

  if (isLoading && !portfolioData && view === "dashboard") {
    return (
      <div className="h-dvh min-h-0 overflow-hidden bg-[#0b0f19] text-slate-100 flex flex-col font-mono w-full max-w-full min-w-0">
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
          onRefresh={() => loadData(true)}
          isRefreshing={true}
          onReload={handleReload}
          onAnalyzePortfolio={() => setIsAnalyzeModalOpen(true)}
          onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
          onQuit={handleQuitApp}
          zoomLevel={zoomLevel}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
        />
        <Header
          currency={currency}
          onChangeCurrency={setCurrency}
          activePortfolio={activePortfolio}
          portfolios={portfolios}
          onChangePortfolio={handleSelectPortfolio}
          onOpenManagePortfolios={handleOpenManagePortfolios}
          onRefresh={() => loadData(true)}
          isRefreshing={true}
          onOpenSettings={handleOpenSettings}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          activeView={view}
          onNavigateDashboard={handleNavigateDashboard}
          reportsCount={reports.length}
          transactionsCount={0}
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
          onSyncQuotes={handleSyncQuotes}
          isSyncingQuotes={isRefreshing}
          hideCurrencyValues={hideCurrencyValues}
          onToggleHideCurrency={toggleHideCurrencyValues}
        />
      </div>
    );
  }

  if (!isLoading && loadError && !portfolioData && view === "dashboard") {
    return (
      <div className="h-dvh min-h-0 overflow-hidden bg-[#0b0f19] text-slate-100 flex flex-col font-mono w-full max-w-full min-w-0">
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
          onRefresh={() => loadData(true)}
          isRefreshing={isRefreshing}
          onReload={handleReload}
          onAnalyzePortfolio={() => setIsAnalyzeModalOpen(true)}
          onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
          onQuit={handleQuitApp}
          zoomLevel={zoomLevel}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
        />
        <Header
          currency={currency}
          onChangeCurrency={setCurrency}
          activePortfolio={activePortfolio}
          portfolios={portfolios}
          onChangePortfolio={handleSelectPortfolio}
          onOpenManagePortfolios={handleOpenManagePortfolios}
          onRefresh={() => loadData(true)}
          isRefreshing={isRefreshing}
          onOpenSettings={handleOpenSettings}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          activeView={view}
          onNavigateDashboard={handleNavigateDashboard}
          reportsCount={reports.length}
          transactionsCount={0}
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
              onClick={() => {
                forceFallbackToNativeBridge();
                void loadData(false);
              }}
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
          onSyncQuotes={handleSyncQuotes}
          isSyncingQuotes={isRefreshing}
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

  const metricContext: MetricContext = { summary, currency, hideValues: hideCurrencyValues };
  const selectedMetrics = metricPreferences
    .filter((pref) => pref.enabled && METRIC_CATALOG_BY_KEY[pref.key])
    .map((pref) => ({ ...METRIC_CATALOG_BY_KEY[pref.key], size: pref.size }));
  const largeMetrics = selectedMetrics.filter((entry) => entry.size === "large");
  const compactMetrics = selectedMetrics.filter((entry) => entry.size === "compact");

  return (
    <div className="h-dvh min-h-0 overflow-hidden bg-[#0b0f19] text-slate-100 flex flex-col font-mono w-full max-w-full min-w-0">
      {/* Application Menu Bar (Native HTML Menu for Linux) */}
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
        onRefresh={() => loadData(true)}
        isRefreshing={isRefreshing}
        onReload={handleReload}
        onAnalyzePortfolio={() => setIsAnalyzeModalOpen(true)}
        onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
        onQuit={handleQuitApp}
        isAssistantOpen={isAssistantOpen}
        onToggleAssistant={handleToggleAssistant}
        updateInfo={updateInfo}
        onCheckForUpdates={() => handleOpenSettings("about")}
        zoomLevel={zoomLevel}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
      />

      {/* Main Content Area & Assistant Sidebar */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {/* Main Menu / Navigation Bar (Header) - pushed when assistant sidebar is shown */}
          <Header
            currency={currency}
            onChangeCurrency={setCurrency}
            activePortfolio={activePortfolio}
            portfolios={portfolios}
            onChangePortfolio={handleSelectPortfolio}
            onOpenManagePortfolios={handleOpenManagePortfolios}
            onRefresh={() => loadData(true)}
            isRefreshing={isRefreshing}
            onOpenSettings={handleOpenSettings}
            lastUpdated={summary?.lastUpdated}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            activeView={view}
            onNavigateDashboard={handleNavigateDashboard}
            reportsCount={reports.length}
            transactionsCount={transactions.length}
            isAssistantOpen={isAssistantOpen}
            onToggleAssistant={handleToggleAssistant}
          />

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
          <ChangelogModal
            isOpen={isChangelogModalOpen && Boolean(updateInfo?.hasUpdate)}
            onClose={() => setIsChangelogModalOpen(false)}
            latestVersion={updateInfo?.latestVersion || ""}
            currentVersion={appVersion}
            releaseName={updateInfo?.releaseName || `v${updateInfo?.latestVersion || ""}`}
            releaseUrl={updateInfo?.releaseUrl || `https://github.com/cgeosoft/portfolio/releases`}
            releaseNotes={updateInfo?.releaseNotes || ""}
          />

          {/* Main View Router */}
          {view === "settings" && (
        <main className="flex-1 w-full container max-w-screen-xl mx-auto px-2 sm:px-6 lg:px-8 pt-2 pb-6 sm:pb-8 overflow-y-auto min-h-0 custom-scrollbar">
          <SettingsPage
            onBack={() => handleNavigateDashboard()}
            initialSection={settingsSection}
            portfolios={portfolios}
            activePortfolio={activePortfolio}
            onSelectPortfolio={handleSelectPortfolio}
            onPortfolioCreated={handlePortfolioCreated}
            onPortfolioUpdated={handlePortfolioUpdated}
            onPortfolioDeleted={handlePortfolioDeleted}
            onMetricsSaved={handleMetricsSaved}
          />
        </main>
      )}

      {view === "portfolios" && (
        <main className="flex-1 w-full container max-w-screen-xl mx-auto px-2 sm:px-6 lg:px-8 pt-2 pb-6 sm:pb-8 overflow-y-auto min-h-0 custom-scrollbar">
          <SettingsPage
            onBack={() => handleNavigateDashboard()}
            initialSection="portfolios"
            portfolios={portfolios}
            activePortfolio={activePortfolio}
            onSelectPortfolio={handleSelectPortfolio}
            onPortfolioCreated={handlePortfolioCreated}
            onPortfolioUpdated={handlePortfolioUpdated}
            onPortfolioDeleted={handlePortfolioDeleted}
            onMetricsSaved={handleMetricsSaved}
          />
        </main>
      )}

      {view === "terms" && (
        <main className="flex-1 w-full container max-w-screen-2xl mx-auto px-2 sm:px-6 lg:px-8 pt-2 pb-6 sm:pb-8 flex flex-col min-h-0 overflow-y-auto custom-scrollbar">
          <TermsPage onBack={() => handleNavigateDashboard()} webpageUrl={webpageUrl} />
        </main>
      )}

      {view === "dashboard" && (
        <main
          className={`flex-1 w-full container max-w-screen-2xl mx-auto px-2 sm:px-6 lg:px-8 pt-2 space-y-6 min-w-0 ${
            activeTab === "transactions" || activeTab === "reports"
              ? "flex flex-col h-full min-h-0 pb-2 sm:pb-3 overflow-hidden"
              : "pb-6 sm:pb-8 overflow-y-auto min-h-0 custom-scrollbar"
          }`}
        >
          {/* TAB: OVERVIEW (Charts & Holdings) */}
          {activeTab === "overview" && (
            <>
              {/* Selected Metrics (configured in Settings > Metrics) */}
              <div className="flex items-center justify-between gap-3 min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono truncate">
                  Portfolio Metrics
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenSettings("metrics")}
                  className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md border border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-[#DD3C73] hover:border-[#DD3C73]/40 hover:bg-[#DD3C73]/10 transition-all cursor-pointer shrink-0"
                  title="Choose the metrics of this portfolio"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Customize Metrics</span>
                </button>
              </div>

              {largeMetrics.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {largeMetrics.map((entry) => {
                    const MetricIcon = entry.icon;
                    return (
                      <StatCard
                        key={entry.key}
                        title={entry.title}
                        value={entry.getValue(metricContext)}
                        subValue={entry.getSubValue?.(metricContext)}
                        icon={<MetricIcon className={`w-5 h-5 ${entry.iconClass}`} />}
                        onInfo={() => handleOpenMetricModal(entry.infoKey)}
                      />
                    );
                  })}
                </div>
              )}

              {compactMetrics.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-4 rounded-2xl bg-[#111726]/60 border border-[#1e293b] text-xs">
                  {compactMetrics.map((entry) => (
                    <div key={entry.key} className="min-w-0">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1 min-w-0">
                        <span className="truncate whitespace-nowrap" title={entry.title}>
                          {entry.compactTitle}
                        </span>
                        <button
                          onClick={() => handleOpenMetricModal(entry.infoKey)}
                          className="hover:text-slate-300 shrink-0"
                          aria-label={`Explanation for ${entry.title}`}
                        >
                          <Info className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      <div
                        className={`font-bold mt-0.5 truncate ${
                          entry.getCompactValueClass?.(metricContext) || "text-slate-200"
                        }`}
                      >
                        {entry.getValue(metricContext)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {largeMetrics.length === 0 && compactMetrics.length === 0 && (
                <div className="p-6 rounded-2xl bg-[#111726]/60 border border-[#1e293b] text-center space-y-3">
                  <div className="text-xs text-slate-400 font-mono">
                    No metrics are selected for this portfolio.
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenSettings("metrics")}
                    className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider font-mono"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Open Metrics Marketplace</span>
                  </button>
                </div>
              )}

              {/* Sponsor Banner Box */}
              <SponsorBannerCard webpageUrl={webpageUrl} devEmail={devEmail} />

              {/* Charts & Allocation Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 min-w-0">
                  <PortfolioChartCard chartHistory={chartHistory} currency={currency} hideValues={hideCurrencyValues} />
                </div>
                <div className="min-w-0">
                  <AllocationCard
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
              />
            </>
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

        {/* Assistant Sidebar (Persistent across all views & tabs) */}
        <AssistantSidebar
          isOpen={isAssistantOpen}
          onClose={() => setIsAssistantOpen(false)}
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
          onClearMessages={handleClearChat}
          isLoading={isChatLoading}
          error={chatError}
          activeProvider={assistantProvider}
          activeModel={assistantModel}
        />
      </div>

      {/* Bottom Status Bar */}
      <BottomBar
        version={appVersion}
        lastQuotesSync={summary?.lastUpdated || lastQuotesSync}
        onOpenTerms={handleOpenTerms}
        onSyncQuotes={handleSyncQuotes}
        isSyncingQuotes={isRefreshing}
        hideCurrencyValues={hideCurrencyValues}
        onToggleHideCurrency={toggleHideCurrencyValues}
        updateInfo={updateInfo}
        onOpenUpdate={() => setIsChangelogModalOpen(true)}
      />

      {/* Modals */}
      <SetupWizardModal
        isOpen={isSetupWizardOpen}
        onComplete={handleSetupComplete}
        onClose={() => setIsSetupWizardOpen(false)}
      />

      <TransactionModal
        isOpen={isTxModalOpen}
        onClose={() => {
          setIsTxModalOpen(false);
          setEditingTx(null);
        }}
        onSave={handleSaveTransaction}
        transaction={editingTx}
      />

      <ImportCsvModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        portfolioId={activePortfolioId || undefined}
        baseCurrency={currency}
        onSuccess={() => loadData(true)}
      />

      <AnalyzePortfolioModal
        isOpen={isAnalyzeModalOpen}
        onClose={() => setIsAnalyzeModalOpen(false)}
        portfolioData={portfolioData}
        portfolioId={activePortfolioId || undefined}
        hideCurrencyValues={hideCurrencyValues}
        onReportGenerated={async () => {
          await loadReports();
          handleTabChange("reports");
        }}
      />

      <MetricInfoModal
        isOpen={isMetricModalOpen}
        onClose={() => setIsMetricModalOpen(false)}
        selectedMetricKey={selectedMetricKey}
        onSelectMetricKey={setSelectedMetricKey}
        summary={summary}
        currency={currency}
        hideCurrencyValues={hideCurrencyValues}
      />

      <CreatePortfolioModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onPortfolioCreated={handlePortfolioCreated}
      />

      <ExportPortfolioModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        portfolio={activePortfolio}
      />
    </div>
  );
}
