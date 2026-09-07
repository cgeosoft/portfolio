import { useState, useEffect, useCallback } from "react";
import type { PortfolioReport } from "../../types/portfolio";
import { rpc } from "../../rpc";
import {
  X,
  Download,
  FileText,
  FileDown,
  Check,
  CheckCircle2,
  AlertCircle,
  Folder,
  ArrowRight,
  ArrowLeft,
  Loader2,
  FolderOpen,
} from "lucide-react";
import {
  getDefaultReportFilename,
  generateReportMarkdown,
  generateReportPdf,
} from "./report-export";

interface DownloadReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: PortfolioReport | null;
  portfolioName?: string;
  hideValues?: boolean;
}

type ReportFormat = "markdown" | "pdf";

export function DownloadReportModal({
  isOpen,
  onClose,
  report,
  portfolioName,
  hideValues = false,
}: DownloadReportModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [format, setFormat] = useState<ReportFormat>("markdown");
  const [fileName, setFileName] = useState("");
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [savedFilePath, setSavedFilePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize or reset state when modal opens
  useEffect(() => {
    if (isOpen && report) {
      setStep(1);
      setFormat("markdown");
      setError(null);
      setSavedFilePath(null);
      setIsProcessing(false);
      const initialName = getDefaultReportFilename(report, "markdown", portfolioName);
      setFileName(initialName);

      const savedDir = localStorage.getItem("portfolio_last_download_dir") || null;
      setSelectedDir(savedDir);
    }
  }, [isOpen, report, portfolioName]);

  // Update suggested filename when format changes
  const handleSelectFormat = (newFormat: ReportFormat) => {
    setFormat(newFormat);
    if (report) {
      setFileName(getDefaultReportFilename(report, newFormat, portfolioName));
    }
  };

  const handlePickDirectory = async () => {
    setError(null);
    try {
      const res = await rpc.request.pickDirectory({
        title: "Select Download Destination Folder",
        startingFolder: selectedDir || undefined,
      });

      if (res && res.path) {
        setSelectedDir(res.path);
        localStorage.setItem("portfolio_last_download_dir", res.path);
      }
    } catch (err) {
      console.warn("Desktop pickDirectory failed:", err);
    }
  };

  const handleExecuteDownload = async () => {
    if (!report) return;

    setIsProcessing(true);
    setError(null);

    const cleanFileName = fileName.trim() || getDefaultReportFilename(report, format, portfolioName);

    try {
      // 1. Try modern browser File System Access API if available and no desktop directory was picked
      const win = typeof window !== "undefined" ? (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> }) : null;
      if (!selectedDir && typeof win?.showSaveFilePicker === "function") {
        try {
          const handle = await win.showSaveFilePicker({
            suggestedName: cleanFileName,
            types: [
              format === "markdown"
                ? {
                    description: "Markdown Document (*.md)",
                    accept: { "text/markdown": [".md"] },
                  }
                : {
                    description: "PDF Document (*.pdf)",
                    accept: { "application/pdf": [".pdf"] },
                  },
            ],
          });

          const writable = await handle.createWritable();
          if (format === "markdown") {
            const mdContent = generateReportMarkdown(report, portfolioName, hideValues);
            await writable.write(mdContent);
          } else {
            const pdfBlob = await generateReportPdf(report, portfolioName, hideValues);
            await writable.write(pdfBlob);
          }
          await writable.close();

          setSavedFilePath(cleanFileName);
          setIsProcessing(false);
          return;
        } catch (pickerErr: unknown) {
          // User aborted the file picker dialog
          if (pickerErr instanceof Error && pickerErr.name === "AbortError") {
            setIsProcessing(false);
            return;
          }
          console.warn("Native showSaveFilePicker failed or was cancelled, falling back:", pickerErr);
        }
      }

      // 2. If desktop directory is selected, save directly through Bun RPC
      if (selectedDir) {
        const separator = selectedDir.includes("\\") ? "\\" : "/";
        const targetPath = `${selectedDir.replace(/[\\/]+$/, "")}${separator}${cleanFileName}`;

        if (format === "markdown") {
          const mdContent = generateReportMarkdown(report, portfolioName, hideValues);
          const res = await rpc.request.saveFile({
            filePath: targetPath,
            content: mdContent,
          });
          if (!res.success) {
            throw new Error(res.error || "Failed to write markdown file to selected directory");
          }
        } else {
          const pdfBlob = await generateReportPdf(report, portfolioName, hideValues);
          const arrayBuffer = await pdfBlob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]!);
          }
          const base64Data = btoa(binary);

          const res = await rpc.request.saveFile({
            filePath: targetPath,
            base64Data,
          });
          if (!res.success) {
            throw new Error(res.error || "Failed to write PDF file to selected directory");
          }
        }

        setSavedFilePath(targetPath);
        setIsProcessing(false);
        return;
      }

      // 3. Fallback: Browser blob download trigger
      if (format === "markdown") {
        const mdContent = generateReportMarkdown(report, portfolioName, hideValues);
        const blob = new Blob([mdContent], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = cleanFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const pdfBlob = await generateReportPdf(report, portfolioName, hideValues);
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = cleanFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      setSavedFilePath(cleanFileName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to download report:", err);
      setError(msg || "Failed to download report");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRevealFile = useCallback(() => {
    if (savedFilePath && selectedDir) {
      void rpc.request.revealFile({ filePath: savedFilePath }).catch((err: unknown) => {
        console.warn("revealFile failed:", err);
      });
    }
  }, [savedFilePath, selectedDir]);

  if (!isOpen || !report) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono overflow-y-auto">
      <div className="relative w-full max-w-md flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden max-h-[calc(100dvh-1.5rem)] my-auto">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg border border-[#DD3C73]/30 bg-[#DD3C73]/10 flex items-center justify-center text-[#DD3C73] shrink-0">
              <Download className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wider truncate">
                Download Report
              </h2>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {step === 1 ? "Step 1 of 2: Select Format" : "Step 2 of 2: Choose Download Path"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
          {error && (
            <div className="p-3 rounded-xl border border-[#DD3C73]/40 bg-[#DD3C73]/10 flex items-start gap-2.5 text-xs text-[#DD3C73]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">{error}</div>
            </div>
          )}

          {savedFilePath ? (
            /* Success State */
            <div className="flex flex-col items-center justify-center py-6 text-center gap-3">
              <div className="w-12 h-12 rounded-2xl border border-[#A7E2C0]/40 bg-[#A7E2C0]/10 flex items-center justify-center text-[#A7E2C0]">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="text-sm font-bold text-slate-100 uppercase tracking-wider">
                Report Downloaded
              </div>
              <p className="text-xs text-slate-400 max-w-xs break-all">
                {savedFilePath}
              </p>
              <div className="flex items-center gap-2 mt-2">
                {selectedDir && (
                  <button
                    type="button"
                    onClick={handleRevealFile}
                    className="h-8 px-3 rounded-lg border border-slate-800 bg-slate-800/60 hover:bg-slate-800 text-slate-200 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 uppercase tracking-wider"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#DD3C73]" />
                    <span>Open Folder</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 px-4 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-colors cursor-pointer uppercase tracking-wider"
                >
                  Done
                </button>
              </div>
            </div>
          ) : step === 1 ? (
            /* Step 1: Format Selection */
            <div className="flex flex-col gap-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                Select Export Format
              </div>

              {/* Format Option 1: Markdown */}
              <button
                type="button"
                onClick={() => handleSelectFormat("markdown")}
                className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-start gap-3 ${
                  format === "markdown"
                    ? "border-[#DD3C73] bg-[#DD3C73]/10 shadow-lg shadow-[#DD3C73]/10"
                    : "border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${
                    format === "markdown"
                      ? "border-[#DD3C73]/50 bg-[#DD3C73]/20 text-[#DD3C73]"
                      : "border-slate-800 bg-slate-900 text-slate-400"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-xs font-bold uppercase tracking-wider ${
                        format === "markdown" ? "text-white" : "text-slate-200"
                      }`}
                    >
                      Markdown Document (.md)
                    </span>
                    {format === "markdown" && (
                      <span className="w-4 h-4 rounded-full bg-[#DD3C73] text-white flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    Plain text format with YAML metadata frontmatter. Ideal for Obsidian, Notion, or local archives.
                  </p>
                </div>
              </button>

              {/* Format Option 2: PDF */}
              <button
                type="button"
                onClick={() => handleSelectFormat("pdf")}
                className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all flex items-start gap-3 ${
                  format === "pdf"
                    ? "border-[#DD3C73] bg-[#DD3C73]/10 shadow-lg shadow-[#DD3C73]/10"
                    : "border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${
                    format === "pdf"
                      ? "border-[#DD3C73]/50 bg-[#DD3C73]/20 text-[#DD3C73]"
                      : "border-slate-800 bg-slate-900 text-slate-400"
                  }`}
                >
                  <FileDown className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-xs font-bold uppercase tracking-wider ${
                        format === "pdf" ? "text-white" : "text-slate-200"
                      }`}
                    >
                      PDF Document (.pdf)
                    </span>
                    {format === "pdf" && (
                      <span className="w-4 h-4 rounded-full bg-[#DD3C73] text-white flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    Formatted document with executive summary, performance cards, tables, and pagination.
                  </p>
                </div>
              </button>
            </div>
          ) : (
            /* Step 2: Choose Download Path */
            <div className="flex flex-col gap-3.5">
              {/* Format summary pill */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
                <span className="text-slate-400">Selected Format:</span>
                <span className="font-bold text-[#DD3C73] uppercase tracking-wider flex items-center gap-1.5">
                  {format === "markdown" ? (
                    <FileText className="w-3.5 h-3.5" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                  <span>{format === "markdown" ? "Markdown (.md)" : "PDF (.pdf)"}</span>
                </span>
              </div>

              {/* Filename Input */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="report-filename" className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  File Name
                </label>
                <input
                  id="report-filename"
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="w-full h-8 px-3 rounded-lg border border-slate-800 bg-slate-950 text-slate-200 text-xs focus:outline-none focus:border-[#DD3C73] transition-colors"
                />
              </div>

              {/* Destination Directory Picker */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  Save Location
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-8 px-3 rounded-lg border border-slate-800 bg-slate-950 flex items-center text-xs text-slate-400 overflow-hidden">
                    <span className="truncate">
                      {selectedDir || "Native File Picker / Default Downloads"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handlePickDirectory}
                    className="h-8 px-3 rounded-lg border border-slate-800 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 uppercase tracking-wider"
                    title="Select destination directory"
                  >
                    <Folder className="w-3.5 h-3.5 text-[#DD3C73]" />
                    <span>Browse</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  Select a specific folder or proceed to use the native system file dialog.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {!savedFilePath && (
          <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between shrink-0">
            {step === 2 ? (
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={isProcessing}
                className="h-8 px-3 rounded-lg border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 uppercase tracking-wider"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="h-8 px-3 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer uppercase tracking-wider"
              >
                Cancel
              </button>
            )}

            {step === 1 ? (
              <button
                type="button"
                onClick={() => setStep(2)}
                className="h-8 px-4 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 uppercase tracking-wider shadow-lg shadow-[#DD3C73]/20"
              >
                <span>Next</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleExecuteDownload}
                disabled={isProcessing}
                className="h-8 px-4 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 uppercase tracking-wider shadow-lg shadow-[#DD3C73]/20"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Downloading...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
