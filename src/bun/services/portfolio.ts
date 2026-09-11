import * as crypto from "node:crypto";
import * as portfolioRepo from "../db/portfolio.repo.js";
import * as txRepo from "../db/transaction.repo.js";
import * as snapshotRepo from "../db/snapshot.repo.js";
import * as marketCache from "../db/market-cache.repo.js";
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
}
import { generateDemoTransactions, DEMO_ASSETS } from "./demo-portfolio.js";
import type {
  FinancialPortfolioData,
  HoldingPerformance,
  PortfolioHoldingConfig,
  PortfolioSummary,
  PortfolioHistoricalPoint,
} from "../../types/portfolio.js";
import { loadConfig } from "../config.js";
import { appLogger } from "../logger.js";

const CACHE_TTL_MS = 60 * 60 * 1000;

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

export class PortfolioService {
  private cache = new Map<string, { data: FinancialPortfolioData; timestamp: number }>();
  private inFlightRequests = new Map<string, Promise<FinancialPortfolioData>>();
  private cacheSweepHandle?: Timer;

  constructor(private readonly yahoo: IMarketDataProvider) {
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

  public clearPortfolioCache(portfolioId?: string) {
    if (!portfolioId) {
      this.cache.clear();
      this.inFlightRequests.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key === portfolioId || key.startsWith(`${portfolioId}_`)) {
        this.cache.delete(key);
        marketCache.deleteKey(`portfolio:${key}`);
      }
    }
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
          `Could not fetch live quotes for the demo portfolio (${err.message}); using reference prices`,
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

  public createPortfolio(data: { name: string; description?: string; baseCurrency?: string }): portfolioRepo.PortfolioRow {
    if (!data.name || !data.name.trim()) {
      throw new Error("Portfolio name is required");
    }

    const config = loadConfig();
    return portfolioRepo.create({
      name: data.name.trim(),
      description: data.description?.trim() || null,
      baseCurrency: data.baseCurrency || config.baseCurrency || process.env.BASE_CURRENCY || "EUR",
    });
  }

  public updatePortfolio(
    portfolioId: string,
    data: { name?: string; description?: string; baseCurrency?: string }
  ): portfolioRepo.PortfolioRow {
    const portfolio = this.getPortfolio(portfolioId);
    if (data.name !== undefined && !data.name.trim()) {
      throw new Error("Portfolio name cannot be empty");
    }

    const saved = portfolioRepo.update(portfolioId, data);
    this.clearPortfolioCache(portfolioId);
    return saved!;
  }

  public deletePortfolio(portfolioId: string): boolean {
    const portfolio = portfolioRepo.findById(portfolioId);
    if (!portfolio) {
      throw new Error("Portfolio not found");
    }

    portfolioRepo.deleteById(portfolioId);
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
    forceFresh = false
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
        appLogger.logStep("info", "portfolio", "cache_hit_memory", `Memory cache hit for ${portfolio.name}`, undefined, {
          cacheKey,
          ageSeconds: Math.round((now - cached.timestamp) / 1000),
        });
        return cached.data;
      }

      // 2. Check persistent SQLite cache (instant return on app restart)
      const diskCached = marketCache.get<FinancialPortfolioData>(`portfolio:${cacheKey}`);
      if (diskCached?.data) {
        this.cache.set(cacheKey, { data: diskCached.data, timestamp: now });
        appLogger.logStep(
          "info",
          "portfolio",
          "cache_hit_disk",
          `Disk cache hit for ${portfolio.name} (isExpired=${diskCached.isExpired})`,
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
      appLogger.logStep("info", "portfolio", "in_flight_dedup", `Joining existing in-flight request for ${portfolio.name}`, undefined, { cacheKey });
      return existingPromise;
    }

    appLogger.logStep(
      "info",
      "portfolio",
      "rebuild_start",
      `Starting portfolio calculation for ${portfolio.name} (${effectiveCurrency}, forceFresh=${forceFresh})`,
      undefined,
      { portfolioId: portfolio.id, currency: effectiveCurrency },
    );

    const computePromise = (async (): Promise<FinancialPortfolioData> => {
      const txTimer = appLogger.startTimer("portfolio", "get_transactions", `Fetching transactions for ${portfolio.name}`);
      const transactions = await this.getTransactions(portfolio);
      txTimer.end("info", `Retrieved ${transactions.length} transactions`, { count: transactions.length });

      const holdings = this.computeHoldingsFromTransactions(transactions);
      appLogger.logStep("info", "portfolio", "compute_holdings", `Computed ${holdings.length} holdings from transactions`, undefined, {
        holdingsCount: holdings.length,
        symbols: holdings.map((h) => h.symbol),
      });

      const buildTimer = appLogger.startTimer("portfolio", "build_data", `Building portfolio metrics and market quotes for ${portfolio.name}`);
      try {
        const data = await this.buildPortfolioData(portfolio, holdings, transactions, effectiveCurrency, forceFresh);
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
        marketCache.set(`portfolio:${cacheKey}`, data, CACHE_TTL_MS);
        buildTimer.end("success", `Portfolio built successfully for ${portfolio.name}`, {
          holdingsCount: data.holdings?.length ?? 0,
          totalValue: data.summary?.totalValue,
        });
        return data;
      } catch (err) {
        buildTimer.fail(err, `Build failed for ${portfolio.name}`);
        // If calculation/network failed, check if we have a stale disk cache to use offline
        const staleDisk = marketCache.get<FinancialPortfolioData>(`portfolio:${cacheKey}`);
        if (staleDisk && staleDisk.data) {
          appLogger.logStep("warning", "portfolio", "fallback_stale_disk", `Using stale disk cache for ${portfolio.name} after build failure`);
          return staleDisk.data;
        }
        throw err;
      }
    })().finally(() => {
      this.inFlightRequests.delete(cacheKey);
    });

    this.inFlightRequests.set(cacheKey, computePromise);
    return computePromise;
  }

  public computeHoldingsFromTransactions(transactions: txRepo.TransactionRow[]): PortfolioHoldingConfig[] {
    const activeHoldingsMap = new Map<
      string,
      {
        symbol: string;
        name: string;
        shares: number;
        totalCost: number;
        assetType: "Stock" | "ETF" | "MutualFund" | "Crypto" | "Cash" | "Other";
        currency?: string;
        isPrivate: boolean;
      }
    >();

    for (const tx of transactions) {
      const sym = (tx.symbol || "").toUpperCase();
      const shares = tx.shares ?? 0;
      const price = tx.price ?? 0;
      const amount = tx.amount ?? 0;

      if (tx.type === "BUY" || tx.type === "STOCKPERK" || tx.type === "PRIVATE_MARKET_BUY") {
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
            let assetType: "Stock" | "ETF" | "MutualFund" | "Crypto" | "Cash" | "Other" = "Stock";
            if (isPrivateTx) {
              assetType = "Other";
            } else if (tx.assetClass === "FUND") {
              assetType = "ETF";
            } else if (tx.assetClass === "CRYPTO" || sym.includes("BTC")) {
              assetType = "Crypto";
            } else if (tx.assetClass === "MUTUALFUND") {
              assetType = "MutualFund";
            }

            entry = {
              symbol: sym,
              name: tx.name || sym,
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
            }
            if (tx.currency) {
              entry.currency = tx.currency;
            }
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
        shares: Number(h.shares.toFixed(6)),
        buyPrice: Number((h.shares > 0 ? h.totalCost / h.shares : 0).toFixed(4)),
        assetType: h.assetType,
        isPrivate: h.isPrivate,
        currency: h.currency,
      }));
  }

  public async buildPortfolioData(
    _portfolio: portfolioRepo.PortfolioRow,
    holdingsConfig: PortfolioHoldingConfig[],
    transactions: txRepo.TransactionRow[],
    baseCurrency = "EUR",
    forceFresh = false
  ): Promise<FinancialPortfolioData> {
    let totalCashInjected = 0;
    let totalCashWithdrawn = 0;
    let realizedPnL = 0;
    let totalDividends = 0;
    let totalInterest = 0;
    let totalFees = 0;
    let totalTaxes = 0;

    const cumulativeCostMap = new Map<string, { shares: number; totalCost: number }>();

    for (const tx of transactions) {
      const amt = tx.amount ?? 0;
      const sh = tx.shares ?? 0;
      const pr = tx.price ?? 0;
      const sym = (tx.symbol || "").toUpperCase();

      const fee = absNum(tx.fee ?? 0);
      const tax = absNum(tx.tax ?? 0);
      totalFees += fee;
      totalTaxes += tax;

      if (tx.type === "CUSTOMER_INBOUND" || tx.type === "TRANSFER_INBOUND" || tx.type === "DEPOSIT") {
        totalCashInjected += absNum(amt);
      } else if (tx.type === "CUSTOMER_OUTBOUND" || tx.type === "TRANSFER_OUTBOUND" || tx.type === "WITHDRAWAL") {
        totalCashWithdrawn += absNum(amt);
      } else if (tx.type === "DIVIDEND") {
        totalDividends += absNum(amt);
      } else if (tx.type === "INTEREST_PAYMENT") {
        totalInterest += absNum(amt);
      } else if (tx.type === "BUY" || tx.type === "STOCKPERK" || tx.type === "PRIVATE_MARKET_BUY") {
        if (sym && sym !== "CASH") {
          let pos = cumulativeCostMap.get(sym);
          if (!pos) {
            pos = { shares: 0, totalCost: 0 };
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
        }
      } else if (tx.type === "SELL") {
        if (sym && sym !== "CASH" && cumulativeCostMap.has(sym)) {
          const pos = cumulativeCostMap.get(sym)!;
          if (pos.shares > 0) {
            const avgCost = pos.totalCost / pos.shares;
            const costBasisOfSold = absNum(sh) * avgCost;
            const proceeds = absNum(amt) > 0 ? absNum(amt) : pr * absNum(sh);
            const tradePnL = proceeds - costBasisOfSold;
            realizedPnL += tradePnL;

            pos.shares -= absNum(sh);
            pos.totalCost -= costBasisOfSold;
            if (pos.shares <= 0.000001) {
              pos.shares = 0;
              pos.totalCost = 0;
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

    const publicHoldings = holdingsConfig.filter(
      (h) => !h.isPrivate && h.assetType !== "Other" && h.symbol !== "CASH"
    );
    const publicSymbols = publicHoldings.map((h) => h.symbol);

    const individualCharts: Record<string, { date: string; close: number }[]> = {};
    const chartHistories: Map<string, { date: string; close: number }[]> = new Map();
    const quotesMap = new Map<string, YahooQuote>();

    // 1. Fetch 1y daily chart first; extract quote from chart directly to avoid redundant 5d queries
    const chartFetchTimer = appLogger.startTimer(
      "portfolio",
      "fetch_charts",
      `Fetching 1y daily charts for ${publicSymbols.length} symbols: ${publicSymbols.join(", ")}`,
    );
    await mapWithConcurrencyLimit(publicSymbols, 8, async (sym) => {
      try {
        const chart = await this.yahoo.getChart(sym, "1y", "1d", forceFresh);
        const points = chart?.candles?.map((c) => ({ date: c.date, close: c.close })) || [];
        chartHistories.set(sym, points);
        individualCharts[sym] = points;

        const extracted = extractQuoteFromChart(chart);
        if (extracted) {
          quotesMap.set(sym, extracted);
        }
      } catch (e) {
        appLogger.logStep("warning", "portfolio", "chart_fetch_error", `Chart fetch failed for ${sym}: ${e}`);
        chartHistories.set(sym, []);
        individualCharts[sym] = [];
      }
    });
    chartFetchTimer.end("info", `Completed charts fetch (${quotesMap.size}/${publicSymbols.length} quotes extracted)`);

    // 2. For any symbols where 1y chart didn't yield a quote, fall back to getQuotes (checks SQLite cache first)
    const missingSymbols = publicSymbols.filter((sym) => !quotesMap.has(sym));
    if (missingSymbols.length > 0) {
      const fallbackTimer = appLogger.startTimer(
        "portfolio",
        "fetch_fallback_quotes",
        `Fetching fallback quotes for ${missingSymbols.length} symbols: ${missingSymbols.join(", ")}`,
      );
      try {
        const fallbackQuotes = await this.yahoo.getQuotes(missingSymbols, forceFresh);
        for (const [sym, q] of fallbackQuotes) {
          quotesMap.set(sym, q);
        }
        fallbackTimer.end("info", `Fallback quotes resolved (${fallbackQuotes.size}/${missingSymbols.length})`);
      } catch (e) {
        fallbackTimer.fail(e, "Fallback quotes fetch failed");
        // Continue with available quotes or transaction cost basis
      }
    }

    const quoteCurrencies = Array.from(
      new Set(
        [
          ...Array.from(quotesMap.values()).map((q) => q.currency),
          ...holdingsConfig.map((h) => h.currency),
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
      const isPrivate = Boolean(config.isPrivate || config.assetType === "Other" || sym === "LU3176111881");
      const quote = isPrivate ? undefined : quotesMap.get(sym);
      const shares = config.shares ?? 0;
      const buyPrice = config.buyPrice ?? 0;

      const nativeCurrency = quote?.currency || config.currency || baseCurrency;
      const fxMultiplier = fxRates.get(nativeCurrency) ?? 1;

      const rawNativePrice = quote?.regularMarketPrice ?? buyPrice;
      const rawNativePrevClose = quote?.previousClose ?? rawNativePrice;

      const currentPrice = rawNativePrice * fxMultiplier;
      const prevClose = isPrivate ? currentPrice : rawNativePrevClose * fxMultiplier;

      const costMultiplier = (!config.currency || config.currency === baseCurrency) ? 1 : fxMultiplier;
      const itemCost = shares * buyPrice * costMultiplier;
      const itemValue = shares * currentPrice;
      const itemPrevValue = shares * prevClose;

      totalCost += itemCost;
      totalValue += itemValue;
      totalPreviousValue += itemPrevValue;

      let assetType = config.assetType;
      if (!assetType) {
        if (isPrivate) assetType = "Other";
        else if (quote?.instrumentType === "ETF" || sym.endsWith(".DE")) assetType = "ETF";
        else if (sym.includes("BTC")) assetType = "Crypto";
        else assetType = "Stock";
      }

      if (assetType === "ETF") etfValue += itemValue;
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
        assetType,
        isPrivate,
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
    if (transactions.length > 0) {
      const netCash = (totalCashInjected - totalCashWithdrawn - totalCost) + realizedPnL + totalDividends + totalInterest - totalFees - totalTaxes;
      cashBalance = Math.max(0, netCash);
    }
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
      if (points.length > 0) {
        currentPriceMap.set(sym, points[0]!.close);
      }
    }

    const activeSharesOnDate = new Map<string, { shares: number; cost: number }>();
    let histCashInjected = 0;
    let histCashWithdrawn = 0;
    let histRealizedPnL = 0;
    let histDividends = 0;
    let histInterest = 0;
    let histFees = 0;
    let histTaxes = 0;
    let txPointer = 0;

    for (const d of sortedDates) {
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
        const fee = absNum(tx.fee ?? 0);
        const tax = absNum(tx.tax ?? 0);
        const txType = tx.type;

        histFees += fee;
        histTaxes += tax;

        if (txType === "CUSTOMER_INBOUND" || txType === "TRANSFER_INBOUND" || txType === "DEPOSIT") {
          histCashInjected += absNum(amount);
        } else if (txType === "CUSTOMER_OUTBOUND" || txType === "TRANSFER_OUTBOUND" || txType === "WITHDRAWAL") {
          histCashWithdrawn += absNum(amount);
        } else if (txType === "DIVIDEND") {
          histDividends += absNum(amount);
        } else if (txType === "INTEREST_PAYMENT") {
          histInterest += absNum(amount);
        } else if (txType === "BUY" || txType === "STOCKPERK" || txType === "PRIVATE_MARKET_BUY") {
          if (sym && sym !== "CASH") {
            let entry = activeSharesOnDate.get(sym);
            if (!entry) {
              entry = { shares: 0, cost: 0 };
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
          }
        } else if (txType === "SELL") {
          if (sym && sym !== "CASH") {
            const proceeds = absNum(amount);
            const entry = activeSharesOnDate.get(sym);
            if (entry && entry.shares > 0) {
              const avgCost = entry.cost / entry.shares;
              const costOfSold = absNum(shares) * avgCost;
              const tradePnL = proceeds - costOfSold;
              histRealizedPnL += tradePnL;

              entry.shares -= absNum(shares);
              entry.cost -= costOfSold;
              if (entry.shares <= 0.000001) {
                entry.shares = 0;
                entry.cost = 0;
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
          const nativeCurr = quote?.currency || baseCurrency;
          const fxMult = fxRates.get(nativeCurr) ?? 1;
          const rawPrice = currentPriceMap.get(sym) ?? (holding.shares > 0 ? holding.cost / holding.shares : 0);
          const price = rawPrice * fxMult;
          valOnDate += holding.shares * price;
          costOnDate += holding.cost;
        }
      }

      let cashOnDate = (histCashInjected - histCashWithdrawn - costOnDate) + histRealizedPnL + histDividends + histInterest - histFees - histTaxes;
      if (cashOnDate < 0) cashOnDate = 0;

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
      const id = this.mintTransactionId(txData.id);
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

      for (const t of batchList) {
        const candidateId = t.id || `tx_${t.date || "nodate"}_${t.type || "notype"}_${t.symbol || "nosym"}_${t.amount ?? ""}_${t.shares ?? ""}`;
        const existing = existingTxMap.get(candidateId);
        
        const id = existing ? candidateId : this.mintTransactionId(candidateId);
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
        if (toSaveNew.length > 0) {
          txRepo.bulkCreate(toSaveNew as any);
        }
        for (const update of toSaveUpdate) {
          txRepo.update(update.id, update.data);
        }
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
