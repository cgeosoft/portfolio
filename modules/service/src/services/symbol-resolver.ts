/**
 * ISIN to ticker resolution for imported transactions.
 *
 * Brokers such as Trade Republic export the ISIN only. The resolver looks it
 * up in the stored map (`symbol_map`), then searches the providers through
 * the market data chain (FMP ISIN search first when a key is set, then Yahoo
 * and Finnhub search) and keeps what it finds. A mapping the user set by hand
 * always wins over a search result.
 *
 * Listing choice: the primary listing of the ISIN's home market (META for a
 * US ISIN, RHM.DE for a German one), else a listing in the portfolio's base
 * currency (EUNL.DE for an Irish ETF in a EUR portfolio), else the first hit.
 */

import { appLogger } from "../logger.js";
import * as symbolMapRepo from "../db/symbol-map.repo.js";
import * as txRepo from "../db/transaction.repo.js";
import { isIsin } from "./providers/identifiers.js";
import { mapWithConcurrencyLimit, type YahooSymbolSearchResult } from "./yahoo-finance.js";

export interface SymbolSearcher {
  searchSymbols(query: string): Promise<YahooSymbolSearchResult[]>;
}

export interface ResolvedSymbol {
  symbol: string;
  name?: string;
  source: symbolMapRepo.SymbolMapSource;
}

/** Yahoo suffix of each exchange and the currency it quotes in. */
const SUFFIX_CURRENCY: Record<string, string> = {
  DE: "EUR", F: "EUR", BE: "EUR", DU: "EUR", HM: "EUR", MU: "EUR", SG: "EUR", HA: "EUR",
  PA: "EUR", AS: "EUR", MI: "EUR", MC: "EUR", BR: "EUR", VI: "EUR", LS: "EUR", HE: "EUR", IR: "EUR",
  L: "GBP", IL: "GBP", SW: "CHF", TO: "CAD", V: "CAD", NE: "CAD", AX: "AUD", NZ: "NZD",
  HK: "HKD", T: "JPY", ST: "SEK", CO: "DKK", OL: "NOK", WA: "PLN", PR: "CZK", BD: "HUF",
  SI: "SGD", KS: "KRW", TW: "TWD", SA: "BRL", MX: "MXN", JO: "ZAR", IS: "TRY",
};

/** Within one currency, the venue to prefer first (Xetra before the regional German exchanges). */
const SUFFIX_RANK = ["DE", "PA", "AS", "MI", "MC", "BR", "VI", "LS", "HE", "IR", "F", "SG", "MU", "BE", "DU", "HM", "HA"];

/** Home market of an ISIN country prefix. An empty suffix is a US listing. */
const HOME_SUFFIXES: Record<string, string[]> = {
  US: [""], CA: ["TO", "V", "NE"], DE: ["DE"], FR: ["PA"], NL: ["AS"], IT: ["MI"], ES: ["MC"],
  BE: ["BR"], AT: ["VI"], PT: ["LS"], FI: ["HE"], GB: ["L"], CH: ["SW"], SE: ["ST"], DK: ["CO"],
  NO: ["OL"], JP: ["T"], HK: ["HK"], AU: ["AX"], PL: ["WA"],
};

/** Exchange suffix of a Yahoo-style symbol: "DE" for "SAP.DE", "" for "AAPL". */
function suffixOf(symbol: string): string {
  const dot = symbol.lastIndexOf(".");
  return dot > 0 ? symbol.slice(dot + 1).toUpperCase() : "";
}

/** Quote currency implied by the symbol, or undefined when it does not say. */
export function listingCurrency(symbol: string): string | undefined {
  const upper = symbol.toUpperCase();
  const pair = /^[A-Z0-9]+-([A-Z]{3})$/.exec(upper);
  if (pair) return pair[1];
  const suffix = suffixOf(upper);
  if (!suffix) return "USD";
  return SUFFIX_CURRENCY[suffix];
}

/** Pick the listing to use for an ISIN from provider search results. */
export function pickListing(isin: string, results: YahooSymbolSearchResult[], baseCurrency: string): YahooSymbolSearchResult | undefined {
  const candidates = results.filter((r) => r?.symbol && !isIsin(r.symbol));
  if (candidates.length === 0) return undefined;
  const home = HOME_SUFFIXES[isin.slice(0, 2).toUpperCase()];
  const base = baseCurrency.toUpperCase();
  const score = (r: YahooSymbolSearchResult, index: number): number[] => {
    const suffix = suffixOf(r.symbol);
    const rank = SUFFIX_RANK.indexOf(suffix);
    return [
      home?.includes(suffix) ? 0 : 1,
      listingCurrency(r.symbol) === base ? 0 : 1,
      rank === -1 ? SUFFIX_RANK.length : rank,
      index,
    ];
  };
  const scored = candidates.map((r, i) => ({ r, s: score(r, i) }));
  scored.sort((a, b) => {
    for (let i = 0; i < a.s.length; i++) if (a.s[i] !== b.s[i]) return a.s[i]! - b.s[i]!;
    return 0;
  });
  return scored[0]!.r;
}

/** Transactions as the resolver sees them. */
export interface ResolvableTransaction {
  symbol?: string | null;
  isin?: string | null;
  name?: string | null;
  assetClass?: string | null;
  currency?: string | null;
}

/** The ISIN a transaction refers to, from the ISIN field or a symbol that is an ISIN. */
export function transactionIsin(tx: ResolvableTransaction): string | undefined {
  const isin = (tx.isin || "").trim().toUpperCase();
  if (isin && isIsin(isin)) return isin;
  const symbol = (tx.symbol || "").trim().toUpperCase();
  if (symbol && isIsin(symbol)) return symbol;
  return undefined;
}

/** True when the transaction has no ticker of its own: no symbol, or the ISIN as the symbol. */
function needsSymbol(tx: ResolvableTransaction, isin: string): boolean {
  const symbol = (tx.symbol || "").trim().toUpperCase();
  return !symbol || symbol === isin;
}

/**
 * Yahoo pair for a crypto transaction that names the coin only: "BTC" in a
 * EUR account becomes "BTC-EUR". Undefined when the symbol needs no change.
 */
export function cryptoPair(tx: ResolvableTransaction, baseCurrency: string): string | undefined {
  if ((tx.assetClass || "").toUpperCase() !== "CRYPTO") return undefined;
  const symbol = (tx.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol) || isIsin(symbol)) return undefined;
  const currency = (tx.currency || baseCurrency || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? `${symbol}-${currency}` : undefined;
}

function isPrivateAsset(tx: ResolvableTransaction): boolean {
  return Boolean(tx.assetClass && tx.assetClass.toUpperCase().includes("PRIVATE"));
}

const SEARCH_CONCURRENCY = 3;
/** How long an ISIN with no search hit is left alone before the next try. */
const MISS_TTL_MS = 60 * 60 * 1000;

export class SymbolResolver {
  private readonly misses = new Map<string, number>();

  constructor(private readonly searcher: SymbolSearcher) {}

  /** Stored or searched symbol of each ISIN. ISINs with no result are left out. */
  public async resolveIsins(isins: string[], baseCurrency: string): Promise<Map<string, ResolvedSymbol>> {
    const out = new Map<string, ResolvedSymbol>();
    const toSearch: string[] = [];
    for (const raw of new Set(isins.map((i) => i.trim().toUpperCase()))) {
      if (!isIsin(raw)) continue;
      const stored = symbolMapRepo.findByIsin(raw);
      if (stored) {
        out.set(raw, { symbol: stored.symbol, name: stored.name ?? undefined, source: stored.source });
        continue;
      }
      const missedAt = this.misses.get(raw);
      if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) continue;
      toSearch.push(raw);
    }

    let found = 0;
    await mapWithConcurrencyLimit(toSearch, SEARCH_CONCURRENCY, async (isin) => {
      try {
        const listing = pickListing(isin, await this.searcher.searchSymbols(isin), baseCurrency);
        if (!listing) {
          this.misses.set(isin, Date.now());
          return;
        }
        const name = listing.name && listing.name !== listing.symbol ? listing.name : undefined;
        symbolMapRepo.upsert({ isin, symbol: listing.symbol, name, source: "auto" });
        out.set(isin, { symbol: listing.symbol.toUpperCase(), name, source: "auto" });
        found++;
      } catch {
        // No message: provider errors can echo the query, and the log never names holdings.
        this.misses.set(isin, Date.now());
        appLogger.logStep("warning", "symbols", "isin_search_failed", "ISIN search failed");
      }
    });
    if (toSearch.length > 0) {
      appLogger.logStep("info", "symbols", "isin_resolved", `Resolved ${found} of ${toSearch.length} ISINs by search`);
    }
    return out;
  }

  /**
   * Fill in the ticker of transactions that carry only an ISIN. Sets `isin`
   * when the symbol was the ISIN, and the name when it was empty or the ISIN.
   * A bare crypto code becomes its pair in the transaction currency.
   * Returns the transactions changed in place. Private assets are skipped:
   * they have no public listing.
   */
  public async applyToTransactions<T extends ResolvableTransaction>(transactions: T[], baseCurrency: string): Promise<T[]> {
    const pending: { tx: T; isin: string }[] = [];
    const changed: T[] = [];
    for (const tx of transactions) {
      const pair = cryptoPair(tx, baseCurrency);
      if (pair) {
        tx.symbol = pair;
        changed.push(tx);
        continue;
      }
      const isin = transactionIsin(tx);
      if (!isin) continue;
      if (!tx.isin) tx.isin = isin;
      if (isPrivateAsset(tx) || !needsSymbol(tx, isin)) continue;
      pending.push({ tx, isin });
    }
    if (pending.length === 0) return changed;

    const resolved = await this.resolveIsins(pending.map((p) => p.isin), baseCurrency);
    for (const { tx, isin } of pending) {
      const hit = resolved.get(isin);
      if (!hit) continue;
      tx.symbol = hit.symbol;
      const name = (tx.name || "").trim();
      if (hit.name && (!name || name.toUpperCase() === isin)) tx.name = hit.name;
      changed.push(tx);
    }
    return changed;
  }

  /**
   * Store the user's own symbol for an ISIN and repoint its transactions in
   * every portfolio. Returns the ids of the portfolios that changed.
   */
  public setManualSymbol(isin: string, symbol: string, name?: string | null): string[] {
    const key = isin.trim().toUpperCase();
    const sym = symbol.trim().toUpperCase();
    const cleanName = name?.trim() || null;
    symbolMapRepo.upsert({ isin: key, symbol: sym, name: cleanName, source: "manual" });
    this.misses.delete(key);
    return txRepo.setSymbolForIsin(key, sym, cleanName);
  }
}
