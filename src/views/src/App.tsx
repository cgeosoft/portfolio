import { useState, useEffect, useCallback } from "react";
import type {
  FinancialPortfolioData,
  PortfolioTransaction,
  PortfolioReport,
  PortfolioItem,
} from "../../types/portfolio";
import { Header, type PortfolioTabKey } from "./components/layout/Header";
import { AppMenuBar } from "./components/layout/AppMenuBar";
import { AboutModal } from "./components/common/AboutModal";
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
import { SetupWizardModal } from "./components/common/SetupWizardModal";
import { SettingsPage } from "./components/settings/SettingsPage";
import { ManagePortfoliosPage } from "./components/portfolio/ManagePortfoliosPage";
import { MetricInfoModal, type MetricKey } from "./components/portfolio/MetricInfoModal";
import { fmtCurrency, fmtPercent } from "./components/portfolio/utils";
import type { DesktopConfig, GetPortfoliosResponse } from "../../shared/rpc-types";
import { rpc } from "./rpc";
import {
  Wallet,
  TrendingUp,
  DollarSign,
  PiggyBank,
  RefreshCw,
  PieChart,
  FileText,
  History,
  Coins,
  Layers,
  CircleDollarSign,
  Flame,
  Info,
} from "lucide-react";

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
  const [view, setView] = useState<"dashboard" | "settings" | "portfolios">(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.toLowerCase();
      if (hash === "#portfolios") return "portfolios";
      if (hash === "#settings") return "settings";
    }
    return "dashboard";
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

  const handleOpenSettings = useCallback(() => {
    setView("settings");
    if (typeof window !== "undefined") {
      const newHash = "#settings";
      if (window.location.hash !== newHash) {
        window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${newHash}`);
      }
    }
  }, []);

  const handleOpenManagePortfolios = useCallback(() => {
    setView("portfolios");
    if (typeof window !== "undefined") {
      const newHash = "#portfolios";
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
        setView("portfolios");
      } else if (hash === "#settings") {
        setView("settings");
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
  const [reports, setReports] = useState<PortfolioReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currency, setCurrency] = useState("EUR");

  // Privacy Mode Toggle State
  const [hideCurrencyValues, setHideCurrencyValues] = useState<boolean>(false);

  const toggleHideCurrencyValues = () => {
    setHideCurrencyValues((prev) => {
      const next = !prev;
      rpc.request.saveConfig({ hideCurrencyValues: next }).catch(() => {});
      return next;
    });
  };

  // Modals state
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<PortfolioTransaction | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAnalyzeModalOpen, setIsAnalyzeModalOpen] = useState(false);
  const [isMetricModalOpen, setIsMetricModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [selectedMetricKey, setSelectedMetricKey] = useState<MetricKey>("totalGain");

  const handleOpenMetricModal = useCallback((metricKey: MetricKey) => {
    setSelectedMetricKey(metricKey);
    setIsMetricModalOpen(true);
  }, []);

  const handleQuitApp = useCallback(async () => {
    try {
      await rpc.request.quitApp({});
    } catch {
      if (typeof window !== "undefined") {
        window.close();
      }
    }
  }, []);

  // Safe retry helper for startup RPC handshakes
  const callWithRetry = async <T,>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> => {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
        }
      }
    }
    throw lastError;
  };

  // Check setup status and load initial config on mount
  useEffect(() => {
    const initApp = async () => {
      try {
        const config = await callWithRetry<DesktopConfig>(() => rpc.request.getConfig({}));
        if (config.baseCurrency) setCurrency(config.baseCurrency);
        if (config.hideCurrencyValues !== undefined) setHideCurrencyValues(config.hideCurrencyValues);

        if (!config.setupCompleted) {
          setIsSetupWizardOpen(true);
        }
      } catch (e) {
        console.error("Failed to load initial config:", e);
      }
    };
    initApp();
  }, []);

  // Load portfolios list
  const loadPortfolios = useCallback(async () => {
    try {
      const data = await callWithRetry<GetPortfoliosResponse>(() => rpc.request.getPortfolios({}));
      const list: PortfolioItem[] = data.portfolios || [];
      setPortfolios(list);

      if (list.length > 0) {
        const targetId =
          (activePortfolioId && list.some((p) => p.id === activePortfolioId) && activePortfolioId) ||
          list[0]!.id;

        if (targetId !== activePortfolioId) {
          setActivePortfolioId(targetId);
          if (typeof localStorage !== "undefined") {
            localStorage.setItem("selected_portfolio_id", targetId);
          }
        }
      }
    } catch (e) {
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
      const res = await rpc.request.getReports({ portfolioId: activePortfolioId });
      setReports(res.reports || []);
    } catch (e) {
      console.error("Error loading reports:", e);
    }
  }, [activePortfolioId]);

  // Fetch portfolio data
  const loadData = useCallback(
    async (forceRefresh = false) => {
      if (!activePortfolioId) return;
      if (forceRefresh) setIsRefreshing(true);
      else setIsLoading(true);

      try {
        const data = await rpc.request.getPortfolioData({
          portfolioId: activePortfolioId,
          baseCurrency: currency,
          refresh: forceRefresh,
        });
        setPortfolioData(data);
      } catch (e) {
        console.error("Error loading portfolio data:", e);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
      void loadReports();
    },
    [activePortfolioId, currency, loadReports],
  );

  useEffect(() => {
    if (activePortfolioId) {
      loadData();
    }
  }, [activePortfolioId, currency, loadData]);

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
        void loadData(true);
        return;
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
  }, [handleOpenSettings, handleQuitApp, loadData]);

  if (isLoading && !portfolioData && view === "dashboard") {
    return (
      <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col font-mono">
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
          onAnalyzePortfolio={() => setIsAnalyzeModalOpen(true)}
          onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
          onOpenAbout={() => setIsAboutModalOpen(true)}
          onQuit={handleQuitApp}
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
          hideCurrencyValues={hideCurrencyValues}
          onToggleHideCurrency={toggleHideCurrencyValues}
        />
        <div className="flex-1 flex flex-col items-center justify-center space-y-3 p-8">
          <RefreshCw className="w-8 h-8 text-[#DD3C73] animate-spin" />
          <p className="text-xs text-slate-400 font-mono tracking-wider uppercase">
            Synchronizing Portfolio &amp; Market Quotes...
          </p>
        </div>
      </div>
    );
  }

  const summary = portfolioData?.summary;
  const holdings = portfolioData?.holdings || [];
  const chartHistory = portfolioData?.chartHistory || [];
  const transactions = portfolioData?.transactions || [];

  const isStartUp = (summary?.totalGainSinceStartDollar ?? 0) >= 0;
  const isDayUp = (summary?.dayGainLossDollar ?? 0) >= 0;

  return (
    <div
      className={`bg-[#0b0f19] text-slate-100 flex flex-col font-mono w-full max-w-full overflow-x-hidden min-w-0 ${
        view === "dashboard" && (activeTab === "transactions" || activeTab === "reports")
          ? "h-dvh min-h-0 overflow-hidden"
          : "min-h-screen"
      }`}
    >
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
        onAnalyzePortfolio={() => setIsAnalyzeModalOpen(true)}
        onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
        onOpenAbout={() => setIsAboutModalOpen(true)}
        onQuit={handleQuitApp}
      />

      {/* Top Header */}
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
        hideCurrencyValues={hideCurrencyValues}
        onToggleHideCurrency={toggleHideCurrencyValues}
      />

      {/* Main View Router */}
      {view === "settings" && (
        <main className="flex-1 w-full max-w-full p-4 sm:p-6 lg:p-8">
          <SettingsPage onBack={() => handleNavigateDashboard()} />
        </main>
      )}

      {view === "portfolios" && (
        <main className="flex-1 w-full max-w-full">
          <ManagePortfoliosPage
            portfolios={portfolios}
            activePortfolio={activePortfolio}
            onSelectPortfolio={handleSelectPortfolio}
            onPortfolioCreated={handlePortfolioCreated}
            onPortfolioUpdated={handlePortfolioUpdated}
            onPortfolioDeleted={handlePortfolioDeleted}
            onBack={() => handleNavigateDashboard()}
          />
        </main>
      )}

      {view === "dashboard" && (
        <main
          className={`flex-1 w-full max-w-full p-4 sm:p-6 lg:p-8 space-y-6 min-w-0 ${
            activeTab === "transactions" || activeTab === "reports" ? "flex flex-col h-full min-h-0 pb-2" : ""
          }`}
        >
          {/* TAB: OVERVIEW (Charts & Holdings) */}
          {activeTab === "overview" && (
            <>
              {/* Primary Stat Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Total Portfolio Value"
                  value={fmtCurrency(summary?.totalPortfolioValue, currency, hideCurrencyValues)}
                  subValue={
                    summary?.totalGainSinceStartDollar !== undefined
                      ? `${isStartUp ? "+" : ""}${fmtCurrency(
                          summary.totalGainSinceStartDollar,
                          currency,
                          hideCurrencyValues,
                        )} (${isStartUp ? "+" : ""}${fmtPercent(summary.totalGainSinceStartPercent)})`
                      : undefined
                  }
                  icon={<Wallet className="w-5 h-5 text-[#DD3C73]" />}
                  onInfo={() => handleOpenMetricModal("valuation")}
                />
                <StatCard
                  title="Day Gain / Loss"
                  value={`${isDayUp ? "+" : ""}${fmtCurrency(
                    summary?.dayGainLossDollar,
                    currency,
                    hideCurrencyValues,
                  )}`}
                  subValue={`${isDayUp ? "+" : ""}${fmtPercent(summary?.dayGainLossPercent)} today`}
                  icon={<TrendingUp className="w-5 h-5 text-[#A7E2C0]" />}
                  onInfo={() => handleOpenMetricModal("todayReturn")}
                />
                <StatCard
                  title="Lifetime Total Gain"
                  value={`${isStartUp ? "+" : ""}${fmtCurrency(
                    summary?.totalGainSinceStartDollar,
                    currency,
                    hideCurrencyValues,
                  )}`}
                  subValue={`${isStartUp ? "+" : ""}${fmtPercent(
                    summary?.totalGainSinceStartPercent,
                  )} all-time return`}
                  icon={<Flame className="w-5 h-5 text-[#DD3C73]" />}
                  onInfo={() => handleOpenMetricModal("totalGain")}
                />
                <StatCard
                  title="Cash Liquidity"
                  value={fmtCurrency(summary?.cashBalance, currency, hideCurrencyValues)}
                  subValue={`${fmtPercent(summary?.cashWeightPercent)} portfolio allocation`}
                  icon={<CircleDollarSign className="w-5 h-5 text-[#243C8F]" />}
                  onInfo={() => handleOpenMetricModal("cashReserves")}
                />
              </div>

              {/* Secondary Capital Metrics Panel */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-4 rounded-2xl bg-[#111726]/60 border border-[#1e293b] text-xs">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <span>Invested Capital</span>
                    <button onClick={() => handleOpenMetricModal("capitalInjected")} className="hover:text-slate-300">
                      <Info className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div className="font-bold text-slate-200 mt-0.5">
                    {fmtCurrency(summary?.totalCashInjected, currency, hideCurrencyValues)}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <span>Current Holdings Cost</span>
                    <button onClick={() => handleOpenMetricModal("valuation")} className="hover:text-slate-300">
                      <Info className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div className="font-bold text-slate-200 mt-0.5">
                    {fmtCurrency(summary?.totalCost, currency, hideCurrencyValues)}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <span>Realized P&amp;L</span>
                    <button onClick={() => handleOpenMetricModal("realizedIncome")} className="hover:text-slate-300">
                      <Info className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div
                    className={`font-bold mt-0.5 ${
                      (summary?.realizedPnL ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {(summary?.realizedPnL ?? 0) >= 0 ? "+" : ""}
                    {fmtCurrency(summary?.realizedPnL, currency, hideCurrencyValues)}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <span>Dividends &amp; Interest</span>
                    <button onClick={() => handleOpenMetricModal("dividends")} className="hover:text-slate-300">
                      <Info className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div className="font-bold text-emerald-400 mt-0.5">
                    +{fmtCurrency((summary?.totalDividends ?? 0) + (summary?.totalInterest ?? 0), currency, hideCurrencyValues)}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <span>Broker Fees</span>
                    <button onClick={() => handleOpenMetricModal("realizedIncome")} className="hover:text-slate-300">
                      <Info className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div className="font-bold text-slate-400 mt-0.5">
                    {fmtCurrency(summary?.totalFees, currency, hideCurrencyValues)}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <span>Taxes Withheld</span>
                    <button onClick={() => handleOpenMetricModal("realizedIncome")} className="hover:text-slate-300">
                      <Info className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div className="font-bold text-slate-400 mt-0.5">
                    {fmtCurrency(summary?.totalTaxes, currency, hideCurrencyValues)}
                  </div>
                </div>
              </div>

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

      {/* Modals */}
      <SetupWizardModal
        isOpen={isSetupWizardOpen}
        onComplete={handleSetupComplete}
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

      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />
    </div>
  );
}
