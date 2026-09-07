import { rpc } from "../../rpc";
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  Copy,
  CheckCheck,
  Database,
  Layers,
  Percent,
  RefreshCw,
  Sparkles,
  StopCircle,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import type { FinancialPortfolioData, PortfolioReport } from "../../types/portfolio";
import type { PrepareReportPromptResponse } from "../../../../shared/rpc-types.js";
import { fmtCurrency, maskFinancialValues } from "./utils";

interface AnalyzePortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReportGenerated: (newReportId: string) => Promise<void> | void;
  portfolioData: FinancialPortfolioData | null;
  portfolioId?: string;
  hideCurrencyValues?: boolean;
}

type WizardStep = "intro" | "context" | "processing" | "confirmation";
type ConfirmationStatus = "success" | "fail" | "cancelled";

const WIZARD_STEPS = [
  { id: "intro", number: "01", label: "Intro" },
  { id: "context", number: "02", label: "Context & Prompt" },
  { id: "processing", number: "03", label: "AI Processing" },
  { id: "confirmation", number: "04", label: "Confirmation" },
] as const;

export function AnalyzePortfolioModal({
  isOpen,
  onClose,
  onReportGenerated,
  portfolioData,
  portfolioId,
  hideCurrencyValues = false,
}: AnalyzePortfolioModalProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("intro");
  const [skipIntroPreference, setSkipIntroPreference] = useState(false);
  const [promptData, setPromptData] = useState<PrepareReportPromptResponse | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptTab, setPromptTab] = useState<"full" | "user" | "system">("full");
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Streaming state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [lastWordsStream, setLastWordsStream] = useState<string>("");
  const [chunkCount, setChunkCount] = useState<number>(0);
  const [confirmationStatus, setConfirmationStatus] = useState<ConfirmationStatus>("success");
  const [generatedReport, setGeneratedReport] = useState<PortfolioReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const summary = portfolioData?.summary;
  const holdingsCount = portfolioData?.holdings?.filter((h: any) => h.assetType !== "Cash").length ?? 0;
  const baseCurrency = summary?.baseCurrency || "EUR";

  const clearPollTimer = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearPollTimer();
    };
  }, []);

  // Initialize or reset wizard on modal open
  useEffect(() => {
    if (!isOpen) {
      clearPollTimer();
      return;
    }

    clearPollTimer();
    setPromptData(null);
    setPromptLoading(false);
    setPromptError(null);
    setActiveSessionId(null);
    setLastWordsStream("");
    setChunkCount(0);
    setGeneratedReport(null);
    setErrorMessage(null);

    // Fetch config to check skipReportIntro preference
    void (async () => {
      try {
        const config = await rpc.request.getConfig({});
        if (!isMountedRef.current) return;
        const skip = Boolean(config.skipReportIntro);
        setSkipIntroPreference(skip);
        if (skip) {
          setCurrentStep("context");
        } else {
          setCurrentStep("intro");
        }
      } catch {
        if (isMountedRef.current) {
          setCurrentStep("intro");
        }
      }
    })();
  }, [isOpen]);

  // Load context prompt when entering Step 2
  const loadPromptContext = useCallback(async () => {
    if (!portfolioId) return;
    setPromptLoading(true);
    setPromptError(null);

    try {
      const config = await rpc.request.getConfig({});
      const res = await rpc.request.prepareReportPrompt({
        portfolioId,
        provider: config.llmProvider,
        model: config.llmModel,
      });

      if (!isMountedRef.current) return;
      setPromptData(res);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setPromptError(msg || "Failed to compile portfolio context and prompt.");
    } finally {
      if (isMountedRef.current) {
        setPromptLoading(false);
      }
    }
  }, [portfolioId]);

  useEffect(() => {
    if (isOpen && currentStep === "context" && !promptData && !promptLoading) {
      void loadPromptContext();
    }
  }, [isOpen, currentStep, promptData, promptLoading, loadPromptContext]);

  // Keyboard escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && currentStep !== "processing") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentStep, onClose]);

  // Toggle skip intro preference
  const handleToggleSkipIntro = useCallback(async (checked: boolean) => {
    setSkipIntroPreference(checked);
    try {
      await rpc.request.saveConfig({ skipReportIntro: checked });
    } catch (err) {
      console.error("Failed to save skipReportIntro preference:", err);
    }
  }, []);

  // Copy prompt text to clipboard
  const handleCopyPrompt = useCallback(async () => {
    if (!promptData) return;
    const textToCopy =
      promptTab === "system"
        ? promptData.systemPrompt
        : promptTab === "user"
        ? promptData.userPrompt
        : promptData.fullPrompt;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedPrompt(true);
      setTimeout(() => {
        if (isMountedRef.current) setCopiedPrompt(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to copy prompt to clipboard:", err);
    }
  }, [promptData, promptTab]);

  // Start LLM streaming generation (Step 3)
  const handleStartProcessing = useCallback(async () => {
    if (!portfolioId) return;

    setCurrentStep("processing");
    setLastWordsStream("");
    setChunkCount(0);
    setErrorMessage(null);
    clearPollTimer();

    try {
      const config = await rpc.request.getConfig({});
      const streamRes = await rpc.request.startReportStream({
        portfolioId,
        provider: config.llmProvider,
        model: config.llmModel,
        apiKey: config.llmApiKey,
        baseUrl: config.llmBaseUrl || config.llamacppServerUrl,
      });

      if (!isMountedRef.current) return;
      const sid = streamRes.sessionId;
      setActiveSessionId(sid);

      // Start polling loop
      const poll = async () => {
        if (!isMountedRef.current) return;
        try {
          const statusRes = await rpc.request.pollReportStream({ sessionId: sid });
          if (!isMountedRef.current) return;

          if (statusRes.lastWords) {
            setLastWordsStream(statusRes.lastWords);
          }
          if (statusRes.chunkCount) {
            setChunkCount(statusRes.chunkCount);
          }

          if (statusRes.status === "running") {
            pollTimerRef.current = setTimeout(() => void poll(), 180);
          } else if (statusRes.status === "success") {
            setGeneratedReport(statusRes.report ?? null);
            setConfirmationStatus("success");
            setCurrentStep("confirmation");
          } else if (statusRes.status === "cancelled") {
            setConfirmationStatus("cancelled");
            setCurrentStep("confirmation");
          } else {
            setErrorMessage(statusRes.error || "Report generation failed");
            setConfirmationStatus("fail");
            setCurrentStep("confirmation");
          }
        } catch (pollErr: unknown) {
          if (!isMountedRef.current) return;
          const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
          setErrorMessage(msg || "Failed to poll generation status");
          setConfirmationStatus("fail");
          setCurrentStep("confirmation");
        }
      };

      pollTimerRef.current = setTimeout(() => void poll(), 200);
    } catch (startErr: unknown) {
      if (!isMountedRef.current) return;
      const msg = startErr instanceof Error ? startErr.message : String(startErr);
      setErrorMessage(msg || "Failed to initiate report generation stream");
      setConfirmationStatus("fail");
      setCurrentStep("confirmation");
    }
  }, [portfolioId]);

  // Cancel LLM generation
  const handleCancelProcessing = useCallback(async () => {
    clearPollTimer();
    if (activeSessionId) {
      try {
        await rpc.request.cancelReportStream({ sessionId: activeSessionId });
      } catch (err) {
        console.error("Failed to cancel report stream:", err);
      }
    }
    setConfirmationStatus("cancelled");
    setCurrentStep("confirmation");
  }, [activeSessionId]);

  // View finished report
  const handleFinishAndSelect = useCallback(async () => {
    if (generatedReport?.id) {
      await onReportGenerated(generatedReport.id);
    }
    onClose();
  }, [generatedReport, onReportGenerated, onClose]);

  if (!isOpen) return null;

  const stepIndex =
    currentStep === "intro"
      ? 0
      : currentStep === "context"
      ? 1
      : currentStep === "processing"
      ? 2
      : 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono overflow-y-auto">
      <div className="relative w-full max-w-2xl flex flex-col rounded-xl sm:rounded-2xl border border-[#DD3C73]/30 bg-slate-900 shadow-2xl overflow-hidden max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/70 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg border border-[#DD3C73]/30 bg-[#DD3C73]/10 flex items-center justify-center text-[#DD3C73] shrink-0">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 truncate">
              Report Generation Wizard
            </span>
          </div>

          <button
            onClick={onClose}
            disabled={currentStep === "processing"}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-30"
            title="Close wizard"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Wizard Step Progress Bar */}
        <div className="bg-slate-950 border-b border-slate-800 px-3.5 sm:px-5 py-2 shrink-0">
          <div className="flex items-center justify-between gap-1 sm:gap-2">
            {WIZARD_STEPS.map((step, idx) => {
              const isPassed = stepIndex > idx;
              const isCurrent = stepIndex === idx;

              return (
                <div key={step.id} className="flex items-center gap-1.5 min-w-0 flex-1">
                  <div
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors truncate ${
                      isCurrent
                        ? "bg-[#DD3C73]/20 border border-[#DD3C73]/40 text-[#DD3C73]"
                        : isPassed
                        ? "bg-[#A7E2C0]/10 border border-[#A7E2C0]/30 text-[#A7E2C0]"
                        : "text-slate-500 border border-transparent"
                    }`}
                  >
                    {isPassed ? (
                      <Check className="w-2.5 h-2.5 shrink-0 stroke-[3]" />
                    ) : (
                      <span className="shrink-0">{step.number}</span>
                    )}
                    <span className="hidden sm:inline truncate">{step.label}</span>
                  </div>
                  {idx < WIZARD_STEPS.length - 1 && (
                    <div
                      className={`h-0.5 flex-1 min-w-2 rounded-full ${
                        isPassed ? "bg-[#A7E2C0]/40" : "bg-slate-800"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 custom-scrollbar">
          {/* STEP 1: EXPLAIN INTRO */}
          {currentStep === "intro" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100 uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-[#DD3C73] shrink-0" />
                <span>Autonomous Quantitative Diagnostic & Strategic AI Assessment</span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Generate an on-demand comprehensive investment briefing. The engine scans your multi-asset portfolio, calculates momentum indicators (SMA50, SMA200, RSI), evaluates asset allocations, and consults the AI advisor for objective rebalancing insights.
              </p>

              {/* Telemetry Preview Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-0.5">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Wallet className="w-3 h-3 text-[#DD3C73]" />
                    <span>Valuation</span>
                  </div>
                  <div className="font-bold text-slate-100 text-xs truncate">
                    {fmtCurrency(
                      summary?.totalPortfolioValue ?? (summary?.totalValue ?? 0) + (summary?.cashBalance ?? 0),
                      baseCurrency,
                      hideCurrencyValues
                    )}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-0.5">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Layers className="w-3 h-3 text-[#ab97f7]" />
                    <span>Positions</span>
                  </div>
                  <div className="font-bold text-slate-100 text-xs">
                    {holdingsCount} Assets Tracked
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-0.5">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Percent className="w-3 h-3 text-[#A7E2C0]" />
                    <span>Cash Liquidity</span>
                  </div>
                  <div className="font-bold text-slate-100 text-xs truncate">
                    {summary?.cashWeightPercent ?? 0}% ({fmtCurrency(summary?.cashBalance ?? 0, baseCurrency, hideCurrencyValues)})
                  </div>
                </div>
              </div>

              {/* Pipeline Overview */}
              <div className="flex flex-col gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5 text-[#DD3C73]" />
                  <span>Pipeline Operations</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-400">
                  <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900 border border-slate-800/80">
                    <BarChart3 className="w-3.5 h-3.5 text-[#A7E2C0] shrink-0" />
                    <span className="truncate">Weight allocations & returns</span>
                  </div>
                  <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900 border border-slate-800/80">
                    <TrendingUp className="w-3.5 h-3.5 text-[#ab97f7] shrink-0" />
                    <span className="truncate">SMA 50/200 & RSI momentum</span>
                  </div>
                  <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900 border border-slate-800/80">
                    <Bot className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
                    <span className="truncate">Tactical rebalancing advice</span>
                  </div>
                  <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900 border border-slate-800/80">
                    <Database className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">Weekly snapshot archival</span>
                  </div>
                </div>
              </div>

              {/* Skip Intro Checkbox */}
              <div className="pt-2 border-t border-slate-800/80">
                <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={skipIntroPreference}
                    onChange={(e) => void handleToggleSkipIntro(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-[#DD3C73] focus:ring-[#DD3C73] focus:ring-offset-slate-900 cursor-pointer accent-[#DD3C73]"
                  />
                  <span>Skip this introduction step in future report generations</span>
                </label>
              </div>
            </div>
          )}

          {/* STEP 2: BUILD CONTEXT & INSPECT PROMPT */}
          {currentStep === "context" && (
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-100 uppercase tracking-wider">
                  <Database className="w-4 h-4 text-[#DD3C73] shrink-0" />
                  <span>Context Compilation & Prompt Review</span>
                </div>
                {promptData && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#A7E2C0]/30 bg-[#A7E2C0]/10 text-[#A7E2C0] uppercase">
                    Context Ready
                  </span>
                )}
              </div>

              {promptLoading ? (
                <div className="p-10 flex flex-col items-center justify-center text-center gap-2.5 border border-slate-800 rounded-xl bg-slate-950">
                  <RefreshCw className="w-6 h-6 animate-spin text-[#DD3C73]" />
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Extracting Ledger & Technical Context
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Aggregating price channels, indicators, and valuation states...
                  </div>
                </div>
              ) : promptError ? (
                <div className="p-4 rounded-xl border border-[#DD3C73]/40 bg-[#DD3C73]/10 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#DD3C73]">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Failed to Build Report Context</span>
                  </div>
                  <p className="text-xs text-[#DD3C73]/90 font-mono">{promptError}</p>
                  <button
                    type="button"
                    onClick={() => void loadPromptContext()}
                    className="self-start mt-1 px-3 py-1 rounded bg-[#DD3C73] text-white text-xs font-bold hover:bg-[#c82f63] cursor-pointer"
                  >
                    Retry Context Compilation
                  </button>
                </div>
              ) : promptData ? (
                <div className="flex flex-col gap-3">
                  {/* Context Metadata Pill */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs">
                    <div className="flex items-center gap-2 text-slate-300">
                      <span className="text-slate-500 uppercase text-[10px]">Period:</span>
                      <span className="font-bold text-slate-200">{promptData.period}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <span>{promptData.holdingsCount} assets evaluated</span>
                      <span className="text-slate-700">•</span>
                      <span>
                        Target Model: <span className="font-bold text-slate-200">{promptData.model}</span> (
                        <span className="uppercase">{promptData.provider}</span>)
                      </span>
                    </div>
                  </div>

                  {/* Prompt Payload Viewer */}
                  <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPromptTab("full")}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase transition-colors cursor-pointer ${
                            promptTab === "full"
                              ? "bg-[#DD3C73]/20 border border-[#DD3C73]/40 text-[#DD3C73]"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          Full Prompt
                        </button>
                        <button
                          type="button"
                          onClick={() => setPromptTab("user")}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase transition-colors cursor-pointer ${
                            promptTab === "user"
                              ? "bg-[#DD3C73]/20 border border-[#DD3C73]/40 text-[#DD3C73]"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          User Instructions
                        </button>
                        <button
                          type="button"
                          onClick={() => setPromptTab("system")}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase transition-colors cursor-pointer ${
                            promptTab === "system"
                              ? "bg-[#DD3C73]/20 border border-[#DD3C73]/40 text-[#DD3C73]"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          System Persona
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleCopyPrompt()}
                        className="h-6 inline-flex items-center gap-1 px-2 rounded border border-slate-800 bg-slate-950 text-[10px] font-medium text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
                        title="Copy prompt to clipboard"
                      >
                        {copiedPrompt ? (
                          <>
                            <CheckCheck className="w-3 h-3 text-[#A7E2C0]" />
                            <span className="text-[#A7E2C0]">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-400" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="p-3 max-h-56 overflow-y-auto text-slate-300 text-xs font-mono leading-relaxed select-text whitespace-pre-wrap custom-scrollbar bg-black/40">
                      {promptTab === "system"
                        ? promptData.systemPrompt
                        : promptTab === "user"
                        ? promptData.userPrompt
                        : promptData.fullPrompt}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* STEP 3: LLM PROCESSING & STREAMING */}
          {currentStep === "processing" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#DD3C73] animate-pulse shadow-[0_0_8px_rgba(221,60,115,0.7)]" />
                  <span className="text-xs font-bold text-[#DD3C73] uppercase tracking-wider">
                    Autonomous LLM Inference In Progress
                  </span>
                </div>
                <span className="text-[11px] font-bold text-slate-400">
                  {chunkCount > 0 ? `${chunkCount} token chunks received` : "Establishing stream…"}
                </span>
              </div>

              {/* Streaming Monitor Card */}
              <div className="rounded-xl border border-[#DD3C73]/40 bg-slate-950 p-3.5 flex flex-col gap-2.5 shadow-lg shadow-[#DD3C73]/5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300">
                    <Sparkles className="w-3.5 h-3.5 text-[#DD3C73]" />
                    <span>Real-Time Stream Window (Last 50 Words)</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">Live Window</span>
                </div>

                <div className="p-3 rounded-lg bg-black/60 border border-slate-800 text-xs text-slate-200 font-mono leading-relaxed min-h-[90px] flex items-center">
                  {lastWordsStream ? (
                    <div className="select-text">
                      <span className="text-slate-400">… </span>
                      <span>{lastWordsStream}</span>
                      <span className="inline-block w-1.5 h-3.5 ml-1 bg-[#DD3C73] animate-pulse align-middle" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-slate-500 italic">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#DD3C73]" />
                      <span>Awaiting model inference stream tokens...</span>
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 italic text-center">
                  Displaying trailing words from the real-time stream. The complete formatted report will be presented in the final view.
                </p>
              </div>
            </div>
          )}

          {/* STEP 4: CONFIRMATION (SUCCESS, FAIL, OR CANCEL) */}
          {currentStep === "confirmation" && (
            <div className="flex flex-col gap-4">
              {/* SUCCESS STATE */}
              {confirmationStatus === "success" && (
                <div className="flex flex-col gap-3.5">
                  <div className="p-3.5 rounded-xl border border-[#A7E2C0]/40 bg-[#A7E2C0]/10 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full border border-[#A7E2C0]/50 bg-[#A7E2C0]/20 flex items-center justify-center text-[#A7E2C0] shrink-0">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-[#A7E2C0] uppercase tracking-wider">
                        Report Generated Successfully
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Autonomous quantitative diagnostic completed and archived in reports history.
                      </div>
                    </div>
                  </div>

                  {generatedReport && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[#DD3C73] font-bold uppercase">{generatedReport.period}</span>
                          <span className="text-slate-600">•</span>
                          <span className="text-slate-400">{generatedReport.metrics?.holdingsCount ?? 0} assets evaluated</span>
                        </div>
                        <div className="font-bold text-slate-100">
                          {fmtCurrency(
                            generatedReport.metrics?.totalPortfolioValue,
                            generatedReport.metrics?.baseCurrency || baseCurrency,
                            hideCurrencyValues
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-slate-300 leading-relaxed line-clamp-3 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                        {(hideCurrencyValues ? maskFinancialValues(generatedReport.summary) : generatedReport.summary) ||
                          "Quantitative strategic review and rebalancing tactical recommendations generated."}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* CANCELLED STATE */}
              {confirmationStatus === "cancelled" && (
                <div className="flex flex-col gap-3.5">
                  <div className="p-3.5 rounded-xl border border-[#E3EACD]/40 bg-[#E3EACD]/10 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full border border-[#E3EACD]/50 bg-[#E3EACD]/20 flex items-center justify-center text-[#E3EACD] shrink-0">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-[#E3EACD] uppercase tracking-wider">
                        Report Generation Cancelled
                      </div>
                      <div className="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                        The generation process was stopped before completion. No new report was archived.
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#E3EACD]/40 bg-[#E3EACD]/10 text-[#E3EACD] uppercase">
                      Cancelled
                    </span>
                  </div>
                </div>
              )}

              {/* FAIL STATE */}
              {confirmationStatus === "fail" && (
                <div className="flex flex-col gap-3.5">
                  <div className="p-3.5 rounded-xl border border-[#DD3C73]/40 bg-[#DD3C73]/10 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-[#DD3C73] shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-[#DD3C73] uppercase tracking-wider">
                        Report Generation Failed
                      </div>
                      <div className="text-xs text-[#DD3C73] font-mono break-words leading-relaxed mt-1.5 p-2 rounded-lg bg-black/40 border border-[#DD3C73]/20">
                        {errorMessage || "Failed to communicate with the portfolio advisor engine."}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/70 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0 gap-2">
          <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">
            {currentStep === "intro" && <span>Step 1 of 4: Introduction</span>}
            {currentStep === "context" && <span>Step 2 of 4: Context & Prompt Inspection</span>}
            {currentStep === "processing" && <span className="text-[#DD3C73]">Step 3 of 4: Live Model Inference</span>}
            {currentStep === "confirmation" && (
              <span className={confirmationStatus === "success" ? "text-[#A7E2C0] font-bold" : "text-slate-400"}>
                Step 4 of 4: Operation Status
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* STEP 1 FOOTER */}
            {currentStep === "intro" && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 sm:px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep("context")}
                  className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider"
                >
                  <span>Build Context</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </>
            )}

            {/* STEP 2 FOOTER */}
            {currentStep === "context" && (
              <>
                <button
                  type="button"
                  onClick={() => setCurrentStep("intro")}
                  className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  disabled={promptLoading || Boolean(promptError)}
                  onClick={() => void handleStartProcessing()}
                  className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Run Analysis</span>
                </button>
              </>
            )}

            {/* STEP 3 FOOTER */}
            {currentStep === "processing" && (
              <button
                type="button"
                onClick={() => void handleCancelProcessing()}
                className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg border border-[#DD3C73]/50 bg-[#DD3C73]/15 text-[#DD3C73] hover:bg-[#DD3C73]/25 text-xs font-bold cursor-pointer uppercase tracking-wider transition-colors"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Cancel Generation</span>
              </button>
            )}

            {/* STEP 4 FOOTER */}
            {currentStep === "confirmation" && (
              <>
                {confirmationStatus === "success" && (
                  <button
                    type="button"
                    onClick={() => void handleFinishAndSelect()}
                    className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#243C8F] hover:bg-[#341B83] text-white text-xs font-bold transition-all shadow-lg shadow-[#243C8F]/25 cursor-pointer uppercase tracking-wider"
                  >
                    <span>View Report</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}

                {confirmationStatus === "cancelled" && (
                  <>
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 sm:px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentStep("context")}
                      className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider"
                    >
                      <span>Restart Wizard</span>
                    </button>
                  </>
                )}

                {confirmationStatus === "fail" && (
                  <>
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 sm:px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentStep("context")}
                      className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Retry</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

