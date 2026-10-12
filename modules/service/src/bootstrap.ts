/**
 * Prepares the user data directory (`DATA_DIR` in `paths.ts`) before the
 * database is opened.
 *
 * Releases before 0.6 kept the database in `<old dir>/data/portfolio.sqlite`,
 * with `<old dir>` = `~/.config/portfolio` on Linux and the data directory
 * itself on macOS and Windows. When the data directory has no database yet
 * and the old location has one, the files are copied over once: the database
 * to `<data>/portfolio.sqlite` and every other entry of the old directory
 * as is. SQLite side files (`-wal`, `-shm`, `-journal`) are skipped, so the
 * old database is checkpointed first. The old directory stays in place.
 *
 * Tests call `setDataDirForTests`, which turns the import off.
 */

import { Database } from "bun:sqlite";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, LEGACY_DATA_DIR, getDatabaseFile } from "./paths";

const SIDE_FILE = /\.sqlite-(shm|wal|journal)$/;

let done = false;

/**
 * Closes a directory to everyone but its owner (mode 0700). The data
 * directory holds the database with the API keys in plain text and the logs;
 * the files inside keep the default mode, so the directory is what stops
 * another account on the computer from reading them. Applied on every start:
 * earlier releases and the desktop shell (which may create `logs/` first)
 * made it with the default mode. Windows keeps `%APPDATA%` per user already.
 */
function restrictToOwner(dir: string): void {
  if (process.platform === "win32") return;
  try {
    if ((statSync(dir).mode & 0o077) !== 0) chmodSync(dir, 0o700);
  } catch {
    // A file system without modes, or a directory we do not own: leave it as it is.
  }
}

/** Creates `DATA_DIR` and imports the old data directory into it on the first run. Idempotent. */
export function ensureDataDir(): string | undefined {
  if (done) return undefined;
  done = true;
  mkdirSync(DATA_DIR, { recursive: true });
  restrictToOwner(DATA_DIR);

  const dbFile = getDatabaseFile();
  if (existsSync(dbFile) || !LEGACY_DATA_DIR) return undefined;
  const legacyDb = join(LEGACY_DATA_DIR, "data", "portfolio.sqlite");
  if (!existsSync(legacyDb)) return undefined;

  // Fold the write-ahead log into the old database file, so the copy is complete without it.
  try {
    const old = new Database(legacyDb);
    old.run("PRAGMA wal_checkpoint(TRUNCATE)");
    old.close();
  } catch {
    // A database that cannot be opened is copied as it is.
  }
  cpSync(legacyDb, dbFile);

  if (LEGACY_DATA_DIR !== DATA_DIR) {
    for (const name of readdirSync(LEGACY_DATA_DIR)) {
      const to = join(DATA_DIR, name);
      if (name === "data" || existsSync(to)) continue;
      cpSync(join(LEGACY_DATA_DIR, name), to, { recursive: true, filter: (src) => !SIDE_FILE.test(src) });
    }
  }
  return LEGACY_DATA_DIR;
}
