import { useState, useEffect } from "react";
import type { PortfolioItem } from "../../types/portfolio";
import { rpc } from "../../rpc";
import { X, Plus, Loader2, AlertCircle, TrendingUp, Sparkles } from "lucide-react";
import { Select } from "../common/Select";

interface CreatePortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPortfolioCreated: (newPortfolio: PortfolioItem) => void;
}

export function CreatePortfolioModal({
  isOpen,
  onClose,
  onPortfolioCreated,
}: CreatePortfolioModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("EUR");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setDescription("");
      setBaseCurrency("EUR");
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isLoading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter a portfolio name");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const portfolio = await rpc.request.createPortfolio({
        name: name.trim(),
        description: description.trim() || undefined,
        baseCurrency,
      });

      onPortfolioCreated(portfolio);
      onClose();
    } catch (err: any) {
      setError(err.message || "Error creating portfolio");
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
            <TrendingUp className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 truncate">
              Create New Portfolio
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800/80 text-slate-400 uppercase font-bold shrink-0 ml-1">
              {baseCurrency}
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
        <form onSubmit={handleCreate} className="flex flex-col min-h-0 flex-1">
          <div className="p-3.5 sm:p-5 flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 custom-scrollbar">
            {/* Top Banner */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100 uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-orange-400 shrink-0" />
                <span>Initialize Portfolio Ledger</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Establish an isolated investment portfolio with its own base currency, holdings tracking, and analytics.
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3.5 rounded-xl border border-[#DD3C73]/40 bg-[#DD3C73]/10 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-[#DD3C73] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-[#DD3C73] uppercase tracking-wider">
                    Creation Error
                  </div>
                  <div className="text-xs text-[#DD3C73] font-mono break-words leading-relaxed mt-1">
                    {error}
                  </div>
                </div>
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
                  placeholder="e.g. Growth Stocks, Crypto, Real Estate"
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

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                  Base Currency
                </label>
                <Select
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                  selectSize="sm"
                >
                  <option value="EUR">EUR (€) - Euro</option>
                  <option value="USD">USD ($) - US Dollar</option>
                  <option value="GBP">GBP (£) - British Pound</option>
                  <option value="CHF">CHF (Fr) - Swiss Franc</option>
                </Select>
                <p className="text-[10px] text-slate-500 mt-1 font-mono">
                  Note: The base currency is fixed after creation for valuation consistency.
                </p>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0 gap-2">
            <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">
              <span>Multi-Portfolio Engine</span>
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
                    <span>Creating…</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Portfolio</span>
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
