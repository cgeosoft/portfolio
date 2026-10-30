import { useState } from "react";
import { createPortal } from "react-dom";
import type { PortfolioDataWarning, PortfolioHolding, PortfolioSummary } from "portfolio-shared/portfolio";
import { fmtCurrency, fmtPercent, getRsiZone, getAssetTypeBadgeClass } from "./utils";
import { Search, ArrowUpDown, Layers, Pencil, Wand2, Loader2, TriangleAlert } from "lucide-react";
import { Select } from "../common/Select";
import { showToast } from "../common/Toaster";
import { api } from "../../api";
import { SymbolEditModal } from "./SymbolEditModal";
import { ManualPriceModal } from "./ManualPriceModal";
import { hasCompanyIntel, openHolding } from "./holding-links";
import { t } from "../../i18n";

type HoldingWithIsin = PortfolioHolding & { isin: string };

/** A holding that still shows its ISIN because no ticker was found. */
function showsIsin(h: PortfolioHolding): h is HoldingWithIsin {
  return Boolean(h.isin) && h.symbol.toUpperCase() === h.isin!.toUpperCase();
}

interface HoldingsTableCardProps {
  holdings: PortfolioHolding[];
  currency?: string;
  hideValues?: boolean;
  summary?: PortfolioSummary;
  /** Needed to look up tickers for ISIN-only holdings. */
  portfolioId?: string | null;
  /** Reload after a symbol or a manual price changed. */
  onSymbolsChanged?: () => void | Promise<void>;
  /** Hints that the transactions look incomplete, such as a sell beyond the holding. */
  warnings?: PortfolioDataWarning[];
}

const VALID_ASSET_FILTERS = ["ALL", "Stock", "ETF", "Crypto", "Cash", "Other"] as const;

/** Keys of the asset type badges under `dashboard.assetTypes`. */
const ASSET_TYPE_KEYS: Record<string, string> = {
  Stock: "stock",
  ETF: "etf",
  MutualFund: "mutualFund",
  Crypto: "crypto",
  Cash: "cash",
  Other: "otherType",
  Private: "private",
};

function assetTypeLabel(type: string): string {
  const key = ASSET_TYPE_KEYS[type];
  return key ? t(`dashboard.assetTypes.${key}`) : type;
}

export function HoldingsTableCard({
  holdings,
  currency = "EUR",
  hideValues = false,
  summary,
  portfolioId,
  onSymbolsChanged,
  warnings,
}: HoldingsTableCardProps) {
  const [search, setSearch] = useState("");
  const [symbolHolding, setSymbolHolding] = useState<HoldingWithIsin | null>(null);
  const [priceHolding, setPriceHolding] = useState<PortfolioHolding | null>(null);
  const [resolving, setResolving] = useState(false);

  const isinOnlyCount = holdings.filter((h) => !h.isPrivate && showsIsin(h)).length;

  const handleResolveSymbols = async () => {
    if (!portfolioId || resolving) return;
    setResolving(true);
    try {
      const res = await api.resolvePortfolioSymbols(portfolioId);
      if (!res.success) throw new Error(res.error || t("dashboard.holdings.lookupFailed"));
      if (res.updated > 0) {
        showToast(t("dashboard.holdings.foundTickers", { count: res.updated }));
        await onSymbolsChanged?.();
      } else {
        showToast(t("dashboard.holdings.noTickers"), "error");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("dashboard.holdings.lookupFailed"), "error");
    } finally {
      setResolving(false);
    }
  };
  const [typeFilter, setTypeFilter] = useState<string>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("portfolio_holdings_type_filter");
      if (saved && (VALID_ASSET_FILTERS as readonly string[]).includes(saved)) {
        return saved;
      }
    }
    return "ALL";
  });
  const [sortField, setSortField] = useState<keyof PortfolioHolding>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("portfolio_holdings_sort_field");
      if (saved) return saved as keyof PortfolioHolding;
    }
    return "currentValue";
  });
  const [sortAsc, setSortAsc] = useState<boolean>(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("portfolio_holdings_sort_asc") === "true";
    }
    return false;
  });

  const handleTypeFilterChange = (val: string) => {
    setTypeFilter(val);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("portfolio_holdings_type_filter", val);
    }
  };

  const handleSort = (field: keyof PortfolioHolding) => {
    let nextAsc = false;
    if (sortField === field) {
      nextAsc = !sortAsc;
      setSortAsc(nextAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("portfolio_holdings_sort_field", field);
      localStorage.setItem("portfolio_holdings_sort_asc", String(nextAsc));
    }
  };

  const isCashHolding = (h: PortfolioHolding) =>
    h.assetType === "Cash" ||
    h.symbol === "CASH" ||
    h.name?.toLowerCase().includes("liquidity") ||
    h.name?.toLowerCase().includes("cash");

  const investedHoldings = holdings.filter((h) => !isCashHolding(h));
  let cashHoldings = holdings.filter(isCashHolding);

  const cashBalance = summary?.cashBalance ?? 0;
  if (cashHoldings.length === 0 && cashBalance > 0) {
    cashHoldings = [
      {
        symbol: "CASH",
        name: t("dashboard.availableLiquidity", { currency }),
        assetType: "Cash",
        shares: cashBalance,
        buyPrice: 1,
        currentPrice: 1,
        previousClose: 1,
        totalCost: cashBalance,
        currentValue: cashBalance,
        dayChangeDollar: 0,
        dayChangePercent: 0,
        totalGainLossDollar: 0,
        totalGainLossPercent: 0,
        weightPercent: summary?.cashWeightPercent ?? 0,
        currency,
      },
    ];
  }

  const filteredInvested = investedHoldings
    .filter((h) => {
      const matchesSearch =
        h.symbol.toLowerCase().includes(search.toLowerCase()) ||
        h.name.toLowerCase().includes(search.toLowerCase());
      const matchesType = typeFilter === "ALL" || h.assetType === typeFilter;
      return matchesSearch && matchesType;
    })
    .sort((a, b) => {
      const vA = a[sortField] ?? 0;
      const vB = b[sortField] ?? 0;
      if (typeof vA === "string" && typeof vB === "string") {
        return sortAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
      }
      return sortAsc ? Number(vA) - Number(vB) : Number(vB) - Number(vA);
    });

  const filteredCash = cashHoldings.filter((h) => {
    const matchesSearch =
      h.symbol.toLowerCase().includes(search.toLowerCase()) ||
      h.name.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "ALL" || typeFilter === "Cash";
    return matchesSearch && matchesType;
  });

  const totalAssetsCount = filteredInvested.length + filteredCash.length;

  const renderRow = (h: PortfolioHolding, isCash: boolean) => {
    const isDayUp = h.dayChangeDollar >= 0;
    const dayColor = isDayUp ? "text-emerald-400" : "text-rose-400";
    const isTotalUp = h.totalGainLossDollar >= 0;
    const totalColor = isTotalUp ? "text-emerald-400" : "text-rose-400";

    let rangePercent = 50;
    if (h.fiftyTwoWeekHigh && h.fiftyTwoWeekLow && h.fiftyTwoWeekHigh > h.fiftyTwoWeekLow) {
      rangePercent = Math.min(
        100,
        Math.max(
          0,
          ((h.currentPrice - h.fiftyTwoWeekLow) / (h.fiftyTwoWeekHigh - h.fiftyTwoWeekLow)) * 100
        )
      );
    }

    const rsiInfo = getRsiZone(h.rsi);
    const badgeClass = getAssetTypeBadgeClass(h.isPrivate ? "Private" : h.assetType);
    const canOpenIntel = !isCash && hasCompanyIntel(h);
    const canEditSymbol = !isCash && Boolean(h.isin) && Boolean(onSymbolsChanged);
    const canSetPrice = !isCash && Boolean(h.isPrivate) && Boolean(portfolioId) && Boolean(onSymbolsChanged);

    return (
      <tr
        key={h.symbol}
        className={`transition-colors font-mono ${
          isCash
            ? "bg-slate-900/60 hover:bg-slate-900/90"
            : "hover:bg-slate-800/30"
        }${canOpenIntel ? " cursor-pointer" : ""}`}
        onClick={canOpenIntel ? () => openHolding(h.symbol) : undefined}
        onKeyDown={canOpenIntel ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openHolding(h.symbol); } } : undefined}
        tabIndex={canOpenIntel ? 0 : undefined}
        title={canOpenIntel ? t("dashboard.holdings.showDetails", { symbol: h.symbol }) : undefined}
      >
        {/* Line 1: Symbol + Asset Type badge, Line 2: Full Name */}
        <td className="px-4 py-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 font-bold text-slate-100">
              <span title={h.isin && h.isin !== h.symbol ? `ISIN ${h.isin}` : undefined}>{h.symbol}</span>
              {canEditSymbol && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSymbolHolding(h as HoldingWithIsin);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className={`p-0.5 rounded hover:bg-slate-800 cursor-pointer ${showsIsin(h) ? "text-cream" : "text-slate-600 hover:text-slate-300"}`}
                  title={showsIsin(h) ? t("dashboard.holdings.noTickerSet") : t("dashboard.holdings.changeTicker")}
                  aria-label={t("dashboard.holdings.setTickerFor", { isin: h.isin ?? "" })}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
              <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${badgeClass}`}>
                {assetTypeLabel(h.isPrivate ? "Private" : h.assetType)}
              </span>
            </div>
            <span className="text-[11px] text-slate-500 truncate max-w-[180px]" title={h.name}>
              {h.name}
            </span>
          </div>
        </td>

        {/* Line 1: Shares, Line 2: Avg Cost */}
        <td className="px-4 py-3 text-right">
          <div className="font-bold text-slate-200">
            {isCash ? "—" : hideValues ? "••••" : (typeof h.shares === "number" ? h.shares.toLocaleString("en-US", { maximumFractionDigits: 4 }) : h.shares)}
          </div>
          <div className="text-[11px] text-slate-500">
            {isCash ? t("dashboard.holdings.par") : t("dashboard.holdings.avgCost", { price: fmtCurrency(h.buyPrice, h.currency || currency, hideValues) })}
          </div>
        </td>

        {/* Line 1: Current Price, Line 2: Total Value & Weight */}
        <td className="px-4 py-3 text-right">
          <div className="font-bold text-slate-100 flex items-center justify-end gap-1.5">
            <span>{isCash ? fmtCurrency(1, h.currency || currency, false) : fmtCurrency(h.currentPrice, h.currency || currency, hideValues)}</span>
            {!isCash && h.nativeCurrency && h.nativeCurrency !== currency && h.nativePrice !== undefined && (
              <span
                className="text-[10px] font-normal px-1 py-0.5 rounded border border-cream/40 bg-cream/10 text-cream"
                title={t("dashboard.holdings.nativePrice", { price: fmtCurrency(h.nativePrice, h.nativeCurrency, hideValues), rate: h.fxRate ?? "—" })}
              >
                {fmtCurrency(h.nativePrice, h.nativeCurrency, hideValues)}
              </span>
            )}
            {!isCash && h.quoteMissing && (
              <span
                className="text-[10px] font-normal px-1 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300"
                title={t("dashboard.holdings.noQuoteHint")}
              >
                {t("dashboard.holdings.noQuote")}
              </span>
            )}
            {canSetPrice && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPriceHolding(h);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                className={`text-[10px] font-normal px-1 py-0.5 rounded border cursor-pointer flex items-center gap-1 ${
                  h.manualPrice
                    ? "border-mint/40 bg-mint/10 text-mint hover:bg-mint/20"
                    : "border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                }`}
                title={
                  h.manualPrice
                    ? t("dashboard.holdings.manualPriceHint", { date: h.manualPrice.setAt })
                    : t("dashboard.holdings.setPriceHint")
                }
                aria-label={t("dashboard.holdings.setPriceFor", { symbol: h.symbol })}
              >
                <Pencil className="w-2.5 h-2.5" />
                {h.manualPrice ? t("dashboard.holdings.navOn", { date: h.manualPrice.setAt }) : t("dashboard.holdings.setNav")}
              </button>
            )}
            {!isCash && h.fxMissing && (
              <span
                className="text-[10px] font-normal px-1 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300"
                title={h.nativeCurrency ? t("dashboard.holdings.noFxFor", { currency: h.nativeCurrency }) : t("dashboard.holdings.noFxUnknown")}
              >
                {t("dashboard.holdings.noFx")}
              </span>
            )}
          </div>
          <div className={isCash ? "text-[11px] text-slate-400 font-semibold" : "text-[11px] text-slate-50"}>
            {fmtCurrency(h.currentValue, h.currency || currency, hideValues)} ({h.weightPercent.toFixed(1)}%)
          </div>
        </td>

        {/* Line 1: 24h %, Line 2: 24h € */}
        <td className="px-4 py-3 text-right">
          {isCash ? (
            <span className="text-slate-500">—</span>
          ) : (
            <div className={dayColor}>
              <div className="font-bold">{fmtPercent(h.dayChangePercent)}</div>
              <div className="text-[11px] opacity-80">{isDayUp ? "+" : ""}{fmtCurrency(h.dayChangeDollar, h.currency || currency, hideValues)}</div>
            </div>
          )}
        </td>

        {/* Line 1: Return %, Line 2: Return € */}
        <td className="px-4 py-3 text-right">
          {isCash ? (
            <span className="text-slate-500">—</span>
          ) : (
            <div className={totalColor}>
              <div className="font-bold">{fmtPercent(h.totalGainLossPercent)}</div>
              <div className="text-[11px] opacity-80">{isTotalUp ? "+" : ""}{fmtCurrency(h.totalGainLossDollar, h.currency || currency, hideValues)}</div>
            </div>
          )}
        </td>

        {/* 52w Range */}
        <td className="px-4 py-3 text-center">
          {isCash ? (
            <span
              className="text-[10px] font-bold text-slate-300 border border-slate-700/80 px-2 py-0.5 rounded inline-block shadow-inner"
              style={{ background: "repeating-linear-gradient(-45deg, #334155, #334155 3px, #1e293b 3px, #1e293b 6px)" }}
            >
              {t("dashboard.holdings.unallocated")}
            </span>
          ) : h.fiftyTwoWeekHigh && h.fiftyTwoWeekLow ? (
            <div className="flex flex-col items-center gap-1 w-24 mx-auto">
              <div className="w-full h-1.5 rounded bg-slate-800 border border-slate-700 relative overflow-hidden">
                <div
                  className="h-full bg-mint rounded transition-all"
                  style={{ width: `${rangePercent}%` }}
                />
              </div>
              <div className="flex justify-between w-full text-[9px] text-slate-500">
                <span>{fmtCurrency(h.fiftyTwoWeekLow, h.currency || currency, hideValues)}</span>
                <span>{fmtCurrency(h.fiftyTwoWeekHigh, h.currency || currency, hideValues)}</span>
              </div>
            </div>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </td>

        {/* RSI */}
        <td className="px-4 py-3 text-right">
          {isCash ? (
            <span className="text-slate-500">—</span>
          ) : h.rsi !== undefined ? (
            <div className="flex flex-col items-end">
              <span className="font-bold text-slate-200">{h.rsi.toFixed(1)}</span>
              <span className={`text-[10px] font-bold ${rsiInfo.color}`}>
                {rsiInfo.label}
              </span>
            </div>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="cx-card w-full max-w-full min-w-0 overflow-hidden">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 sm:p-5 min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 min-w-0">
            <Layers className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">{t("dashboard.holdings.title")}</span>
          </div>
          <p className="pl-[22px] text-[11px] text-slate-500 font-mono mt-0.5 truncate" title={t("dashboard.holdings.subtitle", { count: totalAssetsCount })}>
            {t("dashboard.holdings.subtitle", { count: totalAssetsCount })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {isinOnlyCount > 0 && portfolioId && onSymbolsChanged && (
            <button
              type="button"
              onClick={handleResolveSymbols}
              disabled={resolving}
              className="h-8 px-2.5 rounded-lg border border-cream/40 bg-cream/10 text-cream text-[11px] font-mono flex items-center gap-1.5 cursor-pointer hover:bg-cream/20 disabled:opacity-50 shrink-0"
              title={t("dashboard.holdings.findTickersHint", { count: isinOnlyCount })}
            >
              {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {t("dashboard.holdings.findTickers", { count: isinOnlyCount })}
            </button>
          )}

          {/* Search bar */}
          <div className="relative flex-1 sm:w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder={t("dashboard.holdings.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#DD3C73]/50 font-mono"
            />
          </div>

          {/* Type filter */}
          <Select
            value={typeFilter}
            onChange={(e) => handleTypeFilterChange(e.target.value)}
            selectSize="sm"
            className="h-8"
            wrapperClassName="shrink-0"
            aria-label={t("dashboard.holdings.filterLabel")}
          >
            <option value="ALL">{t("dashboard.holdings.filters.all")}</option>
            <option value="Stock">{t("dashboard.holdings.filters.stock")}</option>
            <option value="ETF">{t("dashboard.holdings.filters.etf")}</option>
            <option value="Crypto">{t("dashboard.holdings.filters.crypto")}</option>
            <option value="Cash">{t("dashboard.holdings.filters.cash")}</option>
            <option value="Other">{t("dashboard.holdings.filters.otherFunds")}</option>
          </Select>
        </div>
      </div>

      {warnings && warnings.length > 0 && (
        <div className="space-y-1.5 px-4 sm:px-5 pb-4">
          {warnings.map((w) => (
            <div key={`${w.kind}:${w.symbol}:${w.date}`} className="flex items-start gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[11px] text-status-warning">
              <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{t("dashboard.holdings.oversell", { symbol: w.symbol, date: w.date })}</span>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto w-full max-w-full min-w-0 custom-scrollbar">
        <table className="w-full text-left text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider bg-slate-950/40">
              <th className="py-2.5 px-4 cursor-pointer hover:text-slate-200" onClick={() => handleSort("symbol")}>
                <div className="flex items-center gap-1">
                  {t("dashboard.holdings.columns.asset")}
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-2.5 px-4 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort("shares")}>
                {t("dashboard.holdings.columns.shares")}
              </th>
              <th className="py-2.5 px-4 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort("currentValue")}>
                {t("dashboard.holdings.columns.price")}
              </th>
              <th className="py-2.5 px-4 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort("dayChangePercent")}>
                {t("dashboard.holdings.columns.dayChange")}
              </th>
              <th className="py-2.5 px-4 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort("totalGainLossPercent")}>
                {t("dashboard.holdings.columns.totalReturn")}
              </th>
              <th className="py-2.5 px-4 text-center">{t("dashboard.holdings.columns.range")}</th>
              <th className="py-2.5 px-4 text-right">{t("dashboard.holdings.columns.rsi")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {totalAssetsCount === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500 font-mono text-xs">
                  {t("dashboard.holdings.empty")}
                </td>
              </tr>
            ) : (
              <>
                {/* 1. Invested Asset Positions */}
                {filteredInvested.map((h) => renderRow(h, false))}

                {/* 2. Divider before Cash (if both exist) */}
                {filteredInvested.length > 0 && filteredCash.length > 0 && (
                  <tr className="bg-slate-950/80 border-t-2 border-b border-dashed border-slate-700/60">
                    <td colSpan={7} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-sm border border-slate-500/60 inline-block shrink-0"
                          style={{ background: "repeating-linear-gradient(-45deg, #64748b, #64748b 2px, #334155 2px, #334155 4px)" }}
                        />
                        <span className="font-semibold text-slate-300">{t("dashboard.holdings.cashDivider")}</span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* 3. Cash Reserves & Liquidity Holdings */}
                {filteredCash.map((h) => renderRow(h, true))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {symbolHolding && onSymbolsChanged && createPortal(
        <SymbolEditModal holding={symbolHolding} onClose={() => setSymbolHolding(null)} onSaved={onSymbolsChanged} />,
        document.body,
      )}

      {priceHolding && portfolioId && onSymbolsChanged && createPortal(
        <ManualPriceModal
          portfolioId={portfolioId}
          holding={priceHolding}
          currency={currency}
          hideValues={hideValues}
          onClose={() => setPriceHolding(null)}
          onSaved={onSymbolsChanged}
        />,
        document.body,
      )}
    </div>
  );
}

