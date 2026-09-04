import { randomUUID } from "node:crypto";
import { getDatabase } from "./database.js";

export interface SnapshotRow {
  id: string;
  portfolioId: string;
  date: string;
  timestamp: number;
  totalValue: number;
  totalCost: number;
  totalGainLoss: number;
  cashBalance: number;
  totalPortfolioValue: number;
  holdingsJson: string | null;
  createdAt: string;
}

export function findByPortfolio(portfolioId: string): SnapshotRow[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM snapshots WHERE portfolioId = ? ORDER BY date ASC")
    .all(portfolioId) as SnapshotRow[];
}

export function upsert(data: {
  portfolioId: string;
  date: string;
  timestamp: number;
  totalValue: number;
  totalCost: number;
  totalGainLoss: number;
  cashBalance: number;
  totalPortfolioValue: number;
  holdingsJson?: string | null;
}): SnapshotRow {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO snapshots (id, portfolioId, date, timestamp, totalValue, totalCost, totalGainLoss, cashBalance, totalPortfolioValue, holdingsJson, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(portfolioId, date) DO UPDATE SET
       timestamp = excluded.timestamp, totalValue = excluded.totalValue, totalCost = excluded.totalCost,
       totalGainLoss = excluded.totalGainLoss, cashBalance = excluded.cashBalance,
       totalPortfolioValue = excluded.totalPortfolioValue, holdingsJson = excluded.holdingsJson`,
    [
      id, data.portfolioId, data.date, data.timestamp, data.totalValue,
      data.totalCost, data.totalGainLoss, data.cashBalance,
      data.totalPortfolioValue, data.holdingsJson ?? null, now,
    ],
  );

  // Return the upserted row
  const row = db
    .query("SELECT * FROM snapshots WHERE portfolioId = ? AND date = ?")
    .get(data.portfolioId, data.date) as SnapshotRow;
  return row;
}
