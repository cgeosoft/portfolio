import { useEffect, useId, useState } from "react";
import { X, Tag, Loader2, AlertCircle } from "lucide-react";
import type { PortfolioHolding } from "portfolio-shared/portfolio";
import { api } from "../../api";
import { t } from "../../i18n";

interface SymbolEditModalProps {
  holding: PortfolioHolding & { isin: string };
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

/**
 * Set the ticker of an ISIN by hand. The service stores it in the ISIN map,
 * uses it for later imports and repoints the transactions of every portfolio.
 */
export function SymbolEditModal({ holding, onClose, onSaved }: SymbolEditModalProps) {
  const titleId = useId();
  const unresolved = holding.symbol.toUpperCase() === holding.isin.toUpperCase();
  const [symbol, setSymbol] = useState(unresolved ? "" : holding.symbol);
  const [name, setName] = useState(holding.name && holding.name !== holding.symbol ? holding.name : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = symbol.trim().toUpperCase();
    if (!value) {
      setError(t("transactions.symbol.required"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.setIsinSymbol(holding.isin, { symbol: value, name: name.trim() || undefined });
      if (!res.success) throw new Error(res.error || t("transactions.symbol.saveFailed"));
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("transactions.symbol.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const [isinBefore, isinAfter] = t("transactions.symbol.isin").split("{isin}");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 font-mono" onClick={saving ? undefined : onClose} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md flex flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-4 py-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <Tag className="w-4 h-4 text-slate-400 shrink-0" />
            <span id={titleId} className="text-xs font-bold uppercase tracking-wider text-slate-400 truncate">
              {t("transactions.symbol.title")}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-30"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 text-xs">
          <p className="text-slate-400 leading-relaxed">
            {isinBefore}<span className="text-slate-200">{holding.isin}</span>{isinAfter}{" "}
            {unresolved ? t("transactions.symbol.unresolved") : t("transactions.symbol.resolved")}{" "}
            {t("transactions.symbol.appliesEverywhere")}
          </p>

          {error && (
            <div className="p-2.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/10 flex items-start gap-2 text-[#DD3C73]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="wrap-break-word">{error}</span>
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{t("transactions.symbol.ticker")}</span>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder={t("transactions.symbol.tickerPlaceholder")}
              autoFocus
              maxLength={32}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 uppercase focus:outline-hidden focus:border-[#DD3C73]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{t("transactions.symbol.name")}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("common.optional")}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-[#DD3C73]"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-800 bg-slate-950/40 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer disabled:opacity-40"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1.5 rounded-lg border border-[#DD3C73]/50 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
