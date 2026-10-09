/**
 * Portfolio exposure: what a portfolio holds once its ETFs and funds are
 * looked through.
 *
 * It combines the direct holdings and the fund data of `EtfIntelService`
 * (intel/etf.ts), weighted by market value in the portfolio base currency,
 * into sector, country and asset-class exposure, the largest underlying
 * stocks (direct and through funds), pairwise fund overlap, concentration
 * warnings and the share of the portfolio the result is based on.
 *
 * Every percent is a share of the whole portfolio value, cash included.
 * Symbols are deduplicated before any lookup; FMP and Yahoo responses come
 * from their caches (7 days for fund data, 24 h for profiles), and the
 * result is kept in memory for `EXPOSURE_CACHE_MS`.
 *
 * For the AI features: `getPortfolioExposure()` returns the full result and
 * `getPortfolioExposureSummary()` a compact, percent-only summary.
 */
import type {
  ExposureBreakdown,
  ExposureCoverage,
  ExposureFund,
  ExposureLimits,
  ExposureOverlap,
  ExposureUnderlyingStock,
  ExposureWarning,
  PortfolioExposureResponse,
} from "portfolio-shared/api-types";
import type { DataProviderId } from "portfolio-shared/config-types";
import type { FinancialPortfolioData, PortfolioHolding } from "portfolio-shared/portfolio";
import { appLogger } from "../logger.js";
import type { PortfolioService } from "./portfolio.js";
import { mapWithConcurrencyLimit } from "./yahoo-finance.js";
import { EtfIntelService, type FundLookThrough, type SecurityProfile } from "./intel/etf.js";

/** Warning thresholds in percent of the portfolio value. */
export const EXPOSURE_LIMITS: ExposureLimits = {
  /** One underlying stock, direct and through funds together. */
  stockPercent: 10,
  /** One sector. */
  sectorPercent: 35,
  /** One country. */
  countryPercent: 80,
  /** Overlap between two funds (percent of the smaller weights, see `ExposureOverlap`). */
  overlapPercent: 50,
};

/** How long a built exposure is reused before it is built again from the caches. */
export const EXPOSURE_CACHE_MS = 15 * 60 * 1000;
/** Underlying stocks in the result. */
const TOP_STOCKS = 25;
/** Fund pairs in the result. */
const TOP_OVERLAPS = 15;
/** Parallel lookups; FMP has its own throttle on top. */
const LOOKUP_CONCURRENCY = 4;
/** Fund holdings below this weight (percent of the fund) are left out of the stock list. */
const MIN_FUND_HOLDING_WEIGHT = 0.01;

const PROVIDER_ORDER: DataProviderId[] = ["fmp", "yahoo", "finnhub"];

type HoldingKind = "stock" | "fund" | "cash" | "crypto" | "other";

interface Position {
  symbol: string;
  name: string;
  kind: HoldingKind;
  value: number;
  profile?: SecurityProfile;
  fund?: FundLookThrough;
}

/** Accumulates value per bucket, plus unknown and not-applicable value. */
class Buckets {
  private readonly values = new Map<string, number>();
  unknown = 0;
  notApplicable = 0;

  add(name: string, value: number): void {
    if (!(value > 0)) return;
    this.values.set(name, (this.values.get(name) ?? 0) + value);
  }

  toBreakdown(total: number): ExposureBreakdown {
    const pct = (v: number) => (total > 0 ? round((v / total) * 100) : 0);
    return {
      items: Array.from(this.values, ([name, value]) => ({ name, value: round(value), percent: pct(value) }))
        .filter((s) => s.percent > 0)
        .sort((a, b) => b.value - a.value),
      unknownPercent: pct(this.unknown),
      notApplicablePercent: pct(this.notApplicable),
    };
  }
}

/**
 * Joins the same stock seen under different symbols: a direct "SAP.DE" and a
 * fund holding "SAP" share an ISIN. Keys are the first symbol seen.
 */
class StockIndex {
  private readonly bySymbol = new Map<string, string>();
  private readonly byIsin = new Map<string, string>();

  key(symbol: string, isin?: string): string {
    const sym = symbol.toUpperCase();
    const found = (isin && this.byIsin.get(isin)) || this.bySymbol.get(sym);
    const key = found ?? sym;
    if (!this.bySymbol.has(sym)) this.bySymbol.set(sym, key);
    if (isin && !this.byIsin.has(isin)) this.byIsin.set(isin, key);
    return key;
  }
}

interface StockAccumulator {
  symbol: string;
  name?: string;
  isin?: string;
  direct: number;
  parts: Map<string, number>;
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function kindOf(h: PortfolioHolding): HoldingKind {
  if (h.assetType === "Cash" || h.symbol === "CASH") return "cash";
  if (h.assetType === "Crypto") return "crypto";
  if (h.assetType === "Other" || h.isPrivate) return "other";
  if (h.assetType === "ETF" || h.assetType === "MutualFund") return "fund";
  return "stock";
}

function hasFundData(f: FundLookThrough | undefined): boolean {
  return !!f && (f.holdings.length > 0 || f.sectors.length > 0 || f.countries.length > 0 || f.assetClasses.length > 0);
}

/** Share of a fund (0 to 100) that is not equity, when its asset classes are known. */
function nonEquityWeight(f: FundLookThrough): number | undefined {
  if (f.assetClasses.length === 0) return undefined;
  const equity = f.assetClasses.filter((r) => r.name === "Equity").reduce((s, r) => s + r.weight, 0);
  return Math.max(0, 100 - equity);
}

/** Spreads a fund over sector or country buckets; the rest goes to n/a (non-equity part) or unknown. */
function spreadFund(buckets: Buckets, value: number, rows: { name: string; weight: number }[], f: FundLookThrough): void {
  let assigned = 0;
  let cashLike = 0;
  for (const row of rows) {
    if (row.name === "Cash & Other") {
      cashLike += row.weight;
      continue;
    }
    buckets.add(row.name, (value * row.weight) / 100);
    assigned += row.weight;
  }
  const rest = Math.max(0, 100 - assigned - cashLike);
  const nonEquity = nonEquityWeight(f);
  const notApplicable = Math.min(rest, Math.max(0, (nonEquity ?? 0) - cashLike));
  buckets.notApplicable += (value * (cashLike + notApplicable)) / 100;
  buckets.unknown += (value * (rest - notApplicable)) / 100;
}

export class ExposureService {
  private readonly memo = new Map<string, { at: number; version: string; data: PortfolioExposureResponse }>();
  private readonly inFlight = new Map<string, Promise<PortfolioExposureResponse>>();

  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly etf: EtfIntelService,
  ) {
    defaultInstance = this;
  }

  /** Drops the built exposure of one portfolio, or of all. */
  public clear(portfolioId?: string): void {
    if (!portfolioId) return this.memo.clear();
    for (const key of this.memo.keys()) if (key.startsWith(`${portfolioId}:`)) this.memo.delete(key);
  }

  /**
   * The exposure of a portfolio. `refresh` builds it again (the provider
   * caches still apply, so it does not hit FMP or Yahoo again for fresh data).
   */
  public async getExposure(portfolioId: string, options: { baseCurrency?: string; refresh?: boolean } = {}): Promise<PortfolioExposureResponse> {
    // The portfolio data is cached by PortfolioService; its timestamp tells
    // whether a built exposure still matches the holdings.
    const data = await this.portfolioService.getPortfolioData(portfolioId, options.baseCurrency);
    const key = `${portfolioId}:${options.baseCurrency ?? ""}`;
    const version = data.summary?.lastUpdated ?? "";
    const memo = this.memo.get(key);
    if (!options.refresh && memo && memo.version === version && Date.now() - memo.at < EXPOSURE_CACHE_MS) return memo.data;
    const flightKey = `${key}:${version}`;
    const running = this.inFlight.get(flightKey);
    if (running) return running;

    const promise = this.build(portfolioId, data, options.baseCurrency)
      .then((result) => {
        this.memo.set(key, { at: Date.now(), version, data: result });
        return result;
      })
      .finally(() => this.inFlight.delete(flightKey));
    this.inFlight.set(flightKey, promise);
    return promise;
  }

  private async build(portfolioId: string, data: FinancialPortfolioData, baseCurrency?: string): Promise<PortfolioExposureResponse> {
    const started = performance.now();
    const currency = data.summary?.baseCurrency || baseCurrency || data.portfolio?.baseCurrency || "EUR";

    // 1. Positions, one per symbol.
    const bySymbol = new Map<string, Position>();
    for (const h of data.holdings ?? []) {
      if (!(h.currentValue > 0)) continue;
      const symbol = h.symbol.trim().toUpperCase();
      const existing = bySymbol.get(symbol);
      if (existing) existing.value += h.currentValue;
      else bySymbol.set(symbol, { symbol, name: h.name, kind: kindOf(h), value: h.currentValue });
    }
    if (!Array.from(bySymbol.values()).some((p) => p.kind === "cash") && (data.summary?.cashBalance ?? 0) > 0) {
      bySymbol.set("CASH", { symbol: "CASH", name: "Cash", kind: "cash", value: data.summary.cashBalance });
    }
    const positions = Array.from(bySymbol.values());
    const total = positions.reduce((s, p) => s + p.value, 0);

    // 2. Lookups: a profile for each stock (it can turn out to be a fund),
    //    look-through for each fund. A "fund" without fund data gets a profile
    //    too, since the asset type can be a guess (portfolio.ts).
    await mapWithConcurrencyLimit(positions.filter((p) => p.kind === "stock"), LOOKUP_CONCURRENCY, async (p) => {
      p.profile = await this.safeProfile(p.symbol);
      if (p.profile?.kind === "fund") p.kind = "fund";
    });
    await mapWithConcurrencyLimit(positions.filter((p) => p.kind === "fund"), LOOKUP_CONCURRENCY, async (p) => {
      p.fund = await this.safeFund(p.symbol);
      if (!hasFundData(p.fund) && !p.profile) {
        p.profile = await this.safeProfile(p.symbol);
        if (p.profile?.kind === "stock") p.kind = "stock";
      }
    });

    // 3. Aggregate.
    const sectors = new Buckets();
    const countries = new Buckets();
    const assetClasses = new Buckets();
    const index = new StockIndex();
    const stocks = new Map<string, StockAccumulator>();
    const sources = new Set<DataProviderId>();
    const coverage = { direct: 0, lookedThrough: 0, unknown: 0, holdingsKnown: 0 };

    const addStock = (symbol: string, isin: string | undefined, name: string | undefined, via: string, value: number) => {
      const key = index.key(symbol, isin);
      let acc = stocks.get(key);
      if (!acc) {
        acc = { symbol: key, name, isin, direct: 0, parts: new Map() };
        stocks.set(key, acc);
      }
      acc.name ??= name;
      acc.isin ??= isin;
      if (via === "direct") acc.direct += value;
      else acc.parts.set(via, (acc.parts.get(via) ?? 0) + value);
    };

    // Direct stocks first, so their symbols name the merged entries.
    const ordered = [...positions].sort((a, b) => (a.kind === "stock" ? 0 : 1) - (b.kind === "stock" ? 0 : 1));
    for (const p of ordered) {
      switch (p.kind) {
        case "cash":
        case "crypto":
        case "other": {
          sectors.notApplicable += p.value;
          countries.notApplicable += p.value;
          assetClasses.add(p.kind === "cash" ? "Cash" : p.kind === "crypto" ? "Crypto" : "Other", p.value);
          coverage.direct += p.value;
          break;
        }
        case "stock": {
          const prof = p.profile;
          if (prof?.source) sources.add(prof.source);
          if (prof?.sector) sectors.add(prof.sector, p.value);
          else sectors.unknown += p.value;
          if (prof?.country) countries.add(prof.country, p.value);
          else countries.unknown += p.value;
          assetClasses.add("Equity", p.value);
          if (prof?.source) coverage.direct += p.value;
          else coverage.unknown += p.value;
          coverage.holdingsKnown += p.value;
          addStock(p.symbol, prof?.isin, prof?.name ?? p.name, "direct", p.value);
          break;
        }
        case "fund": {
          const f = p.fund;
          if (!f || !hasFundData(f)) {
            sectors.unknown += p.value;
            countries.unknown += p.value;
            assetClasses.unknown += p.value;
            coverage.unknown += p.value;
            break;
          }
          coverage.lookedThrough += p.value;
          for (const s of Object.values(f.sources)) if (s) sources.add(s);

          if (f.sectors.length > 0) spreadFund(sectors, p.value, f.sectors, f);
          else {
            const nonEquity = nonEquityWeight(f) ?? 0;
            sectors.notApplicable += (p.value * nonEquity) / 100;
            sectors.unknown += (p.value * (100 - nonEquity)) / 100;
          }
          if (f.countries.length > 0) spreadFund(countries, p.value, f.countries, f);
          else countries.unknown += p.value;

          if (f.assetClasses.length > 0) {
            let assigned = 0;
            for (const r of f.assetClasses) {
              assetClasses.add(r.name, (p.value * r.weight) / 100);
              assigned += r.weight;
            }
            assetClasses.unknown += (p.value * Math.max(0, 100 - assigned)) / 100;
          } else assetClasses.unknown += p.value;

          let known = 0;
          for (const h of f.holdings) {
            known += h.weight;
            if (h.weight < MIN_FUND_HOLDING_WEIGHT) continue;
            addStock(h.symbol, h.isin, h.name, p.symbol, (p.value * h.weight) / 100);
          }
          coverage.holdingsKnown += (p.value * Math.min(100, known)) / 100;
          break;
        }
      }
    }

    const pct = (v: number) => (total > 0 ? round((v / total) * 100) : 0);

    // 4. Underlying stocks.
    const topStocks: ExposureUnderlyingStock[] = Array.from(stocks.values())
      .map((acc) => {
        const viaFunds = Array.from(acc.parts.values()).reduce((s, v) => s + v, 0);
        const value = acc.direct + viaFunds;
        const breakdown = [
          ...(acc.direct > 0 ? [{ via: "direct", value: round(acc.direct), percent: pct(acc.direct) }] : []),
          ...Array.from(acc.parts, ([via, v]) => ({ via, value: round(v), percent: pct(v) })),
        ].sort((a, b) => b.value - a.value);
        return {
          symbol: acc.symbol,
          name: acc.name,
          isin: acc.isin,
          value: round(value),
          percent: pct(value),
          directPercent: pct(acc.direct),
          viaFundsPercent: pct(viaFunds),
          breakdown,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, TOP_STOCKS);

    // 5. Funds and their overlap.
    const fundPositions = positions.filter((p) => p.kind === "fund").sort((a, b) => b.value - a.value);
    const funds: ExposureFund[] = fundPositions.map((p) => ({
      symbol: p.symbol,
      name: p.fund?.name ?? p.name,
      percent: pct(p.value),
      value: round(p.value),
      expenseRatio: p.fund?.expenseRatio,
      aum: p.fund?.aum,
      aumCurrency: p.fund?.aumCurrency,
      holdingsCount: p.fund?.holdingsCount,
      holdingsComplete: p.fund?.holdingsComplete ?? false,
      holdingsKnownPercent: round(Math.min(100, (p.fund?.holdings ?? []).reduce((s, h) => s + h.weight, 0))),
      sources: p.fund?.sources ?? { holdings: null, sectors: null, countries: null, assetClasses: null, info: null },
    }));
    const overlaps = computeOverlaps(fundPositions, index);

    let weightedExpenseRatio: PortfolioExposureResponse["weightedExpenseRatio"];
    const fundValue = fundPositions.reduce((s, p) => s + p.value, 0);
    const withRatio = fundPositions.filter((p) => p.fund?.expenseRatio !== undefined);
    const ratioValue = withRatio.reduce((s, p) => s + p.value, 0);
    if (ratioValue > 0) {
      weightedExpenseRatio = {
        percent: round(withRatio.reduce((s, p) => s + p.value * (p.fund!.expenseRatio as number), 0) / ratioValue, 4),
        coveragePercent: round((ratioValue / fundValue) * 100),
      };
    }

    const sectorBreakdown = sectors.toBreakdown(total);
    const countryBreakdown = countries.toBreakdown(total);
    const warnings = buildWarnings(topStocks, sectorBreakdown, countryBreakdown, overlaps, EXPOSURE_LIMITS);

    const exposureCoverage: ExposureCoverage = {
      directPercent: pct(coverage.direct),
      lookedThroughPercent: pct(coverage.lookedThrough),
      unknownPercent: pct(coverage.unknown),
      holdingsKnownPercent: pct(coverage.holdingsKnown),
    };

    // Counts only (AGENTS.md rule 3).
    appLogger.logStep(
      "info",
      "exposure",
      "build",
      `Exposure built from ${positions.length} positions (${fundPositions.length} funds, ${warnings.length} warnings)`,
      Math.round(performance.now() - started),
    );

    return {
      portfolioId,
      baseCurrency: currency,
      totalValue: round(total),
      generatedAt: new Date().toISOString(),
      sectors: sectorBreakdown,
      countries: countryBreakdown,
      assetClasses: assetClasses.toBreakdown(total),
      topStocks,
      funds,
      overlaps,
      warnings,
      limits: { ...EXPOSURE_LIMITS },
      coverage: exposureCoverage,
      weightedExpenseRatio,
      sources: PROVIDER_ORDER.filter((id) => sources.has(id)),
    };
  }

  private async safeProfile(symbol: string): Promise<SecurityProfile | undefined> {
    try {
      return await this.etf.getSecurityProfile(symbol);
    } catch (err) {
      appLogger.logStep("warning", "exposure", "profile", `Profile lookup failed (${err instanceof Error ? err.name : typeof err})`);
      return undefined;
    }
  }

  private async safeFund(symbol: string): Promise<FundLookThrough | undefined> {
    try {
      return await this.etf.getFundLookThrough(symbol);
    } catch (err) {
      appLogger.logStep("warning", "exposure", "fund", `Fund look-through failed (${err instanceof Error ? err.name : typeof err})`);
      return undefined;
    }
  }
}

/** Sum over shared holdings of the smaller weight, for every pair of funds with holdings. */
function computeOverlaps(funds: Position[], index: StockIndex): ExposureOverlap[] {
  const weights = funds
    .filter((p) => p.fund && p.fund.holdings.length > 0)
    .map((p) => {
      const map = new Map<string, number>();
      for (const h of p.fund!.holdings) {
        const key = index.key(h.symbol, h.isin);
        map.set(key, (map.get(key) ?? 0) + h.weight);
      }
      return { symbol: p.symbol, complete: p.fund!.holdingsComplete, map };
    });

  const out: ExposureOverlap[] = [];
  for (let i = 0; i < weights.length; i++) {
    for (let j = i + 1; j < weights.length; j++) {
      const a = weights[i]!;
      const b = weights[j]!;
      const [small, large] = a.map.size <= b.map.size ? [a.map, b.map] : [b.map, a.map];
      let overlap = 0;
      let common = 0;
      for (const [key, w] of small) {
        const other = large.get(key);
        if (other === undefined) continue;
        overlap += Math.min(w, other);
        common++;
      }
      if (common === 0) continue;
      out.push({ a: a.symbol, b: b.symbol, overlapPercent: round(Math.min(100, overlap)), commonHoldings: common, partial: !a.complete || !b.complete });
    }
  }
  return out.sort((x, y) => y.overlapPercent - x.overlapPercent).slice(0, TOP_OVERLAPS);
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function buildWarnings(
  stocks: ExposureUnderlyingStock[],
  sectors: ExposureBreakdown,
  countries: ExposureBreakdown,
  overlaps: ExposureOverlap[],
  limits: ExposureLimits,
): ExposureWarning[] {
  const out: ExposureWarning[] = [];
  for (const s of stocks) {
    if (s.percent <= limits.stockPercent) continue;
    const via = s.viaFundsPercent > 0 ? `, ${fmtPct(s.viaFundsPercent)} through funds` : "";
    out.push({ kind: "stock", name: s.symbol, percent: s.percent, limit: limits.stockPercent, message: `${s.symbol} is ${fmtPct(s.percent)} of the portfolio${via}. Limit: ${limits.stockPercent}%.` });
  }
  for (const s of sectors.items) {
    if (s.percent <= limits.sectorPercent) continue;
    out.push({ kind: "sector", name: s.name, percent: s.percent, limit: limits.sectorPercent, message: `${s.name} is ${fmtPct(s.percent)} of the portfolio. Limit: ${limits.sectorPercent}%.` });
  }
  for (const c of countries.items) {
    if (c.percent <= limits.countryPercent) continue;
    out.push({ kind: "country", name: c.name, percent: c.percent, limit: limits.countryPercent, message: `${c.name} is ${fmtPct(c.percent)} of the portfolio. Limit: ${limits.countryPercent}%.` });
  }
  for (const o of overlaps) {
    if (o.overlapPercent <= limits.overlapPercent) continue;
    out.push({
      kind: "overlap",
      name: `${o.a} / ${o.b}`,
      percent: o.overlapPercent,
      limit: limits.overlapPercent,
      message: `${o.a} and ${o.b} overlap by ${fmtPct(o.overlapPercent)}${o.partial ? " or more" : ""}. Limit: ${limits.overlapPercent}%.`,
    });
  }
  return out.sort((a, b) => b.percent - a.percent);
}

// ── entry points for the AI features ────────────────────────────────────────

let defaultInstance: ExposureService | null = null;

/** Compact, percent-only exposure for prompts. No values or quantities. */
export interface PortfolioExposureSummary {
  baseCurrency: string;
  coverage: ExposureCoverage;
  /** Top 6 sectors and countries, then the unknown and not-applicable shares. */
  sectors: { name: string; percent: number }[];
  countries: { name: string; percent: number }[];
  assetClasses: { name: string; percent: number }[];
  unknownSectorPercent: number;
  unknownCountryPercent: number;
  /** Top 10 underlying stocks. */
  topStocks: { symbol: string; name?: string; percent: number; viaFundsPercent: number }[];
  /** Top 5 fund pairs. */
  overlaps: { a: string; b: string; overlapPercent: number; partial: boolean }[];
  warnings: string[];
  weightedExpenseRatioPercent?: number;
  sources: DataProviderId[];
}

/** The full exposure of a portfolio. Needs the `ExposureService` built in container.ts. */
export async function getPortfolioExposure(portfolioId: string, options: { baseCurrency?: string; refresh?: boolean } = {}): Promise<PortfolioExposureResponse> {
  if (!defaultInstance) throw new Error("Exposure service is not ready");
  return defaultInstance.getExposure(portfolioId, options);
}

/** Shrinks a full exposure to the summary the assistant and reports use. */
export function summarizeExposure(e: PortfolioExposureResponse): PortfolioExposureSummary {
  const slim = (b: ExposureBreakdown, n: number) => b.items.slice(0, n).map((s) => ({ name: s.name, percent: s.percent }));
  return {
    baseCurrency: e.baseCurrency,
    coverage: e.coverage,
    sectors: slim(e.sectors, 6),
    countries: slim(e.countries, 6),
    assetClasses: slim(e.assetClasses, 6),
    unknownSectorPercent: e.sectors.unknownPercent,
    unknownCountryPercent: e.countries.unknownPercent,
    topStocks: e.topStocks.slice(0, 10).map((s) => ({ symbol: s.symbol, name: s.name, percent: s.percent, viaFundsPercent: s.viaFundsPercent })),
    overlaps: e.overlaps.slice(0, 5).map((o) => ({ a: o.a, b: o.b, overlapPercent: o.overlapPercent, partial: o.partial })),
    warnings: e.warnings.map((w) => w.message),
    weightedExpenseRatioPercent: e.weightedExpenseRatio?.percent,
    sources: e.sources,
  };
}

/** `summarizeExposure(await getPortfolioExposure(id))`, or null when the exposure cannot be built. */
export async function getPortfolioExposureSummary(portfolioId: string): Promise<PortfolioExposureSummary | null> {
  try {
    return summarizeExposure(await getPortfolioExposure(portfolioId));
  } catch (err) {
    appLogger.logStep("warning", "exposure", "summary", `Exposure summary failed (${err instanceof Error ? err.name : typeof err})`);
    return null;
  }
}

/** Plain-text lines of a summary for an LLM prompt. Percentages only. */
export function formatExposureForPrompt(s: PortfolioExposureSummary): string {
  const list = (rows: { name: string; percent: number }[]) => rows.map((r) => `${r.name} ${r.percent.toFixed(1)}%`).join(", ") || "none";
  const lines = [
    `Exposure after ETF and fund look-through (percent of portfolio value, base ${s.baseCurrency}):`,
    `- Coverage: ${s.coverage.directPercent.toFixed(1)}% held directly, ${s.coverage.lookedThroughPercent.toFixed(1)}% looked through in funds, ${s.coverage.unknownPercent.toFixed(1)}% unknown.`,
    `- Sectors: ${list(s.sectors)}; unknown ${s.unknownSectorPercent.toFixed(1)}%.`,
    `- Countries: ${list(s.countries)}; unknown ${s.unknownCountryPercent.toFixed(1)}%.`,
    `- Asset classes: ${list(s.assetClasses)}.`,
    `- Largest underlying stocks: ${s.topStocks.map((t) => `${t.symbol} ${t.percent.toFixed(1)}%${t.viaFundsPercent > 0 ? ` (${t.viaFundsPercent.toFixed(1)}% via funds)` : ""}`).join(", ") || "none"}.`,
  ];
  if (s.overlaps.length) lines.push(`- Fund overlap: ${s.overlaps.map((o) => `${o.a}/${o.b} ${o.overlapPercent.toFixed(1)}%${o.partial ? "+" : ""}`).join(", ")}.`);
  if (s.weightedExpenseRatioPercent !== undefined) lines.push(`- Weighted fund expense ratio: ${s.weightedExpenseRatioPercent.toFixed(2)}%.`);
  if (s.warnings.length) lines.push(`- Warnings: ${s.warnings.join(" ")}`);
  lines.push(`- Data: ${s.sources.join(", ") || "none"}.`);
  return lines.join("\n");
}
