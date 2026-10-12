import { createHash, randomBytes } from "node:crypto";
import type { PortfolioSuggestion, SuggestionFunding, SuggestionStoredStatus, SuggestionValidity } from "portfolio-shared/suggestions";
import { getDatabase } from "./database.js";

/** Rows the history keeps per portfolio, besides the active ones. */
const HISTORY_LIMIT = 200;

interface SuggestionRow extends Omit<PortfolioSuggestion, "validity" | "fundedBy" | "statusReason" | "dismissedAtWeight" | "resolvedAt"> {
  validity: string;
  fundedBy: string;
  statusReason: string | null;
  dismissedAtWeight: number | null;
  resolvedAt: string | null;
}

export interface SuggestionRunRow {
  portfolioId: string;
  generatedAt: string;
  txFingerprint: string;
  summary: string | null;
  /** JSON array of strings. */
  notes: string;
  provider: string | null;
  model: string | null;
}

function toSuggestion(row: SuggestionRow): PortfolioSuggestion {
  return {
    ...row,
    validity: JSON.parse(row.validity) as SuggestionValidity,
    fundedBy: JSON.parse(row.fundedBy) as SuggestionFunding[],
    statusReason: row.statusReason ?? undefined,
    dismissedAtWeight: row.dismissedAtWeight ?? undefined,
    resolvedAt: row.resolvedAt ?? undefined,
  };
}

export function newSuggestionId(): string {
  return `sg_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

export function findByPortfolio(portfolioId: string): PortfolioSuggestion[] {
  const rows = getDatabase()
    .query("SELECT * FROM suggestions WHERE portfolioId = ? ORDER BY priority ASC, createdAt ASC")
    .all(portfolioId) as SuggestionRow[];
  return rows.map(toSuggestion);
}

export function findById(portfolioId: string, id: string): PortfolioSuggestion | null {
  const row = getDatabase().query("SELECT * FROM suggestions WHERE portfolioId = ? AND id = ?").get(portfolioId, id) as SuggestionRow | null;
  return row ? toSuggestion(row) : null;
}

export function upsert(s: PortfolioSuggestion): void {
  getDatabase().run(
    `INSERT INTO suggestions (id, portfolioId, key, action, symbol, name, fromWeight, targetWeight, title, why, priority, validity, fundedBy, status, statusReason, dismissedAtWeight, createdAt, updatedAt, resolvedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, fromWeight = excluded.fromWeight, targetWeight = excluded.targetWeight, title = excluded.title, why = excluded.why,
       priority = excluded.priority, validity = excluded.validity, fundedBy = excluded.fundedBy, status = excluded.status,
       statusReason = excluded.statusReason, dismissedAtWeight = excluded.dismissedAtWeight, updatedAt = excluded.updatedAt, resolvedAt = excluded.resolvedAt`,
    [
      s.id,
      s.portfolioId,
      s.key,
      s.action,
      s.symbol,
      s.name,
      s.fromWeight,
      s.targetWeight,
      s.title,
      s.why,
      s.priority,
      JSON.stringify(s.validity),
      JSON.stringify(s.fundedBy),
      s.status,
      s.statusReason ?? null,
      s.dismissedAtWeight ?? null,
      s.createdAt,
      s.updatedAt,
      s.resolvedAt ?? null,
    ],
  );
}

export function setStatus(
  portfolioId: string,
  id: string,
  status: SuggestionStoredStatus,
  extra: { statusReason?: string | null; dismissedAtWeight?: number | null } = {},
): PortfolioSuggestion | null {
  const now = new Date().toISOString();
  getDatabase().run(
    "UPDATE suggestions SET status = ?, statusReason = ?, dismissedAtWeight = ?, updatedAt = ?, resolvedAt = ? WHERE portfolioId = ? AND id = ?",
    [status, extra.statusReason ?? null, extra.dismissedAtWeight ?? null, now, status === "active" ? null : now, portfolioId, id],
  );
  return findById(portfolioId, id);
}

/** Keeps the active rows and the newest HISTORY_LIMIT others. */
export function pruneHistory(portfolioId: string): void {
  getDatabase().run(
    `DELETE FROM suggestions WHERE portfolioId = ? AND status <> 'active' AND id NOT IN (
       SELECT id FROM suggestions WHERE portfolioId = ? AND status <> 'active' ORDER BY updatedAt DESC LIMIT ?
     )`,
    [portfolioId, portfolioId, HISTORY_LIMIT],
  );
}

export function findRun(portfolioId: string): SuggestionRunRow | null {
  return (getDatabase().query("SELECT * FROM suggestion_runs WHERE portfolioId = ?").get(portfolioId) as SuggestionRunRow | null) ?? null;
}

export function saveRun(run: Omit<SuggestionRunRow, "notes"> & { notes: string[] }): void {
  getDatabase().run(
    `INSERT INTO suggestion_runs (portfolioId, generatedAt, txFingerprint, summary, notes, provider, model) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(portfolioId) DO UPDATE SET generatedAt = excluded.generatedAt, txFingerprint = excluded.txFingerprint,
       summary = excluded.summary, notes = excluded.notes, provider = excluded.provider, model = excluded.model`,
    [run.portfolioId, run.generatedAt, run.txFingerprint, run.summary, JSON.stringify(run.notes), run.provider, run.model],
  );
}

/**
 * Changes when a transaction is added, edited, imported or deleted. Price
 * moves do not change it, so they never mark the suggestions as outdated.
 */
export function transactionFingerprint(portfolioId: string): string {
  const row = getDatabase()
    .query("SELECT COUNT(*) AS n, MAX(updatedAt) AS last, TOTAL(shares) AS shares, TOTAL(amount) AS amount FROM transactions WHERE portfolioId = ?")
    .get(portfolioId) as { n: number; last: string | null; shares: number; amount: number };
  return createHash("sha256").update(`${row.n}|${row.last ?? ""}|${row.shares.toFixed(6)}|${row.amount.toFixed(4)}`).digest("hex").slice(0, 32);
}
