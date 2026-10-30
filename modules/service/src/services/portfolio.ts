import * as crypto from "node:crypto";
import * as portfolioRepo from "../db/portfolio.repo.js";
import * as txRepo from "../db/transaction.repo.js";
import * as snapshotRepo from "../db/snapshot.repo.js";
import * as marketCache from "../db/market-cache.repo.js";
import * as manualPriceRepo from "../db/manual-price.repo.js";
import {
  YahooFinanceService,
  mapWithConcurrencyLimit,
  extractQuoteFromChart,
  type YahooQuote,
  type YahooChartData,
} from "./yahoo-finance.js";

export interface IMarketDataProvider {
  getQuotes(symbols: string[], forceFresh?: boolean): Promise<Map<string, YahooQuote>>;
  getExchangeRates(baseCurrency: string, targetCurrencies: string[], forceFresh?: boolean): Promise<Map<string, number>>;
  getChart(symbol: string, range?: string, interval?: string, forceFresh?: boolean): Promise<YahooChartData>;
  /** Warms the quote caches the daily charts read, in batches. Optional. */
  prefetchChartQuotes?(symbols: string[]): Promise<void>;
}
import { generateDemoTransactions, DEMO_ASSETS } from "./demo-portfolio.js";
import type {
  FinancialPortfolioData,
  HoldingPerformance,
  ManualPrice,
  PortfolioHoldingConfig,
  PortfolioSummary,
  PortfolioHistoricalPoint,
} from "portfolio-shared/portfolio";
import type { DesktopConfig } from "portfolio-shared/config-types";
import { loadConfig, updateConfig } from "../config.js";
import { appLogger } from "../logger.js";
import { rememberJson } from "../json-cache.js";
import type { SymbolResolver } from "./symbol-resolver.js";
import { isIsin } from "./providers/identifiers.js";

const CACHE_TTL_MS = 60 * 60 * 1000;
/** How long an expired disk copy counts as fresh in memory while its background refresh runs. */
const STALE_RETRY_MS = 60 * 1000;

/** The setting that aims an automation at one portfolio ("" runs it for every portfolio), with its switch. */
const AUTOMATION_TARGETS = [
  ["dailyBriefPortfolioId", "dailyBriefEnabled"],
  ["weeklyAnalysisPortfolioId", "weeklyAnalysisEnabled"],
  ["eventAlertsPortfolioId", "eventAlertsEnabled"],
] as const;

/** An error for a log line: the message can carry a symbol (CLAUDE.md rule 3), the name cannot. */
function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Puts a live price on the last point of a daily close series, as a
 * provider's daily chart shows the current session. When the last close
 * equals the quote's previous close and the price has moved, the last point
 * is the previous session and the price starts a new point.
 */
function applyLiveClose(points: { date: string; close: number }[], quote: YahooQuote): void {
  const last = points[points.length - 1];
  const price = quote.regularMarketPrice;
  if (!last || !(price > 0)) return;
  const prev = quote.previousClose;
  const previousSession = prev !== undefined && prev > 0 && Math.abs(last.close - prev) <= prev * 1e-6 && price !== prev;
  if (!previousSession) {
    last.close = price;
    return;
  }
  let date = (quote.updatedAt || "").slice(0, 10);
  if (!(date > last.date)) {
    const next = new Date(`${last.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  points.push({ date, close: price });
}

/** A private holding has no public quote; it is valued at cost or at the user's price. */
function isPrivateHolding(config: PortfolioHoldingConfig): boolean {
  return Boolean(config.isPrivate || config.assetType === "Other" || config.symbol.toUpperCase() === "LU3176111881");
}

/** Symbols with a market price: neither private, "Other" nor cash. */
function publicSymbolsOf(holdings: PortfolioHoldingConfig[]): string[] {
  return holdings.filter((h) => !h.isPrivate && h.assetType !== "Other" && h.symbol !== "CASH").map((h) => h.symbol);
}

function computeSMA(closes: number[], period: number): number | undefined {
  if (closes.length < period) return undefined;
  const slice = closes.slice(-period);
  const sum = slice.reduce((acc, c) => acc + c, 0);
  return Number((sum / period).toFixed(2));
}

function computeRSI(closes: number[]): number | undefined {
  if (closes.length < 15) return undefined;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= 14; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / 14;
  let avgLoss = losses / 14;

  for (let i = 15; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * 13 + gain) / 14;
    avgLoss = (avgLoss * 13 + loss) / 14;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(1));
}

function absNum(val: number): number {
  return Math.abs(val);
}

const INFLOW_TYPES = new Set(["CUSTOMER_INBOUND", "TRANSFER_INBOUND", "DEPOSIT"]);
const OUTFLOW_TYPES = new Set(["CUSTOMER_OUTBOUND", "TRANSFER_OUTBOUND", "WITHDRAWAL"]);

/**
 * True when the transaction adds shares at a cost. Trade Republic exports a
 * stock perk as a cash credit with no shares followed by a regular BUY, so a
 * STOCKPERK only counts as a buy when it carries shares itself.
 */
function isBuyTransaction(tx: txRepo.TransactionRow): boolean {
  if (tx.type === "BUY" || tx.type === "PRIVATE_MARKET_BUY") return true;
  return tx.type === "STOCKPERK" && (tx.shares ?? 0) > 0;
}

type HoldingAssetType = NonNullable<PortfolioHoldingConfig["assetType"]>;

/**
 * Asset type for a stored transaction asset class. The manual form saves
 * EQUITY, FUND or CRYPTO; the demo and some imports save STOCK or ETF.
 * Returns undefined for an empty or unknown class.
 */
export function assetTypeFromClass(assetClass: string | null | undefined): HoldingAssetType | undefined {
  switch ((assetClass || "").trim().toUpperCase()) {
    case "ETF":
    case "FUND":
      return "ETF";
    case "MUTUALFUND":
      return "MutualFund";
    case "CRYPTO":
    case "CRYPTOCURRENCY":
      return "Crypto";
    case "STOCK":
    case "EQUITY":
      return "Stock";
    default:
      return undefined;
  }
}

/** Asset type for a Yahoo chart `instrumentType`, or undefined when there is none. */
export function assetTypeFromInstrument(instrumentType: string | undefined): HoldingAssetType | undefined {
  switch ((instrumentType || "").toUpperCase()) {
    case "ETF":
      return "ETF";
    case "MUTUALFUND":
      return "MutualFund";
    case "CRYPTOCURRENCY":
      return "Crypto";
    case "EQUITY":
      return "Stock";
    default:
      return undefined;
  }
}

/**
 * Cash effect of everything except the trade value of a BUY or SELL, in the
 * transaction currency. Known credits and debits use the absolute amount; any
 * other type (card payments, manual transfers, stock perks) uses the signed
 * amount as exported. Fees are always a cost; a negative tax is a refund.
 */
function nonTradeCashFlow(tx: txRepo.TransactionRow): number {
  const amount = tx.amount ?? 0;
  let flow = 0;
  if (INFLOW_TYPES.has(tx.type)) flow = absNum(amount);
  else if (OUTFLOW_TYPES.has(tx.type)) flow = -absNum(amount);
  else if (tx.type === "DIVIDEND" || tx.type === "INTEREST_PAYMENT" || tx.type === "STOCKPERK") flow = absNum(amount);
  else if (tx.type !== "BUY" && tx.type !== "PRIVATE_MARKET_BUY" && tx.type !== "SELL") flow = amount;
  return flow - absNum(tx.fee ?? 0) - (tx.tax ?? 0);
}

function normalizeComparisonValue(val: unknown): unknown {
  if (val === null || val === undefined || val === "") return undefined;
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof val === "number") {
    if (isNaN(val)) return undefined;
    return val;
  }
  return val;
}

export { mapWithConcurrencyLimit, extractQuoteFromChart };

/** A portfolio dot colour from a request: `#rrggbb` in lower case, null to clear it, undefined to keep it. */
export function portfolioColor(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Portfolio colour must be #rrggbb");
  return value.toLowerCase();
}

export class PortfolioService {
  private cache = new Map<string, { data: FinancialPortfolioData; timestamp: number }>();
  private inFlightRequests = new Map<string, Promise<FinancialPortfolioData>>();
  private cacheSweepHandle?: Timer;
  /**
   * Bumped by clearPortfolioCache, per portfolio and for all of them. A build
   * that started before a bump read old transactions: it caches nothing.
   */
  private readonly generations = new Map<string, number>();
  private allGeneration = 0;

  constructor(
    private readonly yahoo: IMarketDataProvider,
    /** ISIN to ticker lookup on import. Without it, imported symbols are kept as sent. */
    private readonly symbols?: SymbolResolver,
  ) {
    this.cacheSweepHandle = setInterval(() => this.sweepExpiredCacheEntries(), CACHE_TTL_MS);
    this.cacheSweepHandle.unref?.();
  }

  destroy() {
    if (this.cacheSweepHandle) {
      clearInterval(this.cacheSweepHandle);
    }
  }

  private sweepExpiredCacheEntries() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp >= CACHE_TTL_MS) {
        this.cache.delete(key);
      }
    }
  }

  private generationOf(portfolioId: string): string {
    return `${this.allGeneration}:${this.generations.get(portfolioId) ?? 0}`;
  }

  /** Changes whenever the transactions, manual prices or settings of the portfolio change (see clearPortfolioCache). */
  public ledgerVersion(portfolioId: string): string {
    return this.generationOf(portfolioId);
  }

  public clearPortfolioCache(portfolioId?: string) {
    if (!portfolioId) {
      this.allGeneration++;
      this.cache.clear();
      this.inFlightRequests.clear();
      marketCache.deleteByPrefix("portfolio:");
      return;
    }
    this.generations.set(portfolioId, (this.generations.get(portfolioId) ?? 0) + 1);
    for (const key of this.cache.keys()) {
      if (key === portfolioId || key.startsWith(`${portfolioId}_`)) this.cache.delete(key);
    }
    // The disk copy too, in every currency, even when the memory entry was already swept.
    marketCache.deleteByPrefix(`portfolio:${portfolioId}_`);
    for (const key of this.inFlightRequests.keys()) {
      if (key === portfolioId || key.startsWith(`${portfolioId}_`)) {
        this.inFlightRequests.delete(key);
      }
    }
  }

  private mintTransactionId(candidateId: string | undefined | null): string {
    const trimmed = candidateId?.trim();
    if (trimmed) {
      return trimmed;
    }
    return `tx_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  }

  // Transaction ids are a global key, but brokers reuse their own ids when the same export goes into
  // a second portfolio. Such an id gets the portfolio id appended, so each portfolio keeps one copy.
  private scopedTransactionId(candidateId: string, portfolioId: string): string {
    return `${candidateId}@${portfolioId}`;
  }

  private mintPortfolioTransactionId(candidateId: string | undefined | null, portfolioId: string): string {
    const id = this.mintTransactionId(candidateId);
    const taken = txRepo.findById(id);
    return taken && taken.portfolioId !== portfolioId ? this.scopedTransactionId(id, portfolioId) : id;
  }

  public async createDemoPortfolio(customBaseCurrency?: string): Promise<portfolioRepo.PortfolioRow> {
    const config = loadConfig();
    const baseCurrency = customBaseCurrency || config.baseCurrency || "EUR";

    const saved = portfolioRepo.create({
      name: "Demo Portfolio",
      description: "Simulated demonstration portfolio with 100 mock transactions spanning the past year.",
      baseCurrency,
    });

    try {
      let quotesMapInBase: Map<string, number> | undefined = undefined;
      try {
        const symbols = DEMO_ASSETS.map((a) => a.symbol);
        const liveQuotes = await this.yahoo.getQuotes(symbols);
        const quoteCurrencies = Array.from(
          new Set([
            ...Array.from(liveQuotes.values()).map((q) => q.currency),
            ...DEMO_ASSETS.map((a) => a.currency),
          ].filter(Boolean) as string[])
        );
        const fxRates = await this.yahoo.getExchangeRates(baseCurrency, quoteCurrencies);

        quotesMapInBase = new Map<string, number>();
        for (const asset of DEMO_ASSETS) {
          const q = liveQuotes.get(asset.symbol);
          const rawPrice = q?.regularMarketPrice || asset.refPrice;
          const curr = q?.currency || asset.currency || baseCurrency;
          const mult = fxRates.get(curr) ?? 1;
          quotesMapInBase.set(asset.symbol, rawPrice * mult);
        }
      } catch (err: any) {
        appLogger.logStep(
          "warning",
          "portfolio",
          "demo_quotes",
          `Could not fetch live quotes for the demo portfolio (${errorName(err)}); using reference prices`,
        );
      }

      const transactions = generateDemoTransactions(saved.id, baseCurrency, quotesMapInBase);
      txRepo.bulkCreate(transactions as any);
      this.clearPortfolioCache(saved.id);
      appLogger.logStep("success", "portfolio", "create_demo", "Created demo portfolio", undefined, {
        portfolioId: saved.id,
        transactions: transactions.length,
        baseCurrency,
      });
    } catch (err: any) {
      appLogger.logStep("warning", "portfolio", "create_demo", `Failed to generate demo transactions: ${err.message}`);
    }

    return saved;
  }

  public getPortfolios(): portfolioRepo.PortfolioRow[] {
    return portfolioRepo.findAll();
  }

  public getPortfolio(portfolioId: string): portfolioRepo.PortfolioRow {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio not found (${portfolioId})`);
    }
    return portfolio;
  }

  public createPortfolio(data: { name: string; description?: string; baseCurrency?: string; color?: string | null }): portfolioRepo.PortfolioRow {
    if (!data.name || !data.name.trim()) {
      throw new Error("Portfolio name is required");
    }

    const config = loadConfig();
    return portfolioRepo.create({
      name: data.name.trim(),
      description: data.description?.trim() || null,
      baseCurrency: data.baseCurrency || config.baseCurrency || "EUR",
      color: portfolioColor(data.color) ?? null,
    });
  }

  public updatePortfolio(
    portfolioId: string,
    data: { name?: string; description?: string; baseCurrency?: string; color?: string | null }
  ): portfolioRepo.PortfolioRow {
    const portfolio = this.getPortfolio(portfolioId);
    if (data.name !== undefined && !data.name.trim()) {
      throw new Error("Portfolio name cannot be empty");
    }

    const saved = portfolioRepo.update(portfolioId, { ...data, color: portfolioColor(data.color) });
    this.clearPortfolioCache(portfolioId);
    return saved!;
  }

  public deletePortfolio(portfolioId: string): boolean {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) {
      throw new Error("Portfolio not found");
    }

    portfolioRepo.deleteById(portfolioId);
    // The rows go with the portfolio (ON DELETE CASCADE). An automation aimed at it is switched off:
    // a cleared id means "every portfolio", and its pushes must not start to cover the others.
    const cfg = loadConfig();
    const reset: Partial<DesktopConfig> = {};
    for (const [idKey, enabledKey] of AUTOMATION_TARGETS) {
      if (cfg[idKey] === portfolioId) Object.assign(reset, { [idKey]: "", [enabledKey]: false });
    }
    if (Object.keys(reset).length > 0) updateConfig(reset);
    appLogger.logStep("success", "portfolio", "delete", "Deleted portfolio and all associated data", undefined, {
      portfolioId,
    });
    this.clearPortfolioCache(portfolioId);
    return true;
  }

  public async getTransactions(portfolioOrId: string | portfolioRepo.PortfolioRow): Promise<txRepo.TransactionRow[]> {
    const id = typeof portfolioOrId === "string" ? portfolioOrId : portfolioOrId.id;
    return txRepo.findByPortfolio(id);
  }

  public async getPortfolioData(
    portfolioOrId: string | portfolioRepo.PortfolioRow,
    baseCurrency?: string,
    forceFresh = false,
    /** Quotes from `fetchLiveQuotes()`; a forced build then asks for no quotes of its own. */
    liveQuotes?: Map<string, YahooQuote>,
  ): Promise<FinancialPortfolioData> {
    const portfolio = typeof portfolioOrId === "string" ? portfolioRepo.findById(portfolioOrId) : portfolioOrId;
    if (!portfolio) {
      throw new Error(`Portfolio not found: ${typeof portfolioOrId === "string" ? portfolioOrId : ""}`);
    }
    const effectiveCurrency = baseCurrency || portfolio.baseCurrency || "EUR";
    const cacheKey = `${portfolio.id}_${effectiveCurrency}`;
    const now = Date.now();

    // 1. If not forcing fresh, check memory cache
    if (!forceFresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        appLogger.logStep("info", "portfolio", "cache_hit_memory", "Memory cache hit", undefined, {
          cacheKey,
          ageSeconds: Math.round((now - cached.timestamp) / 1000),
        });
        return cached.data;
      }

      // 2. Check persistent SQLite cache (instant return on app restart)
      const diskCached = marketCache.get<FinancialPortfolioData>(`portfolio:${cacheKey}`, { keepJson: true });
      if (diskCached?.data) {
        // The real build time; an expired copy counts as fresh only briefly, so a failed refresh is tried again.
        const timestamp = diskCached.isExpired ? now - CACHE_TTL_MS + STALE_RETRY_MS : diskCached.expiresAt - CACHE_TTL_MS;
        this.cache.set(cacheKey, { data: diskCached.data, timestamp });
        appLogger.logStep(
          "info",
          "portfolio",
          "cache_hit_disk",
          `Disk cache hit (isExpired=${diskCached.isExpired})`,
          undefined,
          { cacheKey, isExpired: diskCached.isExpired },
        );
        if (diskCached.isExpired) {
          // Stale cache: schedule asynchronous background refresh without blocking UI
          setTimeout(() => {
            this.getPortfolioData(portfolioOrId, baseCurrency, true).catch(() => {});
          }, 150);
        }
        return diskCached.data;
      }
    }

    // 3. Check in-flight request deduplication
    const existingPromise = this.inFlightRequests.get(cacheKey);
    if (existingPromise) {
      appLogger.logStep("info", "portfolio", "in_flight_dedup", "Joining the in-flight request", undefined, { cacheKey });
      return existingPromise;
    }

    appLogger.logStep(
      "info",
      "portfolio",
      "rebuild_start",
      `Starting portfolio calculation (${effectiveCurrency}, forceFresh=${forceFresh})`,
      undefined,
      { portfolioId: portfolio.id, currency: effectiveCurrency },
    );

    // Taken before the transactions are read: a clear during the build changes it.
    const generation = this.generationOf(portfolio.id);
    const computePromise: Promise<FinancialPortfolioData> = (async (): Promise<FinancialPortfolioData> => {
      const txTimer = appLogger.startTimer("portfolio", "get_transactions", "Fetching transactions");
      const transactions = await this.getTransactions(portfolio);
      txTimer.end("info", `Retrieved ${transactions.length} transactions`, { count: transactions.length });

      const holdings = this.computeHoldingsFromTransactions(transactions);
      appLogger.logStep("info", "portfolio", "compute_holdings", `Computed ${holdings.length} holdings from transactions`, undefined, {
        holdingsCount: holdings.length,
      });

      const buildTimer = appLogger.startTimer("portfolio", "build_data", "Building portfolio metrics and market quotes");
      let data: FinancialPortfolioData;
      try {
        data = await this.buildPortfolioData(portfolio, holdings, transactions, effectiveCurrency, forceFresh, liveQuotes);
      } catch (err) {
        buildTimer.end("error", `Build failed (${errorName(err)})`);
        // If calculation/network failed, check if we have a stale disk cache to use offline
        const staleDisk = marketCache.get<FinancialPortfolioData>(`portfolio:${cacheKey}`);
        if (staleDisk && staleDisk.data) {
          appLogger.logStep("warning", "portfolio", "fallback_stale_disk", "Using the stale disk cache after a build failure");
          return staleDisk.data;
        }
        throw err;
      }
      if (this.generationOf(portfolio.id) !== generation) {
        // The transactions, a manual price or the portfolio changed while this build ran, or the
        // portfolio was deleted: the result is stale, so it is not cached and every caller gets a new build.
        buildTimer.end("info", "The portfolio changed during the build; building it again");
        return this.getPortfolioData(portfolio.id, baseCurrency, forceFresh, liveQuotes);
      }
      // One serialization for the disk copy and every GET of this build.
      rememberJson(data);
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      marketCache.set(`portfolio:${cacheKey}`, data, CACHE_TTL_MS);
      buildTimer.end("success", "Portfolio built", { holdingsCount: data.holdings?.length ?? 0 });
      return data;
    })().finally(() => {
      // A clear during the build may have let a newer build in under the same key: that one stays.
      if (this.inFlightRequests.get(cacheKey) === computePromise) this.inFlightRequests.delete(cacheKey);
    });

    this.inFlightRequests.set(cacheKey, computePromise);
    return computePromise;
  }

  /**
   * Fresh quotes for the public holdings of several portfolios, asked once.
   * Pass them to `getPortfolioData(id, currency, true, quotes)` so a symbol
   * held in several portfolios is not fetched once per portfolio.
   */
  public async fetchLiveQuotes(portfolioIds: string[]): Promise<Map<string, YahooQuote>> {
    const symbols = new Set<string>();
    for (const id of portfolioIds) {
      for (const sym of publicSymbolsOf(this.computeHoldingsFromTransactions(txRepo.findByPortfolio(id)))) symbols.add(sym);
    }
    if (symbols.size === 0) return new Map();
    const timer = appLogger.startTimer("portfolio", "fetch_live_quotes", `Refreshing quotes for ${symbols.size} symbols in ${portfolioIds.length} portfolio(s)`);
    try {
      const quotes = await this.yahoo.getQuotes(Array.from(symbols), true);
      timer.end("info", `Quotes refreshed (${quotes.size}/${symbols.size})`);
      return quotes;
    } catch (e) {
      timer.end("warning", `Quote refresh failed (${errorName(e)})`);
      return new Map();
    }
  }

  public computeHoldingsFromTransactions(transactions: txRepo.TransactionRow[]): PortfolioHoldingConfig[] {
    const activeHoldingsMap = new Map<
      string,
      {
        symbol: string;
        name: string;
        isin?: string;
        shares: number;
        totalCost: number;
        assetType: HoldingAssetType;
        currency?: string;
        isPrivate: boolean;
      }
    >();

    for (const tx of transactions) {
      const sym = (tx.symbol || "").toUpperCase();
      const shares = tx.shares ?? 0;
      const price = tx.price ?? 0;
      const amount = tx.amount ?? 0;

      if (isBuyTransaction(tx)) {
        if (sym && sym !== "CASH") {
          let entry = activeHoldingsMap.get(sym);
          const isPrivateTx =
            tx.type === "PRIVATE_MARKET_BUY" ||
            tx.assetClass === "PRIVATE_FUND" ||
            tx.assetClass === "PRIVATE" ||
            tx.assetClass === "PRIVATE_INVESTMENT" ||
            tx.assetClass === "PRIVATE_EQUITY" ||
            tx.assetClass === "PRIVATE_MARKET" ||
            Boolean(tx.assetClass && tx.assetClass.toUpperCase().includes("PRIVATE")) ||
            sym.startsWith("PRIVATE_") ||
            sym === "LU3176111881";

          if (!entry) {
            let assetType: HoldingAssetType = assetTypeFromClass(tx.assetClass) ?? "Stock";
            if (isPrivateTx) {
              assetType = "Other";
            } else if (assetType === "Stock" && sym.includes("BTC")) {
              assetType = "Crypto";
            }

            entry = {
              symbol: sym,
              name: tx.name || sym,
              isin: tx.isin && isIsin(tx.isin) ? tx.isin.toUpperCase() : undefined,
              shares: 0,
              totalCost: 0,
              assetType,
              currency: tx.currency || "EUR",
              isPrivate: isPrivateTx,
            };
            activeHoldingsMap.set(sym, entry);
          } else {
            if (isPrivateTx) {
              entry.isPrivate = true;
              entry.assetType = "Other";
            } else if (entry.assetType === "Stock") {
              // A later transaction may name a more specific class than the first one.
              const fromClass = assetTypeFromClass(tx.assetClass);
              if (fromClass && fromClass !== "Stock") entry.assetType = fromClass;
            }
            if (tx.currency) {
              entry.currency = tx.currency;
            }
            if (!entry.isin && tx.isin && isIsin(tx.isin)) entry.isin = tx.isin.toUpperCase();
          }

          let cost = 0;
          if (absNum(amount) > 0) {
            cost = absNum(amount);
          } else if (entry.totalCost > 0 && entry.shares === 0 && shares > 0) {
            cost = 0;
          } else {
            cost = price * shares;
          }

          entry.shares += shares;
          entry.totalCost += cost;
        }
      } else if (tx.type === "SELL") {
        if (sym && sym !== "CASH" && activeHoldingsMap.has(sym)) {
          const entry = activeHoldingsMap.get(sym)!;
          if (entry.shares > 0) {
            const avgCostPerShare = entry.totalCost / entry.shares;
            const costOfSold = absNum(shares) * avgCostPerShare;
            entry.shares -= absNum(shares);
            entry.totalCost -= costOfSold;
            if (entry.shares <= 0.000001) {
              entry.shares = 0;
              entry.totalCost = 0;
            }
          }
        }
      }
    }

    return Array.from(activeHoldingsMap.values())
      .filter((h) => h.shares > 0.000001)
      .map((h) => ({
        symbol: h.symbol,
        name: h.name,
        isin: h.isin,
        shares: Number(h.shares.toFixed(6)),
        buyPrice: Number((h.shares > 0 ? h.totalCost / h.shares : 0).toFixed(4)),
        assetType: h.assetType,
        isPrivate: h.isPrivate,
        currency: h.currency,
      }));
  }

  public async buildPortfolioData(
    portfolio: portfolioRepo.PortfolioRow,
    holdingsConfig: PortfolioHoldingConfig[],
    transactions: txRepo.TransactionRow[],
    baseCurrency = "EUR",
    forceFresh = false,
    prefetchedQuotes?: Map<string, YahooQuote>,
  ): Promise<FinancialPortfolioData> {
    // Cash flows, realized P&L, income, fees and taxes per transaction currency, converted to the base currency once FX is known.
    type NativeTotals = {
      injected: number;
      withdrawn: number;
      realizedPnL: number;
      dividends: number;
      interest: number;
      fees: number;
      taxes: number;
    };
    const nativeByCurrency = new Map<string, NativeTotals>();
    const native = (curr: string): NativeTotals => {
      let t = nativeByCurrency.get(curr);
      if (!t) {
        t = { injected: 0, withdrawn: 0, realizedPnL: 0, dividends: 0, interest: 0, fees: 0, taxes: 0 };
        nativeByCurrency.set(curr, t);
      }
      return t;
    };

    // costByCurrency splits totalCost by trade currency, so the summary converts each part at its own rate.
    const cumulativeCostMap = new Map<string, { shares: number; totalCost: number; costByCurrency: Map<string, number> }>();
    // Cash ledger per transaction currency, converted to the base currency once FX is known.
    const cashByCurrency = new Map<string, number>();
    const addCash = (tx: txRepo.TransactionRow, delta: number) => {
      const curr = (tx.currency || baseCurrency).trim();
      cashByCurrency.set(curr, (cashByCurrency.get(curr) ?? 0) + delta);
    };
    // Without any deposit the ledger is incomplete (a trades-only export), so
    // cash is clamped at zero instead of showing every buy as an overdraft.
    const hasFunding = transactions.some((tx) => INFLOW_TYPES.has(tx.type));

    for (const tx of transactions) {
      const amt = tx.amount ?? 0;
      const sh = tx.shares ?? 0;
      const pr = tx.price ?? 0;
      const sym = (tx.symbol || "").toUpperCase();
      const txNative = native((tx.currency || baseCurrency).trim());

      txNative.fees += absNum(tx.fee ?? 0);
      txNative.taxes += tx.tax ?? 0;
      addCash(tx, nonTradeCashFlow(tx));

      if (INFLOW_TYPES.has(tx.type)) {
        txNative.injected += absNum(amt);
      } else if (OUTFLOW_TYPES.has(tx.type)) {
        txNative.withdrawn += absNum(amt);
      } else if (tx.type === "DIVIDEND") {
        txNative.dividends += absNum(amt);
      } else if (tx.type === "INTEREST_PAYMENT") {
        txNative.interest += absNum(amt);
      } else if (isBuyTransaction(tx)) {
        if (sym && sym !== "CASH") {
          let pos = cumulativeCostMap.get(sym);
          if (!pos) {
            pos = { shares: 0, totalCost: 0, costByCurrency: new Map() };
            cumulativeCostMap.set(sym, pos);
          }
          let cost = 0;
          if (absNum(amt) > 0) {
            cost = absNum(amt);
          } else if (pos.totalCost > 0 && pos.shares === 0 && sh > 0) {
            cost = 0;
          } else {
            cost = pr * sh;
          }
          pos.shares += sh;
          pos.totalCost += cost;
          const curr = (tx.currency || baseCurrency).trim();
          pos.costByCurrency.set(curr, (pos.costByCurrency.get(curr) ?? 0) + cost);
          addCash(tx, -cost);
        }
      } else if (tx.type === "SELL") {
        const proceeds = absNum(amt) > 0 ? absNum(amt) : pr * absNum(sh);
        if (sym && sym !== "CASH") addCash(tx, proceeds);
        if (sym && sym !== "CASH" && cumulativeCostMap.has(sym)) {
          const pos = cumulativeCostMap.get(sym)!;
          if (pos.shares > 0) {
            const avgCost = pos.totalCost / pos.shares;
            const costBasisOfSold = absNum(sh) * avgCost;
            // Proceeds count in the trade currency, the sold cost in each currency it was bought in.
            txNative.realizedPnL += proceeds;
            for (const [curr, cost] of pos.costByCurrency) {
              const soldCost = absNum(sh) * (cost / pos.shares);
              native(curr).realizedPnL -= soldCost;
              pos.costByCurrency.set(curr, cost - soldCost);
            }

            pos.shares -= absNum(sh);
            pos.totalCost -= costBasisOfSold;
            if (pos.shares <= 0.000001) {
              pos.shares = 0;
              pos.totalCost = 0;
              pos.costByCurrency.clear();
            }
          }
        }
      }
    }

    if (holdingsConfig.length === 0 && transactions.length === 0) {
      return {
        summary: {
          totalValue: 0,
          totalCost: 0,
          totalGainLossDollar: 0,
          totalGainLossPercent: 0,
          dayGainLossDollar: 0,
          dayGainLossPercent: 0,
          totalGainSinceStartDollar: 0,
          totalGainSinceStartPercent: 0,
          totalCashInjected: 0,
          totalCashWithdrawn: 0,
          cashBalance: 0,
          totalPortfolioValue: 0,
          realizedPnL: 0,
          totalDividends: 0,
          totalInterest: 0,
          totalFees: 0,
          totalTaxes: 0,
          stockWeightPercent: 0,
          etfWeightPercent: 0,
          cryptoWeightPercent: 0,
          otherWeightPercent: 0,
          cashWeightPercent: 0,
          baseCurrency,
          lastUpdated: new Date().toISOString(),
        },
        holdings: [],
        chartHistory: [],
        individualCharts: {},
        transactions,
      };
    }

    // The user's price or NAV per private holding, in place of the buy price.
    const manualPrices = new Map<string, ManualPrice>();
    const privateSymbols = new Set(holdingsConfig.filter(isPrivateHolding).map((h) => h.symbol.toUpperCase()));
    for (const row of manualPriceRepo.findByPortfolio(portfolio.id)) {
      if (privateSymbols.has(row.symbol)) manualPrices.set(row.symbol, { price: row.price, currency: row.currency, setAt: row.setAt });
    }
    const publicSymbols = publicSymbolsOf(holdingsConfig);

    const individualCharts: Record<string, { date: string; close: number }[]> = {};
    const chartHistories: Map<string, { date: string; close: number }[]> = new Map();
    const quotesMap = new Map<string, YahooQuote>();

    // 1. A forced refresh asks only for fresh quotes, in batches (FMP: 50 symbols a call). Daily
    // history changes once a day, so the charts below come from their caches and get the live price.
    let liveQuotes = new Map<string, YahooQuote>();
    if (forceFresh && prefetchedQuotes) {
      for (const sym of publicSymbols) {
        const quote = prefetchedQuotes.get(sym);
        if (quote) liveQuotes.set(sym, quote);
      }
    } else if (forceFresh && publicSymbols.length > 0) {
      const liveTimer = appLogger.startTimer("portfolio", "fetch_live_quotes", `Refreshing quotes for ${publicSymbols.length} symbols`);
      try {
        liveQuotes = await this.yahoo.getQuotes(publicSymbols, true);
        liveTimer.end("info", `Quotes refreshed (${liveQuotes.size}/${publicSymbols.length})`);
      } catch (e) {
        liveTimer.end("warning", `Quote refresh failed (${errorName(e)})`);
      }
    }

    // 2. The 1y daily chart of each symbol; without a live quote, its last candle gives the quote.
    try {
      await this.yahoo.prefetchChartQuotes?.(publicSymbols);
    } catch {
      // Each chart asks for its own quote instead.
    }
    const chartFetchTimer = appLogger.startTimer(
      "portfolio",
      "fetch_charts",
      `Fetching 1y daily charts for ${publicSymbols.length} symbols`,
    );
    await mapWithConcurrencyLimit(publicSymbols, 8, async (sym) => {
      const live = liveQuotes.get(sym);
      if (live) quotesMap.set(sym, live);
      try {
        const chart = await this.yahoo.getChart(sym, "1y", "1d");
        const points = chart?.candles?.map((c) => ({ date: c.date, close: c.close })) || [];
        if (live) applyLiveClose(points, live);
        chartHistories.set(sym, points);
        individualCharts[sym] = points;

        if (live) {
          // The instrument type refines the asset type; an FMP quote has none, a Yahoo chart does.
          if (!live.instrumentType && chart?.instrumentType) quotesMap.set(sym, { ...live, instrumentType: chart.instrumentType });
        } else {
          const extracted = extractQuoteFromChart(chart);
          if (extracted) quotesMap.set(sym, extracted);
        }
      } catch (e) {
        appLogger.logStep("warning", "portfolio", "chart_fetch_error", `Chart fetch failed for one symbol (${errorName(e)})`);
        chartHistories.set(sym, []);
        individualCharts[sym] = [];
      }
    });
    chartFetchTimer.end("info", `Completed charts fetch (${quotesMap.size}/${publicSymbols.length} quotes)`);

    // 3. Symbols still without a quote: the quote caches, then the providers. A forced refresh
    // already asked the providers for every symbol above, so this pass does not force again.
    const missingSymbols = publicSymbols.filter((sym) => !quotesMap.has(sym));
    if (missingSymbols.length > 0) {
      const fallbackTimer = appLogger.startTimer(
        "portfolio",
        "fetch_fallback_quotes",
        `Fetching fallback quotes for ${missingSymbols.length} symbols`,
      );
      try {
        const fallbackQuotes = await this.yahoo.getQuotes(missingSymbols);
        for (const [sym, q] of fallbackQuotes) {
          quotesMap.set(sym, q);
        }
        fallbackTimer.end("info", `Fallback quotes resolved (${fallbackQuotes.size}/${missingSymbols.length})`);
      } catch (e) {
        fallbackTimer.end("error", `Fallback quotes fetch failed (${errorName(e)})`);
        // Continue with available quotes or transaction cost basis
      }
    }

    const quoteCurrencies = Array.from(
      new Set(
        [
          ...Array.from(quotesMap.values()).map((q) => q.currency),
          ...holdingsConfig.map((h) => h.currency),
          ...Array.from(manualPrices.values()).map((m) => m.currency),
          ...cashByCurrency.keys(),
        ].filter(Boolean) as string[]
      )
    );
    const fxTimer = appLogger.startTimer(
      "portfolio",
      "fetch_fx_rates",
      `Resolving FX rates from ${baseCurrency} to: ${quoteCurrencies.join(", ")}`,
    );
    const fxRates = await this.yahoo.getExchangeRates(baseCurrency, quoteCurrencies, forceFresh);
    fxTimer.end("info", `FX rates resolved for ${fxRates.size} currency pairs`);

    const toBase = (curr: string) => fxRates.get(curr) ?? 1;
    let totalCashInjected = 0;
    let totalCashWithdrawn = 0;
    let realizedPnL = 0;
    let totalDividends = 0;
    let totalInterest = 0;
    let totalFees = 0;
    let totalTaxes = 0;
    for (const [curr, t] of nativeByCurrency) {
      const rate = toBase(curr);
      totalCashInjected += t.injected * rate;
      totalCashWithdrawn += t.withdrawn * rate;
      realizedPnL += t.realizedPnL * rate;
      totalDividends += t.dividends * rate;
      totalInterest += t.interest * rate;
      totalFees += t.fees * rate;
      totalTaxes += t.taxes * rate;
    }
    // The rate of the trade currencies, as the history converts each trade. One currency takes its rate;
    // several take the blend of their converted cost. Holdings without trades fall back to the holding's currency.
    const tradeCostRate = (sym: string): number | undefined => {
      const pos = cumulativeCostMap.get(sym);
      if (!pos || pos.costByCurrency.size === 0) return undefined;
      if (pos.costByCurrency.size === 1) return toBase(pos.costByCurrency.keys().next().value!);
      if (!(pos.totalCost > 0)) return undefined;
      let baseCost = 0;
      for (const [curr, cost] of pos.costByCurrency) baseCost += cost * toBase(curr);
      return baseCost / pos.totalCost;
    };

    let totalValue = 0;
    let totalCost = 0;
    let totalPreviousValue = 0;
    let stockValue = 0;
    let etfValue = 0;
    let cryptoValue = 0;
    let otherValue = 0;

    const holdings: HoldingPerformance[] = [];

    for (const config of holdingsConfig) {
      const sym = config.symbol.toUpperCase();
      const isPrivate = isPrivateHolding(config);
      const quote = isPrivate ? undefined : quotesMap.get(sym);
      const manualPrice = isPrivate ? manualPrices.get(sym) : undefined;
      const shares = config.shares ?? 0;
      const buyPrice = config.buyPrice ?? 0;

      const nativeCurrency = manualPrice?.currency || quote?.currency || config.currency || baseCurrency;
      const fxRate = fxRates.get(nativeCurrency);
      const fxMissing = fxRate === undefined && nativeCurrency.toUpperCase() !== baseCurrency.toUpperCase();
      const fxMultiplier = fxRate ?? 1;

      const rawNativePrice = manualPrice?.price ?? quote?.regularMarketPrice ?? buyPrice;
      const rawNativePrevClose = quote?.previousClose ?? rawNativePrice;

      const currentPrice = rawNativePrice * fxMultiplier;
      const prevClose = isPrivate ? currentPrice : rawNativePrevClose * fxMultiplier;

      // The cost stays in the trade currency, which the quote or a manual price may not share.
      const costFx = manualPrice ? fxRates.get(config.currency || baseCurrency) ?? 1 : fxMultiplier;
      const costMultiplier = tradeCostRate(sym) ?? ((!config.currency || config.currency === baseCurrency) ? 1 : costFx);
      const itemCost = shares * buyPrice * costMultiplier;
      const itemValue = shares * currentPrice;
      const itemPrevValue = shares * prevClose;

      totalCost += itemCost;
      totalValue += itemValue;
      totalPreviousValue += itemPrevValue;

      // A stored ETF, fund or crypto class wins. Stock is also the default for a
      // missing class, so the provider's instrument type may refine it.
      const providerType = assetTypeFromInstrument(quote?.instrumentType);
      let assetType = config.assetType;
      if (assetType === "Stock" && !isPrivate && providerType) assetType = providerType;
      if (!assetType) {
        if (isPrivate) assetType = "Other";
        else if (providerType) assetType = providerType;
        else if (sym.endsWith(".DE")) assetType = "ETF";
        else if (sym.includes("BTC")) assetType = "Crypto";
        else assetType = "Stock";
      }

      if (assetType === "ETF" || assetType === "MutualFund") etfValue += itemValue;
      else if (assetType === "Crypto") cryptoValue += itemValue;
      else if (assetType === "Other") otherValue += itemValue;
      else stockValue += itemValue;

      const dayChangeDollar = isPrivate ? 0 : (currentPrice - prevClose) * shares;
      const dayChangePercent = isPrivate
        ? 0
        : prevClose > 0
        ? ((currentPrice - prevClose) / prevClose) * 100
        : 0;

      const totalGainLossDollar = itemValue - itemCost;
      const totalGainLossPercent = itemCost > 0 ? (totalGainLossDollar / itemCost) * 100 : 0;

      const history = isPrivate ? [] : (chartHistories.get(sym) ?? []);
      const closes = history.map((h) => h.close);
      const sma50 = closes.length >= 50 ? computeSMA(closes, 50) : undefined;
      const sma200 = closes.length >= 200 ? computeSMA(closes, 200) : undefined;
      const rsi = computeRSI(closes);

      holdings.push({
        symbol: sym,
        name: config.name || quote?.longName || quote?.shortName || sym,
        isin: config.isin,
        assetType,
        isPrivate,
        quoteMissing: !isPrivate && !quote ? true : undefined,
        fxMissing: fxMissing || undefined,
        manualPrice,
        shares,
        buyPrice,
        currentPrice: Number(currentPrice.toFixed(2)),
        previousClose: Number(prevClose.toFixed(2)),
        totalCost: Number(itemCost.toFixed(2)),
        currentValue: Number(itemValue.toFixed(2)),
        dayChangeDollar: Number(dayChangeDollar.toFixed(2)),
        dayChangePercent: Number(dayChangePercent.toFixed(2)),
        totalGainLossDollar: Number(totalGainLossDollar.toFixed(2)),
        totalGainLossPercent: Number(totalGainLossPercent.toFixed(2)),
        weightPercent: 0,
        currency: baseCurrency,
        nativePrice: Number(rawNativePrice.toFixed(2)),
        nativeCurrency,
        fxRate: fxMultiplier !== 1 && fxMultiplier > 0 ? Number((1 / fxMultiplier).toFixed(4)) : undefined,
        fiftyTwoWeekHigh: quote?.fiftyTwoWeekHigh ? Number((quote.fiftyTwoWeekHigh * fxMultiplier).toFixed(2)) : undefined,
        fiftyTwoWeekLow: quote?.fiftyTwoWeekLow ? Number((quote.fiftyTwoWeekLow * fxMultiplier).toFixed(2)) : undefined,
        sma50: sma50 ? Number((sma50 * fxMultiplier).toFixed(2)) : undefined,
        sma200: sma200 ? Number((sma200 * fxMultiplier).toFixed(2)) : undefined,
        rsi: rsi !== undefined ? Number(rsi.toFixed(2)) : undefined,
      });
    }

    let cashBalance = 0;
    for (const [curr, native] of cashByCurrency) cashBalance += native * toBase(curr);
    if (!hasFunding) cashBalance = Math.max(0, cashBalance);
    cashBalance = Number(cashBalance.toFixed(2));

    const totalPortfolioValue = Number((totalValue + cashBalance).toFixed(2));
    const allocDenominator = totalPortfolioValue > 0 ? totalPortfolioValue : (totalValue > 0 ? totalValue : 1);

    for (const h of holdings) {
      h.weightPercent = Number(((h.currentValue / allocDenominator) * 100).toFixed(2));
    }

    const stockWeightPercent = Number(((stockValue / allocDenominator) * 100).toFixed(2));
    const etfWeightPercent = Number(((etfValue / allocDenominator) * 100).toFixed(2));
    const cryptoWeightPercent = Number(((cryptoValue / allocDenominator) * 100).toFixed(2));
    const otherWeightPercent = Number(((otherValue / allocDenominator) * 100).toFixed(2));
    const cashWeightPercent = cashBalance > 0 ? Number(((cashBalance / allocDenominator) * 100).toFixed(2)) : 0;

    holdings.sort((a, b) => b.currentValue - a.currentValue);

    if (cashBalance > 0.001) {
      holdings.push({
        symbol: "CASH",
        name: `Available Liquidity (${baseCurrency})`,
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
        weightPercent: cashWeightPercent,
        currency: baseCurrency,
      });
    }

    const totalGainLossDollar = totalValue - totalCost;
    const totalGainLossPercent = totalCost > 0 ? (totalGainLossDollar / totalCost) * 100 : 0;
    const dayGainLossDollar = totalValue - totalPreviousValue;
    const dayGainLossPercent = totalPreviousValue > 0 ? (dayGainLossDollar / totalPreviousValue) * 100 : 0;

    const totalGainSinceStartDollar = (totalValue - totalCost) + realizedPnL + totalDividends + totalInterest - totalFees;
    const capitalDenominator = totalCost > 0 ? totalCost : (totalCashInjected > 0 ? totalCashInjected : 1);
    const totalGainSinceStartPercent = (totalGainSinceStartDollar / capitalDenominator) * 100;

    const sortedByDayChange = [...holdings.filter((h) => h.assetType !== "Cash")].sort((a, b) => b.dayChangePercent - a.dayChangePercent);
    const bestPerformer = sortedByDayChange.length > 0 ? { symbol: sortedByDayChange[0]!.symbol, changePercent: sortedByDayChange[0]!.dayChangePercent } : undefined;
    const worstPerformer = sortedByDayChange.length > 1 ? { symbol: sortedByDayChange[sortedByDayChange.length - 1]!.symbol, changePercent: sortedByDayChange[sortedByDayChange.length - 1]!.dayChangePercent } : undefined;

    const allDatesSet = new Set<string>();
    for (const points of chartHistories.values()) {
      for (const p of points) {
        allDatesSet.add(p.date);
      }
    }
    for (const tx of transactions) {
      const tDate = (tx.date || tx.datetime || "").split("T")[0];
      if (tDate) allDatesSet.add(tDate);
    }
    allDatesSet.add(new Date().toISOString().split("T")[0]!);
    const sortedDates = Array.from(allDatesSet).sort((a, b) => a.localeCompare(b));

    const chartHistory: PortfolioHistoricalPoint[] = [];
    const currentPriceMap = new Map<string, number>();

    const dateCloseMaps = new Map<string, Map<string, number>>();
    for (const [sym, points] of chartHistories.entries()) {
      const m = new Map<string, number>();
      for (const p of points) m.set(p.date, p.close);
      dateCloseMaps.set(sym, m);
    }

    // The charts cover the last year. A day inside it before a symbol's first close (a holiday, another
    // exchange's calendar) takes that close. Before the year the price is unknown, so a holding counts at cost.
    const yearAgo = new Date();
    yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
    const chartStart = yearAgo.toISOString().split("T")[0]!;
    let chartStarted = false;

    // cost is in the transaction currency. baseCost converts it to the base currency like the cash ledger;
    // the history's value and cost both use it.
    const activeSharesOnDate = new Map<string, { shares: number; cost: number; baseCost: number }>();
    let histCash = 0;
    let txPointer = 0;

    for (const d of sortedDates) {
      if (!chartStarted && d >= chartStart) {
        chartStarted = true;
        for (const [sym, points] of chartHistories.entries()) {
          if (points.length > 0 && !currentPriceMap.has(sym)) currentPriceMap.set(sym, points[0]!.close);
        }
      }
      for (const [sym, dateMap] of dateCloseMaps.entries()) {
        const close = dateMap.get(d);
        if (close !== undefined) {
          currentPriceMap.set(sym, close);
        }
      }

      while (txPointer < transactions.length) {
        const tx = transactions[txPointer]!;
        const tDate = (tx.date || tx.datetime || "").split("T")[0]!;
        if (tDate > d) break;
        txPointer++;

        const sym = (tx.symbol || "").toUpperCase();
        const shares = tx.shares ?? 0;
        const amount = tx.amount ?? 0;
        const price = tx.price ?? 0;
        const txType = tx.type;
        const txFx = toBase((tx.currency || baseCurrency).trim());

        histCash += nonTradeCashFlow(tx) * txFx;

        if (isBuyTransaction(tx)) {
          if (sym && sym !== "CASH") {
            let entry = activeSharesOnDate.get(sym);
            if (!entry) {
              entry = { shares: 0, cost: 0, baseCost: 0 };
              activeSharesOnDate.set(sym, entry);
            }

            let cost = 0;
            if (absNum(amount) > 0) {
              cost = absNum(amount);
            } else if (entry.cost > 0 && entry.shares === 0 && shares > 0) {
              cost = 0;
            } else {
              cost = price * shares;
            }

            entry.shares += shares;
            entry.cost += cost;
            entry.baseCost += cost * txFx;
            histCash -= cost * txFx;
          }
        } else if (txType === "SELL") {
          if (sym && sym !== "CASH") {
            const proceeds = absNum(amount) > 0 ? absNum(amount) : price * absNum(shares);
            histCash += proceeds * txFx;
            const entry = activeSharesOnDate.get(sym);
            if (entry && entry.shares > 0) {
              const avgCost = entry.cost / entry.shares;
              const costOfSold = absNum(shares) * avgCost;
              entry.baseCost -= absNum(shares) * (entry.baseCost / entry.shares);

              entry.shares -= absNum(shares);
              entry.cost -= costOfSold;
              if (entry.shares <= 0.000001) {
                entry.shares = 0;
                entry.cost = 0;
                entry.baseCost = 0;
              }
            }
          }
        }
      }

      let valOnDate = 0;
      let costOnDate = 0;

      for (const [sym, holding] of activeSharesOnDate.entries()) {
        if (holding.shares > 0) {
          const quote = quotesMap.get(sym);
          // A manual price counts from the day it was entered; before that the holding stays at cost.
          const manual = manualPrices.get(sym);
          const manualApplies = manual !== undefined && d >= manual.setAt;
          const nativeCurr = manualApplies ? manual.currency : quote?.currency || baseCurrency;
          const fxMult = fxRates.get(nativeCurr) ?? 1;
          const close = currentPriceMap.get(sym);
          // Without a price (before its chart starts, no chart, no manual price yet) the holding counts at cost.
          const priced = manualApplies || close !== undefined;
          const price = (manualApplies ? manual.price : close ?? 0) * fxMult;
          valOnDate += priced ? holding.shares * price : holding.baseCost;
          costOnDate += holding.baseCost;
        }
      }

      const cashOnDate = hasFunding ? histCash : Math.max(0, histCash);

      if (valOnDate > 0 || costOnDate > 0 || cashOnDate > 0) {
        chartHistory.push({
          date: d,
          timestamp: new Date(d).getTime(),
          totalValue: Number(valOnDate.toFixed(2)),
          totalCost: Number(costOnDate.toFixed(2)),
          totalGainLoss: Number((valOnDate - costOnDate).toFixed(2)),
          cashBalance: Number(cashOnDate.toFixed(2)),
          totalPortfolioValue: Number((valOnDate + cashOnDate).toFixed(2)),
        });
      }
    }

    const summary: PortfolioSummary = {
      totalValue: Number(totalValue.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
      totalGainLossDollar: Number(totalGainLossDollar.toFixed(2)),
      totalGainLossPercent: Number(totalGainLossPercent.toFixed(2)),
      dayGainLossDollar: Number(dayGainLossDollar.toFixed(2)),
      dayGainLossPercent: Number(dayGainLossPercent.toFixed(2)),

      totalGainSinceStartDollar: Number(totalGainSinceStartDollar.toFixed(2)),
      totalGainSinceStartPercent: Number(totalGainSinceStartPercent.toFixed(2)),
      totalCashInjected: Number(totalCashInjected.toFixed(2)),
      totalCashWithdrawn: Number(totalCashWithdrawn.toFixed(2)),
      cashBalance: Number(cashBalance.toFixed(2)),
      totalPortfolioValue: Number(totalPortfolioValue.toFixed(2)),
      realizedPnL: Number(realizedPnL.toFixed(2)),
      totalDividends: Number(totalDividends.toFixed(2)),
      totalInterest: Number(totalInterest.toFixed(2)),
      totalFees: Number(totalFees.toFixed(2)),
      totalTaxes: Number(totalTaxes.toFixed(2)),

      bestPerformer,
      worstPerformer,
      stockWeightPercent,
      etfWeightPercent,
      cryptoWeightPercent,
      otherWeightPercent,
      cashWeightPercent,
      baseCurrency,
      lastUpdated: new Date().toISOString(),
    };

    return {
      summary,
      holdings,
      chartHistory,
      individualCharts,
      transactions,
    };
  }

  public saveDailySnapshot(portfolioOrId: string | portfolioRepo.PortfolioRow, data: FinancialPortfolioData): snapshotRepo.SnapshotRow {
    const id = typeof portfolioOrId === "string" ? portfolioOrId : portfolioOrId.id;
    const today = new Date().toISOString().split("T")[0]!;
    
    return snapshotRepo.upsert({
      portfolioId: id,
      date: today,
      timestamp: Date.now(),
      totalValue: data.summary.totalValue,
      totalCost: data.summary.totalCost,
      totalGainLoss: data.summary.totalGainLossDollar,
      cashBalance: data.summary.cashBalance,
      totalPortfolioValue: data.summary.totalPortfolioValue,
      holdingsJson: JSON.stringify(data.holdings.map((h) => ({
        symbol: h.symbol,
        shares: h.shares,
        price: h.currentPrice,
        val: h.currentValue,
      }))),
    });
  }

  /** Replace ISIN-only symbols with tickers. A failed lookup leaves the ISIN in place. */
  private async resolveImportSymbols(transactions: Partial<txRepo.TransactionInput>[], baseCurrency: string): Promise<void> {
    if (!this.symbols) return;
    try {
      await this.symbols.applyToTransactions(transactions, baseCurrency || "EUR");
    } catch {
      appLogger.logStep("warning", "portfolio", "symbol_resolve", "ISIN lookup failed; imported symbols kept as sent");
    }
  }

  /**
   * Look up tickers for stored transactions that still carry an ISIN as their
   * symbol (imports from before the lookup existed, or a provider that was down).
   */
  public async resolvePortfolioSymbols(portfolioId: string): Promise<{ success: boolean; updated: number; error?: string }> {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) return { success: false, updated: 0, error: "Portfolio not found" };
    if (!this.symbols) return { success: true, updated: 0 };
    const transactions = txRepo.findByPortfolio(portfolio.id);
    const changed = await this.symbols.applyToTransactions(transactions, portfolio.baseCurrency || "EUR");
    if (changed.length > 0) {
      txRepo.bulkUpdate(changed.map((t) => ({ id: t.id, data: { symbol: t.symbol, isin: t.isin, name: t.name } })));
      this.clearPortfolioCache(portfolio.id);
    }
    return { success: true, updated: changed.length };
  }

  /** Set the ticker of an ISIN by hand, for every portfolio that holds it. */
  public setSymbolForIsin(isin: string, symbol: string, name?: string | null): { success: boolean; portfolios: number; error?: string } {
    if (!this.symbols) return { success: false, portfolios: 0, error: "Symbol lookup unavailable" };
    const changed = this.symbols.setManualSymbol(isin, symbol, name);
    for (const id of changed) this.clearPortfolioCache(id);
    return { success: true, portfolios: changed.length };
  }

  /**
   * Store the user's price or NAV for a private holding. `buildPortfolioData`
   * values the holding with it in place of the buy price.
   */
  public setManualPrice(
    portfolioId: string,
    symbol: string,
    price: number,
    currency?: string,
  ): { success: boolean; manualPrice?: ManualPrice; error?: string } {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) return { success: false, error: "Portfolio not found" };
    if (!Number.isFinite(price) || price <= 0) return { success: false, error: "The price must be a positive number" };
    const sym = symbol.trim().toUpperCase();
    const holding = this.computeHoldingsFromTransactions(txRepo.findByPortfolio(portfolio.id)).find((h) => h.symbol === sym);
    if (!holding) return { success: false, error: "Holding not found" };
    if (!isPrivateHolding(holding)) return { success: false, error: "Only a private holding takes a manual price" };

    const row = manualPriceRepo.upsert({
      portfolioId: portfolio.id,
      symbol: sym,
      price,
      currency: (currency || holding.currency || portfolio.baseCurrency || "EUR").trim().toUpperCase(),
      setAt: new Date().toISOString().slice(0, 10),
    });
    this.clearPortfolioCache(portfolio.id);
    appLogger.logStep("info", "portfolio", "manual_price_set", "Manual price saved for one private holding", undefined, {
      portfolioId: portfolio.id,
    });
    return { success: true, manualPrice: { price: row.price, currency: row.currency, setAt: row.setAt } };
  }

  /** Drop the user's price; the holding goes back to its buy price. */
  public clearManualPrice(portfolioId: string, symbol: string): { success: boolean; error?: string } {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) return { success: false, error: "Portfolio not found" };
    if (manualPriceRepo.remove(portfolio.id, symbol.trim())) {
      this.clearPortfolioCache(portfolio.id);
      appLogger.logStep("info", "portfolio", "manual_price_clear", "Manual price cleared for one private holding", undefined, {
        portfolioId: portfolio.id,
      });
    }
    return { success: true };
  }

  public async manageTransactions(
    portfolioOrId: string | portfolioRepo.PortfolioRow,
    payload: any
  ): Promise<{
    success: boolean;
    action: string;
    totalTransactions: number;
    newTransactionsCount?: number;
    modifiedTransactionsCount?: number;
    unchangedTransactionsCount?: number;
    addedPreview?: txRepo.TransactionRow[];
    modifiedPreview?: { tx: txRepo.TransactionRow; diffs: { field: string; oldVal: unknown; newVal: unknown }[] }[];
    unchangedPreview?: txRepo.TransactionRow[];
    transaction?: txRepo.TransactionRow;
    error?: string;
  }> {
    const portfolio = typeof portfolioOrId === "string" ? portfolioRepo.findById(portfolioOrId) : portfolioOrId;
    if (!portfolio) {
      return { success: false, action: payload?.action || "unknown", totalTransactions: 0, error: "Portfolio not found" };
    }
    const action = payload?.action || "add";
    const isDryRun = Boolean(payload?.dryRun);
    const txData = payload?.transaction as Partial<txRepo.TransactionInput> | undefined;
    const targetId = payload?.transactionId || txData?.id;

    if (action === "add" && txData) {
      await this.resolveImportSymbols([txData], portfolio.baseCurrency);
      const id = this.mintPortfolioTransactionId(txData.id, portfolio.id);
      const dataToSave = { ...txData, id, portfolioId: portfolio.id } as Parameters<typeof txRepo.create>[0];
      let entity = txData as txRepo.TransactionRow;
      if (!isDryRun) {
        entity = txRepo.create(dataToSave);
        this.clearPortfolioCache(portfolio.id);
      }
      const count = txRepo.countByPortfolio(portfolio.id);
      return { success: true, action: "add", totalTransactions: count, transaction: entity };
    }

    if (action === "edit" && targetId && txData) {
      const existing = txRepo.findById(targetId);
      if (!existing || existing.portfolioId !== portfolio.id) {
        return { success: false, action: "edit", totalTransactions: 0, error: "Transaction not found" };
      }
      let saved = existing;
      if (!isDryRun) {
        saved = txRepo.update(targetId, txData) || existing;
        this.clearPortfolioCache(portfolio.id);
      }
      const count = txRepo.countByPortfolio(portfolio.id);
      return { success: true, action: "edit", totalTransactions: count, transaction: saved };
    }

    if (action === "delete" && targetId) {
      const existing = txRepo.findById(targetId);
      if (!existing || existing.portfolioId !== portfolio.id) {
        return { success: false, action: "delete", totalTransactions: 0, error: "Transaction not found" };
      }
      if (!isDryRun) {
        txRepo.deleteById(targetId);
        this.clearPortfolioCache(portfolio.id);
      }
      const count = txRepo.countByPortfolio(portfolio.id);
      return { success: true, action: "delete", totalTransactions: count };
    }

    if (action === "import" || action === "batch_add") {
      const batchList = (payload?.transactions || payload?.items) as Partial<txRepo.TransactionInput>[];
      if (!Array.isArray(batchList)) {
        return { success: false, action: "import", totalTransactions: 0, error: "No transactions list provided" };
      }

      await this.resolveImportSymbols(batchList, portfolio.baseCurrency);

      const existingTransactions = await this.getTransactions(portfolio);
      const existingTxMap = new Map<string, txRepo.TransactionRow>();
      for (const t of existingTransactions) {
        existingTxMap.set(t.id, t);
      }

      let newCount = 0;
      let modCount = 0;
      let unchCount = 0;
      const addedPreview: txRepo.TransactionRow[] = [];
      const modifiedPreview: { tx: txRepo.TransactionRow; diffs: { field: string; oldVal: unknown; newVal: unknown }[] }[] = [];
      const unchangedPreview: txRepo.TransactionRow[] = [];
      const toSaveNew: Parameters<typeof txRepo.create>[0][] = [];
      const toSaveUpdate: {id: string, data: Partial<txRepo.TransactionInput>}[] = [];

      const fieldsToCheck: (keyof txRepo.TransactionRow)[] = [
        "date",
        "datetime",
        "type",
        "symbol",
        "isin",
        "name",
        "assetClass",
        "shares",
        "price",
        "amount",
        "fee",
        "tax",
        "currency",
      ];

      const candidateIds = batchList.map(
        (t) => t.id || `tx_${t.date || "nodate"}_${t.type || "notype"}_${t.symbol || "nosym"}_${t.amount ?? ""}_${t.shares ?? ""}`,
      );
      const matches = candidateIds.map(
        (candidateId) => existingTxMap.get(candidateId) ?? existingTxMap.get(this.scopedTransactionId(candidateId, portfolio.id)),
      );
      // A row without a broker id gets a "tx_" id from its place in the file, so an export
      // that covers more days gives the same row a new id. Such rows match a stored row
      // with a generated id on their content, each stored row once.
      const fingerprint = (t: Partial<txRepo.TransactionInput>) =>
        [String(t.date ?? "").slice(0, 10), t.type ?? "", (t.isin || t.symbol || "").toUpperCase(), t.amount ?? "", t.shares ?? ""].join("|");
      const claimed = new Set(matches.filter((m): m is txRepo.TransactionRow => m !== undefined).map((m) => m.id));
      const byFingerprint = new Map<string, txRepo.TransactionRow[]>();
      for (const t of existingTransactions) {
        if (!t.id.startsWith("tx_") || claimed.has(t.id)) continue;
        const key = fingerprint(t);
        byFingerprint.set(key, [...(byFingerprint.get(key) ?? []), t]);
      }
      batchList.forEach((t, i) => {
        if (matches[i] || !candidateIds[i]!.startsWith("tx_")) return;
        const match = byFingerprint.get(fingerprint(t))?.find((row) => !claimed.has(row.id));
        if (match) {
          matches[i] = match;
          claimed.add(match.id);
        }
      });

      for (const [i, t] of batchList.entries()) {
        const candidateId = candidateIds[i]!;
        const existing = matches[i];

        const id = existing ? existing.id : this.mintPortfolioTransactionId(candidateId, portfolio.id);
        const formattedTx = { ...t, id, portfolioId: portfolio.id } as txRepo.TransactionRow;

        if (!existing) {
          newCount++;
          addedPreview.push(formattedTx);
          toSaveNew.push(formattedTx as any);
        } else {
          const diffs: { field: string; oldVal: unknown; newVal: unknown }[] = [];
          for (const f of fieldsToCheck) {
            const vNew = formattedTx[f];
            const vOld = existing[f];
            const normNew = normalizeComparisonValue(vNew);
            const normOld = normalizeComparisonValue(vOld);
            // An empty incoming field keeps the stored value (txRepo.update), so it is no change.
            if (normNew === undefined) continue;

            if (normNew !== normOld) {
              if (typeof normNew === "number" && typeof normOld === "number" && Math.abs(normNew - normOld) < 1e-6) {
                continue;
              }
              diffs.push({ field: f, oldVal: vOld, newVal: vNew });
            }
          }

          if (diffs.length > 0) {
            modCount++;
            modifiedPreview.push({ tx: formattedTx, diffs });
            toSaveUpdate.push({id: existing.id, data: formattedTx});
          } else {
            unchCount++;
            unchangedPreview.push(existing);
          }
        }
      }

      if (!isDryRun) {
        txRepo.saveImport(toSaveNew, toSaveUpdate);
        if (toSaveNew.length > 0 || toSaveUpdate.length > 0) {
          this.clearPortfolioCache(portfolio.id);
        }
      }

      const total = txRepo.countByPortfolio(portfolio.id);

      return {
        success: true,
        action: isDryRun ? "import_preview" : "import",
        totalTransactions: total,
        newTransactionsCount: newCount,
        modifiedTransactionsCount: modCount,
        unchangedTransactionsCount: unchCount,
        addedPreview,
        modifiedPreview,
        unchangedPreview,
      };
    }

    return { success: false, action, totalTransactions: 0, error: "Invalid action" };
  }
}
