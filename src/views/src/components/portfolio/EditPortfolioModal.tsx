import { useState, useEffect } from "react";
import type { PortfolioItem } from "../../types/portfolio";
import { rpc } from "../../rpc";
import { X, Edit3, Lock, Save, Loader2, AlertCircle, CheckCircle2, Sparkles, Trash2 } from "lucide-react";

interface EditPortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  portfolio: PortfolioItem | null;
  onPortfolioUpdated: (updated: PortfolioItem) => void;
  onDelete?: (portfolio: PortfolioItem) => void;
}

export function EditPortfolioModal({
  isOpen,
  onClose,
  portfolio,
  onPortfolioUpdated,
  onDelete,
}: EditPortfolioModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (portfolio) {
      setName(portfolio.name || "");
      setDescription(portfolio.description || "");
      setError(null);
      setSuccessMsg(null);
    }
  }, [portfolio, isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isLoading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen || !portfolio) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter a portfolio name");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const updated = await rpc.request.updatePortfolio({
        portfolioId: portfolio.id,
        name: name.trim(),
        description: description.trim() || undefined,
      });

      onPortfolioUpdated(updated);
      setSuccessMsg("Portfolio updated successfully");
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err: any) {
      setError(err.message || "Error updating portfolio");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 font-mono overflow-y-auto">
      <div className="relative w-full max-w-lg flex flex-col rounded-xl sm:rounded-2xl border border-orange-500/30 bg-slate-900 shadow-2xl overflow-hidden max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-3.5 py-2.5 sm:px-5 sm:py-3.5 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Edit3 className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 truncate">
              Edit Portfolio
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800/80 text-slate-400 uppercase font-bold shrink-0 ml-1">
              {portfolio.baseCurrency || "EUR"}
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSave} className="flex flex-col min-h-0 flex-1">
          <div className="p-3.5 sm:p-5 flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 custom-scrollbar">
            {/* Top Banner */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100 uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-orange-400 shrink-0" />
                <span>Configure Portfolio Settings</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Update the display name and strategic description of this portfolio.
              </p>
            </div>

            {/* Alerts */}
            {error && (
              <div className="p-3.5 rounded-xl border border-[#DD3C73]/40 bg-[#DD3C73]/10 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-[#DD3C73] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-[#DD3C73] uppercase tracking-wider">
                    Update Error
                  </div>
                  <div className="text-xs text-[#DD3C73] font-mono break-words leading-relaxed mt-1">
                    {error}
                  </div>
                </div>
              </div>
            )}

            {successMsg && (
              <div className="p-3.5 rounded-xl border border-[#A7E2C0]/40 bg-[#A7E2C0]/10 flex items-center gap-2.5 text-xs text-[#A7E2C0]">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="font-bold">{successMsg}</span>
              </div>
            )}

            {/* Form Fields */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs flex flex-col gap-3">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                  Portfolio Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Main Portfolio, Crypto, Tech Stocks"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Short description of this portfolio's strategy"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73]"
                />
              </div>

              {/* Base Currency: Not Editable */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Base Currency
                  </label>
                  <span className="text-[10px] text-[#E3EACD]/80 flex items-center gap-1 font-mono">
                    <Lock className="w-2.5 h-2.5" /> Fixed
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={`${portfolio.baseCurrency || "EUR"} (Fixed Base Currency)`}
                    disabled
                    readOnly
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 cursor-not-allowed select-none font-mono"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1 font-mono">
                  The base currency cannot be modified after portfolio creation.
                </p>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0 gap-2">
            <div>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onDelete(portfolio);
                  }}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-rose-900/50 bg-rose-950/20 text-xs font-bold text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 hover:border-rose-700/60 cursor-pointer disabled:opacity-50 transition-colors"
                  title="Delete this portfolio"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="px-3 sm:px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 hover:text-slate-200 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
