import { useEffect, useRef, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, Cpu, ExternalLink, Eye, EyeOff, Globe, Key, Link2, PlayCircle, RefreshCw, Terminal } from "lucide-react";
import type { CliProviderStatusResponse, DesktopConfig } from "portfolio-shared/api-types";
import { CLI_PROVIDER_MODELS, DEFAULT_OPENAI_COMPATIBLE_URL, type CliProviderId } from "portfolio-shared/llm-defaults";
import { SECRET_MASK } from "portfolio-shared/config-types";
import { Select } from "../common/Select";
import { rpc } from "../../rpc";
import { openExternal } from "../../environment";
import { SectionHeader } from "./SettingsFields";
import { TestLlmModal } from "./TestLlmModal";

type LlmProviderId = "openai-compatible" | CliProviderId;

interface LlmProviderOption {
  id: LlmProviderId;
  name: string;
  badge: string;
  description: string;
}

/** What the Settings page shows for a CLI provider. */
interface CliProviderInfo {
  /** The app name in labels, e.g. "Claude Code". */
  app: string;
  setupUrl: string;
  setupLabel: string;
  modelPlaceholder: string;
}

const CLI_INFO: Record<CliProviderId, CliProviderInfo> = {
  "claude-cli": {
    app: "Claude Code",
    setupUrl: "https://code.claude.com/docs/en/setup",
    setupLabel: "Claude Code setup guide",
    modelPlaceholder: "e.g. claude-sonnet-5",
  },
  "codex-cli": {
    app: "Codex",
    setupUrl: "https://learn.chatgpt.com/docs/codex/cli",
    setupLabel: "Codex CLI setup guide",
    modelPlaceholder: "e.g. gpt-6-sol",
  },
};

const isCliId = (id: LlmProviderId): id is CliProviderId => id !== "openai-compatible";

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
  {
    id: "codex-cli",
    name: "ChatGPT subscription",
    badge: "Codex CLI",
    description: "Uses the OpenAI Codex CLI installed on this computer, signed in with your ChatGPT plan. No API key needed.",
  },
];

/** Provider ids from earlier releases were migrated to "openai-compatible" by the service. */
const toProviderId = (raw: string | undefined): LlmProviderId =>
  raw && Object.hasOwn(CLI_PROVIDER_MODELS, raw) ? (raw as CliProviderId) : "openai-compatible";

/** How often the page asks whether the OpenRouter sign-in in the browser has finished. */
const CONNECT_POLL_MS = 1500;

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
  const [cliStatus, setCliStatus] = useState<CliProviderStatusResponse | null>(null);
  const [isCheckingCli, setIsCheckingCli] = useState(false);
  const [isLocalClient, setIsLocalClient] = useState(false);
  const [connectState, setConnectState] = useState<"idle" | "waiting" | "connected" | "failed">("idle");
  const [connectMessage, setConnectMessage] = useState("");
  const connectPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The provider of the latest status check: a slow answer for another provider is dropped. */
  const cliCheckFor = useRef<LlmProviderId | null>(null);

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

  /** Checks that the CLI of a CLI provider is installed and signed in. */
  const checkCli = async (provider: CliProviderId) => {
    cliCheckFor.current = provider;
    setCliStatus(null);
    setIsCheckingCli(true);
    let status: CliProviderStatusResponse;
    try {
      status = await rpc.request.getCliProviderStatus({ provider });
    } catch (err) {
      status = { installed: false, loggedIn: false, message: err instanceof Error ? err.message : String(err) };
    }
    if (cliCheckFor.current !== provider) return;
    setCliStatus(status);
    setIsCheckingCli(false);
  };

  const stopConnectPoll = () => {
    if (connectPoll.current) clearInterval(connectPoll.current);
    connectPoll.current = null;
  };

  /**
   * Opens the OpenRouter sign-in in the system browser and waits for the
   * service to store the key it returns. Then the page shows the stored
   * address, key and model.
   */
  const connectOpenRouter = async () => {
    stopConnectPoll();
    setConnectState("waiting");
    setConnectMessage("Approve Portfolio in the browser window that opened.");
    try {
      const { authUrl, state } = await rpc.request.startOpenRouterConnect();
      if (!openExternal(authUrl)) throw new Error("Could not open the browser.");
      connectPoll.current = setInterval(async () => {
        let res;
        try {
          res = await rpc.request.getOpenRouterConnectStatus({ state });
        } catch {
          return; // try again on the next tick
        }
        if (res.status === "pending") return;
        stopConnectPoll();
        if (res.status !== "connected") {
          setConnectState("failed");
          setConnectMessage(res.message || "The OpenRouter sign-in did not finish.");
          return;
        }
        const saved = await rpc.request.getConfig();
        onConfigChange(() => saved);
        const url = saved.llmBaseUrls?.["openai-compatible"] || saved.llmBaseUrl;
        const key = saved.llmApiKeys?.["openai-compatible"] || saved.llmApiKey;
        const model = saved.llmModels?.["openai-compatible"] || saved.llmModel || "";
        setReportBaseUrl(url);
        setReportApiKey(key);
        setReportModel(model);
        setIsCustomModel(false);
        setConnectState("connected");
        setConnectMessage(res.message || "Connected to OpenRouter.");
        fetchServerModels(url, key);
      }, CONNECT_POLL_MS);
    } catch (err) {
      setConnectState("failed");
      setConnectMessage(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    rpc.request
      .getAppInfo()
      .then((info) => setIsLocalClient(Boolean(info.isLocalClient)))
      .catch(() => setIsLocalClient(false));
    return stopConnectPoll;
  }, []);

  // The stored provider, model, key and URL, read once when the page opens.
  useEffect(() => {
    const provider = toProviderId(config.llmProvider);
    const isCurrent = config.llmProvider === provider;
    setReportProvider(provider);

    const savedModel = config.llmModels?.[provider] || (isCurrent ? config.llmModel : "") || "";
    setReportModel(savedModel);
    if (isCliId(provider) && savedModel && !CLI_PROVIDER_MODELS[provider].includes(savedModel)) setIsCustomModel(true);

    const savedKey = config.llmApiKeys?.[provider] || (isCurrent ? config.llmApiKey : "") || "";
    setReportApiKey(savedKey);

    const savedUrl = config.llmBaseUrls?.[provider] || (isCurrent ? config.llmBaseUrl : "") || DEFAULT_OPENAI_COMPATIBLE_URL;
    setReportBaseUrl(savedUrl);

    if (isCliId(provider)) checkCli(provider);
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
    setIsCustomModel(isCliId(newProvider) && Boolean(nextModel) && !CLI_PROVIDER_MODELS[newProvider].includes(nextModel));

    if (isCliId(newProvider)) {
      saveConfig({ llmProvider: newProvider, llmModel: nextModel, llmBaseUrl: "", llmApiKey: "" });
      checkCli(newProvider);
      return;
    }
    cliCheckFor.current = null;

    const nextBaseUrl = config.llmBaseUrls?.[newProvider] || DEFAULT_OPENAI_COMPATIBLE_URL;
    const nextApiKey = config.llmApiKeys?.[newProvider] || "";
    setReportBaseUrl(nextBaseUrl);
    setReportApiKey(nextApiKey);
    saveConfig({ llmProvider: newProvider, llmModel: nextModel, llmBaseUrl: nextBaseUrl, llmApiKey: nextApiKey });
    fetchServerModels(nextBaseUrl, nextApiKey);
  };

  const currentProvider = LLM_PROVIDERS.find((p) => p.id === reportProvider) ?? LLM_PROVIDERS[0]!;
  const cliId = isCliId(reportProvider) ? reportProvider : null;
  const cliInfo = cliId ? CLI_INFO[cliId] : null;
  const isCli = cliId !== null;
  const modelOptions = cliId ? CLI_PROVIDER_MODELS[cliId] : serverModels;
  // A saved model the list no longer offers stays selectable instead of silently switching.
  const availableModels = reportModel && !isCustomModel && !modelOptions.includes(reportModel) ? [reportModel, ...modelOptions] : modelOptions;
  // Without a model list the only way to name a model is to type it.
  const showModelInput = isCustomModel || (!isCli && serverModels.length === 0);

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

      {/* CLI status: checked on selection */}
      {cliInfo && (
        <div className="space-y-2 pt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <label className={fieldLabel}>
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span>{cliInfo.app} status</span>
            </label>
            <button
              type="button"
              onClick={() => cliId && checkCli(cliId)}
              disabled={isCheckingCli}
              className={linkButton}
              title={`Check ${cliInfo.app} again`}
            >
              <RefreshCw className={`w-3 h-3 ${isCheckingCli ? "animate-spin" : ""}`} />
              <span>{isCheckingCli ? "Checking..." : "Check again"}</span>
            </button>
          </div>
          {isCheckingCli && !cliStatus ? (
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400">Looking for {cliInfo.app} and its sign-in...</div>
          ) : cliStatus?.installed && cliStatus.loggedIn ? (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2 text-[11px] text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
              <span>{cliStatus.message}</span>
            </div>
          ) : cliStatus ? (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2 text-[11px] text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <div className="space-y-1">
                <p>{cliStatus.message}</p>
                {!cliStatus.installed && (
                  <button
                    type="button"
                    onClick={() => openExternal(cliInfo.setupUrl)}
                    className="flex items-center gap-1 text-rose-200 hover:text-white underline underline-offset-2 cursor-pointer"
                  >
                    <span>{cliInfo.setupLabel}</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* OpenRouter sign-in: fills the address and key below */}
      {!isCli && isLocalClient && (
        <div className="space-y-2 pt-2 border-t border-slate-800/80">
          <label className={fieldLabel}>
            <Link2 className="w-3.5 h-3.5 text-slate-400" />
            <span>OpenRouter account</span>
          </label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <button
              type="button"
              onClick={connectOpenRouter}
              disabled={connectState === "waiting"}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-100 transition-colors cursor-pointer disabled:opacity-60"
            >
              <Link2 className="w-3.5 h-3.5 text-[#DD3C73]" />
              <span>{connectState === "waiting" ? "Waiting for the browser..." : "Connect OpenRouter"}</span>
            </button>
            {connectState === "waiting" && (
              <button
                type="button"
                onClick={() => {
                  stopConnectPoll();
                  setConnectState("idle");
                  setConnectMessage("");
                }}
                className={linkButton}
              >
                Cancel
              </button>
            )}
          </div>
          <p
            className={`text-[10px] ${connectState === "connected" ? "text-emerald-300" : connectState === "failed" ? "text-rose-300" : "text-slate-500"}`}
          >
            {connectMessage ||
              "Sign in to OpenRouter in your browser and approve Portfolio. The app gets a key for your OpenRouter account and uses its credits."}
          </p>
        </div>
      )}

      {/* Server address and API key: OpenAI-compatible only */}
      {!isCli && (
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
              className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 focus:outline-hidden transition-colors font-mono"
            />
          </div>
          <p className="text-[10px] text-slate-500">
            The address the program or service gives you. Examples: http://127.0.0.1:11434/v1 (Ollama), http://127.0.0.1:8080 (llama.cpp),
            https://api.openai.com/v1, https://api.groq.com/openai/v1
          </p>
        </div>
      )}

      {!isCli && (
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
              className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl pl-10 pr-10 py-2.5 text-xs text-slate-100 focus:outline-hidden transition-colors font-mono"
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
          {!isCli && (
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

        {(isCli || serverModels.length > 0) && (
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
            <option value="">{cliInfo ? `Default (chosen by ${cliInfo.app})` : "Default (chosen by the server)"}</option>
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
              placeholder={cliInfo ? cliInfo.modelPlaceholder : "e.g. llama-3.3-70b-versatile, or leave empty for the server default"}
              className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-hidden transition-colors font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              {cliInfo ? `Any model name ${cliInfo.app} accepts with its model option.` : "The model name as your program or service lists it."}
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
