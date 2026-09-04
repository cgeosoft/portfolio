/**
 * Demo portfolio generator.
 * Ported from NestJS, replacing TypeORM entity construction with plain objects.
 */

import type { TransactionInput } from "../db/transaction.repo.js";

export interface MockAssetDefinition {
  symbol: string;
  name: string;
  assetClass: string;
  currency: string;
  refPrice: number;
  targetWeight: number;
  hasDividends?: boolean;
  dividendYieldAnnual?: number;
}

export const DEMO_ASSETS: MockAssetDefinition[] = [
  { symbol: "AAPL", name: "Apple Inc.", assetClass: "STOCK", currency: "USD", refPrice: 280.0, targetWeight: 0.14, hasDividends: true, dividendYieldAnnual: 0.005 },
  { symbol: "MSFT", name: "Microsoft Corporation", assetClass: "STOCK", currency: "USD", refPrice: 430.0, targetWeight: 0.13, hasDividends: true, dividendYieldAnnual: 0.008 },
  { symbol: "NVDA", name: "NVIDIA Corporation", assetClass: "STOCK", currency: "USD", refPrice: 185.0, targetWeight: 0.15, hasDividends: true, dividendYieldAnnual: 0.002 },
  { symbol: "AMZN", name: "Amazon.com Inc.", assetClass: "STOCK", currency: "USD", refPrice: 220.0, targetWeight: 0.10 },
  { symbol: "GOOGL", name: "Alphabet Inc.", assetClass: "STOCK", currency: "USD", refPrice: 290.0, targetWeight: 0.09 },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", assetClass: "ETF", currency: "USD", refPrice: 655.0, targetWeight: 0.14, hasDividends: true, dividendYieldAnnual: 0.013 },
  { symbol: "VWCE.DE", name: "Vanguard FTSE All-World UCITS ETF", assetClass: "ETF", currency: "EUR", refPrice: 166.0, targetWeight: 0.10, hasDividends: false },
  { symbol: "QQQ", name: "Invesco QQQ Trust", assetClass: "ETF", currency: "USD", refPrice: 610.0, targetWeight: 0.07, hasDividends: true, dividendYieldAnnual: 0.006 },
  { symbol: "BTC-USD", name: "Bitcoin USD", assetClass: "CRYPTO", currency: "USD", refPrice: 66500.0, targetWeight: 0.04 },
  { symbol: "JNJ", name: "Johnson & Johnson", assetClass: "STOCK", currency: "USD", refPrice: 235.0, targetWeight: 0.02, hasDividends: true, dividendYieldAnnual: 0.031 },
  { symbol: "PG", name: "Procter & Gamble Co.", assetClass: "STOCK", currency: "USD", refPrice: 126.0, targetWeight: 0.02, hasDividends: true, dividendYieldAnnual: 0.024 },
];

type DemoTx = Partial<TransactionInput> & { portfolioId: string; date: string; type: string; symbol: string };

/**
 * Generate 100 mock transactions simulating 1 year of active portfolio history.
 */
export function generateDemoTransactions(
  portfolioId: string,
  baseCurrency = "EUR",
  currentQuotesMapInBaseCurrency?: Map<string, number>,
  baseDate: Date = new Date(),
): DemoTx[] {
  const transactions: DemoTx[] = [];

  const formatYmd = (d: Date): string => d.toISOString().split("T")[0]!;
  const formatIso = (d: Date): string => d.toISOString();

  const daysAgo = (days: number): Date => {
    const d = new Date(baseDate.getTime());
    d.setUTCDate(d.getUTCDate() - days);
    d.setUTCHours(14, 30, 0, 0);
    return d;
  };

  const getAssetPrice = (asset: MockAssetDefinition): number => {
    if (currentQuotesMapInBaseCurrency?.has(asset.symbol)) {
      const q = currentQuotesMapInBaseCurrency.get(asset.symbol)!;
      if (q > 0) return q;
    }
    return asset.refPrice;
  };

  let txIndex = 1;
  const createTxId = (): string => {
    const id = `demo_tx_${String(txIndex).padStart(3, "0")}`;
    txIndex++;
    return id;
  };

  const makeTx = (overrides: Partial<DemoTx>): DemoTx => ({
    portfolioId,
    date: "",
    type: "BUY",
    symbol: "",
    currency: baseCurrency,
    fee: 0,
    tax: 0,
    ...overrides,
    id: overrides.id || createTxId(),
  });

  // 1. CASH DEPOSITS (6 transactions)
  const depositSchedule = [
    { days: 364, amount: 60000, desc: "Initial Inbound Deposit" },
    { days: 300, amount: 3500, desc: "Monthly Savings Contribution" },
    { days: 240, amount: 3500, desc: "Monthly Savings Contribution" },
    { days: 180, amount: 3500, desc: "Mid-Year Capital Inflow" },
    { days: 120, amount: 3500, desc: "Monthly Savings Contribution" },
    { days: 60, amount: 3500, desc: "Monthly Savings Contribution" },
  ];

  for (const dep of depositSchedule) {
    const d = daysAgo(dep.days);
    transactions.push(makeTx({
      date: formatYmd(d), datetime: formatIso(d), type: "CUSTOMER_INBOUND",
      symbol: "CASH", name: dep.desc, assetClass: "CASH",
      shares: dep.amount, price: 1, amount: dep.amount,
    }));
  }

  // 2. STAGGERED BUY TRANSACTIONS (64 transactions)
  const buyPlan = [
    { symbol: "AAPL", day: 355, shares: 7, priceRatio: 0.90, fee: 1.5 },
    { symbol: "AAPL", day: 310, shares: 6, priceRatio: 0.91, fee: 1.5 },
    { symbol: "AAPL", day: 260, shares: 5, priceRatio: 0.93, fee: 1.5 },
    { symbol: "AAPL", day: 215, shares: 6, priceRatio: 0.89, fee: 1.5 },
    { symbol: "AAPL", day: 165, shares: 5, priceRatio: 0.94, fee: 1.5 },
    { symbol: "AAPL", day: 110, shares: 5, priceRatio: 0.92, fee: 1.5 },
    { symbol: "AAPL", day: 65, shares: 4, priceRatio: 0.95, fee: 1.5 },
    { symbol: "AAPL", day: 20, shares: 4, priceRatio: 0.97, fee: 1.5 },
    { symbol: "MSFT", day: 350, shares: 4, priceRatio: 0.89, fee: 1.5 },
    { symbol: "MSFT", day: 295, shares: 3, priceRatio: 0.92, fee: 1.5 },
    { symbol: "MSFT", day: 245, shares: 3, priceRatio: 0.90, fee: 1.5 },
    { symbol: "MSFT", day: 190, shares: 3, priceRatio: 0.94, fee: 1.5 },
    { symbol: "MSFT", day: 135, shares: 3, priceRatio: 0.91, fee: 1.5 },
    { symbol: "MSFT", day: 80, shares: 2, priceRatio: 0.95, fee: 1.5 },
    { symbol: "MSFT", day: 25, shares: 2, priceRatio: 0.96, fee: 1.5 },
    { symbol: "NVDA", day: 358, shares: 15, priceRatio: 0.88, fee: 1.5 },
    { symbol: "NVDA", day: 305, shares: 12, priceRatio: 0.90, fee: 1.5 },
    { symbol: "NVDA", day: 255, shares: 10, priceRatio: 0.87, fee: 1.5 },
    { symbol: "NVDA", day: 205, shares: 12, priceRatio: 0.93, fee: 1.5 },
    { symbol: "NVDA", day: 150, shares: 10, priceRatio: 0.89, fee: 1.5 },
    { symbol: "NVDA", day: 100, shares: 8, priceRatio: 0.94, fee: 1.5 },
    { symbol: "NVDA", day: 55, shares: 8, priceRatio: 0.96, fee: 1.5 },
    { symbol: "NVDA", day: 15, shares: 6, priceRatio: 0.98, fee: 1.5 },
    { symbol: "AMZN", day: 345, shares: 7, priceRatio: 0.91, fee: 1.5 },
    { symbol: "AMZN", day: 285, shares: 6, priceRatio: 0.93, fee: 1.5 },
    { symbol: "AMZN", day: 225, shares: 6, priceRatio: 0.89, fee: 1.5 },
    { symbol: "AMZN", day: 160, shares: 5, priceRatio: 0.94, fee: 1.5 },
    { symbol: "AMZN", day: 95, shares: 5, priceRatio: 0.92, fee: 1.5 },
    { symbol: "AMZN", day: 35, shares: 4, priceRatio: 0.96, fee: 1.5 },
    { symbol: "GOOGL", day: 340, shares: 7, priceRatio: 0.90, fee: 1.5 },
    { symbol: "GOOGL", day: 275, shares: 6, priceRatio: 0.92, fee: 1.5 },
    { symbol: "GOOGL", day: 210, shares: 5, priceRatio: 0.88, fee: 1.5 },
    { symbol: "GOOGL", day: 145, shares: 5, priceRatio: 0.93, fee: 1.5 },
    { symbol: "GOOGL", day: 85, shares: 5, priceRatio: 0.95, fee: 1.5 },
    { symbol: "GOOGL", day: 30, shares: 4, priceRatio: 0.97, fee: 1.5 },
    { symbol: "SPY", day: 352, shares: 3, priceRatio: 0.91, fee: 1.5 },
    { symbol: "SPY", day: 290, shares: 2, priceRatio: 0.92, fee: 1.5 },
    { symbol: "SPY", day: 235, shares: 2, priceRatio: 0.90, fee: 1.5 },
    { symbol: "SPY", day: 175, shares: 2, priceRatio: 0.93, fee: 1.5 },
    { symbol: "SPY", day: 125, shares: 2, priceRatio: 0.91, fee: 1.5 },
    { symbol: "SPY", day: 70, shares: 2, priceRatio: 0.95, fee: 1.5 },
    { symbol: "SPY", day: 18, shares: 2, priceRatio: 0.97, fee: 1.5 },
    { symbol: "VWCE.DE", day: 348, shares: 10, priceRatio: 0.91, fee: 1.5 },
    { symbol: "VWCE.DE", day: 280, shares: 9, priceRatio: 0.92, fee: 1.5 },
    { symbol: "VWCE.DE", day: 220, shares: 8, priceRatio: 0.89, fee: 1.5 },
    { symbol: "VWCE.DE", day: 155, shares: 8, priceRatio: 0.93, fee: 1.5 },
    { symbol: "VWCE.DE", day: 90, shares: 7, priceRatio: 0.94, fee: 1.5 },
    { symbol: "VWCE.DE", day: 40, shares: 6, priceRatio: 0.96, fee: 1.5 },
    { symbol: "QQQ", day: 335, shares: 3, priceRatio: 0.90, fee: 1.5 },
    { symbol: "QQQ", day: 265, shares: 2, priceRatio: 0.92, fee: 1.5 },
    { symbol: "QQQ", day: 195, shares: 2, priceRatio: 0.91, fee: 1.5 },
    { symbol: "QQQ", day: 115, shares: 2, priceRatio: 0.94, fee: 1.5 },
    { symbol: "QQQ", day: 45, shares: 2, priceRatio: 0.96, fee: 1.5 },
    { symbol: "BTC-USD", day: 330, shares: 0.015, priceRatio: 0.88, fee: 2.0 },
    { symbol: "BTC-USD", day: 250, shares: 0.012, priceRatio: 0.91, fee: 2.0 },
    { symbol: "BTC-USD", day: 170, shares: 0.012, priceRatio: 0.89, fee: 2.0 },
    { symbol: "BTC-USD", day: 105, shares: 0.010, priceRatio: 0.94, fee: 2.0 },
    { symbol: "BTC-USD", day: 28, shares: 0.008, priceRatio: 0.96, fee: 2.0 },
    { symbol: "JNJ", day: 325, shares: 5, priceRatio: 0.93, fee: 1.5 },
    { symbol: "JNJ", day: 215, shares: 4, priceRatio: 0.94, fee: 1.5 },
    { symbol: "JNJ", day: 75, shares: 3, priceRatio: 0.97, fee: 1.5 },
    { symbol: "PG", day: 320, shares: 4, priceRatio: 0.92, fee: 1.5 },
    { symbol: "PG", day: 200, shares: 4, priceRatio: 0.94, fee: 1.5 },
    { symbol: "PG", day: 60, shares: 3, priceRatio: 0.96, fee: 1.5 },
  ];

  const assetMap = new Map<string, MockAssetDefinition>();
  for (const a of DEMO_ASSETS) assetMap.set(a.symbol, a);

  for (const b of buyPlan) {
    const asset = assetMap.get(b.symbol)!;
    const currPriceInBase = getAssetPrice(asset);
    const buyPrice = Number((currPriceInBase * b.priceRatio).toFixed(2));
    const amount = Number((buyPrice * b.shares).toFixed(2));
    const d = daysAgo(b.day);

    transactions.push(makeTx({
      date: formatYmd(d), datetime: formatIso(d), type: "BUY",
      symbol: asset.symbol, name: asset.name, assetClass: asset.assetClass,
      shares: b.shares, price: buyPrice, amount, fee: b.fee ?? 1.5,
    }));
  }

  // 3. SELL TRANSACTIONS (10 transactions)
  const sellPlan = [
    { symbol: "AAPL", day: 140, shares: 3, salePriceRatio: 0.96, fee: 2.0 },
    { symbol: "MSFT", day: 130, shares: 2, salePriceRatio: 0.95, fee: 2.0 },
    { symbol: "NVDA", day: 120, shares: 6, salePriceRatio: 0.97, fee: 2.0 },
    { symbol: "NVDA", day: 50, shares: 4, salePriceRatio: 0.98, fee: 2.0 },
    { symbol: "AMZN", day: 110, shares: 3, salePriceRatio: 0.95, fee: 2.0 },
    { symbol: "GOOGL", day: 100, shares: 3, salePriceRatio: 0.96, fee: 2.0 },
    { symbol: "SPY", day: 85, shares: 1, salePriceRatio: 0.96, fee: 2.0 },
    { symbol: "VWCE.DE", day: 75, shares: 4, salePriceRatio: 0.95, fee: 2.0 },
    { symbol: "QQQ", day: 65, shares: 1, salePriceRatio: 0.97, fee: 2.0 },
    { symbol: "BTC-USD", day: 45, shares: 0.005, salePriceRatio: 0.97, fee: 2.5 },
  ];

  for (const s of sellPlan) {
    const asset = assetMap.get(s.symbol)!;
    const currPriceInBase = getAssetPrice(asset);
    const sellPrice = Number((currPriceInBase * s.salePriceRatio).toFixed(2));
    const amount = Number((sellPrice * s.shares).toFixed(2));
    const d = daysAgo(s.day);

    transactions.push(makeTx({
      date: formatYmd(d), datetime: formatIso(d), type: "SELL",
      symbol: asset.symbol, name: asset.name, assetClass: asset.assetClass,
      shares: s.shares, price: sellPrice, amount,
      fee: s.fee ?? 2.0, tax: Number((amount * 0.002).toFixed(2)),
    }));
  }

  // 4. DIVIDEND TRANSACTIONS (20 transactions)
  const divPlan = [
    { symbol: "AAPL", day: 275, amount: 24.5 },
    { symbol: "MSFT", day: 270, amount: 31.2 },
    { symbol: "SPY", day: 268, amount: 48.0 },
    { symbol: "JNJ", day: 265, amount: 36.8 },
    { symbol: "PG", day: 260, amount: 28.4 },
    { symbol: "AAPL", day: 185, amount: 29.8 },
    { symbol: "MSFT", day: 182, amount: 38.5 },
    { symbol: "SPY", day: 178, amount: 56.4 },
    { symbol: "QQQ", day: 175, amount: 18.2 },
    { symbol: "JNJ", day: 172, amount: 42.0 },
    { symbol: "PG", day: 170, amount: 32.5 },
    { symbol: "AAPL", day: 95, amount: 33.2 },
    { symbol: "MSFT", day: 92, amount: 42.1 },
    { symbol: "SPY", day: 88, amount: 62.8 },
    { symbol: "QQQ", day: 85, amount: 21.0 },
    { symbol: "JNJ", day: 82, amount: 45.6 },
    { symbol: "PG", day: 80, amount: 35.8 },
    { symbol: "AAPL", day: 16, amount: 36.5 },
    { symbol: "MSFT", day: 12, amount: 46.0 },
    { symbol: "SPY", day: 8, amount: 68.2 },
  ];

  for (const div of divPlan) {
    const asset = assetMap.get(div.symbol)!;
    const d = daysAgo(div.day);

    transactions.push(makeTx({
      date: formatYmd(d), datetime: formatIso(d), type: "DIVIDEND",
      symbol: asset.symbol, name: `${asset.name} Quarterly Dividend`,
      assetClass: asset.assetClass,
      shares: 0, price: 0, amount: div.amount,
      tax: Number((div.amount * 0.15).toFixed(2)),
    }));
  }

  // Sort all 100 transactions chronologically
  transactions.sort((a, b) => {
    const dateComp = a.date.localeCompare(b.date);
    if (dateComp !== 0) return dateComp;
    return (a.datetime || "").localeCompare(b.datetime || "");
  });

  return transactions;
}
