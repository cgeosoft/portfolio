import { useState, useEffect, useCallback } from "react";
import JSZip from "jszip";
import type { PortfolioItem, PortfolioTransaction, PortfolioReport, PortfolioSummary } from "../../types/portfolio";
import { rpc } from "../../rpc";
import {
  X,
  Download,
  Loader2,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Archive,
  Check,
  Coins,
} from "lucide-react";
import { fmtCurrency, cleanThinkTags } from "./utils";

interface ExportPortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  portfolio: PortfolioItem | null;
}

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateTransactionsCsv(transactions: PortfolioTransaction[]): string {
  const headers = [
    "Date",
    "Time",
    "Type",
    "Symbol",
    "Name",
    "Asset Class",
    "ISIN",
    "Shares",
    "Price",
    "Total Amount",
    "Fee",
    "Tax",
    "Currency",
    "Transaction ID",
  ];

  const rows = transactions.map((tx) => [
    escapeCsvField(tx.date || ""),
    escapeCsvField(tx.datetime ? tx.datetime.split("T")[1] || "" : ""),
    escapeCsvField(tx.type || ""),
    escapeCsvField(tx.symbol || ""),
    escapeCsvField(tx.name || ""),
    escapeCsvField(tx.assetClass || ""),
    escapeCsvField(tx.isin || ""),
    escapeCsvField(tx.shares !== undefined ? tx.shares : ""),
    escapeCsvField(tx.price !== undefined ? tx.price : ""),
    escapeCsvField(tx.amount !== undefined ? tx.amount : ""),
    escapeCsvField(tx.fee !== undefined ? tx.fee : ""),
    escapeCsvField(tx.tax !== undefined ? tx.tax : ""),
    escapeCsvField(tx.currency || ""),
    escapeCsvField(tx.id || ""),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

function generateReportMarkdown(report: PortfolioReport, portfolioName: string): string {
  const frontmatter = [
    "---",
    `portfolio: ${JSON.stringify(portfolioName)}`,
    `report_id: ${JSON.stringify(report.id)}`,
    `created_at: ${JSON.stringify(report.createdAt)}`,
    `period: ${JSON.stringify(report.period || "")}`,
    `week_start: ${JSON.stringify(report.weekStartDate || "")}`,
    `week_end: ${JSON.stringify(report.weekEndDate || "")}`,
    `model: ${JSON.stringify(report.model || "")}`,
    `provider: ${JSON.stringify(report.provider || "")}`,
    `status: ${JSON.stringify(report.status || "success")}`,
    `portfolio_valuation: ${report.metrics?.totalPortfolioValue ?? 0}`,
    `base_currency: ${JSON.stringify(report.metrics?.baseCurrency || "EUR")}`,
    `holdings_count: ${report.metrics?.holdingsCount ?? 0}`,
    "---",
    "",
  ].join("\n");

  const titleHeader = `# ${report.title || `Portfolio Report (${report.period || report.id})`}\n`;
  const summaryBlock = report.summary ? `> **Executive Summary:**\n> ${report.summary}\n\n` : "";

  return `${frontmatter}${titleHeader}\n${summaryBlock}${cleanThinkTags(report.content)}\n`;
}

function generateReadmeMarkdown(
  portfolio: PortfolioItem,
  summary: PortfolioSummary | null,
  txCount: number,
  reportsCount: number
): string {
  const dateStr = new Date().toISOString();
  return `# Portfolio Data Archive: ${portfolio.name}

Generated on ${dateStr}

## Portfolio Information
- **Portfolio Name:** ${portfolio.name}
- **Portfolio ID:** \`${portfolio.id}\`
- **Base Currency:** ${portfolio.baseCurrency}
- **Description:** ${portfolio.description || "No description provided"}
- **Created Date:** ${portfolio.createdAt || "N/A"}
- **Total Transactions:** ${txCount}
- **Total Reports:** ${reportsCount}

${
  summary
    ? `## Financial Summary (Latest Snapshot)
- **Total Portfolio Valuation:** ${fmtCurrency(summary.totalPortfolioValue, summary.baseCurrency)}
- **Invested Capital:** ${fmtCurrency(summary.totalCashInjected || summary.totalCost, summary.baseCurrency)}
- **Cash Balance:** ${fmtCurrency(summary.cashBalance, summary.baseCurrency)}
- **Total Gain / Loss:** ${fmtCurrency(summary.totalGainLossDollar, summary.baseCurrency)} (${summary.totalGainLossPercent?.toFixed(2)}%)
- **Realized PnL:** ${fmtCurrency(summary.realizedPnL, summary.baseCurrency)}
- **Total Dividends:** ${fmtCurrency(summary.totalDividends, summary.baseCurrency)}
`
    : ""
}
## Archive Contents
1. \`transactions.csv\` - Complete historical transactions ledger (trades, dividends, deposits, withdrawals, fees, taxes) formatted according to RFC 4180.
2. \`reports/\` - Generated weekly portfolio intelligence and tactical analysis reports in Markdown format with YAML frontmatter.
3. \`README.md\` - This portfolio archive manifest.
`;
}

export function ExportPortfolioModal({
  isOpen,
  onClose,
  portfolio,
}: ExportPortfolioModalProps) {
  const [includeTransactions, setIncludeTransactions] = useState(true);
  const [includeReports, setIncludeReports] = useState(true);
  const [includeReadme, setIncludeReadme] = useState(true);

  const [isLoadingCounts, setIsLoadingCounts] = useState(false);
  const [txCount, setTxCount] = useState<number | null>(null);
  const [reportsCount, setReportsCount] = useState<number | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setExportSuccess(false);
      setError(null);
      setIncludeTransactions(true);
      setIncludeReports(true);
      setIncludeReadme(true);
    }
  }, [isOpen, portfolio]);

  // Fetch preview counts for this specific portfolio
  const fetchCounts = useCallback(async (portfolioId: string) => {
    if (!portfolioId) return;
    setIsLoadingCounts(true);
    setError(null);
    try {
      const [txData, repData] = await Promise.all([
        rpc.request.getTransactions({ portfolioId }),
        rpc.request.getReports({ portfolioId }),
      ]);

      setTxCount(Array.isArray(txData.transactions) ? txData.transactions.length : 0);
      setReportsCount(Array.isArray(repData.reports) ? repData.reports.length : 0);
    } catch (err) {
      console.error("Failed to fetch counts for export:", err);
      setTxCount(null);
      setReportsCount(null);
    } finally {
      setIsLoadingCounts(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && portfolio?.id) {
      fetchCounts(portfolio.id);
    }
  }, [isOpen, portfolio?.id, fetchCounts]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isExporting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isExporting, onClose]);

  if (!isOpen || !portfolio) return null;

  const handleDownloadZip = async () => {
    if (!includeTransactions && !includeReports && !includeReadme) {
      setError("Please select at least one item to include in the export archive.");
      return;
    }

    setIsExporting(true);
    setError(null);
    setExportSuccess(false);

    try {
      const zip = new JSZip();
      let transactions: PortfolioTransaction[] = [];
      let reports: PortfolioReport[] = [];
      let summaryData: PortfolioSummary | null = null;

      // 1. Fetch Transactions if requested
      if (includeTransactions) {
        const json = await rpc.request.getTransactions({ portfolioId: portfolio.id });
        transactions = json.transactions || [];
        const csvContent = generateTransactionsCsv(transactions);
        zip.file("transactions.csv", csvContent);
      }

      // 2. Fetch Reports if requested
      if (includeReports) {
        const json = await rpc.request.getReports({ portfolioId: portfolio.id });
        reports = json.reports || [];

        if (reports.length > 0) {
          const reportsFolder = zip.folder("reports");
          reports.forEach((rep, idx) => {
            const rawKey = rep.weekKey || rep.id || `report-${idx + 1}`;
            const cleanKey = rawKey.replace(/[^a-zA-Z0-9_-]/g, "_");
            const mdContent = generateReportMarkdown(rep, portfolio.name);
            reportsFolder?.file(`${cleanKey}.md`, mdContent);
          });
        }
      }

      // 3. Fetch Portfolio Data for README summary if requested
      if (includeReadme) {
        try {
          const json = await rpc.request.getPortfolioData({ portfolioId: portfolio.id });
          summaryData = json.summary || null;
        } catch {
          // Non-critical if summary fails
        }
        const readmeContent = generateReadmeMarkdown(
          portfolio,
          summaryData,
          transactions.length,
          reports.length
        );
        zip.file("README.md", readmeContent);
      }

      // Generate the ZIP blob
      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      // Trigger browser download
      const sanitizedName = portfolio.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
      const dateStr = new Date().toISOString().split("T")[0];
      const filename = `portfolio-${sanitizedName || "export"}-${dateStr}.zip`;

      const downloadUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

      setExportSuccess(true);
      setTimeout(() => {
        setExportSuccess(false);
      }, 4000);
    } catch (err: any) {
      console.error("Export error:", err);
      setError(err?.message || "Failed to generate export archive");
    } finally {
      setIsExporting(false);
    }
  };

  const sanitizedFileName = `portfolio-${portfolio.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "export"}-${new Date().toISOString().split("T")[0]}.zip`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 font-mono overflow-y-auto">
      <div className="relative w-full max-w-lg flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden max-h-[calc(100dvh-1.5rem)] my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/70 px-4 py-3 sm:px-5 sm:py-3.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-[#DD3C73]/15 border border-[#DD3C73]/30 flex items-center justify-center text-[#DD3C73] shrink-0">
              <Archive className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 truncate">
              Export Portfolio Archive
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto min-h-0 custom-scrollbar text-xs">
          {/* Target Portfolio Banner */}
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-[#DD3C73]" />
                <span>Target Portfolio</span>
              </div>
              <div className="text-sm font-bold text-slate-100 truncate mt-0.5" title={portfolio.name}>
                {portfolio.name}
              </div>
              {portfolio.description && (
                <p className="text-[11px] text-slate-400 italic line-clamp-1 mt-0.5">
                  {portfolio.description}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 px-2 py-1 rounded-lg">
                <Coins className="w-3 h-3 text-[#DD3C73]" />
                <span className="text-xs font-bold text-slate-200">{portfolio.baseCurrency}</span>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-xl border border-rose-800/50 bg-rose-950/30 text-rose-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs">{error}</div>
            </div>
          )}

          {/* Success Message */}
          {exportSuccess && (
            <div className="p-3 rounded-xl border border-emerald-800/50 bg-emerald-950/30 text-emerald-300 flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="text-xs">
                Archive successfully generated and download triggered!
              </div>
            </div>
          )}

          {/* Export Options */}
          <div className="space-y-2">
            <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Items to Include in Archive
            </label>

            <div className="space-y-2">
              {/* Transactions to CSV Option */}
              <label
                className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-colors select-none ${
                  includeTransactions
                    ? "bg-[#DD3C73]/10 border-[#DD3C73]/40 text-slate-100"
                    : "bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={includeTransactions}
                    onChange={(e) => setIncludeTransactions(e.target.checked)}
                    disabled={isExporting}
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center border transition-colors shrink-0 ${
                      includeTransactions
                        ? "bg-[#DD3C73] border-[#DD3C73] text-white"
                        : "border-slate-700 bg-slate-900"
                    }`}
                  >
                    {includeTransactions && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>

                  <div className="min-w-0 flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-[#A7E2C0] shrink-0" />
                    <div>
                      <div className="font-bold text-xs flex items-center gap-2">
                        <span>Transactions Ledger</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-slate-400 uppercase font-normal">
                          .csv
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Historical trades, dividends, deposits, withdrawals & fees
                      </p>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] font-mono font-bold text-slate-400 shrink-0">
                  {isLoadingCounts ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
                  ) : txCount !== null ? (
                    `${txCount} rows`
                  ) : (
                    "—"
                  )}
                </div>
              </label>

              {/* Reports to Markdown Option */}
              <label
                className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-colors select-none ${
                  includeReports
                    ? "bg-[#DD3C73]/10 border-[#DD3C73]/40 text-slate-100"
                    : "bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={includeReports}
                    onChange={(e) => setIncludeReports(e.target.checked)}
                    disabled={isExporting}
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center border transition-colors shrink-0 ${
                      includeReports
                        ? "bg-[#DD3C73] border-[#DD3C73] text-white"
                        : "border-slate-700 bg-slate-900"
                    }`}
                  >
                    {includeReports && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>

                  <div className="min-w-0 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#DD3C73] shrink-0" />
                    <div>
                      <div className="font-bold text-xs flex items-center gap-2">
                        <span>AI Intelligence Reports</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-slate-400 uppercase font-normal">
                          .md
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Analytical briefings & reports stored in <code className="text-[#E3EACD]">reports/</code> folder
                      </p>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] font-mono font-bold text-slate-400 shrink-0">
                  {isLoadingCounts ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
                  ) : reportsCount !== null ? (
                    `${reportsCount} files`
                  ) : (
                    "—"
                  )}
                </div>
              </label>

              {/* README Overview Option */}
              <label
                className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-colors select-none ${
                  includeReadme
                    ? "bg-[#DD3C73]/10 border-[#DD3C73]/40 text-slate-100"
                    : "bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={includeReadme}
                    onChange={(e) => setIncludeReadme(e.target.checked)}
                    disabled={isExporting}
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center border transition-colors shrink-0 ${
                      includeReadme
                        ? "bg-[#DD3C73] border-[#DD3C73] text-white"
                        : "border-slate-700 bg-slate-900"
                    }`}
                  >
                    {includeReadme && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>

                  <div className="min-w-0 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-sky-400 shrink-0" />
                    <div>
                      <div className="font-bold text-xs flex items-center gap-2">
                        <span>Portfolio Summary Manifest</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-slate-400 uppercase font-normal">
                          README.md
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        High-level totals, currency metrics, and snapshot telemetry
                      </p>
                    </div>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Archive Filename Preview */}
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Output ZIP Archive Filename:
            </div>
            <div className="text-xs font-mono text-[#E3EACD] truncate flex items-center gap-1.5">
              <Archive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="truncate">{sanitizedFileName}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/70 px-4 py-3 sm:px-5 sm:py-3 shrink-0 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-3.5 py-1.5 rounded-xl border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 hover:text-slate-200 cursor-pointer disabled:opacity-50"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={isExporting || (!includeTransactions && !includeReports && !includeReadme)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Generating ZIP…</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Download ZIP</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
