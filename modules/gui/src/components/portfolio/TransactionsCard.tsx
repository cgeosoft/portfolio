import { useDeferredValue, useMemo, useState } from "react";
import type { PortfolioTransaction } from "portfolio-shared/portfolio";
import { formatMoney, fmtCurrency, numberFormat } from "./utils";
import { Plus, Upload, Trash2, Edit2, Search, ArrowRightLeft } from "lucide-react";
import { Select } from "../common/Select";
import { HoldingLink } from "./holding-links";
import { t } from "../../i18n";

/** Rows rendered before "Show all": thousands of rows make every search keystroke slow. */
const ROW_LIMIT = 200;

/** Sort key of a transaction: its time, else its date; 0 (sorted last) without a valid one. */
function transactionTime(tx: PortfolioTransaction): number {
  const time = tx.datetime ? Date.parse(tx.datetime) : tx.date ? Date.parse(tx.date) : 0;
  return isNaN(time) ? 0 : time;
}

interface TransactionsCardProps {
  transactions: PortfolioTransaction[];
  currency?: string;
  onOpenAddModal: () => void;
  onOpenEditModal: (tx: PortfolioTransaction) => void;
  onDeleteTransaction: (id: string) => void;
  onOpenImportModal: () => void;
  hideValues?: boolean;
}

export function TransactionsCard({
  transactions,
  currency = "EUR",
  onOpenAddModal,
  onOpenEditModal,
  onDeleteTransaction,
  onOpenImportModal,
  hideValues = false,
}: TransactionsCardProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("portfolio_transactions_type_filter") || "ALL";
    }
    return "ALL";
  });

  const handleTypeFilterChange = (val: string) => {
    setTypeFilter(val);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("portfolio_transactions_type_filter", val);
    }
  };

  // Sorted once per ledger, with the search keys lower-cased up front; the search then only filters.
  const sorted = useMemo(
    () =>
      (transactions || [])
        .map((tx) => ({ tx, time: transactionTime(tx), symbol: tx.symbol.toLowerCase(), name: (tx.name || "").toLowerCase() }))
        .sort((a, b) => b.time - a.time),
    [transactions],
  );

  // Typing stays responsive: the table follows the search box a moment later on a long ledger.
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    const query = deferredSearch.toLowerCase();
    return sorted
      .filter((entry) => {
        const matchSearch = entry.symbol.includes(query) || entry.name.includes(query) || entry.tx.date.includes(deferredSearch);
        const matchType = typeFilter === "ALL" || entry.tx.type === typeFilter;
        return matchSearch && matchType;
      })
      .map((entry) => entry.tx);
  }, [sorted, deferredSearch, typeFilter]);

  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? filtered : filtered.slice(0, ROW_LIMIT);

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "BUY":
      case "STOCKPERK":
      case "PRIVATE_MARKET_BUY":
        return "bg-royal/20 text-royal-bright border-royal/40";
      case "SELL":
        return "bg-[#DD3C73]/15 text-[#DD3C73] border-[#DD3C73]/30";
      case "DIVIDEND":
        return "bg-mint/15 text-mint border-mint/30";
      case "INTEREST_PAYMENT":
        return "bg-cream/15 text-cream border-cream/30";
      case "CUSTOMER_INBOUND":
      case "DEPOSIT":
        return "bg-royal/20 text-royal-bright border-royal/40";
      case "CUSTOMER_OUTBOUND":
      case "WITHDRAWAL":
        return "bg-[#DD3C73]/15 text-[#DD3C73] border-[#DD3C73]/30";
      default:
        return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    }
  };

  return (
    <div className="flex flex-col gap-3.5 flex-1 min-h-0 font-mono">
      {/* Header toolbar outside the table box */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pb-3 border-b border-slate-800/80 shrink-0">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-widest font-mono min-w-0">
            <ArrowRightLeft className="w-4 h-4 text-[#DD3C73] shrink-0" />
            <span className="truncate">{t("transactions.ledger.title")}</span>
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5 font-mono" title={t("transactions.ledger.eventsCount", { count: transactions.length })}>
            {t("transactions.ledger.eventsCount", { count: transactions.length })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Search bar */}
          <div className="relative flex-1 sm:w-44">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder={t("transactions.ledger.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#DD3C73]/50 font-mono"
            />
          </div>

          <Select
            value={typeFilter}
            onChange={(e) => handleTypeFilterChange(e.target.value)}
            selectSize="sm"
            className="h-8"
            wrapperClassName="shrink-0"
            aria-label={t("transactions.ledger.filterLabel")}
          >
            <option value="ALL">{t("transactions.ledger.allTypes")}</option>
            <option value="BUY">{t("transactions.types.buy")}</option>
            <option value="SELL">{t("transactions.types.sell")}</option>
            <option value="DIVIDEND">{t("transactions.types.dividend")}</option>
            <option value="INTEREST_PAYMENT">{t("transactions.types.interest")}</option>
            <option value="CUSTOMER_INBOUND">{t("transactions.types.deposit")}</option>
            <option value="CUSTOMER_OUTBOUND">{t("transactions.types.withdrawal")}</option>
          </Select>

          <button
            onClick={onOpenImportModal}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors cursor-pointer uppercase tracking-wider font-mono"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{t("transactions.ledger.importCsv")}</span>
          </button>

          <button
            onClick={onOpenAddModal}
            className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider shadow-lg shadow-[#DD3C73]/10 font-mono"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t("transactions.ledger.addTransaction")}</span>
          </button>
        </div>
      </div>

      {/* Table Box */}
      <div className="cx-card flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0 custom-scrollbar">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 z-10">
              <tr className="text-[11px] text-slate-400 uppercase tracking-wider">
                <th className="py-2.5 px-3">{t("transactions.ledger.columns.date")}</th>
                <th className="py-2.5 px-3">{t("transactions.ledger.columns.type")}</th>
                <th className="py-2.5 px-3">{t("transactions.ledger.columns.symbol")}</th>
                <th className="py-2.5 px-3 text-right">{t("transactions.ledger.columns.shares")}</th>
                <th className="py-2.5 px-3 text-right">{t("transactions.ledger.columns.price")}</th>
                <th className="py-2.5 px-3 text-right">{t("transactions.ledger.columns.totalAmount")}</th>
                <th className="py-2.5 px-3 text-right">{t("transactions.ledger.columns.feeTax")}</th>
                <th className="py-2.5 px-3 text-center">{t("transactions.ledger.columns.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 font-mono text-xs">
                    {t("transactions.ledger.empty")}
                  </td>
                </tr>
              ) : (
                visible.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/20 transition-colors group">
                    <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{tx.date}</td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${getTypeBadge(tx.type)}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-200" title={tx.name || undefined}><HoldingLink reference={tx.symbol} /></td>
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      {tx.shares === undefined || tx.shares === null
                        ? "—"
                        : hideValues
                        ? "••••"
                        : typeof tx.shares === "number"
                        ? numberFormat("en-US", 0, 4).format(tx.shares)
                        : tx.shares}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-400">
                      {typeof tx.price === "number" ? formatMoney(tx.price, tx.currency || currency, 2, hideValues) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-medium text-slate-100">
                      {typeof tx.amount === "number" ? formatMoney(Math.abs(tx.amount), tx.currency || currency, 2, hideValues) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-500 text-[11px]">
                      {(tx.fee || tx.tax) ? fmtCurrency((tx.fee || 0) + (tx.tax || 0), tx.currency || currency, hideValues) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onOpenEditModal(tx)}
                          className="p-1 hover:text-[#DD3C73] text-slate-400 transition-colors cursor-pointer"
                          title={t("transactions.ledger.editTransaction")}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteTransaction(tx.id)}
                          className="p-1 hover:text-[#DD3C73] text-slate-400 transition-colors cursor-pointer"
                          title={t("transactions.ledger.deleteTransaction")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
              {visible.length < filtered.length && (
                <tr>
                  <td colSpan={8} className="py-3 text-center">
                    <button
                      type="button"
                      onClick={() => setShowAll(true)}
                      className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors cursor-pointer uppercase tracking-wider font-mono"
                    >
                      {t("transactions.ledger.showAll", { count: filtered.length })}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
