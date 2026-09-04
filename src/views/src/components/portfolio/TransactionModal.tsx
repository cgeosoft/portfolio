import { rpc } from "../../rpc";
import { useState, useEffect, useRef } from "react";
import type { PortfolioTransaction } from "../../types/portfolio";
import {
  X,
  Loader2,
  Save,
  ArrowRightLeft,
  Sparkles,
  Wallet,
  Layers,
  Percent,
  AlertCircle,
  ChevronDown,
} from "lucide-react";

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (tx: Partial<PortfolioTransaction>) => Promise<void>;
  transaction?: PortfolioTransaction | null;
}

export function TransactionModal({
  isOpen,
  onClose,
  onSave,
  transaction,
}: TransactionModalProps) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]!);
  const [type, setType] = useState("BUY");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<string>("EQUITY");
  const [shares, setShares] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [fee, setFee] = useState<string>("");
  const [tax, setTax] = useState<string>("");
  const [currency, setCurrency] = useState("EUR");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ symbol: string; name: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transaction) {
      setDate(transaction.date || new Date().toISOString().split("T")[0]!);
      setType(transaction.type || "BUY");
      setSymbol(transaction.symbol || "");
      setName(transaction.name || "");
      setAssetClass(transaction.assetClass || "EQUITY");
      setShares(transaction.shares !== undefined ? String(transaction.shares) : "");
      setPrice(transaction.price !== undefined ? String(transaction.price) : "");
      setAmount(transaction.amount !== undefined ? String(transaction.amount) : "");
      setFee(transaction.fee !== undefined ? String(transaction.fee) : "");
      setTax(transaction.tax !== undefined ? String(transaction.tax) : "");
      setCurrency(transaction.currency || "EUR");
    } else {
      setDate(new Date().toISOString().split("T")[0]!);
      setType("BUY");
      setSymbol("");
      setName("");
      setAssetClass("EQUITY");
      setShares("");
      setPrice("");
      setAmount("");
      setFee("");
      setTax("");
      setCurrency("EUR");
    }
    setError(null);
    setSearchResults([]);
    setSearchQuery("");
  }, [transaction, isOpen]);

  // Keyboard escape handler & outside click for autocomplete dropdown
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSubmitting) {
        if (searchResults.length > 0) {
          e.stopPropagation();
          setSearchResults([]);
          return;
        }
        onClose();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchResults([]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, isSubmitting, onClose, searchResults.length]);

  // Search autocomplete debounce
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await rpc.request.searchSymbol({ query: searchQuery.trim() });
        setSearchResults(data.results || []);
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim()) {
      setError("Please specify a ticker symbol or currency");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave({
        ...(transaction ? { id: transaction.id } : {}),
        date,
        type,
        symbol: symbol.trim().toUpperCase(),
        name: name.trim() || symbol.trim().toUpperCase(),
        assetClass,
        shares: shares ? parseFloat(shares) : undefined,
        price: price ? parseFloat(price) : undefined,
        amount: amount ? parseFloat(amount) : undefined,
        fee: fee ? Math.abs(parseFloat(fee)) : undefined,
        tax: tax ? Math.abs(parseFloat(tax)) : undefined,
        currency: currency.trim().toUpperCase(),
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save transaction");
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculatedTotalFriction = (Number(fee) || 0) + (Number(tax) || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 font-mono overflow-y-auto">
      <div className="relative w-full max-w-xl flex flex-col rounded-xl sm:rounded-2xl border border-[#DD3C73]/30 bg-slate-900 shadow-2xl overflow-hidden max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-3.5 py-2.5 sm:px-5 sm:py-3.5 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <ArrowRightLeft className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 truncate">
              {transaction ? "Edit Transaction" : "Record Transaction"}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800/80 text-slate-400 uppercase font-bold shrink-0 ml-1">
              {type}
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="p-3.5 sm:p-5 flex flex-col gap-3.5 sm:gap-4 overflow-y-auto flex-1 min-h-0 custom-scrollbar">
            {/* Top Banner */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-100 uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-[#DD3C73] shrink-0" />
                <span>{transaction ? "Modify Transaction Details" : "Manual Trade & Asset Entry"}</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                {transaction
                  ? "Update execution price, quantity, asset class, or fee structure for this transaction in the portfolio ledger."
                  : "Log an asset purchase, sale, dividend distribution, interest payment, or cash transfer to update your portfolio."}
              </p>
            </div>

            {/* Live Telemetry Preview Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Wallet className="w-3 h-3 text-[#DD3C73]" />
                  <span>Total Amount</span>
                </div>
                <div className="font-bold text-slate-100 text-xs truncate">
                  {amount
                    ? `${currency} ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "—"}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Layers className="w-3 h-3 text-[#ab97f7]" />
                  <span>Asset Class</span>
                </div>
                <div className="font-bold text-slate-100 text-xs truncate">
                  {assetClass}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Percent className="w-3 h-3 text-[#A7E2C0]" />
                  <span>Fee & Tax</span>
                </div>
                <div className="font-bold text-slate-100 text-xs truncate">
                  {currency} {calculatedTotalFriction.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3.5 rounded-xl border border-[#DD3C73]/40 bg-[#DD3C73]/10 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-[#DD3C73] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-[#DD3C73] uppercase tracking-wider">
                    Transaction Error
                  </div>
                  <div className="text-xs text-[#DD3C73] font-mono break-words leading-relaxed mt-1">
                    {error}
                  </div>
                </div>
              </div>
            )}

            {/* Section 1: Date & Type Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                  Transaction Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                  Transaction Type
                </label>
                <div className="relative">
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-2.5 pr-8 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73] appearance-none cursor-pointer"
                  >
                    <option value="BUY" className="bg-slate-900 text-slate-100">BUY (Asset Purchase)</option>
                    <option value="SELL" className="bg-slate-900 text-slate-100">SELL (Asset Sale)</option>
                    <option value="DIVIDEND" className="bg-slate-900 text-slate-100">DIVIDEND (Cash Payout)</option>
                    <option value="INTEREST_PAYMENT" className="bg-slate-900 text-slate-100">INTEREST (Fixed Yield)</option>
                    <option value="CUSTOMER_INBOUND" className="bg-slate-900 text-slate-100">DEPOSIT (Cash Inflow)</option>
                    <option value="CUSTOMER_OUTBOUND" className="bg-slate-900 text-slate-100">WITHDRAWAL (Cash Outflow)</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Section 2: Symbol Autocomplete & Currency */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs flex flex-col gap-3 relative" ref={searchContainerRef}>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider flex items-center justify-between">
                  <span>Ticker Symbol & Lookup</span>
                  {isSearching && <span className="text-[#DD3C73] text-[10px] animate-pulse">Searching…</span>}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="e.g. MSFT, EUNL.DE, BTC-EUR, PRIVATE_ASSET"
                      value={symbol}
                      onChange={(e) => {
                        setSymbol(e.target.value);
                        if (assetClass !== "PRIVATE_FUND") {
                          setSearchQuery(e.target.value);
                        }
                      }}
                      required
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 uppercase focus:outline-none focus:border-[#DD3C73]"
                    />
                    {/* Autocomplete Dropdown */}
                    {searchResults.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl z-30 max-h-48 overflow-y-auto custom-scrollbar">
                        {searchResults.map((r) => (
                          <div
                            key={r.symbol}
                            onClick={() => {
                              setSymbol(r.symbol);
                              setName(r.name);
                              setSearchResults([]);
                            }}
                            className="p-2.5 hover:bg-slate-800/80 cursor-pointer border-b border-slate-800/60 last:border-0 flex items-center justify-between text-xs"
                          >
                            <span className="font-bold text-[#DD3C73]">{r.symbol}</span>
                            <span className="text-[11px] text-slate-400 truncate max-w-[240px]">{r.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="EUR"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 uppercase focus:outline-none focus:border-[#DD3C73] text-center font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                    Asset Full Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Microsoft Corporation"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                    Asset Class
                  </label>
                  <div className="relative">
                    <select
                      value={assetClass}
                      onChange={(e) => setAssetClass(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-2.5 pr-8 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73] appearance-none cursor-pointer"
                    >
                      <option value="EQUITY" className="bg-slate-900 text-slate-100">Stock / Equity</option>
                      <option value="FUND" className="bg-slate-900 text-slate-100">ETF / Fund</option>
                      <option value="CRYPTO" className="bg-slate-900 text-slate-100">Crypto Asset</option>
                      <option value="PRIVATE_FUND" className="bg-slate-900 text-slate-100">Private Investment / Fund</option>
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: Quantity, Unit Price & Total Amount */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                  Shares / Units
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="0"
                  value={shares}
                  onChange={(e) => {
                    setShares(e.target.value);
                    if (e.target.value && price) {
                      setAmount((parseFloat(e.target.value) * parseFloat(price)).toFixed(2));
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73] text-right"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                  Unit Price
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    if (e.target.value && shares) {
                      setAmount((parseFloat(shares) * parseFloat(e.target.value)).toFixed(2));
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73] text-right"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                  Total Amount
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-[#DD3C73] font-bold focus:outline-none focus:border-[#DD3C73] text-right"
                />
              </div>
            </div>

            {/* Section 4: Fees & Taxes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                  Fee Paid (Broker)
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73] text-right"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-wider">
                  Withholding Tax
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#DD3C73] text-right"
                />
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-3.5 py-2.5 sm:px-5 sm:py-3 shrink-0 gap-2">
            <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">
              <span>Transaction Ledger</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-3 sm:px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-bold text-slate-400 hover:text-slate-200 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c82f63] text-white text-xs font-bold transition-all shadow-lg shadow-[#DD3C73]/25 cursor-pointer uppercase tracking-wider disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>{transaction ? "Save" : "Save"}</span>
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
