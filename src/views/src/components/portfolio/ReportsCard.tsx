import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PortfolioReport, FinancialPortfolioData } from "../../types/portfolio";
import { fmtCurrency, fmtPercent, cleanThinkTags } from "./utils";
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
} from "lucide-react";
import { AnalyzePortfolioModal } from "./AnalyzePortfolioModal";

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
      } catch (err: any) {
        setGenError(err?.message || "Failed to refresh reports list");
      }
    },
    [onRefreshReports]
  );

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
    <div className="flex flex-col gap-3 min-h-0 flex-1 overflow-hidden font-mono">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Left: Custom Report Dropdown Picker */}
        <div className="flex items-center gap-2 min-w-0" ref={dropdownRef}>
          {reports.length > 0 && activeReport ? (
            <div className="relative inline-block max-w-full">
              <button
                type="button"
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                className={`h-8 inline-flex items-center justify-between gap-2 px-3 rounded-lg border text-xs font-bold uppercase tracking-wider cursor-pointer transition-all ${
                  isDropdownOpen
                    ? "border-[#DD3C73] bg-[#DD3C73]/15 text-[#DD3C73] shadow-lg shadow-[#DD3C73]/10"
                    : "border-slate-800 bg-slate-900 text-[#DD3C73] hover:border-[#DD3C73]/50 hover:bg-slate-800"
                }`}
              >
                <Calendar className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
                <span className="truncate max-w-[200px] sm:max-w-[280px] md:max-w-[340px] text-left">
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
                <div className="absolute left-0 top-full mt-1.5 z-50 min-w-[280px] sm:min-w-[340px] max-w-[90vw] rounded-xl border border-slate-800 bg-slate-950 shadow-2xl p-1.5 flex flex-col gap-0.5 overflow-hidden">
                  <div className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 mb-1 flex items-center gap-1.5 min-w-0">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">Available Reports ({reports.length})</span>
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
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 uppercase tracking-wider font-bold min-w-0">
              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="truncate">AI Reports</span>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAnalysisModalOpen(true)}
            className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider shadow-lg shadow-[#DD3C73]/10"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Analyze Portfolio</span>
          </button>
        </div>
      </div>

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

      {loadingReports && reports.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
          <RefreshCw className="w-6 h-6 animate-spin text-[#DD3C73] mb-3" />
          <div className="text-xs text-slate-400">Loading portfolio reports history…</div>
        </div>
      ) : !activeReport ? (
        <div className="flex-1 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
          <div className="w-12 h-12 rounded-full border border-[#DD3C73]/30 bg-[#DD3C73]/10 flex items-center justify-center text-[#DD3C73] mb-3">
            <Bot className="w-6 h-6" />
          </div>
          <div className="text-sm font-bold uppercase tracking-wider text-slate-100 mb-2">No Reports Yet</div>
          <p className="max-w-md text-xs text-slate-400 leading-relaxed mb-6">
            The Autonomous AI analyzes your multi-asset portfolio, tracks moving averages, and synthesizes tactical rebalancing recommendations.
          </p>
          <button
            onClick={() => setIsAnalysisModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider"
          >
            <Sparkles className="w-4 h-4" />
            <span>Analyze Portfolio</span>
          </button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          {/* Fallback Warning Banner */}
          {isReportFallback && (
            <div className="cx-card p-3 rounded-xl border border-[#E3EACD]/50 bg-[#E3EACD]/10 flex items-start gap-3 text-xs shrink-0 font-mono">
              <AlertTriangle className="w-4 h-4 text-[#E3EACD] shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[#E3EACD] uppercase tracking-wider text-xs flex items-center gap-2 min-w-0">
                  <span className="truncate">AI Fallback Notice</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded border border-[#E3EACD]/40 bg-[#E3EACD]/10 text-[#E3EACD] font-bold uppercase shrink-0">
                    Degraded Mode
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate" title={activeReport.error ? `Inference notice: ${activeReport.error}. Baseline quantitative telemetry is displayed below.` : "AI reasoning advisor could not complete inference. Baseline quantitative telemetry is displayed below."}>
                  {activeReport.error
                    ? `Inference notice: ${activeReport.error}. Baseline quantitative telemetry is displayed below.`
                    : "AI reasoning advisor could not complete inference. Baseline quantitative telemetry is displayed below."}
                </p>
              </div>
            </div>
          )}

          {/* Split Layout: Markdown Left, Sidebar Right */}
          <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3 overflow-hidden">
            {/* Markdown Report Body */}
            <div className="cx-card p-5 bg-slate-900 border border-slate-800 flex-1 min-h-0 min-w-0 overflow-y-auto font-mono text-xs leading-relaxed select-text custom-scrollbar">
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
                {cleanThinkTags(activeReport.content)}
              </ReactMarkdown>
            </div>

            {/* Sidebar with Metadata & Performance States */}
            <div className="w-full md:w-64 lg:w-72 shrink-0 flex flex-col gap-3 overflow-y-auto min-h-0 custom-scrollbar">
              {/* Metadata Card */}
              <div className="cx-card p-3.5 bg-slate-900 border border-slate-800 flex flex-col gap-2.5 shrink-0 text-xs">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-1.5 flex items-center gap-1.5 min-w-0">
                  <Info className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="truncate">Report Metadata</span>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-[#DD3C73] shrink-0" />
                    <span>Generated Date</span>
                  </div>
                  <div className="text-slate-300 font-medium">
                    {new Date(activeReport.createdAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-[#DD3C73] shrink-0" />
                    <span>Period Window</span>
                  </div>
                  <div className="text-slate-300 font-medium">{activeReport.period}</div>
                </div>

                <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Bot className="w-3 h-3 text-[#DD3C73] shrink-0" />
                    <span>Engine</span>
                  </div>
                  <div className="text-slate-300 font-medium">{activeReport.model}</div>
                </div>

                <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    {isReportFallback ? (
                      <AlertTriangle className="w-3 h-3 text-[#E3EACD] shrink-0" />
                    ) : (
                      <Check className="w-3 h-3 text-[#A7E2C0] shrink-0" />
                    )}
                    <span>Status</span>
                  </div>
                  <div className="font-bold">
                    {isReportFallback ? (
                      <span className="text-[#E3EACD]">Fallback / Offline</span>
                    ) : (
                      <span className="text-[#A7E2C0]">Optimal (AI Generated)</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Performance States Card */}
              <div className="cx-card p-3.5 bg-slate-900 border border-slate-800 flex flex-col gap-2.5 shrink-0 text-xs">
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

              {/* Actions / Delete Report Card */}
              <div className="cx-card p-3.5 bg-slate-900 border border-slate-800 flex flex-col gap-2.5 shrink-0 text-xs">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-1.5 flex items-center gap-1.5 min-w-0">
                  <Trash2 className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="truncate">Report Actions</span>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteReport(activeReport.id)}
                  className="w-full h-8.5 inline-flex items-center justify-center gap-2 px-3 rounded-lg border border-slate-800 bg-slate-950 text-xs font-bold text-slate-400 hover:text-[#DD3C73] hover:border-[#DD3C73]/40 hover:bg-[#DD3C73]/10 transition-colors cursor-pointer uppercase tracking-wider"
                  title="Delete Active Report"
                >
                  <Trash2 className="w-3.5 h-3.5 text-[#DD3C73]" />
                  <span>Delete Report</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AnalyzePortfolioModal
        isOpen={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
        onReportGenerated={handleReportGenerated}
        portfolioData={portfolioData}
        portfolioId={portfolioId}
        hideCurrencyValues={hideValues}
      />
    </div>
  );
}

