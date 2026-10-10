import { getDatabase } from "./database.js";

export type SymbolMapSource = "auto" | "manual";

export interface SymbolMapRow {
  isin: string;
  symbol: string;
  name: string | null;
  source: SymbolMapSource;
  updatedAt: string;
}

export function findByIsin(isin: string): SymbolMapRow | null {
  const db = getDatabase();
  return (db.query("SELECT * FROM symbol_map WHERE isin = ?").get(isin.toUpperCase()) as SymbolMapRow) ?? null;
}

export function findAll(): SymbolMapRow[] {
  const db = getDatabase();
  return db.query("SELECT * FROM symbol_map ORDER BY isin ASC").all() as SymbolMapRow[];
}

/** Insert or replace one mapping. An "auto" row never replaces a "manual" one. */
export function upsert(data: { isin: string; symbol: string; name?: string | null; source: SymbolMapSource }): void {
  const db = getDatabase();
  const isin = data.isin.toUpperCase();
  if (data.source === "auto" && findByIsin(isin)?.source === "manual") return;
  db.run(
    `INSERT INTO symbol_map (isin, symbol, name, source, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(isin) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, source = excluded.source, updatedAt = excluded.updatedAt`,
    [isin, data.symbol.toUpperCase(), data.name ?? null, data.source, new Date().toISOString()],
  );
}

export function remove(isin: string): boolean {
  const db = getDatabase();
  return db.run("DELETE FROM symbol_map WHERE isin = ?", [isin.toUpperCase()]).changes > 0;
}
