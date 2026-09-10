import { rpc } from "../../rpc";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  Calendar,
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
import { Select } from "../common/Select";
import type { FinancialPortfolioData, PortfolioReport } from "../../types/portfolio";
import type { PrepareReportPromptResponse } from "../../../../shared/rpc-types.js";
import { fmtCurrency } from "./utils";

interface AnalyzePortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReportGenerated: (newReportId: string) => Promise<void> | void;
  portfolioData: FinancialPortfolioData | null;
  portfolioId?: string;
  hideCurrencyValues?: boolean;
  reports?: PortfolioReport[];
}

type WizardStep = "period" | "prompt" | "process" | "result";
type ConfirmationStatus = "success" | "fail" | "cancelled";

const WIZARD_STEPS = [
  { id: "period", label: "Period" },
  { id: "prompt", label: "Prompt" },
  { id: "process", label: "Process" },
  { id: "result", label: "Result" },
] as const;

interface WeekOption {
  key: string;
  displayKey: string;
  label: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  isPrevious: boolean;
}

function generateWeekOptions(count = 52): WeekOption[] {
  const now = new Date();
  const currentMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const currentDay = currentMonday.getDay();
  const diffToMonday = (currentDay + 6) % 7;
  currentMonday.setDate(currentMonday.getDate() - diffToMonday);

  const options: WeekOption[] = [];

  for (let i = 0; i < count; i++) {
    const monday = new Date(currentMonday);
    monday.setDate(monday.getDate() - i * 7);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const thursday = new Date(monday);
    thursday.setDate(monday.getDate() + 3);
    const isoYear = thursday.getFullYear();
    const jan4 = new Date(isoYear, 0, 4, 12, 0, 0);
    const jan4Day = jan4.getDay() || 7;
    const week1Monday = new Date(isoYear, 0, 4 - (jan4Day - 1), 12, 0, 0);
    const weekNum = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;

    const padWeek = String(weekNum).padStart(2, "0");
    const key = `${isoYear}-w${padWeek}`;
    const displayKey = `${isoYear}-W${padWeek}`;

    const startStr = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endStr = sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const dateRange = `${startStr} - ${endStr}`;

    options.push({
      key,
      displayKey,
      label: `${displayKey} (${dateRange})`,
      startDate: monday.toISOString().split("T")[0]!,
      endDate: sunday.toISOString().split("T")[0]!,
      isCurrent: i === 0,
      isPrevious: i === 1,
    });
  }

  return options;
}

export function AnalyzePortfolioModal({
  isOpen,
  onClose,
  onReportGenerated,
  portfolioData,
  portfolioId,
  hideCurrencyValues = false,
  reports = [],
}: AnalyzePortfolioModalProps) {
  const weekOptions = useMemo(() => generateWeekOptions(52), []);
  const defaultWeekKey = useMemo(() => {
    const prev = weekOptions.find((w) => w.isPrevious);
    return prev ? prev.key : weekOptions[0]?.key || "";
  }, [weekOptions]);

  const [currentStep, setCurrentStep] = useState<WizardStep>("period");
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>(defaultWeekKey);

  const [promptData, setPromptData] = useState<PrepareReportPromptResponse | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
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

  const selectedWeek = useMemo(
    () => weekOptions.find((w) => w.key.toLowerCase() === selectedWeekKey.toLowerCase()),
    [weekOptions, selectedWeekKey],
  );

  const hasExistingReport = useMemo(() => {
    return reports.some((r) => r.weekKey?.toLowerCase() === selectedWeekKey.toLowerCase());
  }, [reports, selectedWeekKey]);

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
    setCurrentStep("period");
    setSelectedWeekKey(defaultWeekKey);
    setPromptData(null);
    setPromptLoading(false);
    setPromptError(null);
    setActiveSessionId(null);
    setLastWordsStream("");
    setChunkCount(0);
    setGeneratedReport(null);
    setErrorMessage(null);
  }, [isOpen, defaultWeekKey]);

  // Load context prompt when entering Step 2 or changing week
  const loadPromptContext = useCallback(
    async (weekKeyToUse: string) => {
      if (!portfolioId) return;
      setPromptLoading(true);
      setPromptError(null);

      try {
        const config = await rpc.request.getConfig({});
        const res = await rpc.request.prepareReportPrompt({
          portfolioId,
          provider: config.llmProvider,
          model: config.llmModel,
          weekKey: weekKeyToUse,
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
    },
    [portfolioId],
  );

  useEffect(() => {
    if (isOpen && currentStep === "prompt" && (!promptData || promptData.weekKey !== selectedWeekKey) && !promptLoading) {
      void loadPromptContext(selectedWeekKey);
    }
  }, [isOpen, currentStep, promptData, promptLoading, selectedWeekKey, loadPromptContext]);

  // Keyboard escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && currentStep !== "process") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentStep, onClose]);

  // Copy prompt text to clipboard
  const handleCopyPrompt = useCallback(async () => {
    if (!promptData?.fullPrompt) return;
    try {
      await navigator.clipboard.writeText(promptData.fullPrompt);
      setCopiedPrompt(true);
      setTimeout(() => {
        if (isMountedRef.current) setCopiedPrompt(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to copy prompt to clipboard:", err);
    }
  }, [promptData]);

  // Start LLM streaming generation (Step 3)
  const handleStartProcessing = useCallback(async () => {
    if (!portfolioId) return;

    setCurrentStep("process");
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
        weekKey: selectedWeekKey,
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
            setCurrentStep("result");
          } else if (statusRes.status === "cancelled") {
            setConfirmationStatus("cancelled");
            setCurrentStep("result");
          } else {
            setErrorMessage(statusRes.error || "Report generation failed");
            setConfirmationStatus("fail");
            setCurrentStep("result");
          }
        } catch (pollErr: unknown) {
          if (!isMountedRef.current) return;
          const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
          setErrorMessage(msg || "Failed to poll generation status");
          setConfirmationStatus("fail");
          setCurrentStep("result");
        }
      };

      pollTimerRef.current = setTimeout(() => void poll(), 200);
    } catch (startErr: unknown) {
      if (!isMountedRef.current) return;
      const msg = startErr instanceof Error ? startErr.message : String(startErr);
      setErrorMessage(msg || "Failed to initiate report generation stream");
      setConfirmationStatus("fail");
      setCurrentStep("result");
    }
  }, [portfolioId, selectedWeekKey]);

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
    setCurrentStep("result");
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
    currentStep === "period"
      ? 0
      : currentStep === "prompt"
      ? 1
      : currentStep === "process"
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
            disabled={currentStep === "process"}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-30"
            title="Close wizard"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Centered Single-Word Steps Progress Bar */}
        <div className="bg-slate-950 border-b border-slate-800 px-3.5 sm:px-5 py-2.5 shrink-0 flex items-center justify-center">
          <div className="flex items-center justify-center gap-2 sm:gap-4 max-w-lg w-full">
            {WIZARD_STEPS.map((step, idx) => {
              const isPassed = stepIndex > idx;
              const isCurrent = stepIndex === idx;

              return (
                <React.Fragment key={step.id}>
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
                      isCurrent
                        ? "bg-[#DD3C73]/20 border border-[#DD3C73]/40 text-[#DD3C73]"
                        : isPassed
                        ? "bg-[#A7E2C0]/10 border border-[#A7E2C0]/30 text-[#A7E2C0]"
                        : "text-slate-500 border border-transparent"
                    }`}
                  >
                    {isPassed ? (
                      <Check className="w-3 h-3 shrink-0 stroke-[3]" />
                    ) : (
                      <span className="w-4 h-4 rounded-full bg-slate-800 text-[10px] flex items-center justify-center text-slate-400 font-mono">
                        {idx + 1}
                      </span>
                    )}
                    <span>{step.label}</span>
                  </div>
                  {idx < WIZARD_STEPS.length - 1 && (
                    <div
                      className={`h-0.5 w-6 sm:w-10 rounded-full shrink-0 ${
                        isPassed ? "bg-[#A7E2C0]/40" : "bg-slate-800"
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 custom-scrollbar">
          {/* STEP 1: PERIOD SELECTION */}
          {currentStep === "period" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100 uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-[#DD3C73] shrink-0" />
                <span>Select Target Analysis Period</span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Choose the target weekly interval for performance attribution, technical momentum indicators (SMA50, SMA200, RSI), and AI-driven portfolio diagnostics.
              </p>

              {/* Week Picker Dropdown */}
              <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#DD3C73]" />
                  <span>Target Week</span>
                </label>
                <Select
                  value={selectedWeekKey}
                  onChange={(e) => setSelectedWeekKey(e.target.value)}
                  aria-label="Target week"
                >
                  {weekOptions.map((w) => {
                    const hasReport = reports.some(
                      (r) => r.weekKey?.toLowerCase() === w.key.toLowerCase(),
                    );
                    return (
                      <option key={w.key} value={w.key}>
                        {w.label}
                        {w.isCurrent ? " [Current Week]" : ""}
                        {w.isPrevious ? " [Default / Completed]" : ""}
                        {hasReport ? " [Report Exists]" : ""}
                      </option>
                    );
                  })}
                </Select>

                {/* Current Running Week Warning */}
                {selectedWeek?.isCurrent && (
                  <div className="mt-1 p-2.5 rounded-lg border border-[#E3EACD]/40 bg-[#E3EACD]/10 flex items-center gap-2 text-xs text-[#E3EACD]">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-[#E3EACD]" />
                    <span>Notice: This week is currently in progress. Market data and weekly metrics are partial.</span>
                  </div>
                )}

                {/* Existing Report Replacement Alert */}
                {hasExistingReport && (
                  <div className="mt-1 p-2.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/10 flex items-center gap-2 text-xs text-[#DD3C73]">
                    <AlertCircle className="w-4 h-4 shrink-0 text-[#DD3C73]" />
                    <span>Notice: A report already exists for this week. Running analysis will replace the existing report.</span>
                  </div>
                )}
              </div>

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
                      hideCurrencyValues,
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
                  <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900 border border-slate-800/80">
                    <Sparkles className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
                    <span className="truncate">Finnhub market news & ratings</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: BUILD CONTEXT & INSPECT FULL PROMPT (MARKDOWN) */}
          {currentStep === "prompt" && (
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-100 uppercase tracking-wider">
                  <Database className="w-4 h-4 text-[#DD3C73] shrink-0" />
                  <span>Context Compilation & Full Prompt</span>
                </div>
                {promptData && (
                  <div className="flex items-center gap-2">
                    {promptData.finnhubConfigured ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#A7E2C0]/30 bg-[#A7E2C0]/10 text-[#A7E2C0] uppercase flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        <span>Finnhub Enriched ({promptData.finnhubNewsCount || 0} news)</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 px-2 py-0.5 rounded border border-slate-800 bg-slate-950 font-mono">
                        Finnhub: Off
                      </span>
                    )}
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#A7E2C0]/30 bg-[#A7E2C0]/10 text-[#A7E2C0] uppercase">
                      Context Ready
                    </span>
                  </div>
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
                    onClick={() => void loadPromptContext(selectedWeekKey)}
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
                      <span className="text-slate-500 font-mono text-[11px]">({promptData.weekKey})</span>
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

                  {/* Full Prompt Viewer Rendered as Markdown */}
                  <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3.5 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                          Full Prompt
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                          Markdown
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleCopyPrompt()}
                        className="h-6 inline-flex items-center gap-1 px-2 rounded border border-slate-800 bg-slate-950 text-[10px] font-medium text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
                        title="Copy full prompt to clipboard"
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

                    <div className="p-3.5 max-h-72 overflow-y-auto text-slate-300 text-xs font-mono leading-relaxed select-text custom-scrollbar bg-black/40">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ node: _n, ...props }) => (
                            <h1 className="text-xs font-bold uppercase tracking-wider text-[#DD3C73] border-b border-slate-800 pb-1 mt-3 mb-1.5" {...props} />
                          ),
                          h2: ({ node: _n, ...props }) => (
                            <h2 className="text-xs font-bold uppercase tracking-wider text-[#DD3C73] mt-3 mb-1.5" {...props} />
                          ),
                          h3: ({ node: _n, ...props }) => (
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 mt-2.5 mb-1" {...props} />
                          ),
                          p: ({ node: _n, ...props }) => <p className="mb-2 text-slate-300 leading-relaxed text-xs" {...props} />,
                          ul: ({ node: _n, ...props }) => <ul className="list-disc list-outside pl-4 mb-2 space-y-0.5 text-slate-300 text-xs" {...props} />,
                          ol: ({ node: _n, ...props }) => <ol className="list-decimal list-outside pl-4 mb-2 space-y-0.5 text-slate-300 text-xs" {...props} />,
                          li: ({ node: _n, ...props }) => <li className="text-slate-300 leading-relaxed" {...props} />,
                          blockquote: ({ node: _n, ...props }) => (
                            <blockquote className="border-l-2 border-[#DD3C73] bg-[#DD3C73]/5 px-2.5 py-1.5 my-2 text-slate-400 italic rounded-r text-xs" {...props} />
                          ),
                          strong: ({ node: _n, ...props }) => <strong className="font-bold text-slate-100" {...props} />,
                          code: ({ node: _n, ...props }) => (
                            <code className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[#E3EACD] font-mono text-[11px]" {...props} />
                          ),
                        }}
                      >
                        {promptData.fullPrompt}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* STEP 3: LLM PROCESSING & STREAMING */}
          {currentStep === "process" && (
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

                <p className="text-[10px] text-slate-500 italic text-center">
                  Displaying trailing words from the real-time stream. The complete formatted report will be presented in the final view.
                </p>
              </div>
            </div>
          )}

          {/* STEP 4: CONFIRMATION (SUCCESS, FAIL, OR CANCEL) */}
          {currentStep === "result" && (
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
                            hideCurrencyValues,
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-slate-300 leading-relaxed line-clamp-3 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                        {generatedReport.summary ||
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
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/70 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0">
          {/* Left: Back button or secondary close */}
          <div>
            {currentStep === "prompt" && (
              <button
                type="button"
                onClick={() => setCurrentStep("period")}
                className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}

            {currentStep === "result" && (confirmationStatus === "cancelled" || confirmationStatus === "fail") && (
              <button
                type="button"
                onClick={onClose}
                className="px-3 sm:px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Close
              </button>
            )}
          </div>

          {/* Right: Primary action button */}
          <div className="flex items-center gap-2">
            {currentStep === "period" && (
              <button
                type="button"
                onClick={() => setCurrentStep("prompt")}
                className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider"
              >
                <span>Build Context</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === "prompt" && (
              <button
                type="button"
                disabled={promptLoading || Boolean(promptError)}
                onClick={() => void handleStartProcessing()}
                className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Run Analysis</span>
              </button>
            )}

            {currentStep === "process" && (
              <button
                type="button"
                onClick={() => void handleCancelProcessing()}
                className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg border border-[#DD3C73]/50 bg-[#DD3C73]/15 text-[#DD3C73] hover:bg-[#DD3C73]/25 text-xs font-bold cursor-pointer uppercase tracking-wider transition-colors"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Cancel Generation</span>
              </button>
            )}

            {currentStep === "result" && (
              <>
                {confirmationStatus === "success" && (
                  <button
                    type="button"
                    onClick={() => void handleFinishAndSelect()}
                    className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider"
                  >
                    <span>View Report</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}

                {confirmationStatus === "cancelled" && (
                  <button
                    type="button"
                    onClick={() => setCurrentStep("period")}
                    className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider"
                  >
                    <span>Restart Wizard</span>
                  </button>
                )}

                {confirmationStatus === "fail" && (
                  <button
                    type="button"
                    onClick={() => setCurrentStep("period")}
                    className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
