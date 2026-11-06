/**
 * The privacy consent record: one JSON value in `kv_entries`. It proves on this
 * computer what the user chose, when, where and for which notice version.
 */
import type { ConsentRecord } from "portfolio-shared/api-types";
import { getDatabase } from "./database";

const CONSENT_KEY = "privacy:consent";

function isChoice(value: unknown): boolean {
  const choice = value as { granted?: unknown; at?: unknown; source?: unknown } | null;
  return typeof choice?.granted === "boolean" && typeof choice.at === "string" && typeof choice.source === "string";
}

export function readConsentRecord(): ConsentRecord | null {
  const row = getDatabase().query("SELECT value FROM kv_entries WHERE key = ?").get(CONSENT_KEY) as { value: string } | null;
  if (!row) return null;
  try {
    const record = JSON.parse(row.value) as ConsentRecord;
    return Number.isInteger(record?.noticeVersion) && isChoice(record.analytics) && isChoice(record.errorReporting) ? record : null;
  } catch {
    return null;
  }
}

export function writeConsentRecord(record: ConsentRecord): void {
  getDatabase().run(
    "INSERT INTO kv_entries (key, value, expiresAt) VALUES (?, ?, NULL) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expiresAt = NULL",
    [CONSENT_KEY, JSON.stringify(record)],
  );
}
