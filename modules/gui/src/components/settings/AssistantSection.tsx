import { useEffect, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, Cpu, ExternalLink, Eye, EyeOff, Globe, Key, PlayCircle, RefreshCw, Terminal } from "lucide-react";
import type { ClaudeCliStatusResponse, DesktopConfig } from "portfolio-shared/api-types";
import { CLAUDE_CLI_MODELS, DEFAULT_OPENAI_COMPATIBLE_URL } from "portfolio-shared/llm-defaults";
import { SECRET_MASK } from "portfolio-shared/config-types";
import { Select } from "../common/Select";
import { rpc } from "../../rpc";
import { openExternal } from "../../environment";
import { SectionHeader } from "./SettingsFields";
import { TestLlmModal } from "./TestLlmModal";

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
    name: "AI program or cloud service",
    badge: "OpenAI compatible",
    description:
      "A program on this computer such as Ollama, LM Studio or llama.cpp, or a cloud service such as OpenAI, Groq or OpenRouter. Anything that speaks the OpenAI chat format works.",
  },
  {
    id: "claude-cli",
    name: "Claude subscription",
    badge: "Claude Code",
    description: "Uses the Claude Code app installed on this computer, signed in with your Claude subscription. No API key needed.",
  },
];

/** Provider ids from earlier releases were migrated to "openai-compatible" by the service. */
const toProviderId = (raw: string | undefined): LlmProviderId => (raw === "claude-cli" ? "claude-cli" : "openai-compatible");

const fieldLabel = "block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5";
const linkButton = "text-[10px] text-slate-400 hover:text-[#DD3C73] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50";

interface AssistantSectionProps {
  config: DesktopConfig;
  /** Saves the changed keys and resolves with the stored config. */
  saveConfig: (updates: Partial<DesktopConfig>) => Promise<DesktopConfig>;
  onConfigChange: (update: (prev: DesktopConfig | null) => DesktopConfig | null) => void;
}

/** Settings → AI Assistant: where the model runs, which model, and a step-by-step test. */
export function AssistantSection({ config, saveConfig, onConfigChange }: AssistantSectionProps) {
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

  // The stored provider, model, key and URL, read once when the page opens.
  useEffect(() => {
    const provider = toProviderId(config.llmProvider);
    const isCurrent = config.llmProvider === provider;
    setReportProvider(provider);

    const savedModel = config.llmModels?.[provider] || (isCurrent ? config.llmModel : "") || "";
    setReportModel(savedModel);
    if (provider === "claude-cli" && savedModel && !CLAUDE_CLI_MODELS.includes(savedModel)) setIsCustomModel(true);

    const savedKey = config.llmApiKeys?.[provider] || (isCurrent ? config.llmApiKey : "") || "";
    setReportApiKey(savedKey);

    const savedUrl = config.llmBaseUrls?.[provider] || (isCurrent ? config.llmBaseUrl : "") || DEFAULT_OPENAI_COMPATIBLE_URL;
    setReportBaseUrl(savedUrl);

    if (provider === "claude-cli") checkClaudeCli();
    else fetchServerModels(savedUrl, savedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveModel = (provider: LlmProviderId, model: string) => {
    setReportModel(model);
    saveConfig({ llmModel: model, llmModels: { ...(config.llmModels || {}), [provider]: model } });
  };

  const handleProviderSelect = (newProvider: LlmProviderId) => {
    setReportProvider(newProvider);
    const nextModel = config.llmModels?.[newProvider] || "";
    setReportModel(nextModel);
    setIsCustomModel(newProvider === "claude-cli" && Boolean(nextModel) && !CLAUDE_CLI_MODELS.includes(nextModel));

    if (newProvider === "claude-cli") {
      saveConfig({ llmProvider: newProvider, llmModel: nextModel, llmBaseUrl: "", llmApiKey: "" });
      checkClaudeCli();
      return;
    }

    const nextBaseUrl = config.llmBaseUrls?.[newProvider] || DEFAULT_OPENAI_COMPATIBLE_URL;
    const nextApiKey = config.llmApiKeys?.[newProvider] || "";
    setReportBaseUrl(nextBaseUrl);
    setReportApiKey(nextApiKey);
    saveConfig({ llmProvider: newProvider, llmModel: nextModel, llmBaseUrl: nextBaseUrl, llmApiKey: nextApiKey });
    fetchServerModels(nextBaseUrl, nextApiKey);
  };

  const currentProvider = LLM_PROVIDERS.find((p) => p.id === reportProvider) ?? LLM_PROVIDERS[0]!;
  const isClaudeCli = reportProvider === "claude-cli";
  const modelOptions = isClaudeCli ? CLAUDE_CLI_MODELS : serverModels;
  // A saved model the list no longer offers stays selectable instead of silently switching.
  const availableModels = reportModel && !isCustomModel && !modelOptions.includes(reportModel) ? [reportModel, ...modelOptions] : modelOptions;
  // Without a model list the only way to name a model is to type it.
  const showModelInput = isCustomModel || (!isClaudeCli && serverModels.length === 0);

  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-5">
      <SectionHeader icon={Bot} title="AI Assistant" description="Writes reports and briefs and answers your questions in the sidebar." />

      <p className="text-xs text-slate-400 leading-relaxed">
        The assistant needs an AI model to work. It can run as a program on this computer, which keeps everything here, or as a cloud
        service you have an account with, which receives the questions and the portfolio figures the assistant uses.
      </p>

      {/* Where the model runs */}
      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        <label className={fieldLabel}>
          <Bot className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>Where the AI runs</span>
        </label>
        <Select
          value={reportProvider}
          onChange={(e) => handleProviderSelect(toProviderId(e.target.value))}
          selectSize="lg"
          icon={<Bot className="w-4 h-4" />}
          aria-label="Where the AI runs"
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
            <label className={fieldLabel}>
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span>Claude Code status</span>
            </label>
            <button type="button" onClick={checkClaudeCli} disabled={isCheckingClaude} className={linkButton} title="Check Claude Code again">
              <RefreshCw className={`w-3 h-3 ${isCheckingClaude ? "animate-spin" : ""}`} />
              <span>{isCheckingClaude ? "Checking..." : "Check again"}</span>
            </button>
          </div>
          {isCheckingClaude && !claudeStatus ? (
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400">Looking for Claude Code and its sign-in...</div>
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

      {/* Server address and API key: OpenAI-compatible only */}
      {!isClaudeCli && (
        <div className="space-y-2 pt-2 border-t border-slate-800/80">
          <label className={fieldLabel}>
            <Globe className="w-3.5 h-3.5 text-slate-400" />
            <span>Server address</span>
          </label>
          <div className="relative">
            <Globe className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={reportBaseUrl}
              onChange={(e) => setReportBaseUrl(e.target.value)}
              onBlur={(e) => {
                const val = e.target.value.trim();
                // A stored key goes only to the server it was saved for: the service drops it when the
                // URL names another server. Save first, then list the models with the key it kept.
                void saveConfig({ llmBaseUrl: val, llmBaseUrls: { ...(config.llmBaseUrls || {}), [reportProvider]: val } })
                  .then((saved) => {
                    const key = saved?.llmApiKeys?.[reportProvider] ?? reportApiKey;
                    if (key !== reportApiKey) {
                      setReportApiKey(key);
                      onConfigChange((prev) => (prev ? { ...prev, llmApiKey: saved.llmApiKey, llmApiKeys: saved.llmApiKeys } : prev));
                    }
                    fetchServerModels(val, key);
                  })
                  .catch(() => {});
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder={DEFAULT_OPENAI_COMPATIBLE_URL}
              className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
            />
          </div>
          <p className="text-[10px] text-slate-500">
            The address the program or service gives you. Examples: http://127.0.0.1:11434/v1 (Ollama), http://127.0.0.1:8080 (llama.cpp),
            https://api.openai.com/v1, https://api.groq.com/openai/v1
          </p>
        </div>
      )}

      {!isClaudeCli && (
        <div className="space-y-2 pt-2 border-t border-slate-800/80">
          <label className={fieldLabel}>
            <Key className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>API key</span>
            <span className="text-[9px] text-slate-500 font-normal uppercase">(not needed for a program on this computer)</span>
          </label>
          <div className="relative">
            <Key className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type={showApiKey ? "text" : "password"}
              value={reportApiKey === SECRET_MASK ? "" : reportApiKey}
              onChange={(e) => setReportApiKey(e.target.value)}
              onBlur={() => {
                const val = reportApiKey.trim();
                saveConfig({ llmApiKey: val, llmApiKeys: { ...(config.llmApiKeys || {}), [reportProvider]: val } });
                fetchServerModels(reportBaseUrl, val);
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder={reportApiKey === SECRET_MASK ? "•••••••• (stored)" : "The key from your cloud service account"}
              className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl pl-10 pr-10 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              aria-label="Show or hide the API key"
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Model */}
      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between">
          <label className={fieldLabel}>
            <Cpu className="w-3.5 h-3.5 text-slate-400" />
            <span>Model</span>
          </label>
          {!isClaudeCli && (
            <button
              type="button"
              onClick={() => fetchServerModels(reportBaseUrl, reportApiKey)}
              disabled={isFetchingModels}
              className={linkButton}
              title="Ask the server which models it offers"
            >
              <RefreshCw className={`w-3 h-3 ${isFetchingModels ? "animate-spin" : ""}`} />
              <span>{isFetchingModels ? "Loading..." : "Refresh list"}</span>
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
            aria-label="Model"
          >
            <option value="">{isClaudeCli ? "Default (chosen by Claude Code)" : "Default (chosen by the server)"}</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="__custom__">Type a model name...</option>
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
              placeholder={isClaudeCli ? "e.g. claude-sonnet-5" : "e.g. llama-3.3-70b-versatile, or leave empty for the server default"}
              className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              {isClaudeCli ? "Any model name or alias Claude Code accepts with --model." : "The model name as your program or service lists it."}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3 pt-3 border-t border-slate-800/80">
        <button
          type="button"
          onClick={() => setIsTestModalOpen(true)}
          className="flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-100 transition-colors cursor-pointer"
        >
          <PlayCircle className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>Test the assistant</span>
        </button>
      </div>

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
