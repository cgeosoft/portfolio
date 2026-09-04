import { useState, useEffect } from "react";
import type { PortfolioItem } from "../../types/portfolio";
import {
  X,
  Trash2,
  AlertTriangle,
  Loader2,
  FileText,
  History,
  TrendingUp,
  AlertCircle,
} from "lucide-react";

interface DeletePortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  portfolio: PortfolioItem | null;
  isLastPortfolio?: boolean;
  onConfirmDelete: (portfolio: PortfolioItem) => Promise<void>;
}

export function DeletePortfolioModal({
  isOpen,
  onClose,
  portfolio,
  isLastPortfolio = false,
  onConfirmDelete,
}: DeletePortfolioModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsDeleting(false);
    }
  }, [isOpen, portfolio]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isDeleting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isDeleting, onClose]);

  if (!isOpen || !portfolio) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirmDelete(portfolio);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to delete portfolio. Please try again.");
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-portfolio-title"
      aria-describedby="delete-portfolio-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-md flex flex-col rounded-2xl border border-rose-500/40 bg-slate-900 shadow-2xl shadow-rose-950/40 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-rose-950/60 bg-rose-950/30 px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-400 shrink-0">
              <Trash2 className="w-4 h-4" />
            </div>
            <span
              id="delete-portfolio-title"
              className="text-xs font-bold uppercase tracking-wider text-rose-400 truncate"
            >
              Delete Portfolio
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-30"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto max-h-[calc(100dvh-10rem)] custom-scrollbar">
          {/* Portfolio Info Card */}
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <TrendingUp className="w-4 h-4 text-[#DD3C73] shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-100 truncate" title={portfolio.name}>
                  {portfolio.name}
                </div>
                {portfolio.description ? (
                  <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5" title={portfolio.description}>
                    {portfolio.description}
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-500 italic mt-0.5">No description</p>
                )}
              </div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-300 font-bold shrink-0">
              {portfolio.baseCurrency || "EUR"}
            </span>
          </div>

          {/* Warning Message */}
          <div
            id="delete-portfolio-desc"
            className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-950/20 text-xs text-rose-300 leading-relaxed flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-rose-200">
                Are you sure you want to permanently delete this portfolio?
              </p>
              <p className="text-[11px] text-rose-300/90">
                This action is destructive and cannot be undone.
              </p>
            </div>
          </div>

          {/* Cascade Deletion List */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2 text-xs">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Automatically Deleted Data:
            </div>
            <ul className="space-y-1.5 text-[11px] text-slate-300">
              <li className="flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>All transaction history and trade ledgers</span>
              </li>
              <li className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>All AI quantitative analysis reports and briefings</span>
              </li>
              <li className="flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>All performance history, charts, and snapshots</span>
              </li>
            </ul>
          </div>

          {/* Note if it's the only portfolio */}
          {isLastPortfolio && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-950/20 text-[11px] text-amber-300 leading-relaxed">
              <span className="font-bold text-amber-200">Note:</span> Deleting your only portfolio will reset your data and generate a fresh default portfolio.
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-950/30 flex items-start gap-2 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 break-words">{error}</div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-5 py-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 hover:text-slate-200 cursor-pointer disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-lg shadow-rose-600/25 cursor-pointer uppercase tracking-wider disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Deleting…</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Portfolio</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
