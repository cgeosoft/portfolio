import { getDatabase } from "./database.js";

/** A price or NAV the user entered for a private holding of one portfolio. */
export interface ManualPriceRow {
  portfolioId: string;
  symbol: string;
  price: number;
  currency: string;
  /** Day the price was entered, `YYYY-MM-DD`. */
  setAt: string;
}

export function findByPortfolio(portfolioId: string): ManualPriceRow[] {
  const db = getDatabase();
  return db.query("SELECT * FROM manual_prices WHERE portfolioId = ? ORDER BY symbol ASC").all(portfolioId) as ManualPriceRow[];
}

export function find(portfolioId: string, symbol: string): ManualPriceRow | null {
  const db = getDatabase();
  return (
    (db.query("SELECT * FROM manual_prices WHERE portfolioId = ? AND symbol = ?").get(portfolioId, symbol.toUpperCase()) as ManualPriceRow) ??
    null
  );
}

/** Insert or replace the price of one holding. */
export function upsert(data: ManualPriceRow): ManualPriceRow {
  const db = getDatabase();
  const symbol = data.symbol.toUpperCase();
  db.run(
    `INSERT INTO manual_prices (portfolioId, symbol, price, currency, setAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(portfolioId, symbol) DO UPDATE SET price = excluded.price, currency = excluded.currency, setAt = excluded.setAt`,
    [data.portfolioId, symbol, data.price, data.currency.toUpperCase(), data.setAt],
  );
  return find(data.portfolioId, symbol)!;
}

export function remove(portfolioId: string, symbol: string): boolean {
  const db = getDatabase();
  return db.run("DELETE FROM manual_prices WHERE portfolioId = ? AND symbol = ?", [portfolioId, symbol.toUpperCase()]).changes > 0;
}
