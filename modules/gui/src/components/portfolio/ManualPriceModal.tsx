import { useEffect, useId, useState } from "react";
import { X, Landmark, Loader2, AlertCircle } from "lucide-react";
import type { PortfolioHolding } from "portfolio-shared/portfolio";
import { api } from "../../api";
import { fmtCurrency } from "./utils";

interface ManualPriceModalProps {
  portfolioId: string;
  holding: PortfolioHolding;
  /** Base currency of the portfolio, the fallback for the price currency. */
  currency: string;
  hideValues?: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

/**
 * Set, edit or clear the price or NAV of a private holding. The service
 * values the holding with it in place of the buy price.
 */
export function ManualPriceModal({ portfolioId, holding, currency, hideValues = false, onClose, onSaved }: ManualPriceModalProps) {
  const titleId = useId();
  const current = holding.manualPrice;
  // In privacy mode the stored price is not prefilled.
  const [price, setPrice] = useState(current && !hideValues ? String(current.price) : "");
  const [priceCurrency, setPriceCurrency] = useState(current?.currency || holding.nativeCurrency || currency);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(price.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a price above zero.");
      return;
    }
    const curr = priceCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(curr)) {
      setError("Enter a three-letter currency code, such as EUR.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const res = await api.setManualPrice(portfolioId, holding.symbol, { price: value, currency: curr });
      if (!res.success) throw new Error(res.error || "Could not save the price");
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the price");
    } finally {
      setBusy(null);
    }
  };

  const handleClear = async () => {
    setBusy("clear");
    setError(null);
    try {
      const res = await api.clearManualPrice(portfolioId, holding.symbol);
      if (!res.success) throw new Error(res.error || "Could not clear the price");
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear the price");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 font-mono" onClick={busy ? undefined : onClose} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md flex flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-4 py-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <Landmark className="w-4 h-4 text-slate-400 shrink-0" />
            <span id={titleId} className="text-xs font-bold uppercase tracking-wider text-slate-400 truncate">
              Price or NAV
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-30"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 text-xs">
          <p className="text-slate-400 leading-relaxed">
            <span className="text-slate-200">{holding.symbol}</span> has no public quote, so it is valued at its buy price. Enter the
            current price or NAV per share from your broker to value it with that instead.
          </p>
          {current && (
            <p className="text-slate-500">
              Set on {current.setAt}: {fmtCurrency(current.price, current.currency, hideValues)}
            </p>
          )}

          {error && (
            <div className="p-2.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/10 flex items-start gap-2 text-[#DD3C73]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}

          <div className="flex gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Price per share *</span>
              <input
                type={hideValues ? "password" : "text"}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="e.g. 10.42"
                autoFocus
                autoComplete="off"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73]"
              />
            </label>
            <label className="flex flex-col gap-1 w-24">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Currency</span>
              <input
                type="text"
                value={priceCurrency}
                onChange={(e) => setPriceCurrency(e.target.value)}
                maxLength={3}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 uppercase focus:outline-none focus:border-[#DD3C73]"
              />
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-950/40 px-4 py-3">
          {current && (
            <button
              type="button"
              onClick={handleClear}
              disabled={busy !== null}
              className="px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
              title="Value the holding at its buy price again"
            >
              {busy === "clear" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Clear
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy !== null}
            className="px-3 py-1.5 rounded-lg border border-[#DD3C73]/50 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
          >
            {busy === "save" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
