import { describe, it, expect, afterAll } from "bun:test";
import type * as portfolioRepo from "../../db/portfolio.repo";
import type * as txRepo from "../../db/transaction.repo";
import { PortfolioService, type IMarketDataProvider } from "../portfolio";
import type { YahooQuote } from "../yahoo-finance";

const portfolio = { id: "live-quotes-test", name: "Live quotes", baseCurrency: "USD" } as portfolioRepo.PortfolioRow;

function quote(symbol: string, price: number): YahooQuote {
  return { symbol, regularMarketPrice: price, regularMarketChange: 0, regularMarketChangePercent: 0, currency: "USD", updatedAt: "" };
}

function buy(symbol: string): txRepo.TransactionRow {
  return {
    id: `lq-${symbol}`,
    portfolioId: portfolio.id,
    date: "2025-01-02",
    datetime: null,
    type: "BUY",
    assetClass: "STOCK",
    name: null,
    symbol,
    isin: null,
    shares: 1,
    price: 10,
    amount: -10,
    fee: null,
    tax: null,
    currency: "USD",
    createdAt: "",
    updatedAt: "",
  };
}

describe("forced build with shared live quotes", () => {
  it("uses the quotes it is given and asks the provider for none", async () => {
    const forcedCalls: string[][] = [];
    const prefetched: string[][] = [];
    const provider: IMarketDataProvider = {
      getQuotes: async (symbols, forceFresh) => {
        if (forceFresh) forcedCalls.push(symbols);
        return new Map();
      },
      getExchangeRates: async () => new Map(),
      getChart: async () => {
        throw new Error("offline");
      },
      prefetchChartQuotes: async (symbols) => {
        prefetched.push(symbols);
      },
    };
    const service = new PortfolioService(provider);
    afterAll(() => service.destroy());

    const transactions = [buy("AAA"), buy("BBB")];
    const config = service.computeHoldingsFromTransactions(transactions);
    const live = new Map([["AAA", quote("AAA", 12)], ["BBB", quote("BBB", 15)]]);
    const data = await service.buildPortfolioData(portfolio, config, transactions, "USD", true, live);

    expect(forcedCalls).toEqual([]);
    expect(prefetched).toEqual([["AAA", "BBB"]]);
    expect(data.holdings.find((h) => h.symbol === "AAA")?.currentPrice).toBe(12);
    expect(data.holdings.find((h) => h.symbol === "BBB")?.currentPrice).toBe(15);
  });
});
