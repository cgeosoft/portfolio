import { getDatabase } from "./database.js";

export interface ReportRow {
  id: string;
  portfolioId: string;
  createdAt: string;
  period: string;
  weekStartDate: string;
  weekEndDate: string;
  weekKey: string;
  title: string;
  summary: string;
  content: string;
  prompt?: string | null;
  metrics: string; // JSON string
  model: string;
  provider: string;
  status: "success" | "fallback" | "error";
  error: string | null;
  isFallback: number; // 0 or 1
}

export interface ReportMetrics {
  totalPortfolioValue: number;
  periodGainLossDollar?: number;
  periodGainLossPercent?: number;
  weeklyGainLossDollar?: number;
  weeklyGainLossPercent?: number;
  cashBalance: number;
  baseCurrency: string;
  holdingsCount: number;
  topWinner?: { symbol: string; changePercent: number };
  topLoser?: { symbol: string; changePercent: number };
}

export function findByPortfolio(portfolioId: string, limit = 52): ReportRow[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM reports WHERE portfolioId = ? ORDER BY weekStartDate DESC, createdAt DESC LIMIT ?")
    .all(portfolioId, limit) as ReportRow[];
}

export function findById(id: string): ReportRow | null {
  const db = getDatabase();
  return (db.query("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow) ?? null;
}

export function upsert(data: {
  id: string;
  portfolioId: string;
  period: string;
  weekStartDate: string;
  weekEndDate: string;
  weekKey: string;
  title: string;
  summary: string;
  content: string;
  prompt?: string | null;
  metrics: ReportMetrics;
  model: string;
  provider: string;
  status?: "success" | "fallback" | "error";
  error?: string | null;
  isFallback?: boolean;
}): ReportRow {
  const db = getDatabase();
  const metricsJson = JSON.stringify(data.metrics);
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO reports (id, portfolioId, createdAt, period, weekStartDate, weekEndDate, weekKey, title, summary, content, prompt, metrics, model, provider, status, error, isFallback)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, summary = excluded.summary, content = excluded.content, prompt = excluded.prompt,
       metrics = excluded.metrics, model = excluded.model, provider = excluded.provider,
       status = excluded.status, error = excluded.error, isFallback = excluded.isFallback`,
    [
      data.id, data.portfolioId, now, data.period, data.weekStartDate, data.weekEndDate,
      data.weekKey, data.title, data.summary, data.content, data.prompt ?? null, metricsJson,
      data.model, data.provider, data.status ?? "success", data.error ?? null,
      data.isFallback ? 1 : 0,
    ],
  );

  return findById(data.id)!;
}

export function deleteById(id: string, portfolioId: string): boolean {
  const db = getDatabase();
  const result = db.run("DELETE FROM reports WHERE id = ? AND portfolioId = ?", [id, portfolioId]);
  return result.changes > 0;
}
