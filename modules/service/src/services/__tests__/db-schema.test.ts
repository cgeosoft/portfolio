/**
 * Database bootstrap: tables, indexes, pragmas, file modes and the migration of an old schema.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, setDataDirForTests } from "../../paths";
import { getDatabase, getDatabasePath, closeDatabase } from "../../db/database";
import { saveConfig, type DesktopConfig } from "../../config";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as reportRepo from "../../db/report.repo";

/** Points the service at an empty data dir; `restore()` goes back to the shared one. */
function useFreshDataDir(prefix = "portfolio-iso-"): { dir: string; restore: () => void } {
  const previous = DATA_DIR;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  setDataDirForTests(dir);
  closeDatabase();
  saveConfig({} as DesktopConfig);
  return {
    dir,
    restore: () => {
      closeDatabase();
      setDataDirForTests(previous);
      saveConfig({} as DesktopConfig);
    },
  };
}

/** Switches to `dir` without touching config, then opens the database there. */
function openDir(dir: string): Database {
  setDataDirForTests(dir);
  closeDatabase();
  return getDatabase();
}

const tables = (db: Database) =>
  (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
const indexes = (db: Database) =>
  (db.query("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
const cols = (db: Database, t: string) => (db.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((r) => r.name);
const versions = (db: Database) => db.query("SELECT version FROM schema_version").all();

const ALL_TABLES = [
  "assistant_conversations",
  "installed_metrics",
  "kv_entries",
  "manual_prices",
  "market_cache",
  "portfolios",
  "reports",
  "schema_version",
  "sessions",
  "settings",
  "snapshots",
  "suggestion_runs",
  "suggestions",
  "symbol_map",
  "transactions",
].sort();

const OLD_SCHEMA = `
CREATE TABLE portfolios (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Main Portfolio', description TEXT,
  baseCurrency TEXT NOT NULL DEFAULT 'EUR', createdAt TEXT NOT NULL DEFAULT (datetime('now')), updatedAt TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO portfolios (id, name, createdAt, updatedAt) VALUES ('p-old', 'Old', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
CREATE TABLE transactions (id TEXT PRIMARY KEY, portfolioId TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE, date TEXT NOT NULL,
  datetime TEXT, type TEXT NOT NULL, assetClass TEXT, name TEXT, symbol TEXT NOT NULL, isin TEXT, shares REAL, price REAL, amount REAL,
  fee REAL, tax REAL, currency TEXT NOT NULL DEFAULT 'EUR', createdAt TEXT NOT NULL DEFAULT (datetime('now')), updatedAt TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_transactions_symbol ON transactions(symbol);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_portfolio ON transactions(portfolioId);
CREATE TABLE reports (id TEXT PRIMARY KEY, portfolioId TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')), period TEXT NOT NULL, weekStartDate TEXT NOT NULL, weekEndDate TEXT NOT NULL,
  weekKey TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, content TEXT NOT NULL, metrics TEXT NOT NULL, model TEXT NOT NULL,
  provider TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'success', error TEXT, isFallback INTEGER NOT NULL DEFAULT 0);
INSERT INTO reports (id, portfolioId, period, weekStartDate, weekEndDate, weekKey, title, summary, content, metrics, model, provider)
  VALUES ('r-old', 'p-old', 'weekly', '2024-01-01', '2024-01-07', '2024-W01', 'T', 'S', 'C', '{}', 'm', 'p');
CREATE TABLE schema_version (version INTEGER NOT NULL);
INSERT INTO schema_version (version) VALUES (1);
`;

let env: ReturnType<typeof useFreshDataDir>;
beforeAll(() => {
  env = useFreshDataDir();
});
afterAll(() => env.restore());

describe("fresh database", () => {
  it("lives at <data dir>/portfolio.sqlite", () => {
    expect(getDatabasePath()).toBe(join(env.dir, "portfolio.sqlite"));
    getDatabase();
    expect(existsSync(getDatabasePath())).toBe(true);
  });

  it("has exactly the 15 tables and no config table", () => {
    const names = tables(getDatabase()).sort();
    expect(names).toEqual(ALL_TABLES);
    expect(names).not.toContain("config");
  });

  it("has the current named indexes and none of the dropped ones", () => {
    const names = indexes(getDatabase());
    for (const idx of ["idx_transactions_portfolio_order", "idx_reports_portfolio", "idx_conversations_portfolio_updated", "idx_suggestions_portfolio"]) {
      expect(names).toContain(idx);
    }
    for (const idx of [
      "idx_transactions_portfolio_date",
      "idx_transactions_portfolio",
      "idx_transactions_date",
      "idx_transactions_symbol",
      "idx_snapshots_portfolio",
      "idx_conversations_portfolio",
      "idx_conversations_updated",
    ]) {
      expect(names).not.toContain(idx);
    }
  });

  it("sets the connection pragmas", () => {
    const db = getDatabase();
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 1 });
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  });

  it("is a singleton until closed, and data survives a reopen", () => {
    const a = getDatabase();
    expect(getDatabase()).toBe(a);
    const p = portfolioRepo.create({ name: "Survivor" });
    closeDatabase();
    const b = getDatabase();
    expect(b).not.toBe(a);
    expect(portfolioRepo.findById(p.id)?.name).toBe("Survivor");
    expect(() => {
      closeDatabase();
      closeDatabase();
    }).not.toThrow();
    getDatabase();
  });

  it("has one schema_version row that a reopen does not duplicate", () => {
    expect(versions(getDatabase())).toEqual([{ version: 1 }]);
    closeDatabase();
    expect(versions(getDatabase())).toEqual([{ version: 1 }]);
  });

  it.skipIf(process.platform === "win32")("creates the database file with mode 0600", () => {
    getDatabase();
    expect(statSync(getDatabasePath()).mode & 0o777).toBe(0o600);
  });
});

describe("existing database files", () => {
  it.skipIf(process.platform === "win32")("tightens a 0644 database file to 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "portfolio-mode-"));
    const path = join(dir, "portfolio.sqlite");
    new Database(path, { create: true }).close();
    chmodSync(path, 0o644);
    openDir(dir);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("migrates an old schema in place", () => {
    const dir = mkdtempSync(join(tmpdir(), "portfolio-old-"));
    const seed = new Database(join(dir, "portfolio.sqlite"), { create: true });
    seed.exec(OLD_SCHEMA);
    seed.close();

    const db = openDir(dir);
    expect(cols(db, "portfolios")).toEqual(["id", "name", "description", "baseCurrency", "createdAt", "updatedAt", "metricsJson", "color"]);
    const p = portfolioRepo.findById("p-old");
    expect(p).not.toBeNull();
    expect(p!.name).toBe("Old");
    expect(p!.metricsJson).toBeNull();
    expect(p!.color).toBeNull();
    expect(p!.baseCurrency).toBe("EUR");

    expect(cols(db, "reports")).toContain("prompt");
    expect(reportRepo.findPrompt("p-old", "r-old")).toBeNull();
    expect(reportRepo.findById("r-old")!.title).toBe("T");

    const idx = indexes(db);
    expect(idx).not.toContain("idx_transactions_symbol");
    expect(idx).not.toContain("idx_transactions_date");
    expect(idx).not.toContain("idx_transactions_portfolio");
    expect(idx).toContain("idx_transactions_portfolio_order");

    expect(tables(db).sort()).toEqual(ALL_TABLES);
    expect(versions(db)).toEqual([{ version: 1 }]);
  });

  it("reopens a migrated database without changes", () => {
    expect(() => {
      closeDatabase();
      getDatabase();
    }).not.toThrow();
    expect(cols(getDatabase(), "portfolios").length).toBe(8);
  });

  it("keeps an existing schema_version value", () => {
    const dir = mkdtempSync(join(tmpdir(), "portfolio-ver-"));
    const seed = new Database(join(dir, "portfolio.sqlite"), { create: true });
    seed.exec("CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version (version) VALUES (7);");
    seed.close();
    const db = openDir(dir);
    expect(versions(db)).toEqual([{ version: 7 }]);
  });
});
