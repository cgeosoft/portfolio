import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as manualPriceRepo from "../../db/manual-price.repo";
import * as marketCache from "../../db/market-cache.repo";
import { PortfolioService, type IMarketDataProvider } from "../portfolio";

// EUR base: one USD is 0.5 EUR in these tests.
const offline: IMarketDataProvider = {
  getQuotes: async () => new Map(),
  getExchangeRates: async (_base, targets) => new Map(targets.filter((c) => c === "USD").map((c) => [c, 0.5])),
  getChart: async () => {
    throw new Error("offline");
  },
};

const today = new Date().toISOString().slice(0, 10);

describe("manual price for private holdings", () => {
  const service = new PortfolioService(offline);
  let portfolioId = "";

  beforeAll(async () => {
    portfolioId = portfolioRepo.create({ name: "Manual price", baseCurrency: "EUR" }).id;
    await service.manageTransactions(portfolioId, {
      action: "batch_add",
      transactions: [
        { id: "d1", date: "2025-01-01", type: "CUSTOMER_INBOUND", symbol: "", amount: 1000, currency: "EUR" },
        { id: "p1", date: "2025-01-02", type: "PRIVATE_MARKET_BUY", symbol: "PFUND", shares: 10, price: 10, amount: -100, currency: "EUR" },
        { id: "p2", date: "2025-01-03", type: "BUY", assetClass: "PRIVATE", symbol: "PCO", shares: 2, price: 50, amount: -100, currency: "EUR" },
        { id: "s1", date: "2025-01-04", type: "BUY", symbol: "AAA", shares: 1, price: 20, amount: -20, currency: "EUR" },
      ],
    });
  });

  afterAll(() => {
    portfolioRepo.deleteById(portfolioId);
    service.destroy();
  });

  const holding = async (symbol: string) => {
    const data = await service.getPortfolioData(portfolioId);
    return { data, h: data.holdings.find((x) => x.symbol === symbol) };
  };

  it("values a private holding at cost without a manual price", async () => {
    const { h } = await holding("PFUND");
    expect(h?.isPrivate).toBe(true);
    expect(h?.currentPrice).toBe(10);
    expect(h?.currentValue).toBe(100);
    expect(h?.manualPrice).toBeUndefined();
  });

  it("uses the manual price in place of the buy price", async () => {
    const res = service.setManualPrice(portfolioId, "pfund", 12.5);
    expect(res.success).toBe(true);
    expect(res.manualPrice).toEqual({ price: 12.5, currency: "EUR", setAt: today });

    const { data, h } = await holding("PFUND");
    expect(h?.currentPrice).toBe(12.5);
    expect(h?.currentValue).toBe(125);
    expect(h?.totalCost).toBe(100);
    expect(h?.totalGainLossDollar).toBe(25);
    expect(h?.dayChangeDollar).toBe(0);
    expect(h?.manualPrice?.setAt).toBe(today);
    // 125 (PFUND) + 100 (PCO at cost) + 20 (AAA at cost, no quote)
    expect(data.summary.totalValue).toBe(245);
    const last = data.chartHistory[data.chartHistory.length - 1];
    expect(last?.date).toBe(today);
    expect(last?.totalValue).toBe(245);
  });

  it("converts a manual price in another currency and keeps the cost in the buy currency", async () => {
    service.setManualPrice(portfolioId, "PCO", 120, "USD");
    const { h } = await holding("PCO");
    expect(h?.nativeCurrency).toBe("USD");
    expect(h?.nativePrice).toBe(120);
    expect(h?.currentPrice).toBe(60);
    expect(h?.currentValue).toBe(120);
    expect(h?.totalCost).toBe(100);
    expect(h?.fxMissing).toBeUndefined();
  });

  it("refuses a public holding, an unknown holding and a bad price", () => {
    expect(service.setManualPrice(portfolioId, "AAA", 25).success).toBe(false);
    expect(service.setManualPrice(portfolioId, "NOPE", 25).success).toBe(false);
    expect(service.setManualPrice(portfolioId, "PFUND", 0).success).toBe(false);
    expect(service.setManualPrice(portfolioId, "PFUND", Number.NaN).success).toBe(false);
    expect(service.setManualPrice("missing", "PFUND", 1).success).toBe(false);
  });

  it("clears the price and drops the cached portfolio", async () => {
    expect(marketCache.get(`portfolio:${portfolioId}_EUR`)).not.toBeNull();
    expect(service.clearManualPrice(portfolioId, "PFUND").success).toBe(true);
    expect(manualPriceRepo.find(portfolioId, "PFUND")).toBeNull();
    expect(marketCache.get(`portfolio:${portfolioId}_EUR`)).toBeNull();
    const { h } = await holding("PFUND");
    expect(h?.currentPrice).toBe(10);
    expect(h?.manualPrice).toBeUndefined();
  });

  it("deletes the prices with the portfolio", () => {
    const other = portfolioRepo.create({ name: "Gone" });
    manualPriceRepo.upsert({ portfolioId: other.id, symbol: "X", price: 1, currency: "EUR", setAt: today });
    portfolioRepo.deleteById(other.id);
    expect(manualPriceRepo.findByPortfolio(other.id)).toEqual([]);
  });
});
