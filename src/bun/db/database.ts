import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { getStorageDir } from "../config.js";

const DB_PATH = join(getStorageDir(), "data", "portfolio.sqlite");

let db: Database | null = null;

/** Get or create the SQLite database connection */
export function getDatabase(): Database {
  if (db) return db;

  // Ensure directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH, { create: true });

  // Enable WAL mode for better concurrent read performance
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");

  initializeSchema(db);

  return db;
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

  database.run(`CREATE INDEX IF NOT EXISTS idx_transactions_portfolio ON transactions(portfolioId)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_transactions_symbol ON transactions(symbol)`);

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

  database.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_portfolio ON snapshots(portfolioId)`);

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
