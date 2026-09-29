/**
 * A copy of the database for the user to keep. `VACUUM INTO` writes a
 * consistent, compacted snapshot while the service keeps running (WAL
 * readers and writers are not blocked), so the file opens in any SQLite
 * tool and can be put back as `<data dir>/portfolio.sqlite` to restore.
 * The copy holds everything, API keys included, so the route that serves it
 * accepts only the desktop window (see routes.ts).
 */
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
    return { fileName: backupFileName(), bytes: new Uint8Array(readFileSync(file)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
