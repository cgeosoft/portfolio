/**
 * Keys of push alerts already sent (services/event-alerts.ts), so an event is
 * announced once. Stored in `kv_entries` under `sent-alert:` with an expiry;
 * `AuthService.prune()` removes expired rows.
 */
import { getDatabase } from "./database.js";

const PREFIX = "sent-alert:";

/** The keys of `keys` that were sent and have not expired. */
export function findSent(keys: string[]): Set<string> {
  const sent = new Set<string>();
  if (keys.length === 0) return sent;
  const query = getDatabase().query("SELECT 1 FROM kv_entries WHERE key = ? AND (expiresAt IS NULL OR expiresAt >= ?)");
  const now = Date.now();
  for (const key of keys) if (query.get(PREFIX + key, now)) sent.add(key);
  return sent;
}

/** Marks `keys` as sent for `ttlMs`. */
export function markSent(keys: string[], ttlMs: number): void {
  if (keys.length === 0) return;
  const db = getDatabase();
  const upsert = db.prepare(
    "INSERT INTO kv_entries (key, value, expiresAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expiresAt = excluded.expiresAt",
  );
  const sentAt = new Date().toISOString();
  const expiresAt = Date.now() + ttlMs;
  db.transaction(() => {
    for (const key of keys) upsert.run(PREFIX + key, sentAt, expiresAt);
  })();
}
