/**
 * Repository for storing and retrieving assistant conversations per portfolio.
 */

import { getDatabase } from "./database.js";

export interface AssistantConversationRow {
  id: string;
  portfolioId: string;
  title: string;
  messages: string; // JSON encoded PortfolioChatMessage[]
  createdAt: string;
  updatedAt: string;
}

export function findByPortfolio(portfolioId: string, limit = 50): AssistantConversationRow[] {
  const db = getDatabase();
  return db
    .query("SELECT * FROM assistant_conversations WHERE portfolioId = ? ORDER BY updatedAt DESC LIMIT ?")
    .all(portfolioId, limit) as AssistantConversationRow[];
}

export function findById(id: string, portfolioId?: string): AssistantConversationRow | null {
  const db = getDatabase();
  if (portfolioId) {
    return (
      (db.query("SELECT * FROM assistant_conversations WHERE id = ? AND portfolioId = ?").get(id, portfolioId) as AssistantConversationRow) ??
      null
    );
  }
  return (db.query("SELECT * FROM assistant_conversations WHERE id = ?").get(id) as AssistantConversationRow) ?? null;
}

export function upsert(data: {
  id: string;
  portfolioId: string;
  title: string;
  messages: string;
}): AssistantConversationRow {
  const db = getDatabase();
  const existing = findById(data.id, data.portfolioId);

  if (existing) {
    db.run(
      `UPDATE assistant_conversations
       SET title = ?, messages = ?, updatedAt = datetime('now')
       WHERE id = ? AND portfolioId = ?`,
      [data.title, data.messages, data.id, data.portfolioId],
    );
  } else {
    db.run(
      `INSERT INTO assistant_conversations (id, portfolioId, title, messages, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [data.id, data.portfolioId, data.title, data.messages],
    );
  }

  return findById(data.id, data.portfolioId)!;
}

export function deleteById(id: string, portfolioId: string): boolean {
  const db = getDatabase();
  const res = db.run("DELETE FROM assistant_conversations WHERE id = ? AND portfolioId = ?", [id, portfolioId]);
  return res.changes > 0;
}
