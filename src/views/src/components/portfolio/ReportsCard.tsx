import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PortfolioReport, FinancialPortfolioData } from "../../types/portfolio";
import { fmtCurrency, fmtPercent, cleanThinkTags, formatTimeAgo, maskFinancialValues } from "./utils";
import {
  Sparkles,
  Calendar,
  Trash2,
  ChevronDown,
  Check,
  FileText,
  Bot,
  AlertCircle,
  AlertTriangle,
  Clock,
  Layers,
  Percent,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
  Activity,
  Info,
  Copy,
  CheckCheck,
  Terminal,
} from "lucide-react";
import { AnalyzePortfolioModal } from "./AnalyzePortfolioModal";
import { ReportPromptModal } from "./ReportPromptModal";

interface ReportsCardProps {
  reports: PortfolioReport[];
  portfolioData: FinancialPortfolioData | null;
  currency?: string;
  portfolioId?: string;
  loadingReports?: boolean;
  onRefreshReports: () => Promise<void>;
  onDeleteReport: (id: string) => void;
  hideValues?: boolean;
}

export function formatReportDropdownLabel(report: PortfolioReport): string {
  const weekKey = report.weekKey || report.id || "Report";
  let from = report.weekStartDate;
  let to = report.weekEndDate;

  if (!from || !to) {
    const match = /^(\d{4})-[wW](\d{1,2})$/.exec(weekKey);
    if (match) {
      const yr = parseInt(match[1]!, 10);
      const wk = parseInt(match[2]!, 10);
      const simple = new Date(Date.UTC(yr, 0, 4));
      const dayOfWeek = simple.getUTCDay() || 7;
      const monWeek1 = new Date(simple.getTime() - (dayOfWeek - 1) * 86400000);
      const monTarget = new Date(monWeek1.getTime() + (wk - 1) * 7 * 86400000);
      const sunTarget = new Date(monTarget.getTime() + 6 * 86400000);
      from = monTarget.toISOString().split("T")[0]!;
      to = sunTarget.toISOString().split("T")[0]!;
    }
  }

  if (from && to) {
    return `${weekKey} - ${from} - ${to}`;
  }

  if (report.period) {
    return `${weekKey} - ${report.period}`;
  }

  return weekKey;
}

export function ReportsCard({
  reports,
  portfolioData,
  currency = "EUR",
  portfolioId,
  loadingReports = false,
  onRefreshReports,
  onDeleteReport,
  hideValues = false,
}: ReportsCardProps) {
  const [selectedReportId, setSelectedReportId] = useState<string | null>(() => (reports[0] ? reports[0].id : null));
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isDropdownOpen]);

  useEffect(() => {
    if ((!selectedReportId || !reports.some((r) => r.id === selectedReportId)) && reports.length > 0 && reports[0]) {
      setSelectedReportId(reports[0].id);
    }
  }, [reports, selectedReportId]);

  const activeReport = reports.find((r) => r.id === selectedReportId) ?? reports[0] ?? null;

  const handleReportGenerated = useCallback(
    async (newReportId: string) => {
      setSelectedReportId(newReportId);
      try {
        await onRefreshReports();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setGenError(msg || "Failed to refresh reports list");
      }
    },
    [onRefreshReports]
  );

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefreshReports();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenError(msg || "Failed to refresh reports list");
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefreshReports]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!activeReport?.content) return;
    try {
      const raw = cleanThinkTags(activeReport.content);
      const textToCopy = hideValues ? maskFinancialValues(raw) : raw;
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy report to clipboard:", err);
    }
  }, [activeReport, hideValues]);

  const baseCurrency = activeReport?.metrics?.baseCurrency || portfolioData?.summary?.baseCurrency || currency;
  const returnPercent = activeReport?.metrics?.periodGainLossPercent ?? activeReport?.metrics?.weeklyGainLossPercent ?? 0;
  const returnDollar = activeReport?.metrics?.periodGainLossDollar ?? activeReport?.metrics?.weeklyGainLossDollar;
  const isReturnUp = returnPercent >= 0;
  const isReportFallback =
    Boolean(activeReport?.isFallback) ||
    activeReport?.status === "fallback" ||
    Boolean(activeReport?.error) ||
    (activeReport?.content?.includes("Automated AI advice generation encountered an issue") ?? false);

  return (
    <div className="flex flex-col gap-3.5 flex-1 min-h-0 font-mono">
      {/* Top Header Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0 pb-1">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 min-w-0">
            <Sparkles className="w-4 h-4 text-[#DD3C73] shrink-0" />
            <span className="truncate">Reports</span>
          </div>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">
            Generated reports from your portfolio
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto" ref={dropdownRef}>
          {/* Custom Report Dropdown Picker */}
          {reports.length > 0 && activeReport && (
            <div className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={isDropdownOpen}
                className={`h-8 inline-flex items-center justify-between gap-2 px-3 rounded-lg border text-xs font-bold uppercase tracking-wider cursor-pointer transition-all ${
                  isDropdownOpen
                    ? "border-[#DD3C73] bg-[#DD3C73]/15 text-[#DD3C73] shadow-lg shadow-[#DD3C73]/10"
                    : "border-slate-800 bg-slate-900 text-[#DD3C73] hover:border-[#DD3C73]/50 hover:bg-slate-800"
                }`}
              >
                <Calendar className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
                <span className="truncate max-w-[170px] sm:max-w-[240px] md:max-w-[300px] text-left">
                  {formatReportDropdownLabel(activeReport)}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-[#DD3C73] transition-transform duration-200 shrink-0 ${
                    isDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Dropdown Menu Popover */}
              {isDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[280px] sm:min-w-[340px] max-w-[90vw] rounded-xl border border-slate-800 bg-slate-950 shadow-2xl p-1.5 flex flex-col gap-0.5 overflow-hidden">
                  <div className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 mb-1 flex items-center gap-1.5 min-w-0">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">Historical Briefings ({reports.length})</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto font-mono text-xs flex flex-col gap-0.5 custom-scrollbar">
                    {reports.map((rep) => {
                      const isSelected = rep.id === activeReport.id;
                      const isRepFallback =
                        Boolean(rep.isFallback) ||
                        rep.status === "fallback" ||
                        Boolean(rep.error);
                      return (
                        <button
                          key={rep.id}
                          type="button"
                          onClick={() => {
                            setSelectedReportId(rep.id);
                            setIsDropdownOpen(false);
                          }}
                          className={`w-full px-2.5 py-2 rounded-lg cursor-pointer flex items-center justify-between gap-3 text-left transition-colors text-xs ${
                            isSelected
                              ? "bg-[#DD3C73]/15 text-[#DD3C73] font-bold"
                              : "text-slate-300 hover:bg-slate-900 hover:text-[#DD3C73]"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 truncate">
                            {isRepFallback ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-[#E3EACD] shrink-0" />
                            ) : (
                              <Calendar className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-[#DD3C73]" : "text-slate-500"}`} />
                            )}
                            <span className="truncate uppercase font-bold tracking-wider">
                              {formatReportDropdownLabel(rep)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isRepFallback && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded border border-[#E3EACD]/40 bg-[#E3EACD]/10 text-[#E3EACD] font-bold uppercase">
                                Fallback
                              </span>
                            )}
                            {isSelected && <Check className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Analyze Portfolio Button */}
          <button
            type="button"
            onClick={() => setIsAnalysisModalOpen(true)}
            className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider shadow-lg shadow-[#DD3C73]/10 font-mono"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Analyze</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {genError && (
        <div className="rounded-xl border border-[#DD3C73]/40 bg-[#DD3C73]/10 px-3.5 py-2.5 flex items-center justify-between text-xs text-[#DD3C73] shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Notice: {genError}</span>
          </div>
          <button onClick={() => setGenError(null)} className="text-[#DD3C73] hover:text-[#e65f8e] font-bold ml-2 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Main Reports Layout Container */}
      {(loadingReports || isRefreshing) && reports.length === 0 ? (
        <div className="cx-card flex-1 flex flex-col items-center justify-center min-h-0 p-10 text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-[#DD3C73] mb-3" />
          <div className="text-xs font-bold uppercase tracking-wider text-slate-300">Loading Portfolio Briefings</div>
          <div className="text-[11px] text-slate-500 mt-1">Retrieving stored quantitative and qualitative reports...</div>
        </div>
      ) : !activeReport ? (
        <div className="cx-card flex-1 flex flex-col items-center justify-center min-h-0 p-10 text-center">
          <div className="w-12 h-12 rounded-2xl border border-[#DD3C73]/30 bg-[#DD3C73]/10 flex items-center justify-center text-[#DD3C73] mb-4">
            <Bot className="w-6 h-6" />
          </div>
          <div className="text-sm font-bold uppercase tracking-wider text-slate-100 mb-2">No Reports Recorded Yet</div>
          <p className="max-w-md text-xs text-slate-400 leading-relaxed mb-6">
            The Autonomous AI analyzes your multi-asset portfolio, evaluates moving averages, and synthesizes tactical qualitative rebalancing briefings.
          </p>
          <button
            type="button"
            onClick={() => setIsAnalysisModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider"
          >
            <Sparkles className="w-4 h-4" />
            <span>Analyze Portfolio</span>
          </button>
        </div>
      ) : (
        <div className="cx-card flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Integrated Container Header */}
          <div className="px-4 sm:px-5 py-3 border-b border-slate-800 bg-slate-950/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg border border-[#DD3C73]/30 bg-[#DD3C73]/10 flex items-center justify-center text-[#DD3C73] shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wide truncate">
                  {activeReport.title || "Weekly Tactical Portfolio Briefing"}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-[#DD3C73]" />
                    <span>{activeReport.period || activeReport.weekKey}</span>
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-400">
                    Model: <span className="text-slate-200 font-semibold">{activeReport.model}</span>
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-400">
                    Provider: <span className="text-slate-200 uppercase font-semibold">{activeReport.provider || "Local"}</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Status indicator badge */}
              {isReportFallback ? (
                <span className="text-[10px] px-2 py-0.5 rounded border border-[#E3EACD]/40 bg-[#E3EACD]/10 text-[#E3EACD] font-bold uppercase flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Fallback Mode</span>
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded border border-[#A7E2C0]/30 bg-[#A7E2C0]/10 text-[#A7E2C0] font-bold uppercase flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  <span>Synthesized</span>
                </span>
              )}

              {/* View prompt button */}
              <button
                type="button"
                onClick={() => setIsPromptModalOpen(true)}
                className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-slate-800 bg-slate-900 text-[11px] font-medium text-slate-300 hover:text-white hover:border-[#DD3C73]/40 hover:bg-[#DD3C73]/10 transition-colors cursor-pointer"
                title="View prompt sent to LLM for this report"
              >
                <Terminal className="w-3.5 h-3.5 text-[#DD3C73]" />
                <span>Prompt</span>
              </button>

              {/* Copy markdown button */}
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-slate-800 bg-slate-900 text-[11px] font-medium text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
                title="Copy markdown report to clipboard"
              >
                {copied ? (
                  <>
                    <CheckCheck className="w-3.5 h-3.5 text-[#A7E2C0]" />
                    <span className="text-[#A7E2C0]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Copy</span>
                  </>
                )}
              </button>

              {/* Delete button */}
              <button
                type="button"
                onClick={() => onDeleteReport(activeReport.id)}
                className="h-7 inline-flex items-center justify-center gap-1 px-2.5 rounded-lg border border-slate-800 bg-slate-900 text-[11px] font-medium text-slate-400 hover:text-[#DD3C73] hover:border-[#DD3C73]/40 hover:bg-[#DD3C73]/10 transition-colors cursor-pointer"
                title="Delete active report"
              >
                <Trash2 className="w-3.5 h-3.5 text-[#DD3C73]" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </div>
          </div>

          {/* Degraded Inference Banner */}
          {isReportFallback && (
            <div className="px-4 py-2.5 bg-[#E3EACD]/10 border-b border-[#E3EACD]/30 flex items-start gap-2.5 text-xs text-[#E3EACD] shrink-0 font-mono">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="font-bold uppercase tracking-wider">AI Fallback Telemetry Notice:</span>{" "}
                <span className="text-slate-300">
                  {activeReport.error
                    ? `Inference notice: ${activeReport.error.replace(/\.+$/, "")}. Baseline quantitative telemetry is displayed.`
                    : "AI reasoning advisor could not complete inference. Baseline quantitative telemetry is displayed."}
                </span>
              </div>
            </div>
          )}

          {/* Split Panes Body: Markdown Left, Telemetry Right */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
            {/* Markdown Report Body */}
            <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 bg-slate-950/20 custom-scrollbar select-text font-mono text-xs leading-relaxed">
              {activeReport.summary && (
                <div className="p-3.5 rounded-xl border border-[#DD3C73]/30 bg-[#DD3C73]/5 mb-4 text-xs text-slate-300">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#DD3C73] mb-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <span>Executive Summary</span>
                  </div>
                  <p className="italic text-slate-200">
                    {hideValues ? maskFinancialValues(activeReport.summary) : activeReport.summary}
                  </p>
                </div>
              )}

              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ node: _n, ...props }) => (
                    <h1 className="text-sm font-bold uppercase tracking-wider text-[#DD3C73] border-b border-slate-800 pb-1.5 mt-4 mb-2" {...props} />
                  ),
                  h2: ({ node: _n, ...props }) => (
                    <h2 className="text-xs font-bold uppercase tracking-wider text-[#DD3C73] mt-4 mb-2" {...props} />
                  ),
                  h3: ({ node: _n, ...props }) => (
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 mt-3 mb-1.5" {...props} />
                  ),
                  p: ({ node: _n, ...props }) => <p className="mb-2.5 text-slate-300 leading-relaxed" {...props} />,
                  ul: ({ node: _n, ...props }) => <ul className="list-disc list-outside pl-4 mb-3 space-y-1 text-slate-300" {...props} />,
                  ol: ({ node: _n, ...props }) => <ol className="list-decimal list-outside pl-4 mb-3 space-y-1 text-slate-300" {...props} />,
                  li: ({ node: _n, ...props }) => <li className="text-slate-300 leading-relaxed" {...props} />,
                  blockquote: ({ node: _n, ...props }) => (
                    <blockquote className="border-l-2 border-[#DD3C73] bg-[#DD3C73]/5 px-3 py-2 my-3 text-slate-400 italic rounded-r" {...props} />
                  ),
                  table: ({ node: _n, ...props }) => (
                    <div className="my-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950">
                      <table className="w-full border-collapse font-mono text-xs" {...props} />
                    </div>
                  ),
                  thead: ({ node: _n, ...props }) => (
                    <thead className="border-b border-slate-800 bg-slate-900 text-slate-400 uppercase tracking-wider" {...props} />
                  ),
                  tbody: ({ node: _n, ...props }) => <tbody className="divide-y divide-slate-800/60 text-slate-300" {...props} />,
                  tr: ({ node: _n, ...props }) => <tr className="hover:bg-slate-800/30 transition-colors" {...props} />,
                  th: ({ node: _n, ...props }) => <th className="px-3 py-2 text-left font-bold text-slate-200" {...props} />,
                  td: ({ node: _n, ...props }) => <td className="px-3 py-2 text-slate-400" {...props} />,
                  strong: ({ node: _n, ...props }) => <strong className="font-bold text-slate-100" {...props} />,
                  code: ({ node: _n, ...props }) => (
                    <code className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[#E3EACD] font-mono text-[11px]" {...props} />
                  ),
                }}
              >
                {hideValues
                  ? maskFinancialValues(cleanThinkTags(activeReport.content))
                  : cleanThinkTags(activeReport.content)}
              </ReactMarkdown>
            </div>

            {/* Sidebar with Metadata & Performance States */}
            <aside className="w-full lg:w-72 xl:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950/40 p-4 overflow-y-auto min-h-0 custom-scrollbar flex flex-col gap-3 text-xs">
              {/* Performance States Box */}
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2.5 shrink-0">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-1.5 flex items-center gap-1.5 min-w-0">
                  <Activity className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="truncate">Performance States</span>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="w-7 h-7 rounded-lg border border-[#DD3C73]/30 bg-[#DD3C73]/10 flex items-center justify-center text-[#DD3C73] shrink-0">
                      <Wallet className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider">Portfolio Valuation</div>
                      <div className="font-bold text-slate-100 truncate">
                        {fmtCurrency(activeReport.metrics?.totalPortfolioValue, baseCurrency, hideValues)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-950 border border-slate-800">
                    <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                      isReturnUp ? "border-[#A7E2C0]/30 bg-[#A7E2C0]/10 text-[#A7E2C0]" : "border-[#DD3C73]/30 bg-[#DD3C73]/10 text-[#DD3C73]"
                    }`}>
                      {isReturnUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider">Period Return</div>
                      <div className={`font-bold truncate ${isReturnUp ? "text-[#A7E2C0]" : "text-[#DD3C73]"}`}>
                        {fmtPercent(returnPercent)}
                        {returnDollar !== undefined && (
                          <span className="text-[10px] text-slate-500 font-normal ml-1">
                            ({isReturnUp ? "+" : ""}{fmtCurrency(returnDollar, baseCurrency, hideValues)})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="w-7 h-7 rounded-lg border border-[#A7E2C0]/30 bg-[#A7E2C0]/10 flex items-center justify-center text-[#A7E2C0] shrink-0">
                      <Percent className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider">Cash Liquidity</div>
                      <div className="font-bold text-slate-100 truncate">
                        {fmtCurrency(activeReport.metrics?.cashBalance, baseCurrency, hideValues)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="w-7 h-7 rounded-lg border border-[#341B83]/40 bg-[#341B83]/20 flex items-center justify-center text-[#ab97f7] shrink-0">
                      <Layers className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider">Positions Tracked</div>
                      <div className="font-bold text-slate-100 truncate">
                        {activeReport.metrics?.holdingsCount ?? 0} assets
                      </div>
                    </div>
                  </div>

                  {(activeReport.metrics?.topWinner || activeReport.metrics?.topLoser) && (
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-1.5 mt-0.5">
                      {activeReport.metrics?.topWinner && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 flex items-center gap-1">
                            <span className="text-[#A7E2C0]">★</span> Top Winner
                          </span>
                          <span className="font-bold text-[#A7E2C0]">
                            {activeReport.metrics.topWinner.symbol} {fmtPercent(activeReport.metrics.topWinner.changePercent)}
                          </span>
                        </div>
                      )}
                      {activeReport.metrics?.topLoser && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 flex items-center gap-1">
                            <span className="text-[#DD3C73]">▼</span> Top Loser
                          </span>
                          <span className="font-bold text-[#DD3C73]">
                            {activeReport.metrics.topLoser.symbol} {fmtPercent(activeReport.metrics.topLoser.changePercent)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Metadata Box */}
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2 shrink-0">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-1.5 flex items-center gap-1.5 min-w-0">
                  <Info className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="truncate">Report Telemetry</span>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-[#DD3C73] shrink-0" />
                    <span>Generated Timestamp</span>
                  </div>
                  <div className="text-slate-300 font-medium text-[11px]">
                    {new Date(activeReport.createdAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    <span className="text-slate-500">({formatTimeAgo(activeReport.createdAt)})</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-[#DD3C73] shrink-0" />
                    <span>Period Window</span>
                  </div>
                  <div className="text-slate-300 font-medium text-[11px]">{activeReport.period}</div>
                </div>

                <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Bot className="w-3 h-3 text-[#DD3C73] shrink-0" />
                    <span>Inference Model</span>
                  </div>
                  <div className="text-slate-300 font-medium text-[11px] truncate">{activeReport.model}</div>
                </div>

                <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    {isReportFallback ? (
                      <AlertTriangle className="w-3 h-3 text-[#E3EACD] shrink-0" />
                    ) : (
                      <Check className="w-3 h-3 text-[#A7E2C0] shrink-0" />
                    )}
                    <span>Execution Health</span>
                  </div>
                  <div className="font-bold text-[11px]">
                    {isReportFallback ? (
                      <span className="text-[#E3EACD]">Fallback / Degraded</span>
                    ) : (
                      <span className="text-[#A7E2C0]">Optimal (AI Synthesized)</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Terminal className="w-3 h-3 text-[#DD3C73] shrink-0" />
                    <span>Inference Prompt</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPromptModalOpen(true)}
                    className="inline-flex items-center gap-1 text-[11px] text-[#DD3C73] hover:text-[#e65f8e] transition-colors cursor-pointer text-left font-semibold"
                  >
                    <span>Inspect LLM Prompt &rarr;</span>
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* Analysis Modal */}
      <AnalyzePortfolioModal
        isOpen={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
        onReportGenerated={handleReportGenerated}
        portfolioData={portfolioData}
        portfolioId={portfolioId}
        hideCurrencyValues={hideValues}
      />

      {/* Report Prompt Modal */}
      <ReportPromptModal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
        report={activeReport}
        hideValues={hideValues}
      />
    </div>
  );
}

export const ReportsLayoutContainer = ReportsCard;
