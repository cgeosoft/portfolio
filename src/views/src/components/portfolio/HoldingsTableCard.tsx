import { useState } from "react";
import type { PortfolioHolding, PortfolioSummary } from "../../types/portfolio";
import { fmtCurrency, fmtPercent, getRsiZone, getAssetTypeBadgeClass } from "./utils";
import { Search, ArrowUpDown, Layers } from "lucide-react";

interface HoldingsTableCardProps {
  holdings: PortfolioHolding[];
  currency?: string;
  hideValues?: boolean;
  summary?: PortfolioSummary;
}

export function HoldingsTableCard({
  holdings,
  currency = "EUR",
  hideValues = false,
  summary,
}: HoldingsTableCardProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [sortField, setSortField] = useState<keyof PortfolioHolding>("currentValue");
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (field: keyof PortfolioHolding) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
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
        name: `Available Liquidity (${currency})`,
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

    return (
      <tr
        key={h.symbol}
        className={`transition-colors font-mono ${
          isCash
            ? "bg-slate-900/60 hover:bg-slate-900/90"
            : "hover:bg-slate-800/30"
        }`}
      >
        {/* Line 1: Symbol + Asset Type badge, Line 2: Full Name */}
        <td className="px-4 py-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 font-bold text-slate-100">
              <span>{h.symbol}</span>
              <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${badgeClass}`}>
                {h.isPrivate ? "Private" : h.assetType}
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
            {isCash ? "Par: 1.00" : `Avg: ${fmtCurrency(h.buyPrice, h.currency || currency, hideValues)}`}
          </div>
        </td>

        {/* Line 1: Current Price, Line 2: Total Value & Weight */}
        <td className="px-4 py-3 text-right">
          <div className="font-bold text-slate-100 flex items-center justify-end gap-1.5">
            <span>{isCash ? fmtCurrency(1, h.currency || currency, false) : fmtCurrency(h.currentPrice, h.currency || currency, hideValues)}</span>
            {!isCash && h.nativeCurrency && h.nativeCurrency !== currency && h.nativePrice !== undefined && (
              <span
                className="text-[10px] font-normal px-1 py-0.5 rounded border border-[#E3EACD]/40 bg-[#E3EACD]/10 text-[#E3EACD]"
                title={`Native Price: ${fmtCurrency(h.nativePrice, h.nativeCurrency, hideValues)} (FX Rate: ${h.fxRate ?? "—"})`}
              >
                {fmtCurrency(h.nativePrice, h.nativeCurrency, hideValues)}
              </span>
            )}
          </div>
          <div className={isCash ? "text-[11px] text-slate-400 font-semibold" : "text-[11px] text-[#DD3C73]"}>
            {fmtCurrency(h.currentValue, h.currency || currency, hideValues)} ({h.weightPercent.toFixed(1)}%)
          </div>
        </td>

        {/* Line 1: 24h %, Line 2: 24h € */}
        <td className="px-4 py-3 text-right">
          {isCash ? (
            <span className="text-slate-500">—</span>
          ) : (
            <div className={dayColor}>
              <div className="font-bold">{isDayUp ? "+" : ""}{fmtPercent(h.dayChangePercent)}</div>
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
              <div className="font-bold">{isTotalUp ? "+" : ""}{fmtPercent(h.totalGainLossPercent)}</div>
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
              UNALLOCATED
            </span>
          ) : h.fiftyTwoWeekHigh && h.fiftyTwoWeekLow ? (
            <div className="flex flex-col items-center gap-1 w-24 mx-auto">
              <div className="w-full h-1.5 rounded bg-slate-800 border border-slate-700 relative overflow-hidden">
                <div
                  className="h-full bg-[#A7E2C0] rounded transition-all"
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
    <div className="cx-card p-4 sm:p-5 w-full max-w-full min-w-0 overflow-hidden">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4 min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 min-w-0">
            <Layers className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">Active Positions & Technical Gauges</span>
          </div>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate" title={`${totalAssetsCount} tracked assets with real-time valuation, indicators & moving averages`}>
            {totalAssetsCount} tracked assets with real-time valuation, indicators & moving averages
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Search bar */}
          <div className="relative flex-1 sm:w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search symbol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#DD3C73]/50 font-mono"
            />
          </div>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-[#DD3C73]/50 cursor-pointer"
          >
            <option value="ALL" className="bg-slate-900 text-slate-100">All Asset Types</option>
            <option value="Stock" className="bg-slate-900 text-slate-100">Stocks</option>
            <option value="ETF" className="bg-slate-900 text-slate-100">ETFs</option>
            <option value="Crypto" className="bg-slate-900 text-slate-100">Crypto</option>
            <option value="Cash" className="bg-slate-900 text-slate-100">Cash Liquidity</option>
            <option value="Other" className="bg-slate-900 text-slate-100">Other / Funds</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto w-full max-w-full min-w-0 custom-scrollbar">
        <table className="w-full text-left text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider bg-slate-950/40">
              <th className="py-2.5 px-4 cursor-pointer hover:text-slate-200" onClick={() => handleSort("symbol")}>
                <div className="flex items-center gap-1">
                  Asset
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-2.5 px-4 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort("shares")}>
                Shares & Avg Cost
              </th>
              <th className="py-2.5 px-4 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort("currentValue")}>
                Price & Valuation
              </th>
              <th className="py-2.5 px-4 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort("dayChangePercent")}>
                24h Change
              </th>
              <th className="py-2.5 px-4 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort("totalGainLossPercent")}>
                Total Return
              </th>
              <th className="py-2.5 px-4 text-center">52w Range</th>
              <th className="py-2.5 px-4 text-right">RSI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {totalAssetsCount === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500 font-mono text-xs">
                  No active holdings match your filter criteria.
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
                        <span className="font-semibold text-slate-300">Unallocated Standby Liquidity / Cash Reserve</span>
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
    </div>
  );
}

