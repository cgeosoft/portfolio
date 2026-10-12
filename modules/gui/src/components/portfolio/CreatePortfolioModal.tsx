import { useState, useEffect } from "react";
import type { PortfolioItem } from "portfolio-shared/portfolio";
import { rpc } from "../../rpc";
import { X, Plus, Loader2, AlertCircle } from "lucide-react";
import { Select } from "../common/Select";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./PortfolioCard";
import { PORTFOLIO_COLORS, PortfolioColorField, PortfolioDot } from "./portfolioColor";

// The New portfolio modal, drawn like the New organization modal of FintechCrafts Management: an icon
// header, a preview line of the new portfolio, the fields and the colour, one line on what happens, Cancel and Create.

interface CreatePortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPortfolioCreated: (newPortfolio: PortfolioItem) => void;
  /** The colours the other portfolios use; the first free swatch is the starting colour. */
  takenColors?: string[];
}

const firstFreeColor = (taken: string[]) => PORTFOLIO_COLORS.find((swatch) => !taken.includes(swatch)) ?? PORTFOLIO_COLORS[0]!;

const INPUT_CLASS =
  "w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-accent-500 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none transition-colors font-mono";

const LABEL_CLASS = "text-[10px] uppercase tracking-wider text-slate-400 font-semibold";

export function CreatePortfolioModal({
  isOpen,
  onClose,
  onPortfolioCreated,
  takenColors = [],
}: CreatePortfolioModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("EUR");
  const [color, setColor] = useState(() => firstFreeColor(takenColors));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setDescription("");
      setBaseCurrency("EUR");
      setColor(firstFreeColor(takenColors));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!name.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const portfolio = await rpc.request.createPortfolio({
        name: name.trim(),
        description: description.trim() || undefined,
        baseCurrency,
        color,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono">
      <div role="dialog" aria-modal="true" className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg border bg-accent-500/10 text-accent-400 border-accent-500/20">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-lg">New portfolio</h3>
              <p className="text-xs text-slate-400">An empty portfolio with its own base currency</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors cursor-pointer hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-5 text-sm text-slate-300">
          <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
            <PortfolioDot color={color} className="w-3 h-3" />
            <span className="font-bold text-slate-50 truncate">{name.trim() || "Portfolio name"}</span>
            <span className="ml-auto text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border bg-slate-800/80 text-slate-400 border-slate-700 shrink-0">
              {baseCurrency}
            </span>
          </div>

          <div className="space-y-2">
            <label htmlFor="portfolio-new-name" className={LABEL_CLASS}>
              Name
            </label>
            <input
              id="portfolio-new-name"
              className={INPUT_CLASS}
              value={name}
              maxLength={60}
              placeholder="For example Growth stocks"
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="portfolio-new-description" className={LABEL_CLASS}>
              Description
            </label>
            <input
              id="portfolio-new-description"
              className={INPUT_CLASS}
              value={description}
              maxLength={200}
              placeholder="Optional, one short line"
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <span className={LABEL_CLASS}>Base currency</span>
            <Select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} selectSize="sm" disabled={isLoading}>
              <option value="EUR">EUR (€) - Euro</option>
              <option value="USD">USD ($) - US Dollar</option>
              <option value="GBP">GBP (£) - British Pound</option>
              <option value="CHF">CHF (Fr) - Swiss Franc</option>
            </Select>
          </div>

          <PortfolioColorField color={color} onChange={setColor} disabled={isLoading} />

          <p className="text-xs text-slate-400 leading-relaxed">
            The app adds an empty portfolio with no holdings and no transactions. You cannot change the base currency later. The other portfolios
            stay as they are.
          </p>

          {error && (
            <span className="inline-flex items-start gap-1.5 text-[11px] text-rose-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span className="whitespace-pre-line">{error}</span>
            </span>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={isLoading} className={SECONDARY_BUTTON}>
              Cancel
            </button>
            <button type="submit" disabled={isLoading || !name.trim()} className={PRIMARY_BUTTON}>
              {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
