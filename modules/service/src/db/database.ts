import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getDatabaseFile } from "../paths";

let db: Database | null = null;

/** Absolute path of the database file, `<data dir>/portfolio.sqlite` (see paths.ts). */
export function getDatabasePath(): string {
  return getDatabaseFile();
}

/** Get or create the SQLite database connection */
export function getDatabase(): Database {
  if (db) return db;

  const dbPath = getDatabaseFile();
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrent read performance
  db.run("PRAGMA journal_mode = WAL");
  // With WAL, NORMAL still survives a crash; it only skips the fsync per commit.
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  restrictFileModes(dbPath);

  initializeSchema(db);

  return db;
}

/**
 * Makes the database and its WAL files readable by the owner only. The data
 * folder is 0700, but a copied or restored folder can keep 0644 files.
 * Windows has no POSIX modes, so this is a no-op there.
 */
function restrictFileModes(dbPath: string): void {
  if (process.platform === "win32") return;
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (existsSync(file)) chmodSync(file, 0o600);
    } catch {
      // A read-only or foreign-owned file keeps its mode; the 0700 folder still guards it.
    }
  }
}

/** Create tables and indexes if they do not exist */
function initializeSchema(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS portfolios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Main Portfolio',
      description TEXT,
      baseCurrency TEXT NOT NULL DEFAULT 'EUR',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Per-portfolio overview metric selection (metrics marketplace)
  const portfolioColumns = database.query("PRAGMA table_info(portfolios)").all() as { name: string }[];
  if (!portfolioColumns.some((col) => col.name === "metricsJson")) {
    database.run("ALTER TABLE portfolios ADD COLUMN metricsJson TEXT");
  }
  // The colour of the portfolio dot (`#rrggbb`); null means the default of the GUI.
  if (!portfolioColumns.some((col) => col.name === "color")) {
    database.run("ALTER TABLE portfolios ADD COLUMN color TEXT");
  }

  database.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      portfolioId TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      datetime TEXT,
      type TEXT NOT NULL,
      assetClass TEXT,
      name TEXT,
      symbol TEXT NOT NULL,
      isin TEXT,
      shares REAL,
      price REAL,
      amount REAL,
      fee REAL,
      tax REAL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Serves every portfolioId lookup, the delete cascade and the date order of the ledger read.
  database.run(`CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_date ON transactions(portfolioId, date, createdAt)`);
  // No query filters on date or symbol alone, and the index above leads with portfolioId:
  // these three only cost a B-tree write per imported row.
  database.run("DROP INDEX IF EXISTS idx_transactions_portfolio");
  database.run("DROP INDEX IF EXISTS idx_transactions_date");
  database.run("DROP INDEX IF EXISTS idx_transactions_symbol");

  database.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      portfolioId TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      period TEXT NOT NULL,
      weekStartDate TEXT NOT NULL,
      weekEndDate TEXT NOT NULL,
      weekKey TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      prompt TEXT,
      metrics TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      error TEXT,
      isFallback INTEGER NOT NULL DEFAULT 0
    )
  `);

  const reportColumns = database.query("PRAGMA table_info(reports)").all() as { name: string }[];
  if (!reportColumns.some((col) => col.name === "prompt")) {
    database.run("ALTER TABLE reports ADD COLUMN prompt TEXT");
  }

  database.run(`CREATE INDEX IF NOT EXISTS idx_reports_portfolio ON reports(portfolioId)`);

  database.run(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      portfolioId TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      totalValue REAL NOT NULL,
      totalCost REAL NOT NULL,
      totalGainLoss REAL NOT NULL,
      cashBalance REAL NOT NULL DEFAULT 0,
      totalPortfolioValue REAL NOT NULL,
      holdingsJson TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(portfolioId, date)
    )
  `);

  // UNIQUE(portfolioId, date) already indexes portfolioId.
  database.run("DROP INDEX IF EXISTS idx_snapshots_portfolio");

  database.run(`
    CREATE TABLE IF NOT EXISTS market_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      expiresAt INTEGER NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS assistant_conversations (
      id TEXT PRIMARY KEY,
      portfolioId TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New Chat',
      messages TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.run(`CREATE INDEX IF NOT EXISTS idx_conversations_portfolio ON assistant_conversations(portfolioId)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_conversations_updated ON assistant_conversations(updatedAt)`);

  // Metric modules installed from a URL. Built-in modules are embedded in the bundle.
  database.run(`
    CREATE TABLE IF NOT EXISTS installed_metrics (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      source TEXT NOT NULL,
      sourceUrl TEXT,
      sha256 TEXT NOT NULL,
      manifestYaml TEXT NOT NULL,
      scopesGranted TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      installedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ISIN to ticker map shared by all portfolios (see symbol-map.repo.ts).
  // source is "auto" (found by a provider search) or "manual" (set by the user).
  database.run(`
    CREATE TABLE IF NOT EXISTS symbol_map (
      isin TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT,
      source TEXT NOT NULL DEFAULT 'auto',
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Price or NAV the user entered for a private holding that has no quote
  // (see manual-price.repo.ts). setAt is the day it was entered.
  database.run(`
    CREATE TABLE IF NOT EXISTS manual_prices (
      portfolioId TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT NOT NULL,
      setAt TEXT NOT NULL,
      PRIMARY KEY (portfolioId, symbol)
    )
  `);

  // Rebalancing suggestions from the model (see suggestion.repo.ts). Weights
  // in percent only; validity and fundedBy are JSON.
  database.run(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id TEXT PRIMARY KEY,
      portfolioId TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      action TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      fromWeight REAL NOT NULL,
      targetWeight REAL NOT NULL,
      title TEXT NOT NULL,
      why TEXT NOT NULL,
      priority INTEGER NOT NULL,
      validity TEXT NOT NULL,
      fundedBy TEXT NOT NULL,
      status TEXT NOT NULL,
      statusReason TEXT,
      dismissedAtWeight REAL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      resolvedAt TEXT
    )
  `);
  database.run("CREATE INDEX IF NOT EXISTS idx_suggestions_portfolio ON suggestions(portfolioId, status)");
  // One row per portfolio: the last generation and the transaction state it saw.
  database.run(`
    CREATE TABLE IF NOT EXISTS suggestion_runs (
      portfolioId TEXT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
      generatedAt TEXT NOT NULL,
      txFingerprint TEXT NOT NULL,
      summary TEXT,
      notes TEXT NOT NULL,
      provider TEXT,
      model TEXT
    )
  `);

  // User settings, one row per DesktopConfig key (see ../config.ts).
  database.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Login sessions (cookie id -> expiry) and small expiring counters such as
  // the PIN attempt limit (see ../services/auth.ts).
  database.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      expiresAt INTEGER NOT NULL
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS kv_entries (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expiresAt INTEGER
    )
  `);

  // Schema version tracking for future migrations
  database.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    )
  `);

  const versionRow = database.query("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | null;
  if (!versionRow) {
    database.run("INSERT INTO schema_version (version) VALUES (1)");
  }
}

/** Close the database connection */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
