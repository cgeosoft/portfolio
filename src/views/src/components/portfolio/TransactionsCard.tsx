import { useState } from "react";
import type { PortfolioTransaction } from "../../types/portfolio";
import { formatMoney, fmtCurrency } from "./utils";
import { Plus, Upload, Trash2, Edit2, Search, ArrowRightLeft, ChevronDown } from "lucide-react";

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
  const [typeFilter, setTypeFilter] = useState("ALL");

  const filtered = (transactions || [])
    .filter((tx) => {
      const matchSearch =
        tx.symbol.toLowerCase().includes(search.toLowerCase()) ||
        (tx.name || "").toLowerCase().includes(search.toLowerCase()) ||
        tx.date.includes(search);
      const matchType = typeFilter === "ALL" || tx.type === typeFilter;
      return matchSearch && matchType;
    })
    .sort((a, b) => {
      const timeA = a.datetime ? new Date(a.datetime).getTime() : (a.date ? new Date(a.date).getTime() : 0);
      const timeB = b.datetime ? new Date(b.datetime).getTime() : (b.date ? new Date(b.date).getTime() : 0);
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "BUY":
      case "STOCKPERK":
      case "PRIVATE_MARKET_BUY":
        return "bg-[#243C8F]/20 text-[#7392fa] border-[#243C8F]/40";
      case "SELL":
        return "bg-[#DD3C73]/15 text-[#DD3C73] border-[#DD3C73]/30";
      case "DIVIDEND":
        return "bg-[#A7E2C0]/15 text-[#A7E2C0] border-[#A7E2C0]/30";
      case "INTEREST_PAYMENT":
        return "bg-[#E3EACD]/15 text-[#E3EACD] border-[#E3EACD]/30";
      case "CUSTOMER_INBOUND":
      case "DEPOSIT":
        return "bg-[#243C8F]/20 text-[#7392fa] border-[#243C8F]/40";
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
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 min-w-0">
            <ArrowRightLeft className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">Transaction Ledger</span>
          </div>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate" title={`${transactions.length} recorded events (trades, dividends, deposits)`}>
            {transactions.length} recorded events (trades, dividends, deposits)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Search bar */}
          <div className="relative flex-1 sm:w-44">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search ledger..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#DD3C73]/50 font-mono"
            />
          </div>

          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-slate-950/70 border border-slate-800 hover:border-slate-700 rounded-lg pl-2.5 pr-8 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-[#DD3C73]/50 cursor-pointer appearance-none transition-colors"
            >
              <option value="ALL" className="bg-slate-900 text-slate-100">All Types</option>
              <option value="BUY" className="bg-slate-900 text-slate-100">BUY</option>
              <option value="SELL" className="bg-slate-900 text-slate-100">SELL</option>
              <option value="DIVIDEND" className="bg-slate-900 text-slate-100">DIVIDEND</option>
              <option value="INTEREST_PAYMENT" className="bg-slate-900 text-slate-100">INTEREST</option>
              <option value="CUSTOMER_INBOUND" className="bg-slate-900 text-slate-100">DEPOSIT</option>
              <option value="CUSTOMER_OUTBOUND" className="bg-slate-900 text-slate-100">WITHDRAWAL</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <button
            onClick={onOpenImportModal}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors cursor-pointer uppercase tracking-wider font-mono"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import CSV</span>
          </button>

          <button
            onClick={onOpenAddModal}
            className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider shadow-lg shadow-[#DD3C73]/10 font-mono"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Transaction</span>
          </button>
        </div>
      </div>

      {/* Table Box */}
      <div className="cx-card flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0 custom-scrollbar">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 z-10">
              <tr className="text-[11px] text-slate-400 uppercase tracking-wider">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Symbol</th>
                <th className="py-2.5 px-3 text-right">Shares</th>
                <th className="py-2.5 px-3 text-right">Price</th>
                <th className="py-2.5 px-3 text-right">Total Amount</th>
                <th className="py-2.5 px-3 text-right">Fee / Tax</th>
                <th className="py-2.5 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 font-mono text-xs">
                    No recorded transactions found. Click "Import CSV" or "Add Transaction" to record trades.
                  </td>
                </tr>
              ) : (
                filtered.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/20 transition-colors group">
                    <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{tx.date}</td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${getTypeBadge(tx.type)}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-200">{tx.symbol}</td>
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      {tx.shares === undefined || tx.shares === null
                        ? "—"
                        : hideValues
                        ? "••••"
                        : typeof tx.shares === "number"
                        ? tx.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })
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
                          title="Edit Transaction"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteTransaction(tx.id)}
                          className="p-1 hover:text-[#DD3C73] text-slate-400 transition-colors cursor-pointer"
                          title="Delete Transaction"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
