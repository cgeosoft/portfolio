import { randomUUID } from "node:crypto";
import { getDatabase } from "./database.js";

export interface PortfolioRow {
  id: string;
  name: string;
  description: string | null;
  baseCurrency: string;
  createdAt: string;
  updatedAt: string;
}

export function findAll(): PortfolioRow[] {
  const db = getDatabase();
  return db.query("SELECT * FROM portfolios ORDER BY createdAt ASC").all() as PortfolioRow[];
}

export function findById(id: string): PortfolioRow | null {
  const db = getDatabase();
  return (db.query("SELECT * FROM portfolios WHERE id = ?").get(id) as PortfolioRow) ?? null;
}

export function create(data: { name: string; description?: string | null; baseCurrency?: string }): PortfolioRow {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.run(
    "INSERT INTO portfolios (id, name, description, baseCurrency, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    [id, data.name, data.description ?? null, data.baseCurrency ?? "EUR", now, now],
  );
  return findById(id)!;
}

export function update(
  id: string,
  data: { name?: string; description?: string | null; baseCurrency?: string },
): PortfolioRow | null {
  const db = getDatabase();
  const existing = findById(id);
  if (!existing) return null;

  const name = data.name ?? existing.name;
  const description = data.description !== undefined ? data.description : existing.description;
  const baseCurrency = data.baseCurrency ?? existing.baseCurrency;
  const now = new Date().toISOString();

  db.run("UPDATE portfolios SET name = ?, description = ?, baseCurrency = ?, updatedAt = ? WHERE id = ?", [
    name,
    description,
    baseCurrency,
    now,
    id,
  ]);
  return findById(id);
}

export function deleteById(id: string): boolean {
  const db = getDatabase();
  // Cascade deletes handle transactions, reports, and snapshots
  const result = db.run("DELETE FROM portfolios WHERE id = ?", [id]);
  return result.changes > 0;
}

export function count(): number {
  const db = getDatabase();
  const row = db.query("SELECT COUNT(*) as cnt FROM portfolios").get() as { cnt: number };
  return row.cnt;
}
