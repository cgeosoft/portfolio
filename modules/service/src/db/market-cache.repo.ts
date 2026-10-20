import { getDatabase } from "./database.js";
import { appLogger } from "../logger.js";
import { rememberJson, toJson } from "../json-cache.js";

/** How long `pruneExpired()` keeps an expired entry: providers fall back to it when a call fails. */
export const STALE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CacheEntry<T = unknown> {
  key: string;
  data: T;
  updatedAt: string;
  expiresAt: number;
  isExpired: boolean;
}

interface CacheRow {
  key: string;
  data: string;
  updatedAt: string;
  expiresAt: number;
}

/** `keepJson` keeps the stored text with the parsed object (json-cache.ts), for a payload sent as is. */
export function get<T = unknown>(key: string, options: { keepJson?: boolean } = {}): CacheEntry<T> | null {
  try {
    const db = getDatabase();
    const row = db.query("SELECT * FROM market_cache WHERE key = ?").get(key) as CacheRow | null;
    if (!row) return null;

    const data = JSON.parse(row.data) as T;
    if (options.keepJson && data && typeof data === "object") rememberJson(data, row.data);
    const now = Date.now();
    return {
      key: row.key,
      data,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
      isExpired: now > row.expiresAt,
    };
  } catch {
    return null;
  }
}

export function set<T = unknown>(key: string, data: T, ttlMs: number): void {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();
    const expiresAt = Date.now() + ttlMs;
    const serialized = toJson(data);

    db.run(
      `INSERT INTO market_cache (key, data, updatedAt, expiresAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         data = excluded.data,
         updatedAt = excluded.updatedAt,
         expiresAt = excluded.expiresAt`,
      [key, serialized, now, expiresAt],
    );
  } catch (err) {
    // The key can name a symbol (AGENTS.md rule 3), so the log names its kind only.
    appLogger.logStep("warning", "db", "market_cache_set", `Failed to cache a "${key.split(":", 1)[0]}" entry`, undefined, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Expiry of an entry in ms since the epoch, or null when there is none.
 * Reads no data, so a large entry (a portfolio) is not parsed.
 */
export function getExpiresAt(key: string): number | null {
  try {
    const row = getDatabase().query("SELECT expiresAt FROM market_cache WHERE key = ?").get(key) as { expiresAt: number } | null;
    return row ? row.expiresAt : null;
  } catch {
    return null;
  }
}

export function deleteKey(key: string): void {
  try {
    const db = getDatabase();
    db.run("DELETE FROM market_cache WHERE key = ?", [key]);
  } catch {
    // ignore
  }
}

/**
 * Removes every entry whose key starts with `prefix` (a portfolio's cached
 * data in every currency). The key range uses the primary key index, where
 * LIKE would scan the whole table. Prefixes are ASCII.
 */
export function deleteByPrefix(prefix: string): number {
  if (!prefix) return 0;
  try {
    const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
    return getDatabase().run("DELETE FROM market_cache WHERE key >= ? AND key < ?", [prefix, end]).changes;
  } catch {
    return 0;
  }
}

/**
 * Deletes the entries that expired more than `graceMs` ago and returns how
 * many. Some keys carry a date (the `from` of an FMP chart, a Finnhub news
 * window), so without this the table grows every day. `portfolio:` entries
 * stay: there is one per portfolio and currency, and it shows the last data
 * at start.
 */
export function pruneExpired(graceMs = STALE_GRACE_MS): number {
  try {
    return getDatabase().run("DELETE FROM market_cache WHERE expiresAt < ? AND key NOT LIKE 'portfolio:%'", [Date.now() - graceMs]).changes;
  } catch {
    return 0;
  }
}

export function clearMarketData(): number {
  try {
    const db = getDatabase();
    const res = db.run(
      "DELETE FROM market_cache WHERE key LIKE 'quote:%' OR key LIKE 'chart:%' OR key LIKE 'fx:%' OR key LIKE 'finnhub:%' OR key LIKE 'yahoo:%' OR key LIKE 'fmp:%'",
    );
    return res.changes;
  } catch {
    return 0;
  }
}
