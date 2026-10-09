/**
 * ETF and fund look-through, and the sector and country of single stocks.
 *
 * Every lookup runs through the provider chain, FMP first:
 * - fund holdings: FMP `/etf/holdings` (the full list), then Yahoo
 *   `quoteSummary.topHoldings` (the top ten only);
 * - fund sector weights: FMP `/etf/sector-weightings`, then the `sectorsList`
 *   of FMP `/etf/info`, then Yahoo `topHoldings.sectorWeightings`;
 * - fund country weights: FMP `/etf/country-weightings` (Yahoo has none);
 * - fund asset classes: Yahoo `topHoldings` positions (stock, bond, cash),
 *   then the `assetClass` of FMP `/etf/info`;
 * - fund facts (expense ratio, AUM, holdings count): FMP `/etf/info`, then
 *   Yahoo `fundProfile` and `summaryDetail`;
 * - stock profile (sector, industry, country, ISIN, fund or not): FMP
 *   `/profile`, then Finnhub `profile2`, then Yahoo `assetProfile`.
 *
 * All weights are percent (0 to 100). Each result keeps its provider.
 * FMP responses are cached by `FmpService` (7 days for ETF data, 24 h for
 * profiles); Yahoo responses by `YahooFinanceService.getQuoteSummary`.
 * Nothing here logs a symbol or a weight (AGENTS.md rule 3).
 */
import { FMP_TTL, toFmpSymbol, type FmpCompanyProfile, type FmpService } from "../fmp.js";
import type { FinnhubService } from "../finnhub.js";
import type { YahooFinanceService } from "../yahoo-finance.js";
import { firstAvailable } from "../providers/chain.js";
import type { DataProviderId } from "../providers/types.js";

/** One weighted bucket: a sector, a country or an asset class. */
export interface WeightRow {
  name: string;
  /** Percent of the fund (0 to 100). */
  weight: number;
}

/** One security a fund holds. */
export interface FundHolding {
  symbol: string;
  name?: string;
  isin?: string;
  /** Percent of the fund (0 to 100). */
  weight: number;
}

/** What a fund holds, as far as the providers know. */
export interface FundLookThrough {
  symbol: string;
  name?: string;
  holdings: FundHolding[];
  /** True for the full list (FMP); false for top holdings only (Yahoo). */
  holdingsComplete: boolean;
  sectors: WeightRow[];
  countries: WeightRow[];
  assetClasses: WeightRow[];
  /** Annual expense ratio in percent (0.07 means 0.07 %). */
  expenseRatio?: number;
  /** Assets under management in the fund's own currency. */
  aum?: number;
  aumCurrency?: string;
  holdingsCount?: number;
  /** Provider of each part, null where no provider had it. */
  sources: {
    holdings: DataProviderId | null;
    sectors: DataProviderId | null;
    countries: DataProviderId | null;
    assetClasses: DataProviderId | null;
    info: DataProviderId | null;
  };
}

/** Sector and country of one security, and whether it is a fund. */
export interface SecurityProfile {
  symbol: string;
  name?: string;
  kind: "stock" | "fund" | "unknown";
  sector?: string;
  industry?: string;
  /** Full country name ("United States"). */
  country?: string;
  isin?: string;
  source: DataProviderId | null;
}

// ── FMP rows ────────────────────────────────────────────────────────────────

interface FmpEtfHoldingRow {
  symbol?: string;
  asset?: string;
  name?: string;
  isin?: string;
  weightPercentage?: number | string;
}

interface FmpEtfWeightRow {
  sector?: string;
  country?: string;
  weightPercentage?: number | string;
}

interface FmpEtfInfoRow {
  symbol?: string;
  name?: string;
  assetClass?: string;
  expenseRatio?: number;
  assetsUnderManagement?: number;
  navCurrency?: string;
  holdingsCount?: number;
  sectorsList?: Array<{ industry?: string; exposure?: number | string }>;
}

// ── normalisation ───────────────────────────────────────────────────────────

/** A number from a number, a "12.5%" string or a Yahoo `{ raw }` object. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(/[%,\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  if (value && typeof value === "object" && "raw" in value) return toNumber((value as { raw: unknown }).raw);
  return undefined;
}

const YAHOO_SECTORS: Record<string, string> = {
  realestate: "Real Estate",
  consumer_cyclical: "Consumer Cyclical",
  basic_materials: "Basic Materials",
  consumer_defensive: "Consumer Defensive",
  technology: "Technology",
  communication_services: "Communication Services",
  financial_services: "Financial Services",
  utilities: "Utilities",
  industrials: "Industrials",
  energy: "Energy",
  healthcare: "Healthcare",
};

/** Sector names of other vocabularies mapped to the FMP (Morningstar) names. */
const SECTOR_ALIASES: Record<string, string> = {
  "information technology": "Technology",
  tech: "Technology",
  technology: "Technology",
  semiconductors: "Technology",
  software: "Technology",
  "health care": "Healthcare",
  healthcare: "Healthcare",
  pharmaceuticals: "Healthcare",
  biotechnology: "Healthcare",
  "life sciences tools & services": "Healthcare",
  financials: "Financial Services",
  "financial services": "Financial Services",
  banking: "Financial Services",
  banks: "Financial Services",
  insurance: "Financial Services",
  "consumer discretionary": "Consumer Cyclical",
  "consumer cyclical": "Consumer Cyclical",
  retail: "Consumer Cyclical",
  automobiles: "Consumer Cyclical",
  "consumer staples": "Consumer Defensive",
  "consumer defensive": "Consumer Defensive",
  "food products": "Consumer Defensive",
  beverages: "Consumer Defensive",
  "communication services": "Communication Services",
  communications: "Communication Services",
  telecommunication: "Communication Services",
  media: "Communication Services",
  materials: "Basic Materials",
  "basic materials": "Basic Materials",
  chemicals: "Basic Materials",
  metals: "Basic Materials",
  "metals & mining": "Basic Materials",
  "real estate": "Real Estate",
  utilities: "Utilities",
  energy: "Energy",
  "oil & gas": "Energy",
  industrials: "Industrials",
  machinery: "Industrials",
  "aerospace & defense": "Industrials",
  "cash & others": "Cash & Other",
  "cash & other": "Cash & Other",
};

export function normalizeSector(name: string | undefined | null): string | undefined {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return undefined;
  return SECTOR_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

let regionNames: Intl.DisplayNames | null | undefined;

/** "US" → "United States"; full names pass through. */
export function normalizeCountry(name: string | undefined | null): string | undefined {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return undefined;
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    if (regionNames === undefined) {
      try {
        regionNames = new Intl.DisplayNames(["en"], { type: "region" });
      } catch {
        regionNames = null;
      }
    }
    try {
      const full = regionNames?.of(trimmed.toUpperCase());
      if (full && full !== trimmed.toUpperCase()) return full;
    } catch {
      // not a region code
    }
    return trimmed.toUpperCase();
  }
  return trimmed;
}

/** Merges rows with the same name, drops zero weights and sorts by weight. */
function cleanRows(rows: WeightRow[]): WeightRow[] {
  const merged = new Map<string, number>();
  for (const row of rows) {
    if (!row.name || !(row.weight > 0)) continue;
    merged.set(row.name, (merged.get(row.name) ?? 0) + row.weight);
  }
  let out = Array.from(merged, ([name, weight]) => ({ name, weight }));
  // Rounding in provider data can push the total a little over 100.
  const total = out.reduce((s, r) => s + r.weight, 0);
  if (total > 100) out = out.map((r) => ({ name: r.name, weight: (r.weight / total) * 100 }));
  return out.sort((a, b) => b.weight - a.weight);
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// ── service ─────────────────────────────────────────────────────────────────

const YAHOO_FUND_MODULES = ["quoteType", "topHoldings", "fundProfile", "summaryDetail", "price"];
const YAHOO_PROFILE_MODULES = ["quoteType", "assetProfile", "price"];
/** Yahoo fund data changes slowly; keep it as long as FMP ETF data. */
const YAHOO_FUND_TTL_MS = FMP_TTL.etfHoldings;
const YAHOO_PROFILE_TTL_MS = FMP_TTL.profile;

export class EtfIntelService {
  constructor(
    private readonly fmp: FmpService,
    private readonly yahoo: YahooFinanceService,
    private readonly finnhub: FinnhubService,
  ) {}

  // ---------------------------------------------------------------- stocks

  /** Sector, country and kind of one security, or a profile with `source: null`. */
  public async getSecurityProfile(symbol: string): Promise<SecurityProfile> {
    const sym = symbol.trim().toUpperCase();
    const result = await firstAvailable<SecurityProfile>({
      category: "fundamentals",
      isEmpty: (p) => p.kind === "unknown" && !p.sector && !p.country,
      attempts: [
        { provider: "fmp", isAvailable: () => this.fmp.isConfigured(), fetch: () => this.fmpProfile(sym) },
        { provider: "finnhub", isAvailable: () => this.finnhub.isConfigured(), fetch: () => this.finnhubProfile(sym) },
        { provider: "yahoo", fetch: () => this.yahooProfile(sym) },
      ],
    });
    return result.data && result.source ? { ...result.data, source: result.source } : { symbol: sym, kind: "unknown", source: null };
  }

  private async fmpProfile(sym: string): Promise<SecurityProfile | null> {
    const p: FmpCompanyProfile | null = await this.fmp.getProfile(toFmpSymbol(sym));
    if (!p) return null;
    return {
      symbol: sym,
      name: p.companyName,
      kind: p.isEtf || p.isFund ? "fund" : "stock",
      sector: normalizeSector(p.sector),
      industry: str(p.industry),
      country: normalizeCountry(p.country),
      isin: str(p.isin),
      source: "fmp",
    };
  }

  private async finnhubProfile(sym: string): Promise<SecurityProfile | null> {
    const p = await this.finnhub.getCompanyProfile(sym);
    if (!p) return null;
    return {
      symbol: sym,
      name: p.name,
      // Finnhub profile2 covers companies only.
      kind: "stock",
      sector: normalizeSector(p.finnhubIndustry),
      industry: str(p.finnhubIndustry),
      country: normalizeCountry(p.country),
      source: "finnhub",
    };
  }

  private async yahooProfile(sym: string): Promise<SecurityProfile | null> {
    const summary = await this.yahoo.getQuoteSummary(sym, YAHOO_PROFILE_MODULES, YAHOO_PROFILE_TTL_MS);
    if (!summary) return null;
    const quoteType = str(obj(summary.quoteType)?.quoteType)?.toUpperCase();
    const asset = obj(summary.assetProfile);
    const price = obj(summary.price);
    return {
      symbol: sym,
      name: str(price?.longName) ?? str(price?.shortName),
      kind: quoteType === "ETF" || quoteType === "MUTUALFUND" ? "fund" : quoteType === "EQUITY" ? "stock" : "unknown",
      sector: normalizeSector(str(asset?.sector)),
      industry: str(asset?.industry),
      country: normalizeCountry(str(asset?.country)),
      source: "yahoo",
    };
  }

  // ---------------------------------------------------------------- funds

  /** Holdings, sector, country and asset-class weights and facts of one fund. */
  public async getFundLookThrough(symbol: string): Promise<FundLookThrough> {
    const sym = symbol.trim().toUpperCase();
    const fmpSym = toFmpSymbol(sym);
    const fmpOn = () => this.fmp.isConfigured();

    // Each source is fetched at most once, however many parts need it.
    let infoPromise: Promise<FmpEtfInfoRow | null> | null = null;
    const fmpInfo = () =>
      (infoPromise ??= this.fmp
        .get<FmpEtfInfoRow[]>("/etf/info", { symbol: fmpSym }, FMP_TTL.etfHoldings)
        .then((rows) => (Array.isArray(rows) && rows[0] ? rows[0] : null)));
    let yahooPromise: Promise<Record<string, unknown> | null> | null = null;
    const yahooFund = () => (yahooPromise ??= this.yahoo.getQuoteSummary(sym, YAHOO_FUND_MODULES, YAHOO_FUND_TTL_MS));

    const [holdings, sectors, countries, assetClasses, info] = await Promise.all([
      firstAvailable<{ rows: FundHolding[]; complete: boolean }>({
        category: "etfHoldings",
        isEmpty: (v) => v.rows.length === 0,
        attempts: [
          { provider: "fmp", isAvailable: fmpOn, fetch: () => this.fmpHoldings(fmpSym) },
          { provider: "yahoo", fetch: async () => yahooHoldings(await yahooFund()) },
        ],
      }),
      firstAvailable<WeightRow[]>({
        category: "etfSectors",
        attempts: [
          { provider: "fmp", isAvailable: fmpOn, fetch: () => this.fmpSectors(fmpSym, fmpInfo) },
          { provider: "yahoo", fetch: async () => yahooSectors(await yahooFund()) },
        ],
      }),
      firstAvailable<WeightRow[]>({
        category: "etfCountries",
        attempts: [{ provider: "fmp", isAvailable: fmpOn, fetch: () => this.fmpCountries(fmpSym) }],
      }),
      firstAvailable<WeightRow[]>({
        category: "etfAssetClasses",
        attempts: [
          { provider: "yahoo", fetch: async () => yahooAssetClasses(await yahooFund()) },
          { provider: "fmp", isAvailable: fmpOn, fetch: async () => fmpAssetClasses(await fmpInfo()) },
        ],
      }),
      firstAvailable<Omit<FundLookThrough, "symbol" | "holdings" | "holdingsComplete" | "sectors" | "countries" | "assetClasses" | "sources">>({
        category: "etfInfo",
        isEmpty: (v) => v.expenseRatio === undefined && v.aum === undefined && v.holdingsCount === undefined && !v.name,
        attempts: [
          { provider: "fmp", isAvailable: fmpOn, fetch: async () => fmpFacts(await fmpInfo()) },
          { provider: "yahoo", fetch: async () => yahooFacts(await yahooFund()) },
        ],
      }),
    ]);

    return {
      symbol: sym,
      name: info.data?.name,
      holdings: holdings.data?.rows ?? [],
      holdingsComplete: holdings.data?.complete ?? false,
      sectors: sectors.data ?? [],
      countries: countries.data ?? [],
      assetClasses: assetClasses.data ?? [],
      expenseRatio: info.data?.expenseRatio,
      aum: info.data?.aum,
      aumCurrency: info.data?.aumCurrency,
      holdingsCount: info.data?.holdingsCount ?? (holdings.data?.complete ? holdings.data.rows.length : undefined),
      sources: {
        holdings: holdings.data?.rows.length ? holdings.source : null,
        sectors: sectors.data?.length ? sectors.source : null,
        countries: countries.data?.length ? countries.source : null,
        assetClasses: assetClasses.data?.length ? assetClasses.source : null,
        info: info.data ? info.source : null,
      },
    };
  }

  private async fmpHoldings(fmpSym: string): Promise<{ rows: FundHolding[]; complete: boolean } | null> {
    const rows = await this.fmp.get<FmpEtfHoldingRow[]>("/etf/holdings", { symbol: fmpSym }, FMP_TTL.etfHoldings);
    if (!Array.isArray(rows)) return null;
    const out: FundHolding[] = [];
    for (const r of rows) {
      const symbol = str(r.asset)?.toUpperCase();
      const weight = toNumber(r.weightPercentage);
      if (!symbol || weight === undefined || weight <= 0) continue;
      out.push({ symbol, name: str(r.name), isin: str(r.isin)?.toUpperCase(), weight });
    }
    return { rows: out.sort((a, b) => b.weight - a.weight), complete: true };
  }

  private async fmpSectors(fmpSym: string, info: () => Promise<FmpEtfInfoRow | null>): Promise<WeightRow[] | null> {
    const rows = await this.fmp.get<FmpEtfWeightRow[]>("/etf/sector-weightings", { symbol: fmpSym }, FMP_TTL.etfHoldings);
    const fromWeightings = Array.isArray(rows)
      ? cleanRows(rows.map((r) => ({ name: normalizeSector(r.sector) ?? "", weight: toNumber(r.weightPercentage) ?? 0 })))
      : [];
    if (fromWeightings.length > 0) return fromWeightings;
    const list = (await info())?.sectorsList;
    if (!Array.isArray(list)) return null;
    return cleanRows(list.map((r) => ({ name: normalizeSector(r.industry) ?? "", weight: toNumber(r.exposure) ?? 0 })));
  }

  private async fmpCountries(fmpSym: string): Promise<WeightRow[] | null> {
    const rows = await this.fmp.get<FmpEtfWeightRow[]>("/etf/country-weightings", { symbol: fmpSym }, FMP_TTL.etfHoldings);
    if (!Array.isArray(rows)) return null;
    return cleanRows(rows.map((r) => ({ name: normalizeCountry(r.country) ?? "", weight: toNumber(r.weightPercentage) ?? 0 })));
  }
}

// ── provider mappers ────────────────────────────────────────────────────────

function fmpAssetClasses(info: FmpEtfInfoRow | null): WeightRow[] | null {
  const cls = str(info?.assetClass);
  return cls ? [{ name: normalizeAssetClass(cls), weight: 100 }] : null;
}

function fmpFacts(info: FmpEtfInfoRow | null) {
  if (!info) return null;
  return {
    name: str(info.name),
    expenseRatio: toNumber(info.expenseRatio),
    aum: toNumber(info.assetsUnderManagement),
    aumCurrency: str(info.navCurrency),
    holdingsCount: toNumber(info.holdingsCount),
  };
}

function yahooHoldings(summary: Record<string, unknown> | null): { rows: FundHolding[]; complete: boolean } | null {
  const list = obj(summary?.topHoldings)?.holdings;
  if (!Array.isArray(list)) return null;
  const rows: FundHolding[] = [];
  for (const item of list) {
    const h = obj(item);
    const symbol = str(h?.symbol)?.toUpperCase();
    const fraction = toNumber(h?.holdingPercent);
    if (!symbol || fraction === undefined || fraction <= 0) continue;
    rows.push({ symbol, name: str(h?.holdingName), weight: fraction * 100 });
  }
  return { rows: rows.sort((a, b) => b.weight - a.weight), complete: false };
}

function yahooSectors(summary: Record<string, unknown> | null): WeightRow[] | null {
  const list = obj(summary?.topHoldings)?.sectorWeightings;
  if (!Array.isArray(list)) return null;
  const rows: WeightRow[] = [];
  for (const item of list) {
    for (const [key, value] of Object.entries(obj(item) ?? {})) {
      const fraction = toNumber(value);
      if (fraction === undefined) continue;
      rows.push({ name: YAHOO_SECTORS[key] ?? normalizeSector(key.replace(/_/g, " ")) ?? key, weight: fraction * 100 });
    }
  }
  return cleanRows(rows);
}

function yahooAssetClasses(summary: Record<string, unknown> | null): WeightRow[] | null {
  const top = obj(summary?.topHoldings);
  if (!top) return null;
  const part = (key: string) => (toNumber(top[key]) ?? 0) * 100;
  return cleanRows([
    { name: "Equity", weight: part("stockPosition") + part("preferredPosition") },
    { name: "Fixed Income", weight: part("bondPosition") + part("convertiblePosition") },
    { name: "Cash", weight: part("cashPosition") },
    { name: "Other", weight: part("otherPosition") },
  ]);
}

function yahooFacts(summary: Record<string, unknown> | null) {
  if (!summary) return null;
  const fees = obj(obj(summary.fundProfile)?.feesExpensesInvestment);
  const detail = obj(summary.summaryDetail);
  const price = obj(summary.price);
  const ratio = toNumber(fees?.annualReportExpenseRatio) ?? toNumber(fees?.netExpRatio);
  return {
    name: str(price?.longName) ?? str(price?.shortName),
    // Yahoo sends a fraction (0.0007); FMP and this API use percent (0.07).
    expenseRatio: ratio !== undefined ? ratio * 100 : undefined,
    aum: toNumber(detail?.totalAssets) ?? toNumber(fees?.totalNetAssets),
    aumCurrency: str(price?.currency),
    holdingsCount: undefined,
  };
}

/** FMP asset class names mapped to the buckets of the exposure view. */
export function normalizeAssetClass(name: string): string {
  const n = name.trim().toLowerCase();
  if (n.includes("equity") || n.includes("stock")) return "Equity";
  if (n.includes("fixed") || n.includes("bond") || n.includes("debt")) return "Fixed Income";
  if (n.includes("commod")) return "Commodity";
  if (n.includes("real estate")) return "Real Estate";
  if (n.includes("cash") || n.includes("money market")) return "Cash";
  if (n.includes("currency")) return "Currency";
  if (n.includes("crypto")) return "Crypto";
  return name.trim() || "Other";
}
