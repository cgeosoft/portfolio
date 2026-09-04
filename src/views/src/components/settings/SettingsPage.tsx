import { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Settings,
  Bot,
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
} from "lucide-react";
import { rpc } from "../../rpc";

interface ProviderPreset {
  id: string;
  name: string;
  badge: string;
  defaultModel: string;
  presets: string[];
  description: string;
  requiresKey: boolean;
  keyOptional?: boolean;
  keyPlaceholder: string;
  supportsBaseUrl?: boolean;
  baseUrlPlaceholder?: string;
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  "llamacpp-server": {
    id: "llamacpp-server",
    name: "Portfolio AI",
    badge: "Local llamacpp server",
    defaultModel: "qwen3-abliterated-14b-q4_k_m",
    presets: ["qwen3-abliterated-14b-q4_k_m", "qwen3.5-abliterated-9b-q4_k_m"],
    description: "Connect to local OpenAI-compatible inference server daemon.",
    requiresKey: false,
    keyOptional: true,
    keyPlaceholder: "Optional Bearer Token",
  },
  ollama: {
    id: "ollama",
    name: "Ollama Server",
    badge: "Local Daemon",
    defaultModel: "llama3.2:latest",
    presets: ["llama3.2:latest", "qwen2.5:14b", "deepseek-r1:14b"],
    description: "Run models locally via native Ollama daemon endpoint.",
    requiresKey: false,
    keyOptional: true,
    keyPlaceholder: "Optional API Token",
    supportsBaseUrl: true,
    baseUrlPlaceholder: "http://127.0.0.1:11434",
  },
  openai: {
    id: "openai",
    name: "OpenAI Cloud",
    badge: "GPT-4o & Reasoning",
    defaultModel: "gpt-4o-mini",
    presets: ["gpt-4o-mini", "gpt-4o", "o3-mini"],
    description: "Industry-standard OpenAI language models for deep financial analysis.",
    requiresKey: true,
    keyPlaceholder: "sk-proj-... / sk-...",
  }
};

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [reportProvider, setReportProvider] = useState("llamacpp-server");
  const [reportModel, setReportModel] = useState("qwen3-abliterated-14b-q4_k_m");
  const [reportApiKey, setReportApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [reportBaseUrl, setReportBaseUrl] = useState("");
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmTestFeedback, setLlmTestFeedback] = useState<{type: "success" | "error"; message: string; details?: string} | null>(null);

  useEffect(() => {
    rpc.request.getConfig({}).then((config: any) => {
      if (config.llmProvider) setReportProvider(config.llmProvider);
      if (config.llmModel) setReportModel(config.llmModel);
      if (config.llmApiKey) setReportApiKey(config.llmApiKey);
      if (config.llmBaseUrl) setReportBaseUrl(config.llmBaseUrl);
      setTelemetryEnabled(config.telemetryEnabled ?? false);
    });
  }, []);

  const saveConfig = async (updates: any) => {
    await rpc.request.saveConfig(updates);
  };

  const handleProviderSelect = (newProvider: string) => {
    setReportProvider(newProvider);
    setLlmTestFeedback(null);
    const preset = PROVIDER_PRESETS[newProvider];
    if (preset) {
      setReportModel(preset.defaultModel);
      saveConfig({ llmProvider: newProvider, llmModel: preset.defaultModel });
    }
  };

  const handleTestLlmProvider = async () => {
    setTestingLlm(true);
    setLlmTestFeedback(null);
    try {
      const data = await rpc.request.testLlm({
        provider: reportProvider,
        model: reportModel,
        apiKey: reportApiKey,
        baseUrl: reportBaseUrl,
      });

      if (data.success) {
        setLlmTestFeedback({
          type: "success",
          message: `✓ Test successful`,
          details: data.message,
        });
      } else {
        setLlmTestFeedback({
          type: "error",
          message: "✗ LLM provider test failed",
          details: data.message,
        });
      }
    } catch (err: any) {
      setLlmTestFeedback({
        type: "error",
        message: "✗ Request failed",
        details: err.message,
      });
    } finally {
      setTestingLlm(false);
    }
  };

  return (
    <div className="flex-1 w-full max-w-full space-y-6 font-mono">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-[#DD3C73] font-bold uppercase tracking-wider transition-colors cursor-pointer group w-fit"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
          <span>Back to Dashboard</span>
        </button>

        <div className="flex text-xs font-bold text-slate-400 uppercase tracking-widest items-center gap-1.5 min-w-0">
          <Settings className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="truncate">Settings</span>
        </div>
      </div>

      <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-5">
        <div className="min-w-0">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Bot className="w-4 h-4 text-[#DD3C73] shrink-0" />
            <span>Portfolio LLM Engine</span>
          </h2>
        </div>

        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
          <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
            Inference Provider
          </label>
          <select
            value={reportProvider}
            onChange={(e) => handleProviderSelect(e.target.value)}
            className="w-full sm:w-96 bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none transition-colors font-mono cursor-pointer"
          >
            {Object.values(PROVIDER_PRESETS).map((p) => (
              <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
                {p.name} — {p.badge}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3 pt-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
              Model Identifier
            </label>
            <div className="relative">
              <Cpu className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={reportModel}
                onChange={(e) => {
                  setReportModel(e.target.value);
                  saveConfig({ llmModel: e.target.value });
                }}
                className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2 pt-3 border-t border-slate-800/80">
          <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
            Server Base URL
          </label>
          <div className="relative">
            <Globe className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={reportBaseUrl}
              onChange={(e) => {
                setReportBaseUrl(e.target.value);
                saveConfig({ llmBaseUrl: e.target.value });
              }}
              className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
            />
          </div>
        </div>

        <div className="space-y-2 pt-3 border-t border-slate-800/80">
          <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>Provider API Key</span>
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

        <div className="space-y-2 pt-3 border-t border-slate-800/80">
          <button
            type="button"
            onClick={handleTestLlmProvider}
            disabled={testingLlm}
            className="flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold text-slate-100 transition-colors cursor-pointer"
          >
            {testingLlm ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5 text-[#DD3C73]" />}
            <span>{testingLlm ? "Testing Provider…" : "Test LLM Provider"}</span>
          </button>
          
          {llmTestFeedback && (
            <div className={`p-3 rounded-xl text-xs flex items-start gap-2.5 border transition-all ${
              llmTestFeedback.type === "success" ? "bg-emerald-950/30 border-emerald-800/60 text-emerald-300" : "bg-rose-950/30 border-rose-800/60 text-rose-300"
            }`}>
              {llmTestFeedback.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
              <div className="min-w-0 flex-1">
                <div className="font-bold">{llmTestFeedback.message}</div>
                {llmTestFeedback.details && <div className="text-[10px] mt-0.5 opacity-80 break-words font-mono">{llmTestFeedback.details}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-6">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
            <Activity className="w-4 h-4 text-[#DD3C73]" />
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
    </div>
  );
}
