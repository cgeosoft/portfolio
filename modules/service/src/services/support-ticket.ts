import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import JSZip from "jszip";
import { appLogger, getLogDir, LOG_FILE_NAME } from "../logger";
import { getAppVersion } from "../environment";
import { FILE_LOG_LINE_PATTERN } from "portfolio-shared/log-format";
import { SUPPORT_EMAIL } from "portfolio-shared/brand";

export const SUPPORT_EMAIL_RECIPIENT = SUPPORT_EMAIL;

export interface CreateSupportTicketOptions {
  subject?: string;
  message?: string;
  includeLogs?: boolean;
}

export interface CreateSupportTicketResult {
  success: boolean;
  recipient: string;
  zipPath?: string;
  logCount?: number;
  message?: string;
  error?: string;
}

export class SupportTicketService {
  private customLogDir?: string;

  constructor(customLogDir?: string) {
    this.customLogDir = customLogDir;
  }

  private getLogsDirectory(): string {
    return this.customLogDir ?? getLogDir();
  }

  /**
   * Filter plain log lines to those written in the past 24 hours.
   */
  public filterLogContent(rawContent: string, cutoffMs: number): string {
    const lines = rawContent.split("\n");
    const retained: string[] = [];
    let includeBlock = false;

    for (const line of lines) {
      const match = line.match(FILE_LOG_LINE_PATTERN);
      if (match && match[1]) {
        const timestamp = new Date(match[1]).getTime();
        if (!isNaN(timestamp) && timestamp >= cutoffMs) {
          includeBlock = true;
          retained.push(line);
        } else {
          includeBlock = false;
        }
      } else if (includeBlock) {
        retained.push(line);
      }
    }

    return retained.join("\n");
  }

  /**
   * Anonymize sensitive and personal data from log content:
   * - Masks home directory and user paths
   * - Redacts API keys and bearer tokens
   * - Redacts portfolio names, portfolio UUIDs, and ticker lists
   * - Redacts financial values, quantities, and cash balances
   */
  public anonymizeLogContent(content: string, customPortfolioNames?: string[]): string {
    let text = content;

    // 1. Redact API keys and authorization tokens
    text = text.replace(/sk-[a-zA-Z0-9_-]{20,}/g, "sk-[REDACTED_KEY]");
    text = text.replace(/gsk_[a-zA-Z0-9_-]{20,}/g, "gsk_[REDACTED_KEY]");
    text = text.replace(/AIzaSy[a-zA-Z0-9_-]{20,}/g, "AIzaSy[REDACTED_KEY]");
    text = text.replace(/sk-ant-[a-zA-Z0-9_-]{20,}/g, "sk-ant-[REDACTED_KEY]");
    text = text.replace(/sk-or-v1-[a-zA-Z0-9_-]{20,}/g, "sk-or-v1-[REDACTED_KEY]");
    text = text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED_TOKEN]");
    text = text.replace(/"(llmApiKey|apiKey|token|key)":\s*"[^"]*"/gi, '"$1":"[REDACTED]"');

    // 2. Redact file system paths and usernames
    const home = homedir();
    if (home && home.length > 1) {
      text = text.replaceAll(home, "~");
    }
    // Generic Unix home paths: /home/<username> or /Users/<username>
    text = text.replace(/(?:\/home|\/Users)\/[a-zA-Z0-9._-]+/g, "/home/[USER]");
    // Generic Windows user paths: C:\Users\<username>
    text = text.replace(/[a-zA-Z]:\\Users\\[a-zA-Z0-9._-]+/gi, "C:\\Users\\[USER]");

    // 3. Redact financial metrics, balances, prices, and quantities
    text = text.replace(/"(totalValue|unrealizedGain|unrealizedGainPercent|realizedGain|cashBalance|totalCost|quantity|price|value|weight)":\s*-?[\d.]+(?:e[+-]?\d+)?/gi, '"$1":"[REDACTED]"');
    text = text.replace(/\b(totalValue|cashBalance|totalCost|realizedGain|unrealizedGain)\s*=\s*[\d.-]+/gi, "$1=[REDACTED]");

    // 4. Redact portfolio IDs (UUIDs)
    text = text.replace(/"portfolioId":\s*"[a-f0-9-]{36}"/gi, '"portfolioId":"[PORTFOLIO_ID_REDACTED]"');
    text = text.replace(/"activePortfolioId":\s*"[a-f0-9-]{36}"/gi, '"activePortfolioId":"[PORTFOLIO_ID_REDACTED]"');
    text = text.replace(/\bportfolioId=([a-f0-9-]{36}|[a-f0-9]{8})/gi, "portfolioId=[PORTFOLIO_ID_REDACTED]");
    text = text.replace(/\bgetPortfolioData:([a-f0-9]{8})/gi, "getPortfolioData:[REDACTED]");

    // 5. Redact portfolio names in structured payload
    text = text.replace(/"name":\s*"([^"]+)"(?=,\s*"baseCurrency"|,\s*"description"|,\s*"createdAt")/gi, '"name":"[PORTFOLIO_NAME]"');

    // Redact specific portfolio names if provided
    const namesToRedact = new Set<string>(customPortfolioNames || []);
    for (const pName of namesToRedact) {
      if (pName && pName.trim().length >= 2) {
        text = text.replaceAll(pName.trim(), "[PORTFOLIO_NAME]");
      }
    }

    // 6. Redact stock holdings symbols list
    text = text.replace(/"symbols":\s*\[[^\]]*\]/gi, '"symbols":["[REDACTED]"]');

    return text;
  }

  /**
   * Packages the diagnostic logs of the previous 24 hours into a zip buffer.
   */
  public async packageRecentLogs(): Promise<{ zip: Buffer; fileName: string; logCount: number }> {
    const zipArchive = new JSZip();
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const logDir = this.getLogsDirectory();
    let totalLogsCount = 0;

    // Retrieve portfolio names to redact
    const knownPortfolioNames: string[] = [];
    try {
      const { findAll } = await import("../db/portfolio.repo.js");
      const portfolios = findAll();
      for (const p of portfolios) {
        if (p.name) knownPortfolioNames.push(p.name);
      }
    } catch {}

    // 1. Process portfolio.log
    const mainLogPath = join(logDir, LOG_FILE_NAME);
    if (existsSync(mainLogPath)) {
      try {
        const raw = readFileSync(mainLogPath, "utf-8");
        const filtered = this.filterLogContent(raw, cutoffMs);
        const anonymized = this.anonymizeLogContent(filtered, knownPortfolioNames);
        if (anonymized.trim().length > 0) {
          zipArchive.file(LOG_FILE_NAME, anonymized);
          totalLogsCount += anonymized.split("\n").length;
        }
      } catch (err) {
        appLogger.log("warning", `Could not read main log file: ${err}`);
      }
    }

    // Process rotated portfolio.log.1 if it exists and modified within cutoff
    const rotatedLogPath = join(logDir, `${LOG_FILE_NAME}.1`);
    if (existsSync(rotatedLogPath)) {
      try {
        const stats = statSync(rotatedLogPath);
        if (stats.mtimeMs >= cutoffMs) {
          const raw = readFileSync(rotatedLogPath, "utf-8");
          const filtered = this.filterLogContent(raw, cutoffMs);
          const anonymized = this.anonymizeLogContent(filtered, knownPortfolioNames);
          if (anonymized.trim().length > 0) {
            zipArchive.file(`${LOG_FILE_NAME}.1`, anonymized);
            totalLogsCount += anonymized.split("\n").length;
          }
        }
      } catch {}
    }

    // 3. System info
    const appVersion = getAppVersion();

    const systemInfo = {
      application: "Portfolio",
      version: appVersion,
      platform: process.platform,
      arch: process.arch,
      bunVersion: process.versions.bun || "unknown",
      generatedAt: new Date().toISOString(),
      logEntriesCount: totalLogsCount,
      anonymized: true,
      anonymizationPolicy: "Paths, API credentials, portfolio names, tickers, quantities, and balances are redacted.",
    };
    zipArchive.file("system_info.json", JSON.stringify(systemInfo, null, 2));

    // 4. README note in Simplified English
    const readmeText = [
      "# Portfolio Diagnostic Logs Archive",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Support Recipient: ${SUPPORT_EMAIL_RECIPIENT}`,
      "Log Anonymization: ACTIVE",
      "",
      "This archive contains diagnostic log events from the previous 24 hours.",
      "All sensitive data was anonymized before packaging:",
      "- User home directories, usernames, and file system paths are masked.",
      "- API tokens, keys, and authorization headers are redacted.",
      "- Portfolio names, portfolio UUIDs, and ticker lists are masked.",
      "- Financial quantities, asset values, cash balances, and prices are redacted.",
    ].join("\n");
    zipArchive.file("README.txt", readmeText);

    // 5. Generate ZIP buffer
    const zip = await zipArchive.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const dateStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `portfolio-support-logs-${dateStamp}.zip`;
    appLogger.log("info", `Diagnostic log archive built: ${fileName} (${totalLogsCount} entries)`);
    return { zip, fileName, logCount: totalLogsCount };
  }

  /**
   * Builds the support ticket: the mail recipient, subject and body the GUI
   * opens with a mailto link, and (optionally) the anonymised diagnostics zip
   * the GUI offers as a download. Nothing is written outside the zip buffer.
   */
  public async buildSupportTicket(options: CreateSupportTicketOptions): Promise<SupportTicket> {
    const recipient = SUPPORT_EMAIL_RECIPIENT;
    const subject = options.subject?.trim() || "Portfolio Support Request";
    const userMessage = options.message?.trim() || "";

    let zip: Buffer | undefined;
    let zipFileName: string | undefined;
    let logCount = 0;
    if (options.includeLogs) {
      try {
        const packaged = await this.packageRecentLogs();
        zip = packaged.zip;
        zipFileName = packaged.fileName;
        logCount = packaged.logCount;
      } catch (err) {
        appLogger.log("error", `Failed to package logs for support ticket: ${err}`);
      }
    }

    const sections: string[] = [];
    sections.push(userMessage ? `Issue Description:\n${userMessage}` : "Issue Description:\n(Please write your question or issue description here)");
    sections.push(
      `\n---\nSystem Information:\n- Application: Portfolio v${getAppVersion()}\n- OS: ${process.platform} (${process.arch})\n- Bun: ${process.versions.bun || "unknown"}\n- Timestamp: ${new Date().toISOString()}`,
    );
    if (zipFileName) {
      sections.push(`\nDiagnostic Log Archive:\n${zipFileName}\n\nPlease attach the downloaded archive to this mail.`);
    }

    return { recipient, subject, body: sections.join("\n"), zip, zipFileName, logCount };
  }
}

export interface SupportTicket {
  recipient: string;
  subject: string;
  body: string;
  zip?: Buffer;
  zipFileName?: string;
  logCount: number;
}

export const supportTicketService = new SupportTicketService();
