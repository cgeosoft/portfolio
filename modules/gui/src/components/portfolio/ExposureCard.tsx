import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Layers, RefreshCw } from "lucide-react";
import type { ExposureBreakdown, ExposureUnderlyingStock, PortfolioExposureResponse } from "portfolio-shared/api-types";
import { DATA_PROVIDER_LABELS } from "portfolio-shared/config-types";
import { api } from "../../api";
import { fmtCurrency } from "./utils";
import { HoldingLink, HoldingText } from "./holding-links";
import { t } from "../../i18n";

interface ExposureCardProps {
  portfolioId: string | null | undefined;
  currency?: string;
  hideValues?: boolean;
  /** Changes when the portfolio data reloads (for example `summary.lastUpdated`), so the exposure follows. */
  dataVersion?: string;
}

/** Bars shown per breakdown before the rest is folded into "Other". */
const MAX_BARS = 8;

function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

function viaLabel(via: string): string {
  return via === "direct" ? t("dashboard.exposure.direct") : via;
}

function BreakdownBars({ title, breakdown, barClass }: { title: string; breakdown: ExposureBreakdown; barClass: string }) {
  const shown = breakdown.items.slice(0, MAX_BARS);
  const rest = breakdown.items.slice(MAX_BARS).reduce((s, i) => s + i.percent, 0);
  const max = Math.max(1, ...shown.map((i) => i.percent), rest);
  const rows = rest > 0 ? [...shown, { name: t("dashboard.exposure.otherShare"), percent: rest, value: 0 }] : shown;

  return (
    <div className="bg-card border border-line rounded-lg p-3 min-w-0">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-slate-500 py-4 text-center">{t("dashboard.exposure.noBreakdownData")}</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.name} className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-slate-300" title={row.name}>
                  {row.name}
                </span>
                <span className="font-mono text-slate-200 shrink-0">{pct(row.percent)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-widget overflow-hidden mt-0.5">
                <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.min(100, (row.percent / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {(breakdown.unknownPercent > 0.05 || breakdown.notApplicablePercent > 0.05) && (
        <div className="mt-2 pt-2 border-t border-line text-[10px] text-slate-500 font-mono flex flex-wrap gap-x-3">
          {breakdown.unknownPercent > 0.05 && <span title={t("dashboard.exposure.unknownHint")}>{t("dashboard.exposure.unknown", { percent: pct(breakdown.unknownPercent) })}</span>}
          {breakdown.notApplicablePercent > 0.05 && <span title={t("dashboard.exposure.notApplicableHint")}>{t("dashboard.exposure.notApplicable", { percent: pct(breakdown.notApplicablePercent) })}</span>}
        </div>
      )}
    </div>
  );
}

function StockRow({ stock, currency, hideValues }: { stock: ExposureUnderlyingStock; currency: string; hideValues: boolean }) {
  const parts = stock.breakdown.map((b) => `${viaLabel(b.via)} ${pct(b.percent, 2)}`).join(" · ");
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-2 min-w-0">
        <div className="font-mono text-slate-200 truncate"><HoldingLink reference={stock.symbol} /></div>
        {stock.name && <div className="text-[10px] text-slate-500 truncate max-w-[220px]" title={stock.name}>{stock.name}</div>}
      </td>
      <td className="py-1.5 pr-2 text-right font-mono text-slate-200 whitespace-nowrap">{pct(stock.percent, 2)}</td>
      <td className="py-1.5 pr-2 text-right font-mono text-slate-400 whitespace-nowrap hidden sm:table-cell">{fmtCurrency(stock.value, currency, hideValues)}</td>
      <td className="py-1.5 text-[10px] text-slate-500 min-w-0">
        <span className="line-clamp-2" title={parts}>{parts}</span>
      </td>
    </tr>
  );
}

/** Sector, country, asset-class and underlying-stock exposure after ETF and fund look-through. */
export function ExposureCard({ portfolioId, currency = "EUR", hideValues = false, dataVersion }: ExposureCardProps) {
  const [data, setData] = useState<PortfolioExposureResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean, isCancelled: () => boolean = () => false) => {
      if (!portfolioId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await api.getPortfolioExposure(portfolioId, refresh);
        if (!isCancelled()) setData(result);
      } catch (err) {
        if (!isCancelled()) setError(err instanceof Error ? err.message : t("dashboard.exposure.loadFailed"));
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [portfolioId],
  );

  useEffect(() => {
    setData(null);
  }, [portfolioId]);

  useEffect(() => {
    let cancelled = false;
    void load(false, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load, dataVersion]);

  const sourceNote = data && data.sources.length > 0 ? data.sources.map((s) => DATA_PROVIDER_LABELS[s] ?? s).join(", ") : null;
  const cur = data?.baseCurrency || currency;
  const isEmpty = data !== null && data.totalValue <= 0;

  return (
    <div className="cx-card p-4 sm:p-5 font-mono w-full max-w-full min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4 min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 min-w-0">
            <Layers className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">{t("dashboard.exposure.title")}</span>
          </div>
          <p className="pl-[22px] text-[11px] text-slate-500 mt-0.5 truncate">{t("dashboard.exposure.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading || !portfolioId}
          className="p-1.5 rounded-md border border-line text-slate-400 hover:text-slate-200 disabled:opacity-50 shrink-0"
          title={t("dashboard.exposure.rebuild")}
          aria-label={t("dashboard.exposure.rebuild")}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!portfolioId ? (
        <div className="text-xs text-slate-500 text-center py-10">{t("dashboard.exposure.noPortfolio")}</div>
      ) : error && !data ? (
        <div className="text-xs text-accent-bright text-center py-10">{error}</div>
      ) : !data ? (
        <div className="text-xs text-slate-500 text-center py-10">{loading ? t("dashboard.exposure.loading") : t("dashboard.exposure.noData")}</div>
      ) : isEmpty ? (
        <div className="text-xs text-slate-500 text-center py-10">{t("dashboard.exposure.noHoldings")}</div>
      ) : (
        <div className="space-y-4">
          {/* Coverage */}
          <div>
            <div className="flex h-2 rounded-full overflow-hidden bg-widget">
              <div className="bg-royal-bright" style={{ width: `${data.coverage.directPercent}%` }} title={t("dashboard.exposure.heldDirectly", { percent: pct(data.coverage.directPercent) })} />
              <div className="bg-mint" style={{ width: `${data.coverage.lookedThroughPercent}%` }} title={t("dashboard.exposure.lookedThroughInFunds", { percent: pct(data.coverage.lookedThroughPercent) })} />
              <div className="bg-slate-600" style={{ width: `${data.coverage.unknownPercent}%` }} title={t("dashboard.exposure.unknownShare", { percent: pct(data.coverage.unknownPercent) })} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-royal-bright" />{t("dashboard.exposure.directShare", { percent: pct(data.coverage.directPercent) })}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-mint" />{t("dashboard.exposure.lookedThrough", { percent: pct(data.coverage.lookedThroughPercent) })}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-slate-600" />{t("dashboard.exposure.unknown", { percent: pct(data.coverage.unknownPercent) })}</span>
              <span>{t("dashboard.exposure.singleNamesKnown", { percent: pct(data.coverage.holdingsKnownPercent) })}</span>
            </div>
          </div>

          {/* Warnings */}
          {data.warnings.length > 0 && (
            <ul className="space-y-1">
              {data.warnings.map((w) => (
                <li key={`${w.kind}:${w.name}`} className="flex items-start gap-2 text-[11px] rounded-md border border-accent-500/50 bg-accent-500/10 px-2.5 py-1.5 text-accent-bright">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span><HoldingText text={w.message} /></span>
                </li>
              ))}
            </ul>
          )}

          {/* Breakdowns */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <BreakdownBars title={t("dashboard.exposure.sectors")} breakdown={data.sectors} barClass="bg-accent-500" />
            <BreakdownBars title={t("dashboard.exposure.countries")} breakdown={data.countries} barClass="bg-royal-bright" />
            <BreakdownBars title={t("dashboard.exposure.assetClasses")} breakdown={data.assetClasses} barClass="bg-mint" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Top underlying stocks */}
            <div className="lg:col-span-2 bg-card border border-line rounded-lg p-3 min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">{t("dashboard.exposure.topStocks")}</div>
              {data.topStocks.length === 0 ? (
                <div className="text-xs text-slate-500 py-4 text-center">{t("dashboard.exposure.noStocks")}</div>
              ) : (
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                        <th className="pb-1 pr-2 font-semibold">{t("dashboard.exposure.columns.stock")}</th>
                        <th className="pb-1 pr-2 font-semibold text-right">{t("dashboard.exposure.columns.weight")}</th>
                        <th className="pb-1 pr-2 font-semibold text-right hidden sm:table-cell">{t("dashboard.exposure.columns.value")}</th>
                        <th className="pb-1 font-semibold">{t("dashboard.exposure.columns.heldThrough")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topStocks.slice(0, 15).map((s) => (
                        <StockRow key={s.symbol} stock={s} currency={cur} hideValues={hideValues} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Funds and overlap */}
            <div className="bg-card border border-line rounded-lg p-3 min-w-0 space-y-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">{t("dashboard.exposure.overlap")}</div>
                {data.overlaps.length === 0 ? (
                  <div className="text-xs text-slate-500">{data.funds.length < 2 ? t("dashboard.exposure.needsTwoFunds") : t("dashboard.exposure.noOverlap")}</div>
                ) : (
                  <ul className="space-y-1.5">
                    {data.overlaps.slice(0, 6).map((o) => (
                      <li key={`${o.a}:${o.b}`} className="text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-slate-300 truncate"><HoldingLink reference={o.a} /> / <HoldingLink reference={o.b} /></span>
                          <span className="font-mono text-slate-200 shrink-0" title={o.partial ? t("dashboard.exposure.partialOverlap") : undefined}>
                            {pct(o.overlapPercent)}{o.partial ? "+" : ""}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500">{t("dashboard.exposure.sharedHoldings", { count: o.commonHoldings })}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {data.funds.length > 0 && (
                <div className="pt-3 border-t border-line">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">{t("dashboard.exposure.funds")}</div>
                  <ul className="space-y-1.5">
                    {data.funds.map((f) => (
                      <li key={f.symbol} className="text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-slate-300 truncate" title={f.name}><HoldingLink reference={f.symbol} /></span>
                          <span className="font-mono text-slate-200 shrink-0">{pct(f.percent)}</span>
                        </div>
                        {f.name && f.name !== f.symbol && <div className="text-[10px] text-slate-500 truncate" title={f.name}>{f.name}</div>}
                        <div className="text-[10px] text-slate-500 flex flex-wrap gap-x-2">
                          {f.expenseRatio !== undefined && <span>{t("dashboard.exposure.ter", { percent: pct(f.expenseRatio, 2) })}</span>}
                          {f.holdingsCount !== undefined && <span>{t("dashboard.exposure.fundHoldings", { count: f.holdingsCount })}</span>}
                          {!f.sources.holdings && !f.sources.sectors && !f.sources.countries ? (
                            <span>{t("dashboard.exposure.noLookThrough")}</span>
                          ) : (
                            !f.holdingsComplete && f.sources.holdings && <span>{t("dashboard.exposure.topHoldingsOnly")}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {data.weightedExpenseRatio && (
                    <div className="mt-2 text-[10px] text-slate-400">
                      {t("dashboard.exposure.weightedTer", { percent: pct(data.weightedExpenseRatio.percent, 2) })}
                      {data.weightedExpenseRatio.coveragePercent < 99.5 && ` ${t("dashboard.exposure.terCoverage", { percent: pct(data.weightedExpenseRatio.coveragePercent, 0) })}`}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="text-[10px] text-slate-500 flex flex-wrap justify-between gap-2">
            <span>{t("dashboard.exposure.sources", { sources: sourceNote ?? t("dashboard.exposure.noSources") })}</span>
            {error && <span className="text-accent-bright">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
