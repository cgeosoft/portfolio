/**
 * Rows of the `market.fundamentals` metric scope: public company data for
 * every symbol the portfolio holds, from Financial Modeling Prep only. A
 * metric that reads this scope is unavailable while FMP has no API key, so
 * the data never silently changes provider.
 *
 * Every call goes through `FmpService.get`, which shares its cache and
 * throttle with company intel, so the Holding Intel modal and the metrics
 * reuse each other's responses. Logs carry counts, never symbols.
 */

import type { FinancialPortfolioData } from "portfolio-shared/portfolio";
import type { FundamentalField } from "portfolio-shared/metric-abi";
import { appLogger } from "../../logger.js";
import { FMP_TTL, toFmpSymbol, type FmpService } from "../fmp.js";
import { isFundType, isIntelEligible } from "../intel/company.js";
import { mapWithConcurrencyLimit } from "../yahoo-finance.js";
import type { MetricFundamentalsRow } from "./payload.js";

/** Symbols fetched at once; each runs up to seven FMP calls. */
const SYMBOL_CONCURRENCY = 3;
/** In-memory reuse of a symbol's row between evaluations. */
const ROW_TTL_MS = 10 * 60 * 1000;

type FmpRow = Record<string, unknown>;

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** FMP sends 0 for "not available" in several ratios. */
function pos(value: unknown): number | undefined {
  const n = num(value);
  return n !== undefined && n > 0 ? n : undefined;
}

function first(rows: FmpRow[] | null): FmpRow | null {
  return Array.isArray(rows) && rows.length > 0 && rows[0] ? rows[0] : null;
}

/** Mean of the recommendation counts on a 1 (strong sell) to 5 (strong buy) scale. */
function analystScore(row: FmpRow | null): { score?: number; count?: number } {
  if (!row) return {};
  const weights: [string, number][] = [["strongBuy", 5], ["buy", 4], ["hold", 3], ["sell", 2], ["strongSell", 1]];
  let total = 0;
  let sum = 0;
  for (const [key, weight] of weights) {
    const n = num(row[key]) ?? 0;
    total += n;
    sum += n * weight;
  }
  return total > 0 ? { score: sum / total, count: total } : {};
}

export class MetricFundamentalsService {
  private rows = new Map<string, { row: MetricFundamentalsRow; at: number }>();

  constructor(private readonly fmp: FmpService) {}

  /** True when FMP has an API key. */
  isAvailable(): boolean {
    return this.fmp.isConfigured();
  }

  /** One row per eligible holding. Empty when FMP has no key. Never throws. */
  async forPortfolio(data: FinancialPortfolioData): Promise<MetricFundamentalsRow[]> {
    if (!this.isAvailable()) return [];
    const holdings = (data.holdings ?? []).filter((h) => isIntelEligible(h.symbol, h.assetType, h.isPrivate));
    const unique = Array.from(new Map(holdings.map((h) => [h.symbol, h])).values());
    const timer = appLogger.startTimer("metrics", "fundamentals", "Loading fundamentals for metrics");
    try {
      const rows = await mapWithConcurrencyLimit(unique, SYMBOL_CONCURRENCY, (h) => this.forSymbol(h.symbol, isFundType(h.assetType)));
      const found = rows.filter((row): row is MetricFundamentalsRow => row !== null);
      timer.end("info", `Loaded fundamentals for ${found.length} of ${unique.length} symbol(s)`, { symbols: unique.length, found: found.length });
      return found;
    } catch (err) {
      timer.fail(err, "Fundamentals for metrics failed");
      return [];
    }
  }

  private async forSymbol(symbol: string, fundHint: boolean): Promise<MetricFundamentalsRow | null> {
    const cached = this.rows.get(symbol);
    if (cached && Date.now() - cached.at < ROW_TTL_MS) return cached.row;

    const fmpSymbol = toFmpSymbol(symbol);
    const ttl = FMP_TTL.fundamentals;
    const profile = await this.fmp.getProfile(fmpSymbol).catch(() => null);
    const isFund = fundHint || profile?.isEtf === true || profile?.isFund === true;
    const price = pos(profile?.price);
    const values: Partial<Record<FundamentalField, number>> = {
      beta: num(profile?.beta),
      marketCap: pos(profile?.marketCap),
      price,
    };

    // Company ratios, targets and scores do not exist for a fund.
    if (!isFund) {
      const get = (path: string) => this.fmp.get<FmpRow[]>(path, { symbol: fmpSymbol }, ttl).then(first).catch(() => null);
      const [keyMetrics, ratios, target, dcf, scores, grades] = await Promise.all([
        get("/key-metrics-ttm"),
        get("/ratios-ttm"),
        get("/price-target-consensus"),
        get("/discounted-cash-flow"),
        get("/financial-scores"),
        get("/grades-consensus"),
      ]);
      const priceTarget = pos(target?.targetConsensus);
      const dcfValue = num(dcf?.dcf);
      const dcfPrice = price ?? pos(dcf?.["Stock Price"]);
      const analyst = analystScore(grades);
      Object.assign(values, {
        peRatio: pos(ratios?.priceToEarningsRatioTTM),
        priceToBook: pos(ratios?.priceToBookRatioTTM),
        earningsYield: num(keyMetrics?.earningsYieldTTM),
        freeCashFlowYield: num(keyMetrics?.freeCashFlowYieldTTM),
        dividendYield: num(ratios?.dividendYieldTTM),
        payoutRatio: num(ratios?.dividendPayoutRatioTTM),
        returnOnEquity: num(keyMetrics?.returnOnEquityTTM),
        netMargin: num(ratios?.netProfitMarginTTM),
        debtToEquity: num(ratios?.debtToEquityRatioTTM),
        priceTarget,
        targetUpside: priceTarget !== undefined && price ? priceTarget / price - 1 : undefined,
        dcfValue,
        dcfUpside: dcfValue !== undefined && dcfPrice ? dcfValue / dcfPrice - 1 : undefined,
        piotroski: num(scores?.piotroskiScore),
        altmanZ: num(scores?.altmanZScore),
        analystScore: analyst.score,
        analystCount: analyst.count,
      } satisfies Partial<Record<FundamentalField, number | undefined>>);
    }

    if (Object.values(values).every((v) => v === undefined)) return null;
    const row: MetricFundamentalsRow = { symbol, isFund, values };
    this.rows.set(symbol, { row, at: Date.now() });
    return row;
  }
}
