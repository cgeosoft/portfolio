// Domain types for Portfolio desktop app
// Merged from old service + GUI types, minus auth/notification types

export interface PortfolioItem {
  id: string;
  name: string;
  description?: string | null;
  baseCurrency: string;
  isShared?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PortfolioHolding {
  symbol: string;
  name: string;
  assetType: "Stock" | "ETF" | "MutualFund" | "Crypto" | "Cash" | "Other";
  isPrivate?: boolean;
  shares: number;
  buyPrice: number;
  currentPrice: number;
  previousClose: number;
  totalCost: number;
  currentValue: number;
  dayChangeDollar: number;
  dayChangePercent: number;
  totalGainLossDollar: number;
  totalGainLossPercent: number;
  weightPercent: number;
  currency: string;
  nativePrice?: number;
  nativeCurrency?: string;
  fxRate?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  sma50?: number;
  sma200?: number;
  rsi?: number;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalGainLossDollar: number;
  totalGainLossPercent: number;
  dayGainLossDollar: number;
  dayGainLossPercent: number;

  // Progressive lifetime metrics
  totalGainSinceStartDollar: number;
  totalGainSinceStartPercent: number;
  totalCashInjected: number;
  totalCashWithdrawn?: number;
  cashBalance: number;
  totalPortfolioValue: number;
  realizedPnL: number;
  totalDividends: number;
  totalInterest: number;
  totalFees: number;
  totalTaxes: number;

  bestPerformer?: { symbol: string; changePercent: number };
  worstPerformer?: { symbol: string; changePercent: number };
  stockWeightPercent: number;
  etfWeightPercent: number;
  cryptoWeightPercent: number;
  otherWeightPercent?: number;
  cashWeightPercent: number;
  baseCurrency: string;
  lastUpdated: string;
}

export interface PortfolioHistoricalPoint {
  date: string;
  timestamp: number;
  totalValue: number;
  totalCost: number;
  totalGainLoss: number;
  cashBalance?: number;
  totalPortfolioValue?: number;
}

export interface PortfolioTransaction {
  id: string;
  portfolioId?: string;
  date: string;
  datetime?: string | null;
  type: string;
  assetClass?: string | null;
  name?: string | null;
  symbol: string;
  isin?: string | null;
  shares?: number | null;
  price?: number | null;
  amount?: number | null;
  fee?: number | null;
  tax?: number | null;
  currency?: string;
}

export interface PortfolioReport {
  id: string;
  createdAt: string;
  period: string;
  weekStartDate: string;
  weekEndDate: string;
  weekKey?: string;
  title: string;
  summary: string;
  content: string;
  metrics: {
    totalPortfolioValue: number;
    periodGainLossDollar?: number;
    periodGainLossPercent?: number;
    weeklyGainLossDollar?: number;
    weeklyGainLossPercent?: number;
    cashBalance: number;
    baseCurrency: string;
    holdingsCount: number;
    topWinner?: { symbol: string; changePercent: number };
    topLoser?: { symbol: string; changePercent: number };
  };
  model: string;
  provider: string;
  status?: "success" | "fallback" | "error";
  error?: string;
  isFallback?: boolean;
}

export interface FinancialPortfolioData {
  summary: PortfolioSummary;
  holdings: PortfolioHolding[];
  chartHistory: PortfolioHistoricalPoint[];
  individualCharts: Record<string, { date: string; close: number }[]>;
  transactions?: PortfolioTransaction[];
  portfolio?: PortfolioItem;
}

// Service-side holding config type (used for computations)
export interface PortfolioHoldingConfig {
  symbol: string;
  name?: string;
  shares: number;
  buyPrice: number;
  assetType?: "Stock" | "ETF" | "MutualFund" | "Crypto" | "Cash" | "Other";
  isPrivate?: boolean;
  currency?: string;
  notes?: string;
}

// Alias: HoldingPerformance is the same shape as PortfolioHolding
export type HoldingPerformance = PortfolioHolding;
