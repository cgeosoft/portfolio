/**
 * Provider chain: "best data available" for any kind of market data.
 *
 * A chain takes a data category and one attempt per provider. It orders the
 * attempts as: the preferred provider from Settings → Data providers (for a
 * routed category), then the rest in the category's quality order. It skips
 * a provider whose `isAvailable()` is false (no API key), treats null, an
 * empty result or a throw as a miss, and moves on to the next provider.
 *
 * - `firstAvailable()` resolves one value (a chart, a search, a news list).
 * - `fillByKey()` resolves symbol-keyed batches (quotes, FX rates): each
 *   provider only gets the keys the providers before it did not supply.
 *
 * Both return the provider that supplied the data, so the GUI and the
 * assistant can cite the source.
 */
import { DEFAULT_DATA_PROVIDER_ROUTING, loadConfig } from "../../config.js";
import { appLogger } from "../../logger.js";
import type { DataCategory, DataProviderId, RoutedCategory } from "./types.js";

/** Quality order when a category names none: FMP, then Yahoo, then Finnhub. */
export const DEFAULT_QUALITY_ORDER: readonly DataProviderId[] = ["fmp", "yahoo", "finnhub"];

/** Quality order per category. Finnhub ranks above Yahoo for news and fundamentals. */
export const CATEGORY_QUALITY_ORDER: Readonly<Record<string, readonly DataProviderId[]>> = {
  quotes: ["fmp", "yahoo", "finnhub"],
  charts: ["fmp", "yahoo", "finnhub"],
  fx: ["fmp", "yahoo", "finnhub"],
  search: ["fmp", "yahoo", "finnhub"],
  news: ["fmp", "finnhub", "yahoo"],
  fundamentals: ["fmp", "finnhub", "yahoo"],
  companyNews: ["fmp", "finnhub"],
  dividends: ["fmp", "yahoo"],
  splits: ["fmp", "yahoo"],
  // Finnhub carries actual EPS; Yahoo calendarEvents only the next date.
  earnings: ["fmp", "finnhub", "yahoo"],
  analyst: ["fmp", "finnhub"],
  etfInfo: ["fmp", "yahoo"],
  etfHoldings: ["fmp", "yahoo"],
  etfSectors: ["fmp", "yahoo"],
  // Yahoo splits stock, bond and cash; FMP names one class for the whole fund.
  etfAssetClasses: ["yahoo", "fmp"],
};

/** One provider's way to fetch a value. */
export interface ProviderAttempt<T> {
  provider: DataProviderId;
  /** False skips the provider (no API key). Omitted means always available. */
  isAvailable?: () => boolean;
  /** Null, undefined, an empty result or a throw count as a miss. */
  fetch: () => Promise<T | null | undefined>;
}

/** One provider's way to fetch a symbol-keyed batch. */
export interface BatchProviderAttempt<V> {
  provider: DataProviderId;
  isAvailable?: () => boolean;
  /** Gets only the keys still missing. Keys it does not return stay missing. */
  fetch: (keys: string[]) => Promise<Map<string, V> | null | undefined>;
}

interface OrderOptions {
  /** Data category; a routed one reads its preferred provider from the settings. */
  category: DataCategory;
  /** Overrides the routed preference. Null means no preference. */
  preferred?: DataProviderId | null;
  /** Overrides the category's quality order. */
  order?: readonly DataProviderId[];
}

export interface ChainOptions<T> extends OrderOptions {
  attempts: ProviderAttempt<T>[];
  /** Default: null, undefined, an empty array, Map or Set, or an object without keys. */
  isEmpty?: (value: T) => boolean;
}

export interface BatchChainOptions<V> extends OrderOptions {
  keys: string[];
  attempts: BatchProviderAttempt<V>[];
  /** False drops a returned value so the next provider gets its key. */
  isValid?: (value: V) => boolean;
}

export interface ChainResult<T> {
  /** The first non-empty value; an empty value when every provider came back empty; null when none answered. */
  data: T | null;
  /** The provider of `data`, or null. */
  source: DataProviderId | null;
  /** Providers asked, in order. */
  tried: DataProviderId[];
  /** The last error a provider threw, if any. */
  error?: unknown;
}

export interface BatchChainResult<V> {
  data: Map<string, V>;
  /** Provider of each key in `data`. */
  sources: Map<string, DataProviderId>;
  /** Requested keys no provider supplied. */
  missing: string[];
  tried: DataProviderId[];
  error?: unknown;
}

/** The provider the user picked for a routed category, or undefined for any other category. */
export function preferredProvider(category: DataCategory): DataProviderId | undefined {
  if (!Object.hasOwn(DEFAULT_DATA_PROVIDER_ROUTING, category)) return undefined;
  const routing = { ...DEFAULT_DATA_PROVIDER_ROUTING, ...(loadConfig().dataProviderRouting || {}) };
  return routing[category as RoutedCategory];
}

/** The order the chain asks providers in: preferred first, then the quality order. */
export function providerOrder(options: OrderOptions): DataProviderId[] {
  const preferred = options.preferred === undefined ? preferredProvider(options.category) : options.preferred;
  const quality = options.order ?? CATEGORY_QUALITY_ORDER[options.category] ?? DEFAULT_QUALITY_ORDER;
  const out: DataProviderId[] = preferred ? [preferred] : [];
  for (const id of quality) if (!out.includes(id)) out.push(id);
  return out;
}

/** Attempts sorted by `providerOrder`; providers outside the order keep their place at the end. */
function sortAttempts<A extends { provider: DataProviderId }>(attempts: A[], options: OrderOptions): A[] {
  const order = providerOrder(options);
  const rank = (a: A) => {
    const i = order.indexOf(a.provider);
    return i === -1 ? order.length : i;
  };
  return attempts
    .map((attempt, index) => ({ attempt, index }))
    .sort((a, b) => rank(a.attempt) - rank(b.attempt) || a.index - b.index)
    .map((x) => x.attempt);
}

function available(attempt: { isAvailable?: () => boolean }): boolean {
  try {
    return attempt.isAvailable ? attempt.isAvailable() : true;
  } catch {
    return false;
  }
}

/** The default emptiness test of `firstAvailable`. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function logFailure(category: DataCategory, provider: DataProviderId, err: unknown): void {
  // The message can carry a symbol; log the error type only (AGENTS.md rule 3).
  const kind = err instanceof Error ? err.name : typeof err;
  appLogger.logStep("warning", "market_data", `${category}_provider_failed`, `${provider} failed for ${category} (${kind}); trying the next provider`);
}

/**
 * Asks providers in order and returns the first non-empty value.
 *
 * ```ts
 * const { data, source } = await firstAvailable<FmpEtfHolding[]>({
 *   category: "etfHoldings",
 *   attempts: [
 *     { provider: "fmp", isAvailable: () => fmp.isConfigured(), fetch: () => fmp.getEtfHoldings(symbol) },
 *   ],
 * });
 * ```
 */
export async function firstAvailable<T>(options: ChainOptions<T>): Promise<ChainResult<T>> {
  const isEmpty = options.isEmpty ?? ((v: T) => isEmptyValue(v));
  const tried: DataProviderId[] = [];
  let fallback: { data: T; source: DataProviderId } | null = null;
  let error: unknown;

  for (const attempt of sortAttempts(options.attempts, options)) {
    if (!available(attempt)) continue;
    tried.push(attempt.provider);
    try {
      const value = await attempt.fetch();
      if (value === null || value === undefined) continue;
      if (!isEmpty(value)) {
        if (tried.length > 1) {
          appLogger.logStep("debug", "market_data", `${options.category}_fallback`, `${options.category} served by ${attempt.provider} after ${tried.slice(0, -1).join(", ")}`);
        }
        return { data: value, source: attempt.provider, tried, error };
      }
      fallback ??= { data: value, source: attempt.provider };
    } catch (err) {
      error = err;
      logFailure(options.category, attempt.provider, err);
    }
  }

  return { data: fallback?.data ?? null, source: fallback?.source ?? null, tried, error };
}

/**
 * Resolves symbol-keyed data. Each provider gets the keys still missing, and
 * only the requested keys are kept.
 *
 * ```ts
 * const { data, sources, missing } = await fillByKey<YahooQuote>({
 *   category: "quotes",
 *   keys: ["AAPL", "VWCE.DE"],
 *   attempts: [
 *     { provider: "fmp", isAvailable: () => fmp.isConfigured(), fetch: (keys) => fmp.getQuotes(keys) },
 *     { provider: "yahoo", fetch: (keys) => yahoo.getQuotes(keys) },
 *   ],
 * });
 * ```
 */
export async function fillByKey<V>(options: BatchChainOptions<V>): Promise<BatchChainResult<V>> {
  const keys = Array.from(new Set(options.keys));
  const data = new Map<string, V>();
  const sources = new Map<string, DataProviderId>();
  const tried: DataProviderId[] = [];
  let error: unknown;

  for (const attempt of sortAttempts(options.attempts, options)) {
    const missing = keys.filter((k) => !data.has(k));
    if (missing.length === 0) break;
    if (!available(attempt)) continue;
    tried.push(attempt.provider);
    try {
      const result = await attempt.fetch(missing);
      if (!result) continue;
      let filled = 0;
      for (const key of missing) {
        if (!result.has(key)) continue;
        const value = result.get(key) as V;
        if (value === null || value === undefined) continue;
        if (options.isValid && !options.isValid(value)) continue;
        data.set(key, value);
        sources.set(key, attempt.provider);
        filled++;
      }
      if (tried.length > 1 && filled > 0) {
        appLogger.logStep("debug", "market_data", `${options.category}_fallback`, `${attempt.provider} filled ${filled} of ${missing.length} missing ${options.category} entries`);
      }
    } catch (err) {
      error = err;
      logFailure(options.category, attempt.provider, err);
    }
  }

  return { data, sources, missing: keys.filter((k) => !data.has(k)), tried, error };
}

/** The distinct providers behind a batch result, in first-seen order (for citing sources). */
export function distinctSources(sources: Map<string, DataProviderId>): DataProviderId[] {
  return Array.from(new Set(sources.values()));
}
