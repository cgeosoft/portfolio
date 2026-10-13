import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Terminal,
  Copy,
  CheckCheck,
  X,
  Bot,
  Calendar,
  AlertCircle,
  FileCode,
} from "lucide-react";
import type { PortfolioReport } from "portfolio-shared/portfolio";
import { api } from "../../api";
import { maskFinancialValues } from "./utils";
import { t } from "../../i18n";

interface ReportPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: PortfolioReport | null;
  hideValues?: boolean;
}

type TabMode = "all" | "system" | "user";

export function ReportPromptModal({
  isOpen,
  onClose,
  report,
  hideValues = false,
}: ReportPromptModalProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<TabMode>("all");

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // The reports list leaves the prompts out (they are large): fetch this one when the modal opens.
  const reportId = report?.id;
  const portfolioId = report?.portfolioId;
  const listedPrompt = report?.prompt;
  const [fetched, setFetched] = useState<{ reportId: string; prompt: string | null } | null>(null);
  useEffect(() => {
    if (!isOpen || !reportId || !portfolioId || listedPrompt) return;
    let cancelled = false;
    api
      .getReportPrompt(portfolioId, reportId)
      .then((res) => {
        if (!cancelled) setFetched({ reportId, prompt: res.prompt });
      })
      .catch(() => {
        if (!cancelled) setFetched({ reportId, prompt: null });
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, reportId, portfolioId, listedPrompt]);

  const rawPrompt = listedPrompt || (fetched?.reportId === reportId ? fetched?.prompt : null) || "";
  const isLoadingPrompt = Boolean(isOpen && reportId && portfolioId && !listedPrompt && fetched?.reportId !== reportId);

  // Parse sections if present
  const { systemPrompt, userPrompt, hasSections } = useMemo(() => {
    if (!rawPrompt) {
      return { systemPrompt: "", userPrompt: "", hasSections: false };
    }

    const sysIndex = rawPrompt.indexOf("### System Prompt");
    const userIndex = rawPrompt.indexOf("### User Prompt");

    if (sysIndex !== -1 && userIndex !== -1 && userIndex > sysIndex) {
      const sysPart = rawPrompt
        .slice(sysIndex + "### System Prompt".length, userIndex)
        .trim();
      const userPart = rawPrompt
        .slice(userIndex + "### User Prompt".length)
        .trim();
      return {
        systemPrompt: sysPart,
        userPrompt: userPart,
        hasSections: true,
      };
    }

    return { systemPrompt: "", userPrompt: "", hasSections: false };
  }, [rawPrompt]);

  // Determine current active text
  const displayedText = useMemo(() => {
    if (!rawPrompt) return "";
    let content = rawPrompt;
    if (hasSections) {
      if (activeTab === "system") content = systemPrompt;
      else if (activeTab === "user") content = userPrompt;
    }
    return hideValues ? maskFinancialValues(content) : content;
  }, [rawPrompt, hasSections, activeTab, systemPrompt, userPrompt, hideValues]);

  const handleCopy = useCallback(async () => {
    if (!displayedText) return;
    try {
      await navigator.clipboard.writeText(displayedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy prompt to clipboard:", err);
    }
  }, [displayedText]);

  if (!isOpen || !report) return null;

  const charCount = displayedText.length;
  const wordCount = displayedText ? displayedText.trim().split(/\s+/).length : 0;
  const approxTokens = Math.round(charCount / 4);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono overflow-y-auto">
      <div
        className="relative w-full max-w-2xl sm:max-w-3xl flex flex-col rounded-xl sm:rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] my-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/70 px-4 py-3 sm:px-5 sm:py-3.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg border border-[#DD3C73]/30 bg-[#DD3C73]/10 flex items-center justify-center text-[#DD3C73] shrink-0">
              <Terminal className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="prompt-modal-title"
                className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-100 truncate"
              >
                {t("reports.prompt.title")}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Bot className="w-3 h-3 text-[#DD3C73]" />
                  <span className="truncate">{report.model}</span>
                </span>
                <span className="text-slate-600">•</span>
                <span className="uppercase text-slate-300">{report.provider || t("reports.prompt.localProvider")}</span>
                <span className="text-slate-600">•</span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-500" />
                  <span>{report.period || report.weekKey}</span>
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title={t("reports.prompt.closeTitle")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar: Tabs & Meta */}
        <div className="px-4 sm:px-5 py-2.5 border-b border-slate-800/80 bg-slate-950/40 flex flex-wrap items-center justify-between gap-2.5 shrink-0 text-xs">
          {hasSections ? (
            <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer uppercase font-bold tracking-wider ${
                  activeTab === "all"
                    ? "bg-[#DD3C73]/20 text-[#DD3C73] border border-[#DD3C73]/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t("reports.prompt.tabs.all")}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("system")}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer uppercase font-bold tracking-wider ${
                  activeTab === "system"
                    ? "bg-[#DD3C73]/20 text-[#DD3C73] border border-[#DD3C73]/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t("reports.prompt.tabs.system")}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("user")}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer uppercase font-bold tracking-wider ${
                  activeTab === "user"
                    ? "bg-[#DD3C73]/20 text-[#DD3C73] border border-[#DD3C73]/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t("reports.prompt.tabs.user")}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-slate-400 text-xs font-bold uppercase tracking-wider">
              <FileCode className="w-3.5 h-3.5 text-[#DD3C73]" />
              <span>{t("reports.prompt.payload")}</span>
            </div>
          )}

          {rawPrompt && (
            <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono ml-auto">
              <span>{t("reports.prompt.words", { count: wordCount })}</span>
              <span>•</span>
              <span>{t("reports.prompt.chars", { count: charCount })}</span>
              <span>•</span>
              <span>{t("reports.prompt.tokens", { count: approxTokens })}</span>
            </div>
          )}
        </div>

        {/* Modal Content */}
        <div className="p-4 sm:p-5 flex-1 min-h-0 overflow-hidden flex flex-col">
          {!rawPrompt && isLoadingPrompt ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center rounded-xl border border-slate-800 bg-slate-950/60">
              <p className="text-[11px] text-slate-400">{t("reports.prompt.loading")}</p>
            </div>
          ) : !rawPrompt ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center rounded-xl border border-slate-800 bg-slate-950/60">
              <AlertCircle className="w-8 h-8 text-cream mb-3 opacity-80" />
              <div className="text-xs font-bold uppercase tracking-wider text-slate-200 mb-1">
                {t("reports.prompt.emptyTitle")}
              </div>
              <p className="max-w-md text-[11px] text-slate-400 leading-relaxed">
                {t("reports.prompt.emptyDescription")}
              </p>
            </div>
          ) : (
            <div className="relative flex-1 min-h-0 flex flex-col rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
              <div className="absolute top-2.5 right-2.5 z-10">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-slate-800 bg-slate-900/90 text-[11px] font-medium text-slate-300 hover:text-slate-50 hover:border-slate-700 transition-colors shadow-lg cursor-pointer"
                  title={t("reports.prompt.copyTitle")}
                >
                  {copied ? (
                    <>
                      <CheckCheck className="w-3.5 h-3.5 text-mint" />
                      <span className="text-mint">{t("common.copied")}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>{t("common.copy")}</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="flex-1 min-h-0 p-4 overflow-auto font-mono text-xs text-slate-200 leading-relaxed whitespace-pre-wrap select-text custom-scrollbar">
                {displayedText}
              </pre>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/70 px-4 py-2.5 sm:px-5 sm:py-3 shrink-0 gap-3">
          <div className="text-[10px] text-slate-500 truncate">
            {rawPrompt ? (
              <span>{t("reports.prompt.footerSent")}</span>
            ) : (
              <span>{t("reports.prompt.footerEmpty")}</span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {rawPrompt && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-300 hover:text-slate-50 hover:border-slate-700 transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <CheckCheck className="w-3.5 h-3.5 text-mint" />
                    <span className="text-mint">{t("common.copied")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t("reports.prompt.copyPrompt")}</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-royal hover:bg-plum text-white text-xs font-bold transition-all cursor-pointer uppercase tracking-wider"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
