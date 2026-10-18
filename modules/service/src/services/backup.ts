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
 *
 * The snapshot, the trim and the read run in a Worker on its own
 * connection: with a large market cache they take seconds, and the event
 * loop keeps serving requests meanwhile. The Worker source is inline, so the
 * single-file service bundle needs no second entry point.
 */
import { getDatabase, getDatabasePath } from "../db/database";

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

const WORKER_SOURCE = `
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

self.onmessage = async (event) => {
  const dir = mkdtempSync(join(tmpdir(), "portfolio-backup-"));
  const file = join(dir, "backup.sqlite");
  try {
    const live = new Database(event.data.dbPath, { readonly: true });
    try {
      live.run("PRAGMA busy_timeout = 5000");
      live.run("VACUUM INTO ?", [file]);
    } finally {
      live.close();
    }
    // The snapshot is a private file in rollback journal mode: trimming it leaves the live database alone.
    const copy = new Database(file);
    try {
      copy.run("DELETE FROM market_cache WHERE key NOT LIKE 'intel:transcript-summary:%'");
      copy.run("DELETE FROM sessions");
      copy.run("VACUUM");
    } finally {
      copy.close();
    }
    const buffer = await Bun.file(file).arrayBuffer();
    postMessage({ ok: true, buffer }, [buffer]);
  } catch (err) {
    postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
`;

let workerUrl: string | undefined;

type WorkerReply = { ok: true; buffer: ArrayBuffer } | { ok: false; error: string };

/** Snapshots the live database off the event loop and returns the bytes with a file name. */
export async function createDatabaseBackup(): Promise<DatabaseBackup> {
  // The schema exists before the copy is taken, as with the direct backup before.
  getDatabase();
  workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "application/javascript" }));
  const worker = new Worker(workerUrl);
  try {
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        if (event.data.ok) resolve(event.data.buffer);
        else reject(new Error(event.data.error));
      };
      worker.onerror = (event) => reject(new Error(event.message || "Database backup failed"));
      worker.postMessage({ dbPath: getDatabasePath() });
    });
    return { fileName: backupFileName(), bytes: new Uint8Array(buffer) };
  } finally {
    worker.terminate();
  }
}
