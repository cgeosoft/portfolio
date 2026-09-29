import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../../db/database";
import * as portfolioRepo from "../../db/portfolio.repo";
import { backupFileName, createDatabaseBackup } from "../backup";

describe("backupFileName", () => {
  it("names the file after the local date and time", () => {
    const name = backupFileName(new Date(2026, 8, 29, 7, 5));
    expect(name).toBe("portfolio-backup-2026-09-29-0705.sqlite");
  });
});

describe("createDatabaseBackup", () => {
  it("returns a complete SQLite copy of the live database", () => {
    getDatabase();
    const created = portfolioRepo.create({ name: "Backup test", baseCurrency: "EUR" });
    const backup = createDatabaseBackup();
    expect(backup.fileName).toMatch(/^portfolio-backup-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite$/);
    expect(Buffer.from(backup.bytes.subarray(0, 15)).toString("utf-8")).toBe("SQLite format 3");

    const dir = mkdtempSync(join(tmpdir(), "portfolio-backup-test-"));
    try {
      const file = join(dir, "copy.sqlite");
      writeFileSync(file, backup.bytes);
      const copy = new Database(file, { readonly: true });
      const row = copy.query("SELECT name FROM portfolios WHERE id = ?").get(created.id) as { name: string } | null;
      expect(row?.name).toBe("Backup test");
      const tables = copy.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
      expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(["portfolios", "transactions", "settings", "sessions"]));
      copy.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      portfolioRepo.deleteById(created.id);
    }
  });
});
