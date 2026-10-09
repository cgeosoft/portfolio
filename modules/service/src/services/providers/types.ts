/**
 * Types shared by the market data providers (FMP, Yahoo Finance, Finnhub)
 * and the provider chain.
 */
import type { DataProviderCategoryRouting, DataProviderId } from "portfolio-shared/config-types";

export type { DataProviderId };

/** A data category the user routes in Settings → Data providers. */
export type RoutedCategory = keyof DataProviderCategoryRouting;

/**
 * Any kind of data a chain can resolve. A routed category reads its
 * preferred provider from the settings; any other name (for example
 * "etfHoldings") uses the quality order alone.
 */
export type DataCategory = RoutedCategory | (string & {});

/** One market or company news headline, the shape every provider maps to. */
export interface MarketNewsItem {
  headline: string;
  summary: string;
  source: string;
  /** Unix seconds. */
  datetime: number;
  url?: string;
}
