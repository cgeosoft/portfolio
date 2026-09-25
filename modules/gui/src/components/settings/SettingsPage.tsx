import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Settings,
  Sliders,
  TrendingUp,
  Bot,
  Info,
  Cpu,
  Globe,
  Key,
  EyeOff,
  Eye,
  RefreshCw,
  PlayCircle,
  CheckCircle2,
  AlertCircle,
  Plus,
  Edit3,
  Trash2,
  Download,
  Calendar,
  Search,
  Keyboard,
  Sparkles,
  Database,
  LifeBuoy,
  Check,
  ExternalLink,
  Sun,
  Moon,
  Terminal,
} from "lucide-react";
import { Select } from "../common/Select";
import { rpc } from "../../rpc";
import type { PortfolioItem } from "portfolio-shared/portfolio";
import type { AppUpdateInfo, ClaudeCliStatusResponse, DesktopConfig, AppTheme } from "portfolio-shared/api-types";
import { CreatePortfolioModal } from "../portfolio/CreatePortfolioModal";
import { EditPortfolioModal } from "../portfolio/EditPortfolioModal";
import { DeletePortfolioModal } from "../portfolio/DeletePortfolioModal";
import { ExportPortfolioModal } from "../portfolio/ExportPortfolioModal";
import { TestLlmModal } from "./TestLlmModal";
import { DataProvidersSection } from "./DataProvidersSection";
import { AccessRows } from "./AccessSection";
import { SettingsFields } from "./SettingsFields";
import { openExternal, WEBPAGE_EMAIL } from "../../environment";
import { CLAUDE_CLI_MODELS, DEFAULT_OPENAI_COMPATIBLE_URL } from "portfolio-shared/llm-defaults";
import { SECRET_MASK } from "portfolio-shared/config-types";

export type SettingsSection = "general" | "portfolios" | "providers" | "assistant" | "about";

type LlmProviderId = "openai-compatible" | "claude-cli";

interface LlmProviderOption {
  id: LlmProviderId;
  name: string;
  badge: string;
  description: string;
}

const LLM_PROVIDERS: LlmProviderOption[] = [
  {
    id: "openai-compatible",
    name: "OpenAI Compatible",
    badge: "HTTP API",
    description:
      "Any local server or cloud API that speaks OpenAI chat completions: llama.cpp, Ollama, LM Studio, vLLM, OpenAI, Groq, OpenRouter and others.",
  },
  {
    id: "claude-cli",
    name: "Claude CLI",
    badge: "Claude Subscription",
    description: "Runs the Claude Code CLI installed on this machine with your Claude subscription. No API key needed.",
  },
];

/** Provider ids from earlier releases were migrated to "openai-compatible" by the service. */
const toProviderId = (raw: string | undefined): LlmProviderId => (raw === "claude-cli" ? "claude-cli" : "openai-compatible");

const SECTIONS = [
  {
    id: "general" as const,
    label: "General",
    description: "Refresh, startup & app lock",
    icon: Sliders,
  },
  {
    id: "portfolios" as const,
    label: "Portfolios",
    description: "Ledgers & asset management",
    icon: TrendingUp,
  },
  {
    id: "providers" as const,
    label: "Data Providers",
    description: "Market quotes, news & FX",
    icon: Database,
  },
  {
    id: "assistant" as const,
    label: "Assistant",
    description: "AI & LLM inference model",
    icon: Bot,
  },
  {
    id: "about" as const,
    label: "About",
    description: "App details & shortcuts",
    icon: Info,
  },
];

const SHORTCUTS = [
  { key: "Ctrl + N", desc: "Create New Portfolio" },
  { key: "Ctrl + T", desc: "Add Transaction" },
  { key: "Ctrl + I", desc: "Import CSV Data" },
  { key: "Ctrl + E", desc: "Export Active Portfolio" },
  { key: "Ctrl + +", desc: "Zoom In" },
  { key: "Ctrl + -", desc: "Zoom Out" },
  { key: "Ctrl + 0", desc: "Reset Zoom" },
  { key: "Ctrl + R", desc: "Reload Page" },
  { key: "Ctrl + H", desc: "Toggle Privacy Mode (Mask Values)" },
  { key: "Ctrl + J", desc: "Toggle Assistant Sidebar" },
  { key: "Ctrl + Shift + L", desc: "Switch Light / Dark Theme" },
  { key: "Ctrl + ,", desc: "Open Preferences" },
  { key: "Ctrl + Q", desc: "Quit Application" },
];

interface SettingsPageProps {
  onBack: () => void;
  initialSection?: SettingsSection;
  portfolios?: PortfolioItem[];
  activePortfolio?: PortfolioItem | null;
  onSelectPortfolio?: (id: string) => void;
  onPortfolioCreated?: (newPortfolio: PortfolioItem) => void;
  onPortfolioUpdated?: (updated: PortfolioItem) => void;
  onPortfolioDeleted?: (id: string) => void;
  theme?: AppTheme;
  onChangeTheme?: (theme: AppTheme) => void;
  /** Fires when the app lock is turned on or off under Access. */
  onPinEnabledChange?: (enabled: boolean) => void;
  /** About → Report an Issue: opens the support ticket form (the Help menu has the same item). */
  onReportIssue?: () => void;
}

export function SettingsPage({
  onBack,
  initialSection = "general",
  portfolios = [],
  activePortfolio = null,
  onSelectPortfolio,
  onPortfolioCreated,
  onPortfolioUpdated,
  onPortfolioDeleted,
  theme,
  onChangeTheme,
  onPinEnabledChange,
  onReportIssue,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);

  // General settings state
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [appPaths, setAppPaths] = useState<{ data: string; logs: string } | null>(null);

  // Assistant settings state
  const [reportProvider, setReportProvider] = useState<LlmProviderId>("openai-compatible");
  const [reportModel, setReportModel] = useState("");
  const [reportApiKey, setReportApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [reportBaseUrl, setReportBaseUrl] = useState(DEFAULT_OPENAI_COMPATIBLE_URL);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [serverModels, setServerModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCliStatusResponse | null>(null);
  const [isCheckingClaude, setIsCheckingClaude] = useState(false);

  // Full desktop config state for data providers and general settings
  const [fullConfig, setFullConfig] = useState<DesktopConfig | null>(null);

  const handleUpdateConfig = (updates: Partial<DesktopConfig>) => {
    saveConfig(updates);
    setFullConfig((prev) => (prev ? ({ ...prev, ...updates } as DesktopConfig) : null));
  };

  // Portfolios management state
  const [portfolioSearch, setPortfolioSearch] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingPortfolio, setEditingPortfolio] = useState<PortfolioItem | null>(null);
  const [deletingPortfolio, setDeletingPortfolio] = useState<PortfolioItem | null>(null);
  const [exportingPortfolio, setExportingPortfolio] = useState<PortfolioItem | null>(null);
  const [portfolioStatusMsg, setPortfolioStatusMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  /** Lists the models of the OpenAI-compatible server and keeps the saved one when it is still offered. */
  const fetchServerModels = async (url: string, key: string) => {
    setIsFetchingModels(true);
    try {
      const res = await rpc.request.getProviderModels({ provider: "openai-compatible", baseUrl: url, apiKey: key });
      setServerModels(res.models || []);
    } catch {
      setServerModels([]); // server offline or not responding
    } finally {
      setIsFetchingModels(false);
    }
  };

  /** Checks that the Claude CLI is installed and signed in. */
  const checkClaudeCli = async () => {
    setIsCheckingClaude(true);
    try {
      setClaudeStatus(await rpc.request.getClaudeCliStatus());
    } catch (err) {
      setClaudeStatus({ installed: false, loggedIn: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsCheckingClaude(false);
    }
  };

  const saveModel = (provider: LlmProviderId, model: string) => {
    setReportModel(model);
    saveConfig({ llmModel: model, llmModels: { ...(fullConfig?.llmModels || {}), [provider]: model } });
  };

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  useEffect(() => {
    rpc.request.getConfig({}).then((config: any) => {
      const desktopConfig = config as DesktopConfig;
      setFullConfig(desktopConfig);
      const provider = toProviderId(desktopConfig.llmProvider);
      const isCurrent = desktopConfig.llmProvider === provider;
      setReportProvider(provider);

      const savedModel = desktopConfig.llmModels?.[provider] || (isCurrent ? desktopConfig.llmModel : "") || "";
      setReportModel(savedModel);
      if (provider === "claude-cli" && savedModel && !CLAUDE_CLI_MODELS.includes(savedModel)) setIsCustomModel(true);

      const savedKey = desktopConfig.llmApiKeys?.[provider] || (isCurrent ? desktopConfig.llmApiKey : "") || "";
      setReportApiKey(savedKey);

      const savedUrl =
        desktopConfig.llmBaseUrls?.[provider] || (isCurrent ? desktopConfig.llmBaseUrl : "") || DEFAULT_OPENAI_COMPATIBLE_URL;
      setReportBaseUrl(savedUrl);


      if (provider === "claude-cli") checkClaudeCli();
      else fetchServerModels(savedUrl, savedKey);
    });

    rpc.request.getAppInfo({}).then((info) => {
      if (info?.version) setAppVersion(info.version);
      if (info?.paths) setAppPaths(info.paths);
    }).catch(() => {});

    rpc.request.getUpdateInfo({}).then((res: any) => {
      if (res) setUpdateInfo(res);
    }).catch(() => {});
  }, []);

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdates(true);
    try {
      const res = await rpc.request.checkForUpdates({ force: true });
      setUpdateInfo(res);
    } catch (err) {
      console.warn("Manual update check failed:", err);
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const saveConfig = async (updates: any) => {
    setFullConfig((prev) => (prev ? { ...prev, ...updates } : prev));
    await rpc.request.saveConfig(updates);
  };

  const currentTheme: AppTheme = theme ?? (fullConfig?.theme as AppTheme) ?? "dark";

  const handleThemeChange = (newTheme: AppTheme) => {
    onChangeTheme?.(newTheme);
    saveConfig({ theme: newTheme });
  };

  const handleProviderSelect = (newProvider: LlmProviderId) => {
    setReportProvider(newProvider);
    const nextModel = fullConfig?.llmModels?.[newProvider] || "";
    setReportModel(nextModel);
    setIsCustomModel(newProvider === "claude-cli" && Boolean(nextModel) && !CLAUDE_CLI_MODELS.includes(nextModel));

    if (newProvider === "claude-cli") {
      saveConfig({ llmProvider: newProvider, llmModel: nextModel, llmBaseUrl: "", llmApiKey: "" });
      checkClaudeCli();
      return;
    }

    const nextBaseUrl = fullConfig?.llmBaseUrls?.[newProvider] || DEFAULT_OPENAI_COMPATIBLE_URL;
    const nextApiKey = fullConfig?.llmApiKeys?.[newProvider] || "";
    setReportBaseUrl(nextBaseUrl);
    setReportApiKey(nextApiKey);
    saveConfig({ llmProvider: newProvider, llmModel: nextModel, llmBaseUrl: nextBaseUrl, llmApiKey: nextApiKey });
    fetchServerModels(nextBaseUrl, nextApiKey);
  };

  const handleConfirmDeletePortfolio = async (p: PortfolioItem) => {
    setPortfolioStatusMsg(null);
    const data = await rpc.request.deletePortfolio({ portfolioId: p.id });
    if (!data.success) {
      throw new Error("Failed to delete portfolio");
    }

    if (onPortfolioDeleted) {
      onPortfolioDeleted(p.id);
    }
    setPortfolioStatusMsg({
      type: "success",
      text: `Portfolio "${p.name}" and all associated data were successfully removed.`,
    });
    setTimeout(() => setPortfolioStatusMsg(null), 3500);
  };

  const filteredPortfolios = (portfolios || []).filter((p) => {
    const term = portfolioSearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      (p.description || "").toLowerCase().includes(term) ||
      p.baseCurrency.toLowerCase().includes(term)
    );
  });

  const currentProvider = LLM_PROVIDERS.find((p) => p.id === reportProvider) ?? LLM_PROVIDERS[0]!;
  const isClaudeCli = reportProvider === "claude-cli";
  const modelOptions = isClaudeCli ? CLAUDE_CLI_MODELS : serverModels;
  // A saved model the list no longer offers stays selectable instead of silently switching.
  const availableModels = reportModel && !isCustomModel && !modelOptions.includes(reportModel) ? [reportModel, ...modelOptions] : modelOptions;
  // Without a model list the only way to name a model is to type it.
  const showModelInput = isCustomModel || (!isClaudeCli && serverModels.length === 0);

  return (
    <div className="container max-w-screen-xl mx-auto w-full space-y-6 font-mono">

      {/* Main Container: Left Sidebar + Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
        {/* Left Navigation Sidebar */}
        <aside className="w-full">
          <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Settings className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>Preferences</span>
          </div>

          <nav className="space-y-1 mt-1">
            {SECTIONS.map((sec) => {
              const isActive = activeSection === sec.id;
              const Icon = sec.icon;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-mono transition-colors cursor-pointer ${
                    isActive
                      ? "bg-[#DD3C73]/15 text-[#DD3C73] font-semibold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-[#DD3C73]" : "text-slate-400"}`} />
                  <span>{sec.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right/Center Content Area */}
        <div className="min-w-0 space-y-6">
          {/* SECTION 1: GENERAL */}
          {activeSection === "general" && (
            <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-6">
              <div className="border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-wider">
                  <Sliders className="w-4 h-4 text-[#DD3C73]" />
                  <span>General Configuration</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Manage interface theme, background quote updates, startup behavior, telemetry, the app lock and remote connections.
                </p>
              </div>

              {/* 1. Interface Theme */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                    {currentTheme === "light" ? (
                      <Sun className="w-3.5 h-3.5 text-[#DD3C73]" />
                    ) : (
                      <Moon className="w-3.5 h-3.5 text-[#DD3C73]" />
                    )}
                    <span>Interface Theme</span>
                  </label>
                  <span className="text-[10px] text-slate-500 font-mono capitalize">
                    {currentTheme}
                  </span>
                </div>

                <Select
                  value={currentTheme}
                  onChange={(e) => {
                    const val = e.target.value as AppTheme;
                    handleThemeChange(val);
                  }}
                  selectSize="lg"
                  icon={currentTheme === "light" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  aria-label="Interface Theme"
                >
                  <option value="dark">Dark Theme (Terminal Default)</option>
                  <option value="light">Light Theme (Daylight)</option>
                  <option value="system">Follow System Appearance</option>
                </Select>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Choose between high-contrast dark terminal mode, clean daylight theme, or automatic synchronization with your system appearance.
                </p>
              </div>

              <SettingsFields section="general" />

              <AccessRows onPinEnabledChange={onPinEnabledChange} />
            </div>
          )}

          {/* SECTION 2: PORTFOLIOS */}
          {activeSection === "portfolios" && (
            <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-widest min-w-0">
                    <TrendingUp className="w-4 h-4 text-[#DD3C73] shrink-0" />
                    <span>Portfolio Ledgers ({portfolios.length})</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    Manage financial ledgers, base currencies, and export data archives
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {portfolios.length > 3 && (
                    <div className="relative w-40 sm:w-48">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Search portfolios..."
                        value={portfolioSearch}
                        onChange={(e) => setPortfolioSearch(e.target.value)}
                        className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#DD3C73]/50 font-mono"
                      />
                    </div>
                  )}

                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider shadow-lg shadow-[#DD3C73]/10 font-mono"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Portfolio</span>
                  </button>
                </div>
              </div>

              {/* Status Alert Banner */}
              {portfolioStatusMsg && (
                <div
                  className={`p-3 text-xs rounded-xl flex items-center gap-2 ${
                    portfolioStatusMsg.type === "success"
                      ? "text-emerald-400 bg-emerald-950/40 border border-emerald-800/50"
                      : "text-rose-400 bg-rose-950/40 border border-rose-800/50"
                  }`}
                >
                  {portfolioStatusMsg.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{portfolioStatusMsg.text}</span>
                </div>
              )}

              {/* Portfolios Table */}
              <div className="overflow-hidden border border-slate-800/80 rounded-xl bg-slate-950/40">
                <div className="overflow-x-auto w-full custom-scrollbar">
                  <table className="w-full text-left text-xs font-mono border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider bg-slate-950/80">
                        <th className="py-3 px-4 font-semibold">Portfolio & Strategy</th>
                        <th className="py-3 px-4 font-semibold">Currency</th>
                        <th className="py-3 px-4 font-semibold">Created</th>
                        <th className="py-3 px-4 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {filteredPortfolios.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-slate-500 font-mono text-xs">
                            {portfolios.length === 0
                              ? "No portfolios created yet. Click 'New Portfolio' to establish your first ledger."
                              : "No portfolios match your search query."}
                          </td>
                        </tr>
                      ) : (
                        filteredPortfolios.map((p) => {
                          const isActive = activePortfolio?.id === p.id;
                          const createdFormatted = p.createdAt
                            ? new Date(p.createdAt).toLocaleDateString(undefined, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })
                            : "-";

                          return (
                            <tr
                              key={p.id}
                              className={`hover:bg-slate-800/25 transition-colors group ${
                                isActive ? "bg-slate-900/40" : ""
                              }`}
                            >
                              {/* Column 1: Portfolio Name & Description */}
                              <td className="py-3.5 px-4 min-w-[220px]">
                                <div className="flex items-start gap-2.5">
                                  <div className="pt-1 shrink-0">
                                    {isActive ? (
                                      <div
                                        className="w-2 h-2 rounded-full bg-[#DD3C73] ring-4 ring-[#DD3C73]/20 shadow-sm shadow-[#DD3C73]"
                                        title="Active Portfolio"
                                      />
                                    ) : (
                                      <div className="w-2 h-2 rounded-full bg-slate-700 opacity-60" />
                                    )}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => onSelectPortfolio && onSelectPortfolio(p.id)}
                                        className="font-bold text-slate-100 text-xs sm:text-sm hover:text-[#DD3C73] transition-colors truncate text-left cursor-pointer"
                                        title={p.name}
                                      >
                                        {p.name}
                                      </button>
                                      {isActive && (
                                        <span className="text-[9px] uppercase tracking-wider font-bold text-[#DD3C73] bg-[#DD3C73]/10 border border-[#DD3C73]/30 px-1.5 py-0.2 rounded">
                                          Active
                                        </span>
                                      )}
                                    </div>
                                    {p.description ? (
                                      <p className="text-[11px] text-slate-400 truncate mt-0.5 max-w-md" title={p.description}>
                                        {p.description}
                                      </p>
                                    ) : (
                                      <p className="text-[11px] text-slate-600 italic mt-0.5">No description</p>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* Column 2: Currency */}
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span className="font-mono text-xs font-semibold text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                                  {p.baseCurrency}
                                </span>
                              </td>

                              {/* Column 3: Created Date */}
                              <td className="py-3.5 px-4 whitespace-nowrap text-slate-400 text-xs">
                                <div className="flex items-center gap-1.5 text-[11px]">
                                  <Calendar className="w-3 h-3 text-slate-500 shrink-0" />
                                  <span>{createdFormatted}</span>
                                </div>
                              </td>

                              {/* Column 4: Actions */}
                              <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    onClick={() => setExportingPortfolio(p)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-700/70 bg-slate-800/80 hover:bg-slate-700 hover:border-slate-600 text-xs font-semibold text-slate-50 transition-all cursor-pointer shadow-sm mr-1"
                                    title={`Export ${p.name} transactions and reports as ZIP`}
                                  >
                                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Export</span>
                                  </button>

                                  <button
                                    onClick={() => setEditingPortfolio(p)}
                                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-[#DD3C73] transition-colors cursor-pointer"
                                    title="Edit portfolio name and details"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    onClick={() => setDeletingPortfolio(p)}
                                    className="p-1.5 rounded-lg hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                                    title="Delete portfolio"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SECTION: DATA PROVIDERS */}
          {activeSection === "providers" && fullConfig && (
            <DataProvidersSection config={fullConfig} onUpdateConfig={handleUpdateConfig} />
          )}

          {/* SECTION 3: ASSISTANT */}
          {activeSection === "assistant" && (
            <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-5">
              <div className="border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-wider">
                  <Bot className="w-4 h-4 text-[#DD3C73]" />
                  <span>Assistant Engine</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Configure local or cloud inference providers for automated portfolio analysis briefings.
                </p>
              </div>

              {/* Provider Selection Dropdown: styled identically to inputs */}
              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5 text-[#DD3C73]" />
                  <span>Inference Provider</span>
                </label>
                <Select
                  value={reportProvider}
                  onChange={(e) => handleProviderSelect(toProviderId(e.target.value))}
                  selectSize="lg"
                  icon={<Bot className="w-4 h-4" />}
                  aria-label="Inference provider"
                >
                  {LLM_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.badge})
                    </option>
                  ))}
                </Select>
                <p className="text-[11px] text-slate-400 pt-1 leading-relaxed">{currentProvider.description}</p>
              </div>

              {/* Claude CLI status: checked on selection */}
              {isClaudeCli && (
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between">
                    <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-slate-400" />
                      <span>CLI Status</span>
                    </label>
                    <button
                      type="button"
                      onClick={checkClaudeCli}
                      disabled={isCheckingClaude}
                      className="text-[10px] text-slate-400 hover:text-[#DD3C73] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Check the Claude CLI again"
                    >
                      <RefreshCw className={`w-3 h-3 ${isCheckingClaude ? "animate-spin" : ""}`} />
                      <span>{isCheckingClaude ? "Checking..." : "Check Again"}</span>
                    </button>
                  </div>
                  {isCheckingClaude && !claudeStatus ? (
                    <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400">
                      Looking for the Claude CLI and its sign-in...
                    </div>
                  ) : claudeStatus?.installed && claudeStatus.loggedIn ? (
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2 text-[11px] text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
                      <span>{claudeStatus.message}</span>
                    </div>
                  ) : claudeStatus ? (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2 text-[11px] text-rose-300">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                      <div className="space-y-1">
                        <p>{claudeStatus.message}</p>
                        {!claudeStatus.installed && (
                          <button
                            type="button"
                            onClick={() => openExternal("https://code.claude.com/docs/en/setup")}
                            className="flex items-center gap-1 text-rose-200 hover:text-white underline underline-offset-2 cursor-pointer"
                          >
                            <span>Claude Code setup guide</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Model Identifier Dropdown */}
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-slate-400" />
                    <span>Model Identifier</span>
                  </label>
                  {!isClaudeCli && (
                    <button
                      type="button"
                      onClick={() => fetchServerModels(reportBaseUrl, reportApiKey)}
                      disabled={isFetchingModels}
                      className="text-[10px] text-slate-400 hover:text-[#DD3C73] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Fetch available models from endpoint"
                    >
                      <RefreshCw className={`w-3 h-3 ${isFetchingModels ? "animate-spin" : ""}`} />
                      <span>{isFetchingModels ? "Scanning Server..." : "Detect Models"}</span>
                    </button>
                  )}
                </div>

                {(isClaudeCli || serverModels.length > 0) && (
                  <Select
                    value={isCustomModel ? "__custom__" : reportModel}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__custom__") {
                        setIsCustomModel(true);
                      } else {
                        setIsCustomModel(false);
                        saveModel(reportProvider, val);
                      }
                    }}
                    selectSize="lg"
                    icon={<Cpu className="w-4 h-4" />}
                    aria-label="Model identifier"
                  >
                    <option value="">{isClaudeCli ? "Default (chosen by the CLI)" : "Default (chosen by the server)"}</option>
                    {availableModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option value="__custom__">Custom Model (Manual Entry)...</option>
                  </Select>
                )}

                {showModelInput && (
                  <div className="pt-2 animate-fade-in">
                    <input
                      type="text"
                      value={reportModel}
                      onChange={(e) => setReportModel(e.target.value)}
                      onBlur={(e) => saveModel(reportProvider, e.target.value.trim())}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      placeholder={isClaudeCli ? "e.g. claude-sonnet-5" : "e.g. llama-3.3-70b-versatile or leave empty for the server default"}
                      className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      {isClaudeCli
                        ? "Any model name or alias the Claude CLI accepts with --model."
                        : "Enter the model identifier expected by your inference endpoint."}
                    </p>
                  </div>
                )}
              </div>

              {/* Server Base URL and API Key: OpenAI-compatible only */}
              {!isClaudeCli && (
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-slate-400" />
                    <span>Server Base URL</span>
                  </label>
                  <div className="relative">
                    <Globe className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={reportBaseUrl}
                      onChange={(e) => setReportBaseUrl(e.target.value)}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        saveConfig({ llmBaseUrl: val, llmBaseUrls: { ...(fullConfig?.llmBaseUrls || {}), [reportProvider]: val } });
                        fetchServerModels(val, reportApiKey);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      placeholder={DEFAULT_OPENAI_COMPATIBLE_URL}
                      className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Examples: http://127.0.0.1:8080 (llama.cpp), http://127.0.0.1:11434/v1 (Ollama), https://api.openai.com/v1, https://api.groq.com/openai/v1
                  </p>
                </div>
              )}

              {!isClaudeCli && (
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-[#DD3C73]" />
                    <span>Provider API Key</span>
                    <span className="text-[9px] text-slate-500 font-normal uppercase">(Optional for local servers)</span>
                  </label>
                  <div className="relative">
                    <Key className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={reportApiKey === SECRET_MASK ? "" : reportApiKey}
                      onChange={(e) => setReportApiKey(e.target.value)}
                      onBlur={() => {
                        const val = reportApiKey.trim();
                        saveConfig({ llmApiKey: val, llmApiKeys: { ...(fullConfig?.llmApiKeys || {}), [reportProvider]: val } });
                        fetchServerModels(reportBaseUrl, val);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      placeholder={reportApiKey === SECRET_MASK ? "•••••••• (stored)" : "API key or bearer token"}
                      className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl pl-10 pr-10 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Test LLM Action */}
              <div className="space-y-3 pt-3 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setIsTestModalOpen(true)}
                  className="flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-100 transition-colors cursor-pointer"
                >
                  <PlayCircle className="w-3.5 h-3.5 text-[#DD3C73]" />
                  <span>Test LLM Provider</span>
                </button>
              </div>

              {/* Market Data & Intelligence Providers Reference */}
              <div className="pt-4 border-t border-slate-800/80 space-y-3">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                      <Database className="w-3.5 h-3.5 text-[#DD3C73]" />
                      <span>Market Data & News Intelligence</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Configure Finnhub API keys, Yahoo Finance connectivity, and category routing in the dedicated Data Providers tab.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSection("providers")}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-[#DD3C73] transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
                  >
                    <span>Manage Data Providers</span>
                    <ArrowLeft className="w-3 h-3 rotate-180" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 5: ABOUT */}
          {activeSection === "about" && (
            <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-6">
              {/* App Identity Banner */}
              <div className="flex items-start justify-between border-b border-slate-800/80 pb-5">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-plum via-royal to-[#DD3C73] p-[1.5px] shadow-lg shadow-[#DD3C73]/20 flex items-center justify-center shrink-0">
                    <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                      <TrendingUp className="w-6 h-6 text-[#DD3C73]" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold tracking-wide text-slate-100">
                        Portfolio
                      </h2>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#DD3C73]/15 text-[#DD3C73] border border-[#DD3C73]/30">
                        v{appVersion}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Personal Investment Tracker
                    </p>
                  </div>
                </div>
              </div>

              {/* Version and Updates */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 text-[#DD3C73]" />
                    <span>Version and Updates</span>
                  </div>
                  {updateInfo?.lastChecked && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      Last checked: {new Date(updateInfo.lastChecked).toLocaleTimeString()}
                    </span>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-200 font-semibold">
                        {updateInfo?.hasUpdate
                          ? `New version available: v${updateInfo.latestVersion}`
                          : fullConfig?.checkForUpdates === false
                          ? "Automatic update checks are disabled"
                          : "Portfolio is up to date"}
                      </span>
                      {updateInfo?.hasUpdate && (
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-mint/15 text-mint border border-mint/30">
                          Update Available
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Current version: v{appVersion}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {updateInfo?.hasUpdate && updateInfo.releaseUrl && (
                      <button
                        type="button"
                        onClick={() => openExternal(updateInfo.releaseUrl)}
                        className="px-3 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c93567] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>View Release</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isCheckingUpdates}
                      onClick={handleCheckForUpdates}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdates ? "animate-spin text-[#DD3C73]" : ""}`} />
                      <span>{isCheckingUpdates ? "Checking..." : "Check Now"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Support */}
              <div className="space-y-2.5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <LifeBuoy className="w-3.5 h-3.5 text-[#DD3C73]" />
                  <span>Support</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div>
                    <span className="text-xs text-slate-200 font-semibold">Something is not working or you have an idea?</span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Open a support ticket to {WEBPAGE_EMAIL}. Your version is filled in and the anonymized diagnostics of the last day can be attached.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReportIssue?.()}
                    className="px-3 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c93567] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                  >
                    <LifeBuoy className="w-3.5 h-3.5" />
                    <span>Report an Issue</span>
                  </button>
                </div>
              </div>

              {/* Storage Locations */}
              <div className="space-y-2.5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-[#DD3C73]" />
                  <span>Local Data Paths</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                    <span className="text-slate-400 text-[11px]">Database Ledger:</span>
                    <code className="text-slate-200 text-[11px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {appPaths?.data || "…"}
                    </code>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                    <span className="text-slate-400 text-[11px]">Application Logs:</span>
                    <code className="text-slate-200 text-[11px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {appPaths ? `${appPaths.logs}/service.log` : "…"}
                    </code>
                  </div>
                </div>
              </div>

              {/* Keyboard Shortcuts Reference */}
              <div className="space-y-2.5">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Keyboard className="w-3.5 h-3.5 text-[#DD3C73]" />
                  <span>Keyboard Shortcuts Reference</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {SHORTCUTS.map((sc) => (
                    <div
                      key={sc.key}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60"
                    >
                      <span className="text-slate-300 text-[11px]">{sc.desc}</span>
                      <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 shadow-sm">
                        {sc.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Portfolios Management Modals */}
      <CreatePortfolioModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onPortfolioCreated={(newP) => {
          if (onPortfolioCreated) onPortfolioCreated(newP);
          setPortfolioStatusMsg({
            type: "success",
            text: `Portfolio "${newP.name}" created successfully.`,
          });
          setTimeout(() => setPortfolioStatusMsg(null), 3000);
        }}
      />

      <EditPortfolioModal
        isOpen={!!editingPortfolio}
        onClose={() => setEditingPortfolio(null)}
        portfolio={editingPortfolio}
        onPortfolioUpdated={(updated) => {
          if (onPortfolioUpdated) onPortfolioUpdated(updated);
          setPortfolioStatusMsg({
            type: "success",
            text: `Portfolio "${updated.name}" updated successfully.`,
          });
          setTimeout(() => setPortfolioStatusMsg(null), 3000);
        }}
        onDelete={(p) => setDeletingPortfolio(p)}
      />

      <DeletePortfolioModal
        isOpen={!!deletingPortfolio}
        onClose={() => setDeletingPortfolio(null)}
        portfolio={deletingPortfolio}
        isLastPortfolio={portfolios.length <= 1}
        onConfirmDelete={handleConfirmDeletePortfolio}
      />

      <ExportPortfolioModal
        isOpen={!!exportingPortfolio}
        onClose={() => setExportingPortfolio(null)}
        portfolio={exportingPortfolio}
      />

      {/* LLM Diagnostics Step-by-Step Modal */}
      <TestLlmModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        provider={reportProvider}
        providerName={currentProvider.name}
        model={reportModel}
        apiKey={reportApiKey}
        baseUrl={reportBaseUrl}
      />
    </div>
  );
}
