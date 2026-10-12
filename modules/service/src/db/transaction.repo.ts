import { randomBytes } from "node:crypto";
import { getDatabase } from "./database.js";

export interface TransactionRow {
  id: string;
  portfolioId: string;
  date: string;
  datetime: string | null;
  type: string;
  assetClass: string | null;
  name: string | null;
  symbol: string;
  isin: string | null;
  shares: number | null;
  price: number | null;
  amount: number | null;
  fee: number | null;
  tax: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export type TransactionInput = Omit<TransactionRow, "createdAt" | "updatedAt">;

function generateId(): string {
  return `tx_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

export function findByPortfolio(portfolioId: string): TransactionRow[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM transactions WHERE portfolioId = ? ORDER BY date ASC, COALESCE(datetime, date) ASC, createdAt ASC")
    .all(portfolioId) as TransactionRow[];
}

export function findById(id: string): TransactionRow | null {
  const db = getDatabase();
  return (db.query("SELECT * FROM transactions WHERE id = ?").get(id) as TransactionRow) ?? null;
}

export function create(data: Partial<TransactionInput> & { portfolioId: string; date: string; type: string; symbol: string }): TransactionRow {
  const db = getDatabase();
  const id = data.id || generateId();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO transactions (id, portfolioId, date, datetime, type, assetClass, name, symbol, isin, shares, price, amount, fee, tax, currency, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, data.portfolioId, data.date, data.datetime ?? null, data.type,
      data.assetClass ?? null, data.name ?? null, data.symbol, data.isin ?? null,
      data.shares ?? null, data.price ?? null, data.amount ?? null,
      data.fee ?? null, data.tax ?? null, data.currency ?? "EUR", now, now,
    ],
  );
  return findById(id)!;
}

/** A field the update leaves out (null or undefined) keeps its stored value. */
const UPDATE_SQL = `UPDATE transactions SET date = COALESCE(?, date), datetime = COALESCE(?, datetime), type = COALESCE(?, type),
  assetClass = COALESCE(?, assetClass), name = COALESCE(?, name), symbol = COALESCE(?, symbol), isin = COALESCE(?, isin),
  shares = COALESCE(?, shares), price = COALESCE(?, price), amount = COALESCE(?, amount), fee = COALESCE(?, fee),
  tax = COALESCE(?, tax), currency = COALESCE(?, currency), updatedAt = ?
  WHERE id = ?`;

function updateParams(id: string, data: Partial<TransactionInput>, now: string) {
  return [
    data.date ?? null, data.datetime ?? null, data.type ?? null, data.assetClass ?? null, data.name ?? null,
    data.symbol ?? null, data.isin ?? null, data.shares ?? null, data.price ?? null, data.amount ?? null,
    data.fee ?? null, data.tax ?? null, data.currency ?? null, now, id,
  ];
}

export function update(id: string, data: Partial<TransactionInput>): TransactionRow | null {
  const changed = getDatabase().query(UPDATE_SQL).run(...updateParams(id, data, new Date().toISOString())).changes;
  return changed > 0 ? findById(id) : null;
}

export function deleteById(id: string): boolean {
  const db = getDatabase();
  const result = db.run("DELETE FROM transactions WHERE id = ?", [id]);
  return result.changes > 0;
}

export function bulkCreate(transactions: Array<Partial<TransactionInput> & { portfolioId: string; date: string; type: string; symbol: string }>): TransactionRow[] {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO transactions (id, portfolioId, date, datetime, type, assetClass, name, symbol, isin, shares, price, amount, fee, tax, currency, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  );

  const rows: TransactionRow[] = [];

  const insertAll = db.transaction(() => {
    for (const tx of transactions) {
      const id = tx.id || generateId();
      const row = stmt.get(
        id, tx.portfolioId, tx.date, tx.datetime ?? null, tx.type,
        tx.assetClass ?? null, tx.name ?? null, tx.symbol, tx.isin ?? null,
        tx.shares ?? null, tx.price ?? null, tx.amount ?? null,
        tx.fee ?? null, tx.tax ?? null, tx.currency ?? "EUR", now, now,
      ) as TransactionRow | null;
      if (row) rows.push(row);
    }
  });

  insertAll();

  return rows;
}

/**
 * Applies several updates atomically: one fsync for a whole CSV import
 * instead of one per row, and one compiled statement for every row.
 */
export function bulkUpdate(updates: Array<{ id: string; data: Partial<TransactionInput> }>): number {
  if (updates.length === 0) return 0;
  const db = getDatabase();
  const stmt = db.query(UPDATE_SQL);
  const now = new Date().toISOString();
  let changed = 0;
  db.transaction(() => {
    for (const { id, data } of updates) changed += stmt.run(...updateParams(id, data, now)).changes;
  })();
  return changed;
}

/** The new and the changed rows of one import in one transaction: a failure leaves the ledger as it was. */
export function saveImport(
  creates: Parameters<typeof bulkCreate>[0],
  updates: Parameters<typeof bulkUpdate>[0],
): { created: TransactionRow[]; updated: number } {
  const result: { created: TransactionRow[]; updated: number } = { created: [], updated: 0 };
  getDatabase().transaction(() => {
    if (creates.length > 0) result.created = bulkCreate(creates);
    result.updated = bulkUpdate(updates);
  })();
  return result;
}

export function countByPortfolio(portfolioId: string): number {
  const db = getDatabase();
  const row = db.query("SELECT COUNT(*) as cnt FROM transactions WHERE portfolioId = ?").get(portfolioId) as { cnt: number };
  return row.cnt;
}

export function countTotal(): number {
  const db = getDatabase();
  const row = db.query("SELECT COUNT(*) as cnt FROM transactions").get() as { cnt: number } | null;
  return row?.cnt ?? 0;
}

export function deleteByPortfolio(portfolioId: string): number {
  const db = getDatabase();
  const result = db.run("DELETE FROM transactions WHERE portfolioId = ?", [portfolioId]);
  return result.changes;
}

/**
 * Point every transaction of an ISIN at a new symbol, in all portfolios.
 * Matches the ISIN column, and the symbol column for rows that still carry
 * the ISIN as their symbol. A given name replaces the stored one.
 * Returns the ids of the portfolios that changed.
 */
export function setSymbolForIsin(isin: string, symbol: string, name?: string | null): string[] {
  const db = getDatabase();
  const key = isin.toUpperCase();
  const now = new Date().toISOString();
  const portfolios = db
    .query("SELECT DISTINCT portfolioId FROM transactions WHERE UPPER(isin) = ? OR UPPER(symbol) = ?")
    .all(key, key) as { portfolioId: string }[];
  if (portfolios.length === 0) return [];
  db.transaction(() => {
    db.run("UPDATE transactions SET symbol = ?, isin = ?, updatedAt = ? WHERE UPPER(isin) = ? OR UPPER(symbol) = ?", [symbol, key, now, key, key]);
    if (name) db.run("UPDATE transactions SET name = ? WHERE isin = ?", [name, key]);
  })();
  return portfolios.map((p) => p.portfolioId);
}
