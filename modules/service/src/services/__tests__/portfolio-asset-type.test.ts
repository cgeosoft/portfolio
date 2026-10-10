import { describe, it, expect, afterAll } from "bun:test";
import type * as portfolioRepo from "../../db/portfolio.repo";
import type * as txRepo from "../../db/transaction.repo";
import { PortfolioService, assetTypeFromClass, assetTypeFromInstrument, type IMarketDataProvider } from "../portfolio";
import { extractQuoteFromChart, type YahooQuote } from "../yahoo-finance";

const portfolio = { id: "asset-type-test", name: "Asset type", baseCurrency: "USD" } as portfolioRepo.PortfolioRow;

function provider(quotes: Record<string, Partial<YahooQuote>> = {}): IMarketDataProvider {
  return {
    getQuotes: async (symbols) => {
      const out = new Map<string, YahooQuote>();
      for (const s of symbols) {
        const q = quotes[s];
        if (q) out.set(s, { symbol: s, regularMarketPrice: 10, regularMarketChange: 0, regularMarketChangePercent: 0, currency: "USD", updatedAt: "", ...q } as YahooQuote);
      }
      return out;
    },
    getExchangeRates: async () => new Map(),
    getChart: async () => {
      throw new Error("offline");
    },
  };
}

let seq = 0;
function buy(symbol: string, assetClass: string | null): txRepo.TransactionRow {
  seq++;
  return {
    id: `a${seq}`,
    portfolioId: portfolio.id,
    date: "2025-01-02",
    datetime: null,
    type: "BUY",
    assetClass,
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

async function typesOf(service: PortfolioService, transactions: txRepo.TransactionRow[]) {
  const config = service.computeHoldingsFromTransactions(transactions);
  const data = await service.buildPortfolioData(portfolio, config, transactions, "USD");
  return { data, type: (s: string) => data.holdings.find((h) => h.symbol === s)?.assetType };
}

describe("asset class mapping", () => {
  it("maps stored classes and Yahoo instrument types", () => {
    expect(assetTypeFromClass("ETF")).toBe("ETF");
    expect(assetTypeFromClass("FUND")).toBe("ETF");
    expect(assetTypeFromClass("etf")).toBe("ETF");
    expect(assetTypeFromClass("MUTUALFUND")).toBe("MutualFund");
    expect(assetTypeFromClass("CRYPTO")).toBe("Crypto");
    expect(assetTypeFromClass("STOCK")).toBe("Stock");
    expect(assetTypeFromClass("EQUITY")).toBe("Stock");
    expect(assetTypeFromClass(null)).toBeUndefined();
    expect(assetTypeFromClass("BOND")).toBeUndefined();
    expect(assetTypeFromInstrument("ETF")).toBe("ETF");
    expect(assetTypeFromInstrument("CRYPTOCURRENCY")).toBe("Crypto");
    expect(assetTypeFromInstrument(undefined)).toBeUndefined();
  });

  it("passes the chart instrument type through to the quote", () => {
    const quote = extractQuoteFromChart({
      symbol: "X",
      currency: "USD",
      regularMarketPrice: 10,
      instrumentType: "ETF",
      candles: [{ timestamp: 0, date: "2025-01-02", open: 10, high: 10, low: 10, close: 10, volume: 0 }],
    });
    expect(quote?.instrumentType).toBe("ETF");
  });
});

describe("holding asset type", () => {
  it("keeps the stored ETF class when the provider gives no type", async () => {
    const service = new PortfolioService(provider());
    afterAll(() => service.destroy());
    const { data, type } = await typesOf(service, [buy("SPY", "ETF"), buy("VWCE.DE", "ETF"), buy("BTC-USD", "CRYPTO"), buy("AAPL", "STOCK")]);
    expect(type("SPY")).toBe("ETF");
    expect(type("VWCE.DE")).toBe("ETF");
    expect(type("BTC-USD")).toBe("Crypto");
    expect(type("AAPL")).toBe("Stock");
    expect(data.summary.etfWeightPercent).toBe(50);
    expect(data.summary.stockWeightPercent).toBe(25);
  });

  it("keeps the stored ETF class over a provider EQUITY type", async () => {
    const service = new PortfolioService(provider({ QQQ: { instrumentType: "EQUITY" } }));
    afterAll(() => service.destroy());
    const { type } = await typesOf(service, [buy("QQQ", "ETF")]);
    expect(type("QQQ")).toBe("ETF");
  });

  it("lets the provider type refine a default or EQUITY class", async () => {
    const service = new PortfolioService(provider({ IWDA: { instrumentType: "ETF" }, VTSAX: { instrumentType: "MUTUALFUND" }, MSFT: { instrumentType: "EQUITY" } }));
    afterAll(() => service.destroy());
    const { type } = await typesOf(service, [buy("IWDA", null), buy("VTSAX", "EQUITY"), buy("MSFT", null)]);
    expect(type("IWDA")).toBe("ETF");
    expect(type("VTSAX")).toBe("MutualFund");
    expect(type("MSFT")).toBe("Stock");
  });

  it("takes a specific class from a later transaction", () => {
    const service = new PortfolioService(provider());
    afterAll(() => service.destroy());
    const config = service.computeHoldingsFromTransactions([buy("VWRL", null), buy("VWRL", "FUND")]);
    expect(config.find((h) => h.symbol === "VWRL")?.assetType).toBe("ETF");
  });
});
