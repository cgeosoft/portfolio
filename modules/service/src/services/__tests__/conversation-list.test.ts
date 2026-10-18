import { describe, it, expect } from "bun:test";
import { getDatabase } from "../../db/database";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as conversationRepo from "../../db/conversation.repo";

describe("conversation list", () => {
  it("lists newest first with a message count and no bodies", () => {
    const db = getDatabase();
    const portfolio = portfolioRepo.create({ name: "Conversation list test", baseCurrency: "EUR" });
    try {
      conversationRepo.upsert({ id: "conv_list_a", portfolioId: portfolio.id, title: "A", messages: JSON.stringify([{ role: "user", content: "hi" }]) });
      conversationRepo.upsert({ id: "conv_list_b", portfolioId: portfolio.id, title: "B", messages: "not json" });
      db.run("UPDATE assistant_conversations SET updatedAt = '2026-01-01 00:00:00' WHERE id = 'conv_list_a'");
      const rows = conversationRepo.listByPortfolio(portfolio.id);
      expect(rows.map((r) => [r.id, r.messageCount])).toEqual([["conv_list_b", 0], ["conv_list_a", 1]]);
      expect("messages" in rows[0]!).toBe(false);
    } finally {
      portfolioRepo.deleteById(portfolio.id);
    }
  });

  it("reads conversations and transactions in index order without a sort step", () => {
    const db = getDatabase();
    const plan = (sql: string) => (db.query(`EXPLAIN QUERY PLAN ${sql}`).all("p", 50) as { detail: string }[]).map((r) => r.detail).join(" | ");
    const conv = plan("SELECT id FROM assistant_conversations WHERE portfolioId = ? ORDER BY updatedAt DESC LIMIT ?");
    expect(conv).toContain("idx_conversations_portfolio_updated");
    expect(conv).not.toContain("TEMP B-TREE");
    const tx = plan("SELECT * FROM transactions WHERE portfolioId = ? ORDER BY date ASC, COALESCE(datetime, date) ASC, createdAt ASC LIMIT ?");
    expect(tx).toContain("idx_transactions_portfolio_order");
    expect(tx).not.toContain("TEMP B-TREE");
  });
});
