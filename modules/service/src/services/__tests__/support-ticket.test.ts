import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import JSZip from "jszip";
import { SupportTicketService, SUPPORT_EMAIL_RECIPIENT } from "../support-ticket";

describe("SupportTicketService", () => {
  const testDir = join(tmpdir(), `support-ticket-test-${Date.now()}`);
  const logDir = join(testDir, "logs");

  beforeEach(() => {
    mkdirSync(logDir, { recursive: true });
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
      `${twoDaysAgo}  INFO   main  Old log entry that should be excluded`,
      "  at OldFunction (file.ts:1:1)",
      `${oneHourAgo}  INFO   main  Recent log entry that should be included`,
      "  at RecentFunction (file.ts:2:2)",
      `${oneHourAgo}  OK     main  Another recent entry`,
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

    const logContent = `${recentIso}  INFO   main  Reading config at ${home}/config.json (totalValue=54321.00)\n${recentIso}  OK     main  Test completed\n`;
    const today = new Date();
    const fileName = `service-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}.log`;
    writeFileSync(join(logDir, fileName), logContent, "utf-8");
    // A day-old file that nobody touched in the window is left out.
    const stale = join(logDir, "service-2020-01-01.log");
    writeFileSync(stale, `2020-01-01T10:00:00.000Z  INFO   main  old line\n`, "utf-8");
    utimesSync(stale, new Date("2020-01-01T10:00:00Z"), new Date("2020-01-01T10:00:00Z"));

    const result = await service.packageRecentLogs();
    expect(result.fileName).toMatch(/^portfolio-support-logs-.*\.zip$/);
    expect(result.logCount).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(result.zip);

    const logFile = zip.file(fileName);
    expect(logFile).not.toBeNull();
    expect(zip.file("service-2020-01-01.log")).toBeNull();
    const unzippedLog = await logFile!.async("text");
    expect(unzippedLog).not.toContain(home);
    expect(unzippedLog).not.toContain("54321.00");
    expect(unzippedLog).toContain("totalValue=[REDACTED]");

    const systemInfoFile = zip.file("system_info.json");
    expect(systemInfoFile).not.toBeNull();
    const systemInfo = JSON.parse(await systemInfoFile!.async("text"));
    expect(systemInfo.application).toBe("Portfolio");
    expect(systemInfo.anonymized).toBe(true);

    const readmeFile = zip.file("README.txt");
    expect(readmeFile).not.toBeNull();
    const readme = await readmeFile!.async("text");
    expect(readme).toContain("christos@cgeosoft.com");
    expect(readme).toContain("Log Anonymization: ACTIVE");
  });

  it("builds a mail ticket with the diagnostics archive", async () => {
    const service = new SupportTicketService(logDir);
    const ticket = await service.buildSupportTicket({ subject: "Help", message: "Something broke", includeLogs: true });
    expect(ticket.recipient).toBe(SUPPORT_EMAIL_RECIPIENT);
    expect(ticket.subject).toBe("Help");
    expect(ticket.body).toContain("Something broke");
    expect(ticket.zipFileName).toBeDefined();
    expect(ticket.zip).toBeInstanceOf(Buffer);
  });
});

describe("anonymizeLogContent: more cases", () => {
  const logDir = join(tmpdir(), `support-ticket-more-${Date.now()}`, "logs");
  const service = new SupportTicketService(logDir);
  const anon = (text: string, names?: string[]) => service.anonymizeLogContent(text, names);

  it("redacts provider keys by prefix", () => {
    const groq = anon("key gsk_" + "a".repeat(25));
    expect(groq).toContain("gsk_[REDACTED_KEY]");
    expect(groq).not.toContain("a".repeat(25));
    expect(anon("AIzaSy" + "b".repeat(25))).toContain("AIzaSy[REDACTED_KEY]");
    expect(anon("sk-ant-api03-" + "c".repeat(30))).not.toContain("c".repeat(30));
    expect(anon("sk-or-v1-" + "d".repeat(30))).not.toContain("d".repeat(30));
  });

  it("redacts secret JSON fields", () => {
    const out = anon('{"apiKey": "abc", "token":"t", "llmApiKey":"z"}');
    expect(out).toContain('"apiKey":"[REDACTED]"');
    expect(out).toContain('"token":"[REDACTED]"');
    expect(out).toContain('"llmApiKey":"[REDACTED]"');
  });

  it("redacts a lowercase bearer token", () => {
    expect(anon("bearer abc.def")).toContain("Bearer [REDACTED_TOKEN]");
  });

  it("hides the user name in Windows and macOS paths", () => {
    expect(anon("C:\\Users\\Jane.Doe\\AppData")).toContain("C:\\Users\\[USER]\\AppData");
    expect(anon("/Users/jane/Library")).toContain("/home/[USER]/Library");
  });

  it("redacts numeric weight, value, quantity and price fields", () => {
    const out = anon('{"weight": 12.5, "value":-1.5e3, "quantity":10, "price":0.5}');
    expect(out.split("[REDACTED]").length - 1).toBe(4);
    for (const n of ["12.5", "1.5e3", ":10", "0.5"]) expect(out).not.toContain(n);
  });

  it("redacts short portfolio ids and cache keys", () => {
    expect(anon("portfolioId=1a2b3c4d")).toContain("portfolioId=[PORTFOLIO_ID_REDACTED]");
    expect(anon("getPortfolioData:deadbeef")).toContain("getPortfolioData:[REDACTED]");
  });

  it("redacts a portfolio name in a structured log without a names list", () => {
    expect(anon('{"name":"My Pension","baseCurrency":"EUR"}')).toBe('{"name":"[PORTFOLIO_NAME]","baseCurrency":"EUR"}');
    expect(anon('{"name":"Apple Inc","symbol":"AAPL"}')).toContain('"name":"Apple Inc"');
  });

  it("replaces listed names literally, trimmed, and ignores one-letter names", () => {
    expect(anon("Portfolio A", ["A"])).toBe("Portfolio A");
    const kids = anon("Kids savings", ["  Kids  "]);
    expect(kids).not.toContain("Kids");
    expect(kids).toContain("[PORTFOLIO_NAME]");
    const literal = anon("x Fund (2026)+ y", ["Fund (2026)+"]);
    expect(literal).not.toContain("Fund (2026)+");
    expect(literal).toContain("[PORTFOLIO_NAME]");
  });

  it("redacts notification tokens", () => {
    const out = anon('{"gotifyToken":"g-secret","ntfyToken":"n-secret"}');
    expect(out).not.toContain("g-secret");
    expect(out).not.toContain("n-secret");
    expect(out).toContain('"gotifyToken":"[REDACTED]"');
    expect(out).toContain('"ntfyToken":"[REDACTED]"');
    expect(anon('{"token":"t-secret"}')).toBe('{"token":"[REDACTED]"}');
  });

  it("builds a default ticket without logs", async () => {
    const ticket = await service.buildSupportTicket({});
    expect(ticket.subject).toBe("Portfolio Support Request");
    expect(ticket.body.startsWith("Issue Description:\n(Please write your question or issue description here)")).toBe(true);
    expect(ticket.logCount).toBe(0);
    expect(ticket.zip).toBeUndefined();
    expect((await service.buildSupportTicket({ subject: "  " })).subject).toBe("Portfolio Support Request");
    expect((await service.buildSupportTicket({ message: "  Help  " })).body.startsWith("Issue Description:\nHelp")).toBe(true);
  });
});
