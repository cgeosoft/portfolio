import { useState, useEffect } from "react";
import type { PortfolioItem } from "portfolio-shared/portfolio";
import { rpc } from "../../rpc";
import { X, Pencil, Lock, Check, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./PortfolioCard";
import { PortfolioColorField, PortfolioDot, portfolioColor } from "./portfolioColor";
import { t } from "../../i18n";

// The edit modal of one portfolio, drawn like the edit modal of an organization in FintechCrafts
// Management: a preview line, name, description and colour, the fixed base currency, then Delete,
// Cancel and Save.

interface EditPortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  portfolio: PortfolioItem | null;
  onPortfolioUpdated: (updated: PortfolioItem) => void;
  onDelete?: (portfolio: PortfolioItem) => void;
}

const INPUT_CLASS =
  "w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-accent-500 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden transition-colors font-mono";

const LABEL_CLASS = "text-[10px] uppercase tracking-wider text-slate-400 font-semibold";

const DANGER_BUTTON =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-semibold whitespace-nowrap text-rose-300 transition-colors cursor-pointer hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50";

export function EditPortfolioModal({
  isOpen,
  onClose,
  portfolio,
  onPortfolioUpdated,
  onDelete,
}: EditPortfolioModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(portfolioColor(null));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (portfolio) {
      setName(portfolio.name || "");
      setDescription(portfolio.description || "");
      setColor(portfolioColor(portfolio));
      setError(null);
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
    if (!name.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const updated = await rpc.request.updatePortfolio({
        portfolioId: portfolio.id,
        name: name.trim(),
        description: description.trim() || undefined,
        color: color !== portfolioColor(portfolio) ? color : undefined,
      });

      onPortfolioUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || t("portfolios.edit.error"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-200 font-mono">
      <div role="dialog" aria-modal="true" className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg border bg-accent-500/10 text-accent-400 border-accent-500/20">
              <Pencil className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-lg">{t("portfolios.edit.title")}</h3>
              <p className="text-xs text-slate-400">{t("portfolios.edit.subtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors cursor-pointer hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-5 text-sm text-slate-300">
          <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
            <PortfolioDot color={color} className="w-3 h-3" />
            <span className="font-bold text-slate-50 truncate">{name.trim() || t("portfolios.form.namePreview")}</span>
            <span className="ml-auto text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-sm border bg-slate-800/80 text-slate-400 border-slate-700 shrink-0">
              {portfolio.baseCurrency || "EUR"}
            </span>
          </div>

          <div className="space-y-2">
            <label htmlFor="portfolio-edit-name" className={LABEL_CLASS}>
              {t("portfolios.form.name")}
            </label>
            <input
              id="portfolio-edit-name"
              className={INPUT_CLASS}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="portfolio-edit-description" className={LABEL_CLASS}>
              {t("portfolios.form.description")}
            </label>
            <input
              id="portfolio-edit-description"
              className={INPUT_CLASS}
              value={description}
              maxLength={200}
              placeholder={t("portfolios.form.descriptionPlaceholder")}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <PortfolioColorField color={color} onChange={setColor} disabled={isLoading} />

          <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Lock className="w-3 h-3 shrink-0" />
            {t("portfolios.edit.fixedCurrency", { currency: portfolio.baseCurrency || "EUR" })}
          </p>

          {error && (
            <span className="inline-flex items-start gap-1.5 text-[11px] text-rose-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span className="whitespace-pre-line">{error}</span>
            </span>
          )}

          <div className="flex items-center gap-3 pt-2">
            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onDelete(portfolio);
                }}
                disabled={isLoading}
                className={DANGER_BUTTON}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("common.delete")}
              </button>
            )}
            <button type="button" onClick={onClose} disabled={isLoading} className={`${SECONDARY_BUTTON} ml-auto`}>
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={isLoading || !name.trim()} className={PRIMARY_BUTTON}>
              {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
