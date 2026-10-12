/**
 * A copy of the database for the user to keep. `VACUUM INTO` writes a
 * consistent, compacted snapshot while the service keeps running (WAL
 * readers and writers are not blocked), so the file opens in any SQLite
 * tool and can be put back as `<data dir>/portfolio.sqlite` to restore.
 * The copy holds the settings, API keys included, so the route that serves
 * it accepts only the desktop window (see routes.ts).
 *
 * The copy leaves out the market cache, which the app downloads again, and
 * the sessions, so no client stays signed in through a restored copy. It
 * keeps the earnings call summaries, which a model wrote.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../db/database";

export interface DatabaseBackup {
  fileName: string;
  bytes: Uint8Array;
}

/** `portfolio-backup-YYYY-MM-DD-HHMM.sqlite` in local time. */
export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `portfolio-backup-${date}-${pad(now.getHours())}${pad(now.getMinutes())}.sqlite`;
}

/** Snapshots the live database into memory and returns the bytes with a file name. */
export function createDatabaseBackup(): DatabaseBackup {
  const dir = mkdtempSync(join(tmpdir(), "portfolio-backup-"));
  const file = join(dir, "backup.sqlite");
  try {
    getDatabase().run("VACUUM INTO ?", [file]);
    // The snapshot is a private file in rollback journal mode: trimming it leaves the live database alone.
    const copy = new Database(file);
    try {
      copy.run("DELETE FROM market_cache WHERE key NOT LIKE 'intel:transcript-summary:%'");
      copy.run("DELETE FROM sessions");
      copy.run("VACUUM");
    } finally {
      copy.close();
    }
    // A Buffer is a Uint8Array: no second copy of a large file.
    return { fileName: backupFileName(), bytes: readFileSync(file) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
