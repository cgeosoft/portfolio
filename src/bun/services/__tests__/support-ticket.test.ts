import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { SupportTicketService, SUPPORT_EMAIL_RECIPIENT } from "../support-ticket.js";

describe("SupportTicketService", () => {
  const testDir = join(tmpdir(), `support-ticket-test-${Date.now()}`);
  const outputDir = join(testDir, "output");
  const logDir = join(testDir, "logs");

  beforeEach(() => {
    mkdirSync(logDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("uses the correct recipient email", () => {
    expect(SUPPORT_EMAIL_RECIPIENT).toBe("christos@cgeosoft.com");
  });

  it("filters log content to the last 24 hours and retains multiline entries", () => {
    const service = new SupportTicketService(logDir);
    const now = Date.now();
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString();
    const cutoff = now - 24 * 60 * 60 * 1000;

    const raw = [
      `[${twoDaysAgo}] [INFO] Old log entry that should be excluded`,
      "  at OldFunction (file.ts:1:1)",
      `[${oneHourAgo}] [INFO] Recent log entry that should be included`,
      "  at RecentFunction (file.ts:2:2)",
      `[${oneHourAgo}] [SUCCESS] Another recent entry`,
    ].join("\n");

    const filtered = service.filterLogContent(raw, cutoff);
    expect(filtered).toContain("Recent log entry that should be included");
    expect(filtered).toContain("at RecentFunction (file.ts:2:2)");
    expect(filtered).toContain("Another recent entry");
    expect(filtered).not.toContain("Old log entry that should be excluded");
    expect(filtered).not.toContain("at OldFunction (file.ts:1:1)");
  });

  it("packages recent logs into a valid ZIP archive", async () => {
    const service = new SupportTicketService(logDir);
    const now = Date.now();
    const recentIso = new Date(now - 30 * 60 * 1000).toISOString();

    // Create a portfolio.log file
    const logContent = `[${recentIso}] [INFO] Initializing system test\n[${recentIso}] [SUCCESS] Test completed\n`;
    writeFileSync(join(logDir, "portfolio.log"), logContent, "utf-8");

    // Create a session JSONL file
    const sessionContent = JSON.stringify({
      timestamp: recentIso,
      level: "info",
      source: "main",
      message: "Session test message",
    }) + "\n";
    writeFileSync(join(logDir, "load_test-session.jsonl"), sessionContent, "utf-8");

    const result = await service.packageRecentLogs(outputDir);
    expect(existsSync(result.zipPath)).toBe(true);
    expect(result.logCount).toBeGreaterThan(0);

    // Read and verify zip structure
    const zipData = readFileSync(result.zipPath);
    const zip = await JSZip.loadAsync(zipData);

    const portfolioLogFile = zip.file("portfolio.log");
    expect(portfolioLogFile).not.toBeNull();
    const unzippedLog = await portfolioLogFile!.async("text");
    expect(unzippedLog).toContain("Initializing system test");

    const systemInfoFile = zip.file("system_info.json");
    expect(systemInfoFile).not.toBeNull();
    const systemInfo = JSON.parse(await systemInfoFile!.async("text"));
    expect(systemInfo.application).toBe("Portfolio Desktop");

    const readmeFile = zip.file("README.txt");
    expect(readmeFile).not.toBeNull();
    const readme = await readmeFile!.async("text");
    expect(readme).toContain("christos@cgeosoft.com");
  });
});
