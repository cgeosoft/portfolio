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
  Activity,
  ShieldCheck,
  Clock,
  Power,
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
  Mail,
  FolderOpen,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import { Select } from "../common/Select";
import { rpc } from "../../rpc";
import type { PortfolioItem } from "../../types/portfolio";
import type { AppUpdateInfo } from "../../../../shared/rpc-types";
import { CreatePortfolioModal } from "../portfolio/CreatePortfolioModal";
import { EditPortfolioModal } from "../portfolio/EditPortfolioModal";
import { DeletePortfolioModal } from "../portfolio/DeletePortfolioModal";
import { ExportPortfolioModal } from "../portfolio/ExportPortfolioModal";
import { TestLlmModal } from "./TestLlmModal";
import {
  DEFAULT_LLAMACPP_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
} from "../../../../shared/llm-defaults";

export type SettingsSection = "general" | "portfolios" | "assistant" | "support" | "about";

interface ProviderPreset {
  id: string;
  name: string;
  badge: string;
  defaultModel: string;
  /** Bundled model names. Omitted for local server providers whose models come from the endpoint. */
  models?: string[];
  description: string;
  requiresKey: boolean;
  keyOptional?: boolean;
  keyPlaceholder: string;
  supportsBaseUrl?: boolean;
  baseUrlPlaceholder?: string;
  defaultBaseUrl?: string;
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  "llamacpp": {
    id: "llamacpp",
    name: "Llama.cpp Server",
    badge: "Local Daemon",
    // The server answers with whichever model it was started with, so there is
    // no meaningful default to preselect; the list comes from /v1/models.
    defaultModel: "",
    description: "Connect to local OpenAI-compatible inference server daemon.",
    requiresKey: false,
    keyOptional: true,
    keyPlaceholder: "Optional Bearer Token",
    supportsBaseUrl: true,
    baseUrlPlaceholder: DEFAULT_LLAMACPP_URL,
    defaultBaseUrl: DEFAULT_LLAMACPP_URL,
  },
  ollama: {
    id: "ollama",
    name: "Ollama Server",
    badge: "Local Daemon",
    defaultModel: DEFAULT_OLLAMA_MODEL,
    description: "Run models locally via native Ollama daemon endpoint.",
    requiresKey: false,
    keyOptional: true,
    keyPlaceholder: "Optional API Token",
    supportsBaseUrl: true,
    baseUrlPlaceholder: DEFAULT_OLLAMA_URL,
    defaultBaseUrl: DEFAULT_OLLAMA_URL,
  },
  groq: {
    id: "groq",
    name: "Groq Cloud",
    badge: "Ultra-Fast LPU",
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "deepseek-r1-distill-llama-70b",
      "gemma2-9b-it",
      "mixtral-8x7b-32768",
    ],
    description: "Ultra-low latency cloud inference powered by Groq LPU chips.",
    requiresKey: true,
    keyPlaceholder: "gsk_...",
    supportsBaseUrl: false,
  },
  openai: {
    id: "openai",
    name: "OpenAI Cloud",
    badge: "GPT-4o & Reasoning",
    defaultModel: "gpt-4o-mini",
    models: [
      "gpt-4o-mini",
      "gpt-4o",
      "o3-mini",
      "o1-mini",
      "o1",
      "gpt-4-turbo",
    ],
    description: "Industry-standard OpenAI language models for deep financial analysis.",
    requiresKey: true,
    keyPlaceholder: "sk-proj-... / sk-...",
    supportsBaseUrl: false,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Cloud",
    badge: "Claude 3.5 & 3.7",
    defaultModel: "claude-3-5-sonnet-20241022",
    models: [
      "claude-3-7-sonnet-20250219",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
    ],
    description: "Anthropic Claude models specializing in nuanced financial reasoning.",
    requiresKey: true,
    keyPlaceholder: "sk-ant-api03-...",
    supportsBaseUrl: false,
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    badge: "Gemini 1.5 & 2.0",
    defaultModel: "gemini-2.0-flash",
    models: [
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-2.0-pro-exp-02-05",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ],
    description: "High-context multimodal inference powered by Google AI.",
    requiresKey: true,
    keyPlaceholder: "AIzaSy...",
    supportsBaseUrl: false,
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    badge: "Universal Gateway",
    defaultModel: "meta-llama/llama-3.3-70b-instruct",
    models: [
      "meta-llama/llama-3.3-70b-instruct",
      "deepseek/deepseek-r1",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-001",
      "mistralai/mistral-large-2411",
    ],
    description: "Unified API gateway supporting hundreds of leading models.",
    requiresKey: true,
    keyPlaceholder: "sk-or-v1-...",
    supportsBaseUrl: false,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek API",
    badge: "DeepSeek-V3 / R1",
    defaultModel: "deepseek-chat",
    models: [
      "deepseek-chat",
      "deepseek-reasoner",
    ],
    description: "Reasoning and general intelligence models from DeepSeek.",
    requiresKey: true,
    keyPlaceholder: "sk-...",
    supportsBaseUrl: false,
  },
};

/**
 * Resolve a preset from a stored provider id, tolerating the legacy
 * "llamacpp-server" key the backend still persists for llama.cpp.
 */
const resolveProviderPreset = (provider: string): ProviderPreset | undefined =>
  PROVIDER_PRESETS[provider] ||
  (provider === "llamacpp-server" ? PROVIDER_PRESETS["llamacpp"] : undefined);

const SECTIONS = [
  {
    id: "general" as const,
    label: "General",
    description: "Telemetry, refresh & startup",
    icon: Sliders,
  },
  {
    id: "portfolios" as const,
    label: "Portfolios",
    description: "Ledgers & asset management",
    icon: TrendingUp,
  },
  {
    id: "assistant" as const,
    label: "Assistant",
    description: "AI & LLM inference model",
    icon: Bot,
  },
  {
    id: "support" as const,
    label: "Support",
    description: "Submit tickets & diagnostics",
    icon: LifeBuoy,
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
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);

  // General settings state
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [quotesInterval, setQuotesInterval] = useState<number>(15);
  const [startWithBoot, setStartWithBoot] = useState(false);
  const [checkForUpdates, setCheckForUpdates] = useState(true);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [appVersion, setAppVersion] = useState("0.1.0");

  // Support ticket state
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketIncludeLogs, setTicketIncludeLogs] = useState(true);
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);
  const [ticketStatus, setTicketStatus] = useState<{
    type: "success" | "error";
    text: string;
    zipPath?: string;
  } | null>(null);
  const [copiedZipPath, setCopiedZipPath] = useState(false);

  // Assistant settings state
  const [reportProvider, setReportProvider] = useState("llamacpp-server");
  const [reportModel, setReportModel] = useState("");
  const [reportApiKey, setReportApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [reportBaseUrl, setReportBaseUrl] = useState(DEFAULT_LLAMACPP_URL);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const [serverModels, setServerModels] = useState<Record<string, string[]>>({});
  const [isFetchingModels, setIsFetchingModels] = useState(false);

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

  const fetchModelsForProvider = async (provider: string, url?: string, key?: string) => {
    if (provider !== "ollama" && provider !== "llamacpp-server" && provider !== "llamacpp") return;
    setIsFetchingModels(true);
    try {
      const res = await rpc.request.getProviderModels({ provider, baseUrl: url, apiKey: key });
      if (res.models && res.models.length > 0) {
        setServerModels((prev) => ({ ...prev, [provider]: res.models }));
        // llama.cpp ships no default model, so adopt what the server reports
        // rather than leaving the dropdown on an empty selection.
        setReportModel((current) => {
          if (current) return current;
          const [first] = res.models;
          saveConfig({ llmModel: first });
          return first;
        });
      }
    } catch {
      // Server offline or not responding
    } finally {
      setIsFetchingModels(false);
    }
  };

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  useEffect(() => {
    rpc.request.getConfig({}).then((config: any) => {
      const provider = config.llmProvider || "llamacpp-server";
      setReportProvider(provider);

      const preset = resolveProviderPreset(provider);
      const savedModel = config.llmModel || preset?.defaultModel || "";
      setReportModel(savedModel);

      if (savedModel && preset?.models && !preset.models.includes(savedModel)) {
        setIsCustomModel(true);
        setCustomModelInput(savedModel);
      }

      if (config.llmApiKey) setReportApiKey(config.llmApiKey);
      const url = config.llmBaseUrl || config.llamacppServerUrl || preset?.defaultBaseUrl || "";
      if (url) {
        setReportBaseUrl(url);
      } else if (preset?.defaultBaseUrl) {
        setReportBaseUrl(preset.defaultBaseUrl);
      }
      setTelemetryEnabled(config.telemetryEnabled ?? false);
      if (config.marketQuotesInterval !== undefined) setQuotesInterval(config.marketQuotesInterval);
      if (config.startWithBoot !== undefined) setStartWithBoot(config.startWithBoot);
      if (config.checkForUpdates !== undefined) setCheckForUpdates(config.checkForUpdates);

      if (preset?.supportsBaseUrl) {
        fetchModelsForProvider(provider, url || preset?.defaultBaseUrl, config.llmApiKey);
      }
    });

    rpc.request.getAppInfo({}).then((info: any) => {
      if (info?.version) setAppVersion(info.version);
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
    await rpc.request.saveConfig(updates);
  };

  const handleProviderSelect = (newProvider: string) => {
    const isLlamaCpp = newProvider === "llamacpp" || newProvider === "llamacpp-server";
    setReportProvider(newProvider);
    const preset = resolveProviderPreset(newProvider);
    if (preset) {
      setReportModel(preset.defaultModel);
      setIsCustomModel(false);
      setCustomModelInput("");

      const updates: any = { llmProvider: newProvider, llmModel: preset.defaultModel };
      let effectiveBaseUrl = reportBaseUrl;
      if (preset.supportsBaseUrl) {
        // Carry a custom URL across a provider switch, but replace the other
        // local daemon's default rather than pointing llama.cpp at Ollama.
        const otherDefault = isLlamaCpp ? DEFAULT_OLLAMA_URL : DEFAULT_LLAMACPP_URL;
        if (!effectiveBaseUrl || effectiveBaseUrl === otherDefault) {
          effectiveBaseUrl = preset.defaultBaseUrl || "";
          setReportBaseUrl(effectiveBaseUrl);
          updates.llmBaseUrl = effectiveBaseUrl;
          if (isLlamaCpp) updates.llamacppServerUrl = effectiveBaseUrl;
        }
      }
      saveConfig(updates);
      fetchModelsForProvider(newProvider, effectiveBaseUrl, reportApiKey);
    } else {
      saveConfig({ llmProvider: newProvider });
    }
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

  const handleOpenSupportTicket = async () => {
    setIsSubmittingTicket(true);
    setTicketStatus(null);
    try {
      const res = await rpc.request.openSupportTicket({
        subject: ticketSubject.trim() || undefined,
        message: ticketMessage.trim() || undefined,
        includeLogs: ticketIncludeLogs,
      });
      if (res.success) {
        setTicketStatus({
          type: "success",
          text: res.zipPath
            ? "Support ticket email opened. Diagnostic logs archive created."
            : "Support ticket email opened in your default email application.",
          zipPath: res.zipPath,
        });
      } else {
        setTicketStatus({
          type: "error",
          text: res.error || "Failed to open support ticket email.",
        });
      }
    } catch (err: any) {
      setTicketStatus({
        type: "error",
        text: err?.message || "An unexpected error occurred while creating the support ticket.",
      });
    } finally {
      setIsSubmittingTicket(false);
    }
  };

  const handleRevealZipFile = async (path: string) => {
    try {
      await rpc.request.revealFile({ filePath: path });
    } catch {}
  };

  const handleCopyZipPath = (path: string) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(path);
      setCopiedZipPath(true);
      setTimeout(() => setCopiedZipPath(false), 2000);
    }
  };

  const filteredPortfolios = (portfolios || []).filter((p) => {
    const term = portfolioSearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      (p.description || "").toLowerCase().includes(term) ||
      p.baseCurrency.toLowerCase().includes(term)
    );
  });

  // Resolve the preset even when the provider value still uses the legacy
  // "llamacpp-server" key used by the backend.
  const currentPreset = resolveProviderPreset(reportProvider);
  const dynamicList = serverModels[reportProvider] || [];
  const presetList = currentPreset?.models || [];
  // Local server providers (llamacpp-server and ollama) list models only from
  // the live server endpoint. Models are never hardcoded for them. Cloud
  // providers keep the bundled preset list because they expose no accessible
  // model listing.
  const isEndpointProvider =
    reportProvider === "ollama" || reportProvider === "llamacpp-server" || reportProvider === "llamacpp";
  const isLlamaCpp = reportProvider === "llamacpp-server" || reportProvider === "llamacpp";
  const baseList = isEndpointProvider ? dynamicList : presetList;
  const availableModels = Array.from(new Set(baseList));
  if (reportModel && !isCustomModel && !availableModels.includes(reportModel)) {
    availableModels.unshift(reportModel);
  }

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
                  Manage background quote updates, startup behavior, and telemetry settings.
                </p>
              </div>

              {/* 1. Market Quotes Auto-Fetch Interval */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#DD3C73]" />
                    <span>Market Quotes Auto-Fetch Interval</span>
                  </label>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {quotesInterval === 0 ? "Disabled" : `Every ${quotesInterval}m`}
                  </span>
                </div>

                <Select
                  value={quotesInterval}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setQuotesInterval(val);
                    saveConfig({ marketQuotesInterval: val });
                  }}
                  selectSize="lg"
                  icon={<Clock className="w-4 h-4" />}
                  aria-label="Market quotes auto-fetch interval"
                >
                  <option value={0}>Manual Only (Off)</option>
                  <option value={5}>Every 5 Minutes (Active Trading)</option>
                  <option value={15}>Every 15 Minutes (Recommended)</option>
                  <option value={30}>Every 30 Minutes</option>
                  <option value={60}>Every 1 Hour</option>
                  <option value={240}>Every 4 Hours</option>
                </Select>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Automatically pulls live quotes and foreign exchange rates from Yahoo Finance in the background to update portfolio equity valuations.
                </p>
              </div>

              {/* 2. Start with Boot Toggle */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 pr-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                    <Power className="w-4 h-4 text-[#DD3C73]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Start at System Boot
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      Automatically launch Portfolio Desktop in the background when your computer boots up.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={startWithBoot}
                  onClick={() => {
                    const next = !startWithBoot;
                    setStartWithBoot(next);
                    saveConfig({ startWithBoot: next });
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none self-end sm:self-center ${
                    startWithBoot ? "bg-[#DD3C73]" : "bg-slate-800"
                  }`}
                  title={startWithBoot ? "Disable boot startup" : "Enable boot startup"}
                >
                  <span className="sr-only">Start at System Boot</span>
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      startWithBoot ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* 3. Telemetry Configuration */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 pr-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                    <Activity className="w-4 h-4 text-[#A7E2C0]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Enable Anonymous Analytics (Telemetry)
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      Help improve Portfolio by sharing privacy-preserving diagnostic usage events. No financial holdings, balances, or transactions are ever collected.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={telemetryEnabled}
                  onClick={() => {
                    const next = !telemetryEnabled;
                    setTelemetryEnabled(next);
                    saveConfig({ telemetryEnabled: next });
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none self-end sm:self-center ${
                    telemetryEnabled ? "bg-[#DD3C73]" : "bg-slate-800"
                  }`}
                  title={telemetryEnabled ? "Disable anonymous analytics" : "Enable anonymous analytics"}
                >
                  <span className="sr-only">Enable anonymous analytics</span>
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      telemetryEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* 4. Check for Application Updates Toggle */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 pr-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                    <RefreshCw className="w-4 h-4 text-[#DD3C73]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Check for Application Updates
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      Automatically check GitHub releases on startup and every hour for new versions.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={checkForUpdates}
                  onClick={() => {
                    const next = !checkForUpdates;
                    setCheckForUpdates(next);
                    saveConfig({ checkForUpdates: next });
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none self-end sm:self-center ${
                    checkForUpdates ? "bg-[#DD3C73]" : "bg-slate-800"
                  }`}
                  title={checkForUpdates ? "Disable update checks" : "Enable update checks"}
                >
                  <span className="sr-only">Check for Application Updates</span>
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      checkForUpdates ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Privacy Guarantee Note */}
              <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-emerald-300 text-xs flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold">Strict Privacy Guarantee:</span> Portfolio Desktop runs completely on local disk. Your holdings, trade histories, and cash balances remain strictly offline.
                </div>
              </div>
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
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-700/70 bg-slate-800/80 hover:bg-slate-700 hover:border-slate-600 text-xs font-semibold text-white transition-all cursor-pointer shadow-sm mr-1"
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
                  value={currentPreset?.id || reportProvider}
                  onChange={(e) => handleProviderSelect(e.target.value)}
                  selectSize="lg"
                  icon={<Bot className="w-4 h-4" />}
                  aria-label="Inference provider"
                >
                  {Object.values(PROVIDER_PRESETS).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.badge})
                    </option>
                  ))}
                </Select>
                {currentPreset && (
                  <p className="text-[11px] text-slate-400 pt-1 leading-relaxed">
                    {currentPreset.description}
                  </p>
                )}
              </div>

              {/* Model Identifier Dropdown */}
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-slate-400" />
                    <span>Model Identifier</span>
                  </label>
                  {currentPreset?.supportsBaseUrl && (
                    <button
                      type="button"
                      onClick={() => fetchModelsForProvider(reportProvider, reportBaseUrl, reportApiKey)}
                      disabled={isFetchingModels}
                      className="text-[10px] text-slate-400 hover:text-[#DD3C73] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Fetch installed models from local server"
                    >
                      <RefreshCw className={`w-3 h-3 ${isFetchingModels ? "animate-spin" : ""}`} />
                      <span>{isFetchingModels ? "Scanning Server..." : "Detect Local Models"}</span>
                    </button>
                  )}
                </div>

                <Select
                  value={isCustomModel ? "__custom__" : reportModel}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__custom__") {
                      setIsCustomModel(true);
                      setCustomModelInput(reportModel);
                    } else {
                      setIsCustomModel(false);
                      setReportModel(val);
                      saveConfig({ llmModel: val });
                    }
                  }}
                  selectSize="lg"
                  icon={<Cpu className="w-4 h-4" />}
                  aria-label="Model identifier"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value="__custom__">
                    Custom Model (Manual Entry)...
                  </option>
                </Select>

                {isCustomModel && (
                  <div className="pt-2 animate-fade-in">
                    <input
                      type="text"
                      value={customModelInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomModelInput(val);
                        setReportModel(val);
                        saveConfig({ llmModel: val });
                      }}
                      placeholder="e.g. mistral-7b-custom:latest"
                      className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Enter an unlisted model identifier or custom fine-tune tag.
                    </p>
                  </div>
                )}
              </div>

              {/* Server Base URL: Only rendered for local server daemons */}
              {currentPreset?.supportsBaseUrl && (
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
                      onChange={(e) => {
                        setReportBaseUrl(e.target.value);
                        saveConfig({
                          llmBaseUrl: e.target.value,
                          ...(isLlamaCpp ? { llamacppServerUrl: e.target.value } : {}),
                        });
                      }}
                      onBlur={(e) => {
                        if (isEndpointProvider) {
                          fetchModelsForProvider(reportProvider, e.target.value.trim(), reportApiKey);
                        }
                      }}
                      placeholder={
                        currentPreset?.baseUrlPlaceholder ||
                        (reportProvider === "ollama" ? DEFAULT_OLLAMA_URL : DEFAULT_LLAMACPP_URL)
                      }
                      className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {reportProvider === "ollama"
                      ? `Default Ollama daemon endpoint: ${DEFAULT_OLLAMA_URL}`
                      : `Default llama.cpp server endpoint: ${DEFAULT_LLAMACPP_URL}`}
                  </p>
                </div>
              )}

              {/* Provider API Key */}
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-[#DD3C73]" />
                  <span>Provider API Key</span>
                  {currentPreset?.keyOptional && (
                    <span className="text-[9px] text-slate-500 font-normal uppercase">(Optional)</span>
                  )}
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={reportApiKey}
                    onChange={(e) => {
                      setReportApiKey(e.target.value);
                      saveConfig({ llmApiKey: e.target.value });
                    }}
                    placeholder={
                      currentPreset?.keyPlaceholder || "Enter API Key"
                    }
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
            </div>
          )}

          {/* SECTION 4: SUPPORT TICKET */}
          {activeSection === "support" && (
            <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-6">
              <div className="border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-wider">
                  <LifeBuoy className="w-4 h-4 text-[#DD3C73]" />
                  <span>Support Ticket & Diagnostics</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Open a technical support ticket or report an issue directly to christos@cgeosoft.com.
                </p>
              </div>

              {/* Anonymization Guarantee Notice */}
              <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-emerald-300 text-xs flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1 leading-relaxed">
                  <div className="font-bold text-emerald-200">
                    Strict Log Anonymization Guarantee
                  </div>
                  <p className="text-[11px] text-emerald-300/90 leading-relaxed">
                    All diagnostic log entries are completely anonymized before packaging into the ZIP file. Personal usernames, home directories, file paths, portfolio names, tickers, quantities, financial values, and API keys are automatically stripped and redacted.
                  </p>
                </div>
              </div>

              {/* Ticket Form */}
              <div className="p-4 sm:p-5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
                {/* Recipient */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-[#DD3C73]" />
                    <span>Recipient Email</span>
                  </label>
                  <input
                    type="text"
                    readOnly
                    value="christos@cgeosoft.com"
                    className="w-full bg-slate-950/90 border border-slate-800/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-300 font-mono focus:outline-none cursor-default select-all"
                  />
                </div>

                {/* Subject */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Ticket Subject
                  </label>
                  <input
                    type="text"
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder="e.g. Issue with transaction import or quote sync"
                    className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none transition-colors font-mono"
                  />
                </div>

                {/* Message */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Problem Description (Optional)
                  </label>
                  <textarea
                    rows={4}
                    value={ticketMessage}
                    onChange={(e) => setTicketMessage(e.target.value)}
                    placeholder="Describe what happened or steps to reproduce..."
                    className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none transition-colors font-mono resize-none"
                  />
                </div>

                {/* Checkbox for 24h logs */}
                <div className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800/70 flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="ticket-include-logs"
                    checked={ticketIncludeLogs}
                    onChange={(e) => setTicketIncludeLogs(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-950 text-[#DD3C73] focus:ring-[#DD3C73]/40 cursor-pointer accent-[#DD3C73]"
                  />
                  <label htmlFor="ticket-include-logs" className="cursor-pointer select-none space-y-0.5">
                    <div className="text-xs font-semibold text-slate-200">
                      Submit last day logs as an anonymized zip attachment
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Packages diagnostic events and system metadata from the previous 24 hours into a ZIP file. Personal file paths, portfolio names, financial values, and credentials are automatically redacted.
                    </p>
                  </label>
                </div>

                {/* Status / Alert Banner */}
                {ticketStatus && (
                  <div
                    className={`p-3 text-xs rounded-xl flex flex-col gap-2 ${
                      ticketStatus.type === "success"
                        ? "text-emerald-300 bg-emerald-950/40 border border-emerald-800/50"
                        : "text-rose-300 bg-rose-950/40 border border-rose-800/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {ticketStatus.type === "success" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      )}
                      <span>{ticketStatus.text}</span>
                    </div>

                    {ticketStatus.zipPath && (
                      <div className="pt-2 border-t border-emerald-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <code className="text-[10px] text-emerald-200 bg-slate-950/70 px-2 py-1 rounded border border-emerald-800/40 truncate max-w-md">
                          {ticketStatus.zipPath}
                        </code>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRevealZipFile(ticketStatus.zipPath!)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-900/60 hover:bg-emerald-800 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                            title="Open folder containing ZIP archive"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span>Open Folder</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyZipPath(ticketStatus.zipPath!)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors cursor-pointer"
                            title="Copy path to clipboard"
                          >
                            {copiedZipPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedZipPath ? "Copied" : "Copy Path"}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Action Button */}
                <div className="pt-2 flex items-center justify-end">
                  <button
                    type="button"
                    disabled={isSubmittingTicket}
                    onClick={handleOpenSupportTicket}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#DD3C73] hover:bg-[#DD3C73]/90 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shadow-lg shadow-[#DD3C73]/20"
                  >
                    <LifeBuoy className={`w-3.5 h-3.5 ${isSubmittingTicket ? "animate-spin" : ""}`} />
                    <span>{isSubmittingTicket ? "Preparing Ticket..." : "Open Support Ticket"}</span>
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
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#341B83] via-[#243C8F] to-[#DD3C73] p-[1.5px] shadow-lg shadow-[#DD3C73]/20 flex items-center justify-center shrink-0">
                    <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                      <TrendingUp className="w-6 h-6 text-[#DD3C73]" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold tracking-wide text-slate-100">
                        Portfolio Desktop
                      </h2>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#DD3C73]/15 text-[#DD3C73] border border-[#DD3C73]/30">
                        v{appVersion}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Tactical Cyberpunk Personal Investment & Asset Terminal
                    </p>
                  </div>
                </div>
              </div>

              {/* Version and Updates Card */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
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

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-slate-900/60 border border-slate-800/60">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-200 font-semibold">
                        {updateInfo?.hasUpdate
                          ? `New version available: v${updateInfo.latestVersion}`
                          : !checkForUpdates
                          ? "Automatic update checks are disabled"
                          : "Portfolio Desktop is up to date"}
                      </span>
                      {updateInfo?.hasUpdate && (
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#A7E2C0]/15 text-[#A7E2C0] border border-[#A7E2C0]/30">
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
                        onClick={() => rpc.request.openExternalUrl({ url: updateInfo.releaseUrl })}
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

              {/* Architecture & Highlights Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5">
                  <Cpu className="w-4 h-4 text-[#243C8F] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                      Runtime Engine
                    </div>
                    <div className="font-semibold text-slate-200 text-xs mt-0.5">
                      Electrobun & Bun
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Native multi-process IPC</div>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5">
                  <Database className="w-4 h-4 text-[#A7E2C0] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                      Storage Engine
                    </div>
                    <div className="font-semibold text-slate-200 text-xs mt-0.5">
                      SQLite 3 (WAL Mode)
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">100% Offline Local Disk</div>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-[#DD3C73] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                      Data Privacy
                    </div>
                    <div className="font-semibold text-slate-200 text-xs mt-0.5">
                      Zero Asset Telemetry
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Strict local isolation</div>
                  </div>
                </div>
              </div>

              {/* Storage Locations */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-[#DD3C73]" />
                  <span>Local Data Paths</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
                    <span className="text-slate-400 text-[11px]">Database Ledger:</span>
                    <code className="text-slate-200 text-[11px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      ~/.config/portfolio/data/portfolio.sqlite
                    </code>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
                    <span className="text-slate-400 text-[11px]">User Preferences:</span>
                    <code className="text-slate-200 text-[11px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      ~/.config/portfolio/config.json
                    </code>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
                    <span className="text-slate-400 text-[11px]">Application Logs:</span>
                    <code className="text-slate-200 text-[11px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      ~/.config/portfolio/logs/portfolio.log
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

              {/* Footer Notice */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#E3EACD]" />
                  <span>Local-First Financial Computing</span>
                </div>
                <div className="text-[10px] uppercase font-mono tracking-wider text-slate-600">
                  Debian / Linux / Cross-Platform
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
        providerName={currentPreset?.name || reportProvider}
        model={reportModel}
        apiKey={reportApiKey}
        baseUrl={reportBaseUrl}
      />
    </div>
  );
}
