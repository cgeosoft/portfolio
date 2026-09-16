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
    .query("SELECT * FROM transactions WHERE portfolioId = ? ORDER BY date ASC, createdAt ASC")
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

export function update(id: string, data: Partial<TransactionInput>): TransactionRow | null {
  const db = getDatabase();
  const existing = findById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  db.run(
    `UPDATE transactions SET date = ?, datetime = ?, type = ?, assetClass = ?, name = ?, symbol = ?,
     isin = ?, shares = ?, price = ?, amount = ?, fee = ?, tax = ?, currency = ?, updatedAt = ?
     WHERE id = ?`,
    [
      data.date ?? existing.date, data.datetime ?? existing.datetime, data.type ?? existing.type,
      data.assetClass ?? existing.assetClass, data.name ?? existing.name, data.symbol ?? existing.symbol,
      data.isin ?? existing.isin, data.shares ?? existing.shares, data.price ?? existing.price,
      data.amount ?? existing.amount, data.fee ?? existing.fee, data.tax ?? existing.tax,
      data.currency ?? existing.currency, now, id,
    ],
  );
  return findById(id);
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const ids: string[] = [];

  const insertAll = db.transaction(() => {
    for (const tx of transactions) {
      const id = tx.id || generateId();
      ids.push(id);
      stmt.run(
        id, tx.portfolioId, tx.date, tx.datetime ?? null, tx.type,
        tx.assetClass ?? null, tx.name ?? null, tx.symbol, tx.isin ?? null,
        tx.shares ?? null, tx.price ?? null, tx.amount ?? null,
        tx.fee ?? null, tx.tax ?? null, tx.currency ?? "EUR", now, now,
      );
    }
  });

  insertAll();

  return ids.map((id) => findById(id)!).filter(Boolean);
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
