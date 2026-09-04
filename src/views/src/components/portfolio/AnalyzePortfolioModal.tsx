import { rpc } from "../../rpc";
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  Circle,
  Database,
  Layers,
  Percent,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import type { FinancialPortfolioData, PortfolioReport } from "../../types/portfolio";
import { fmtCurrency, maskFinancialValues } from "./utils";

interface AnalyzePortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReportGenerated: (newReportId: string) => Promise<void> | void;
  portfolioData: FinancialPortfolioData | null;
  portfolioId?: string;
  hideCurrencyValues?: boolean;
}

type ModalStage = "intro" | "running" | "success" | "error";

interface AnalysisStep {
  id: string;
  number: string;
  title: string;
  description: string;
  Icon: React.ElementType;
}

const ANALYSIS_STEPS: AnalysisStep[] = [
  {
    id: "snapshot",
    number: "01",
    title: "Aggregating Positions & Trade History",
    description: "Extracting active holdings, cost bases, cash balance, and recent period transactions.",
    Icon: Wallet,
  },
  {
    id: "metrics",
    number: "02",
    title: "Computing Valuation & Asset Allocations",
    description: "Calculating portfolio weights, cash liquidity ratios, and period return benchmarks.",
    Icon: BarChart3,
  },
  {
    id: "technicals",
    number: "03",
    title: "Evaluating Technical Indicators",
    description: "Scanning RSI momentum zones, 50/200 SMA trendlines, and 52-week price channels.",
    Icon: TrendingUp,
  },
  {
    id: "ai_advisor",
    number: "04",
    title: "Autonomous AI Strategic Assessment",
    description: "Consulting quantitative advisor model for rebalancing and risk mitigation advice.",
    Icon: Brain,
  },
  {
    id: "indexing",
    number: "05",
    title: "Compiling & Archiving Historical Report",
    description: "Formatting tactical markdown report and archiving snapshot in reports history.",
    Icon: Database,
  },
];

export function AnalyzePortfolioModal({
  isOpen,
  onClose,
  onReportGenerated,
  portfolioData,
  portfolioId,
  hideCurrencyValues = false,
}: AnalyzePortfolioModalProps) {
  const [stage, setStage] = useState<ModalStage>("intro");
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [generatedReport, setGeneratedReport] = useState<PortfolioReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  const summary = portfolioData?.summary;
  const holdingsCount = portfolioData?.holdings?.filter((h: any) => h.assetType !== "Cash").length ?? 0;
  const baseCurrency = summary?.baseCurrency || "EUR";

  const clearTimers = () => {
    timerRefs.current.forEach((t) => clearTimeout(t));
    timerRefs.current = [];
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setStage("intro");
      setCurrentStepIndex(0);
      setGeneratedReport(null);
      setErrorMessage(null);
      clearTimers();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && stage !== "running") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, stage, onClose]);

  const handleStartAnalysis = useCallback(async () => {
    setStage("running");
    setCurrentStepIndex(0);
    setErrorMessage(null);
    clearTimers();

    const t1 = setTimeout(() => {
      if (isMountedRef.current) setCurrentStepIndex(1);
    }, 700);
    const t2 = setTimeout(() => {
      if (isMountedRef.current) setCurrentStepIndex(2);
    }, 1600);
    const t3 = setTimeout(() => {
      if (isMountedRef.current) setCurrentStepIndex(3);
    }, 2700);

    timerRefs.current = [t1, t2, t3];

    try {
      

      const config = await rpc.request.getConfig({});
      const result = await rpc.request.generateReport({ 
        portfolioId, 
        provider: config.llmProvider, 
        model: config.llmModel, 
        apiKey: config.llmApiKey, 
        baseUrl: config.llmBaseUrl || config.llamacppServerUrl 
      });
      clearTimers();
      const report: PortfolioReport | undefined = result;

      if (!report || !report.id) {
        throw new Error("Invalid response format received from portfolio advisor engine");
      }

      if (isMountedRef.current) {
        setCurrentStepIndex(4);
        setTimeout(() => {
          if (isMountedRef.current) {
            setCurrentStepIndex(5);
            setGeneratedReport(report);
            setStage("success");
          }
        }, 600);
      }
    } catch (err: any) {
      clearTimers();
      if (isMountedRef.current) {
        setErrorMessage(err?.message || "An unexpected error occurred during report generation");
        setStage("error");
      }
    }
  }, [portfolioId, portfolioData]);

  const handleFinishAndSelect = useCallback(async () => {
    if (generatedReport?.id) {
      await onReportGenerated(generatedReport.id);
    }
    onClose();
  }, [generatedReport, onReportGenerated, onClose]);

  if (!isOpen) return null;

  const progressPercent =
    stage === "success"
      ? 100
      : stage === "running"
      ? Math.min(Math.round(((currentStepIndex + 1) / ANALYSIS_STEPS.length) * 90), 95)
      : stage === "error"
      ? Math.round(((currentStepIndex + 1) / ANALYSIS_STEPS.length) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 font-mono overflow-y-auto">
      <div className="relative w-full max-w-xl flex flex-col rounded-xl sm:rounded-2xl border border-[#DD3C73]/30 bg-slate-900 shadow-2xl overflow-hidden max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-3.5 py-2.5 sm:px-5 sm:py-3.5 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Bot className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 truncate">
              Assistant
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={stage === "running"}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-3.5 sm:p-5 flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 custom-scrollbar">
          {/* STAGE 1: INTRO */}
          {stage === "intro" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100 uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-[#DD3C73] shrink-0" />
                <span>On-Demand Quantitative Intelligence Diagnostic</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Initiate a comprehensive multi-pass portfolio diagnostic. The system evaluates asset allocations, calculates RSI momentum and moving averages, and consults the AI advisor for tactical rebalancing recommendations.
              </p>

              {/* Telemetry Preview Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
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

                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Layers className="w-3 h-3 text-[#ab97f7]" />
                    <span>Positions</span>
                  </div>
                  <div className="font-bold text-slate-100 text-xs">
                    {holdingsCount} Assets Tracked
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Percent className="w-3 h-3 text-[#A7E2C0]" />
                    <span>Cash Liquidity</span>
                  </div>
                  <div className="font-bold text-slate-100 text-xs truncate">
                    {summary?.cashWeightPercent ?? 0}% ({fmtCurrency(summary?.cashBalance ?? 0, baseCurrency, hideCurrencyValues)})
                  </div>
                </div>
              </div>


              {/* Stepper Pipeline Overview */}
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 min-w-0">
                  <Layers className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="truncate">Execution Pipeline Steps</span>
                </div>
                <div className="flex flex-col gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
                  {ANALYSIS_STEPS.map((step) => {
                    const StepIcon = step.Icon;
                    return (
                      <div key={step.id} className="flex items-start gap-2.5 text-xs py-1 border-b border-slate-800/60 last:border-b-0">
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 shrink-0">
                          {step.number}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-200 flex items-center gap-1.5 min-w-0">
                            <StepIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{step.title}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate" title={step.description}>
                            {step.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STAGE 2: RUNNING */}
          {stage === "running" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#DD3C73] animate-pulse shadow-[0_0_8px_rgba(221,60,115,0.6)]" />
                    <span className="font-bold text-[#DD3C73] uppercase tracking-wider">
                      Executing Analysis Pipeline…
                    </span>
                  </div>
                  <span className="text-[11px] font-bold text-slate-400">
                    Step {Math.min(currentStepIndex + 1, ANALYSIS_STEPS.length)} of {ANALYSIS_STEPS.length} ({progressPercent}%)
                  </span>
                </div>

                <div className="w-full h-1.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-[#DD3C73] transition-all duration-500 ease-out shadow-[0_0_10px_rgba(221,60,115,0.8)]"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                {ANALYSIS_STEPS.map((step, idx) => {
                  const isDone = currentStepIndex > idx;
                  const isCurrent = currentStepIndex === idx;

                  return (
                    <div
                      key={step.id}
                      className={`flex items-start gap-3 p-2 rounded-lg transition-all duration-300 ${
                        isCurrent
                          ? "border border-[#DD3C73]/40 bg-[#DD3C73]/10 shadow-[0_0_12px_rgba(221,60,115,0.1)]"
                          : isDone
                          ? "bg-[#A7E2C0]/5 border border-[#A7E2C0]/20"
                          : "opacity-40 border border-transparent"
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {isDone ? (
                          <div className="w-4 h-4 rounded-full bg-[#A7E2C0]/20 border border-[#A7E2C0]/50 flex items-center justify-center text-[#A7E2C0]">
                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                          </div>
                        ) : isCurrent ? (
                          <div className="w-4 h-4 rounded-full bg-[#DD3C73]/20 border border-[#DD3C73] flex items-center justify-center text-[#DD3C73] animate-spin">
                            <RefreshCw className="w-2.5 h-2.5" />
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-slate-700 flex items-center justify-center text-slate-500">
                            <Circle className="w-2 h-2" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded border uppercase tracking-wider ${
                              isDone
                                ? "text-[#A7E2C0] border-[#A7E2C0]/30 bg-[#A7E2C0]/10"
                                : isCurrent
                                ? "text-[#DD3C73] border-[#DD3C73]/40 bg-[#DD3C73]/20"
                                : "text-slate-500 border-slate-800 bg-slate-900"
                            }`}
                          >
                            Step {step.number}
                          </span>
                          <span
                            className={`text-xs font-bold uppercase tracking-wider truncate ${
                              isDone ? "text-slate-100" : isCurrent ? "text-[#DD3C73]" : "text-slate-500"
                            }`}
                          >
                            {step.title}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                          {step.description}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="text-[11px] text-slate-500 text-center italic">
                Autonomous LLM inference in progress. Telemetry is being analyzed...
              </div>
            </div>
          )}

          {/* STAGE 3: SUCCESS */}
          {stage === "success" && generatedReport && (
            <div className="flex flex-col gap-4">
              {generatedReport.isFallback || generatedReport.status === "fallback" || generatedReport.error ? (
                <div className="p-3.5 rounded-xl border border-[#E3EACD]/50 bg-[#E3EACD]/10 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full border border-[#E3EACD]/60 bg-[#E3EACD]/20 flex items-center justify-center text-[#E3EACD] shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[#E3EACD] uppercase tracking-wider">
                      Report Generated (AI Fallback Telemetry)
                    </div>
                    <div className="text-[11px] text-slate-400 leading-snug mt-0.5">
                      {generatedReport.error ? `LLM issue: ${generatedReport.error}` : "AI reasoning offline; baseline quantitative report compiled."}
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#E3EACD]/40 bg-[#E3EACD]/10 text-[#E3EACD] uppercase">
                    Fallback
                  </span>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl border border-[#A7E2C0]/40 bg-[#A7E2C0]/10 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full border border-[#A7E2C0]/50 bg-[#A7E2C0]/20 flex items-center justify-center text-[#A7E2C0] shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[#A7E2C0] uppercase tracking-wider">
                      Report Generated Successfully
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Autonomous quantitative intelligence analysis completed and indexed.
                    </div>
                  </div>
                </div>
              )}

              {/* Summary card */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[#DD3C73] font-bold uppercase">{generatedReport.period}</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-slate-400">{generatedReport.metrics?.holdingsCount ?? 0} assets evaluated</span>
                  </div>
                  <div className="font-bold text-slate-100">
                    {fmtCurrency(generatedReport.metrics?.totalPortfolioValue, generatedReport.metrics?.baseCurrency || baseCurrency, hideCurrencyValues)}
                  </div>
                </div>

                <div className="text-xs text-slate-300 leading-relaxed line-clamp-3 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  {(hideCurrencyValues ? maskFinancialValues(generatedReport.summary) : generatedReport.summary) || "Quantitative strategic review and rebalancing tactical recommendations generated."}
                </div>
              </div>
            </div>
          )}

          {/* STAGE 4: ERROR */}
          {stage === "error" && (
            <div className="flex flex-col gap-4">
              <div className="p-3.5 rounded-xl border border-[#DD3C73]/40 bg-[#DD3C73]/10 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[#DD3C73] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-[#DD3C73] uppercase tracking-wider">
                    Analysis Generation Failed
                  </div>
                  <div className="text-xs text-[#DD3C73] font-mono break-words leading-relaxed mt-1.5 p-2 rounded-lg bg-black/40 border border-[#DD3C73]/20">
                    {errorMessage || "Failed to communicate with the portfolio advisor engine."}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0 gap-2">
          <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">
            {stage === "running" ? (
              <span>Please do not navigate away</span>
            ) : stage === "success" ? (
              <span className="text-[#A7E2C0] font-bold">✓ Ready for review</span>
            ) : (
              <span>Quantitative AI Engine</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {stage === "intro" && (
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
                  onClick={() => void handleStartAnalysis()}
                  className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Run Analysis</span>
                </button>
              </>
            )}

            {stage === "running" && (
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-500 cursor-not-allowed uppercase"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Analyzing…</span>
              </button>
            )}

            {stage === "success" && (
              <button
                type="button"
                onClick={() => void handleFinishAndSelect()}
                className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#243C8F] hover:bg-[#341B83] text-white text-xs font-bold transition-all shadow-lg shadow-[#243C8F]/25 cursor-pointer uppercase tracking-wider"
              >
                <span>View Report</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {stage === "error" && (
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
                  onClick={() => void handleStartAnalysis()}
                  className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
