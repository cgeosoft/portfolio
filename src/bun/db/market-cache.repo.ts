import { getDatabase } from "./database.js";
import { appLogger } from "../logger.js";

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

export function get<T = unknown>(key: string): CacheEntry<T> | null {
  try {
    const db = getDatabase();
    const row = db.query("SELECT * FROM market_cache WHERE key = ?").get(key) as CacheRow | null;
    if (!row) return null;

    const data = JSON.parse(row.data) as T;
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
    const serialized = JSON.stringify(data);

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
    appLogger.logStep("warning", "db", "market_cache_set", `Failed to cache key "${key}"`, undefined, {
      error: err instanceof Error ? err.message : String(err),
    });
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

export function clearExpired(): void {
  try {
    const db = getDatabase();
    db.run("DELETE FROM market_cache WHERE expiresAt < ?", [Date.now()]);
  } catch {
    // ignore
  }
}
