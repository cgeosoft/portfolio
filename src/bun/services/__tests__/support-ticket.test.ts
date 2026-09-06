import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
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

  it("thoroughly anonymizes sensitive log information", () => {
    const service = new SupportTicketService(logDir);
    const home = homedir();
    const portfolioUuid = "45ef74ea-f71f-483a-a0cf-a719bb1015b9";

    const sensitiveLog = [
      `[INFO] Loaded portfolio from ${home}/.config/portfolio/portfolio.sqlite`,
      `[INFO] User directory: /home/john_doe/documents`,
      `[INFO] API call with key sk-proj-12345678901234567890abcdef and Bearer secretToken1234567890`,
      `[INFO] Portfolio data loaded (totalValue=94850.50, cashBalance=12000.00)`,
      `{"portfolioId":"${portfolioUuid}","name":"Alpha Growth Fund","totalValue":94850.50,"cashBalance":12000.00,"symbols":["AAPL","MSFT","NVDA"]}`,
    ].join("\n");

    const anonymized = service.anonymizeLogContent(sensitiveLog, ["Alpha Growth Fund"]);

    // Check paths
    expect(anonymized).not.toContain(home);
    expect(anonymized).not.toContain("/home/john_doe");
    expect(anonymized).toContain("~/.config/portfolio/portfolio.sqlite");
    expect(anonymized).toContain("/home/[USER]/documents");

    // Check API keys
    expect(anonymized).not.toContain("sk-proj-12345678901234567890abcdef");
    expect(anonymized).not.toContain("secretToken1234567890");
    expect(anonymized).toContain("sk-[REDACTED_KEY]");
    expect(anonymized).toContain("Bearer [REDACTED_TOKEN]");

    // Check financial values
    expect(anonymized).not.toContain("94850.50");
    expect(anonymized).not.toContain("12000.00");
    expect(anonymized).toContain("totalValue=[REDACTED]");
    expect(anonymized).toContain("cashBalance=[REDACTED]");

    // Check portfolio identifiers and names
    expect(anonymized).not.toContain(portfolioUuid);
    expect(anonymized).not.toContain("Alpha Growth Fund");
    expect(anonymized).toContain("[PORTFOLIO_ID_REDACTED]");
    expect(anonymized).toContain("[PORTFOLIO_NAME]");

    // Check symbols
    expect(anonymized).not.toContain('"AAPL","MSFT","NVDA"');
  });

  it("packages recent logs into a valid and anonymized ZIP archive", async () => {
    const service = new SupportTicketService(logDir);
    const now = Date.now();
    const recentIso = new Date(now - 30 * 60 * 1000).toISOString();
    const home = homedir();

    // Create a portfolio.log file with some sensitive path and balance
    const logContent = `[${recentIso}] [INFO] Reading config at ${home}/config.json (totalValue=54321.00)\n[${recentIso}] [SUCCESS] Test completed\n`;
    writeFileSync(join(logDir, "portfolio.log"), logContent, "utf-8");

    // Create a session JSONL file
    const sessionContent = JSON.stringify({
      timestamp: recentIso,
      level: "info",
      source: "main",
      message: `Opened ledger at ${home}/portfolio.sqlite`,
      data: {
        totalValue: 54321.00,
        portfolioId: "45ef74ea-f71f-483a-a0cf-a719bb1015b9",
      },
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
    expect(unzippedLog).not.toContain(home);
    expect(unzippedLog).not.toContain("54321.00");
    expect(unzippedLog).toContain("totalValue=[REDACTED]");

    const sessionFile = zip.file("session_logs/load_test-session.jsonl");
    expect(sessionFile).not.toBeNull();
    const unzippedSession = await sessionFile!.async("text");
    expect(unzippedSession).not.toContain(home);
    expect(unzippedSession).not.toContain("54321.00");
    expect(unzippedSession).not.toContain("45ef74ea-f71f-483a-a0cf-a719bb1015b9");

    const systemInfoFile = zip.file("system_info.json");
    expect(systemInfoFile).not.toBeNull();
    const systemInfo = JSON.parse(await systemInfoFile!.async("text"));
    expect(systemInfo.application).toBe("Portfolio Desktop");
    expect(systemInfo.anonymized).toBe(true);

    const readmeFile = zip.file("README.txt");
    expect(readmeFile).not.toBeNull();
    const readme = await readmeFile!.async("text");
    expect(readme).toContain("christos@cgeosoft.com");
    expect(readme).toContain("Log Anonymization: ACTIVE");
  });
});
