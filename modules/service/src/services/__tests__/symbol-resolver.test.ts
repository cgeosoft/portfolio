import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getDatabase } from "../../db/database";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as txRepo from "../../db/transaction.repo";
import * as symbolMapRepo from "../../db/symbol-map.repo";
import { PortfolioService, type IMarketDataProvider } from "../portfolio";
import { SymbolResolver, cryptoPair, listingCurrency, pickListing, type SymbolSearcher } from "../symbol-resolver";
import { isIsin } from "../providers/identifiers";
import type { YahooSymbolSearchResult } from "../yahoo-finance";

const META = "US30303M1027";
const MSCI_WORLD = "IE00B4L5Y983";
const RHEINMETALL = "DE0007030009";
const THALES = "FR0000121329";
const AMAZON = "US0231351067";

const hit = (symbol: string, name = `${symbol} name`): YahooSymbolSearchResult => ({ symbol, name, exchange: "X", quoteType: "EQUITY" });

/** Search stub that answers from a fixed table and counts the queries. */
function stubSearcher(table: Record<string, YahooSymbolSearchResult[]>): SymbolSearcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    searchSymbols: async (q: string) => {
      calls.push(q);
      return table[q] ?? [];
    },
  };
}

const offline: IMarketDataProvider = {
  getQuotes: async () => new Map(),
  getExchangeRates: async () => new Map(),
  getChart: async () => {
    throw new Error("offline");
  },
};

describe("listing choice", () => {
  it("uses valid ISINs in these tests", () => {
    for (const isin of [META, MSCI_WORLD, RHEINMETALL, THALES, AMAZON]) expect(isIsin(isin)).toBe(true);
  });

  it("reads the quote currency from the symbol", () => {
    expect(listingCurrency("AAPL")).toBe("USD");
    expect(listingCurrency("SAP.DE")).toBe("EUR");
    expect(listingCurrency("SWDA.L")).toBe("GBP");
    expect(listingCurrency("BTC-EUR")).toBe("EUR");
    expect(listingCurrency("X.ZZ")).toBeUndefined();
  });

  it("prefers the home market of a US ISIN over a EUR listing", () => {
    expect(pickListing(META, [hit("FB2A.DE"), hit("META"), hit("FB2A.F")], "EUR")?.symbol).toBe("META");
  });

  it("prefers the home market of a German or French ISIN", () => {
    expect(pickListing(RHEINMETALL, [hit("RNMBY"), hit("RHM.F"), hit("RHM.DE")], "USD")?.symbol).toBe("RHM.DE");
    expect(pickListing(THALES, [hit("THLEF"), hit("HO.PA")], "EUR")?.symbol).toBe("HO.PA");
  });

  it("takes a base-currency listing for an Irish fund, Xetra first", () => {
    const results = [hit("SWDA.L"), hit("IWDA.AS"), hit("EUNL.DE"), hit("EUNL.F")];
    expect(pickListing(MSCI_WORLD, results, "EUR")?.symbol).toBe("EUNL.DE");
    expect(pickListing(MSCI_WORLD, results, "GBP")?.symbol).toBe("SWDA.L");
  });

  it("ignores results that are ISINs themselves and keeps provider order otherwise", () => {
    expect(pickListing(MSCI_WORLD, [hit(MSCI_WORLD)], "EUR")).toBeUndefined();
    expect(pickListing(MSCI_WORLD, [hit("AAA.ZZ"), hit("BBB.YY")], "EUR")?.symbol).toBe("AAA.ZZ");
  });

  it("turns a bare crypto code into a pair", () => {
    expect(cryptoPair({ symbol: "BTC", assetClass: "CRYPTO", currency: "EUR" }, "EUR")).toBe("BTC-EUR");
    expect(cryptoPair({ symbol: "ETH", assetClass: "CRYPTO" }, "USD")).toBe("ETH-USD");
    expect(cryptoPair({ symbol: "BTC-EUR", assetClass: "CRYPTO" }, "EUR")).toBeUndefined();
    expect(cryptoPair({ symbol: "BTC", assetClass: "STOCK" }, "EUR")).toBeUndefined();
  });
});

describe("SymbolResolver", () => {
  beforeAll(() => {
    getDatabase();
  });

  afterAll(() => {
    for (const isin of [META, MSCI_WORLD, RHEINMETALL, THALES, AMAZON]) symbolMapRepo.remove(isin);
  });

  it("fills the ticker of ISIN-only transactions and stores what it found", async () => {
    const searcher = stubSearcher({ [META]: [hit("FB2A.DE"), hit("META", "Meta Platforms")] });
    const resolver = new SymbolResolver(searcher);
    const txs = [
      { symbol: META, isin: META, name: null as string | null, currency: "EUR" },
      { symbol: "AAPL", isin: null, name: "Apple", currency: "USD" },
    ];
    const changed = await resolver.applyToTransactions(txs, "EUR");
    expect(changed.length).toBe(1);
    expect(txs[0]).toMatchObject({ symbol: "META", isin: META, name: "Meta Platforms" });
    expect(txs[1]!.symbol).toBe("AAPL");
    expect(symbolMapRepo.findByIsin(META)).toMatchObject({ symbol: "META", source: "auto" });

    // The stored map answers the next import without a search.
    const again = [{ symbol: META, name: "Meta Platforms Inc." }];
    await new SymbolResolver(searcher).applyToTransactions(again, "EUR");
    expect(again[0]).toMatchObject({ symbol: "META", isin: META, name: "Meta Platforms Inc." });
    expect(searcher.calls).toEqual([META]);
  });

  it("leaves unresolved ISINs in place and does not search them again right away", async () => {
    const searcher = stubSearcher({});
    const resolver = new SymbolResolver(searcher);
    const txs = [{ symbol: AMAZON, isin: AMAZON }];
    expect((await resolver.applyToTransactions(txs, "EUR")).length).toBe(0);
    expect(txs[0]!.symbol).toBe(AMAZON);
    await resolver.applyToTransactions([{ symbol: AMAZON }], "EUR");
    expect(searcher.calls).toEqual([AMAZON]);
  });

  it("skips private assets", async () => {
    const searcher = stubSearcher({ [THALES]: [hit("HO.PA")] });
    const txs = [{ symbol: THALES, assetClass: "PRIVATE_FUND" }];
    await new SymbolResolver(searcher).applyToTransactions(txs, "EUR");
    expect(txs[0]!.symbol).toBe(THALES);
    expect(searcher.calls.length).toBe(0);
  });

  it("keeps a manual mapping over a later search result", () => {
    symbolMapRepo.upsert({ isin: RHEINMETALL, symbol: "RHM.F", source: "manual" });
    symbolMapRepo.upsert({ isin: RHEINMETALL, symbol: "RHM.DE", source: "auto" });
    expect(symbolMapRepo.findByIsin(RHEINMETALL)).toMatchObject({ symbol: "RHM.F", source: "manual" });
  });
});

describe("PortfolioService with the resolver", () => {
  let service: PortfolioService;
  let portfolio: portfolioRepo.PortfolioRow;
  let other: portfolioRepo.PortfolioRow;

  beforeAll(() => {
    getDatabase();
    const searcher = stubSearcher({ [MSCI_WORLD]: [hit("SWDA.L"), hit("EUNL.DE", "iShares Core MSCI World")] });
    service = new PortfolioService(offline, new SymbolResolver(searcher));
    portfolio = portfolioRepo.create({ name: "ISIN import", baseCurrency: "EUR" });
    other = portfolioRepo.create({ name: "Other", baseCurrency: "EUR" });
  });

  afterAll(() => {
    service.destroy();
    portfolioRepo.deleteById(portfolio.id);
    portfolioRepo.deleteById(other.id);
    symbolMapRepo.remove(MSCI_WORLD);
    symbolMapRepo.remove(THALES);
  });

  it("resolves ISINs on import and shows the ticker in the preview", async () => {
    const res = await service.manageTransactions(portfolio.id, {
      action: "import",
      dryRun: true,
      transactions: [{ id: "isin_tx_1", date: "2026-01-05", type: "BUY", symbol: MSCI_WORLD, isin: MSCI_WORLD, shares: 2, price: 100, amount: -200, currency: "EUR" }],
    });
    expect(res.success).toBe(true);
    expect(res.addedPreview?.[0]).toMatchObject({ symbol: "EUNL.DE", isin: MSCI_WORLD, name: "iShares Core MSCI World" });
  });

  it("sets a ticker by hand in every portfolio and keeps the ISIN on the holding", async () => {
    txRepo.create({ portfolioId: portfolio.id, date: "2026-01-02", type: "BUY", symbol: THALES, isin: THALES, shares: 1, price: 10, amount: -10, currency: "EUR" });
    txRepo.create({ portfolioId: other.id, date: "2026-01-02", type: "BUY", symbol: THALES, isin: null, shares: 1, price: 10, amount: -10, currency: "EUR" });
    const res = service.setSymbolForIsin(THALES, "ho.pa", "Thales");
    expect(res).toEqual({ success: true, portfolios: 2 });
    for (const id of [portfolio.id, other.id]) {
      const tx = txRepo.findByPortfolio(id).find((t) => t.isin === THALES);
      expect(tx).toMatchObject({ symbol: "HO.PA", name: "Thales" });
    }
    const holdings = service.computeHoldingsFromTransactions(txRepo.findByPortfolio(other.id));
    expect(holdings[0]).toMatchObject({ symbol: "HO.PA", isin: THALES });
  });
});
