import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import JSZip from "jszip";
import { appLogger, getLogDir, getProjectLogDir } from "../logger.js";

export const SUPPORT_EMAIL_RECIPIENT = "christos@cgeosoft.com";

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
      const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]/);
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
    const projectDir = getProjectLogDir();
    if (projectDir) {
      const rootDir = dirname(projectDir);
      if (rootDir && rootDir.length > 2) {
        text = text.replaceAll(rootDir, "[PROJECT_DIR]");
      }
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
   * Package diagnostic logs from the previous 24 hours into a ZIP archive.
   */
  public async packageRecentLogs(outputDir?: string): Promise<{ zipPath: string; logCount: number }> {
    const zip = new JSZip();
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
    const mainLogPath = join(logDir, "portfolio.log");
    if (existsSync(mainLogPath)) {
      try {
        const raw = readFileSync(mainLogPath, "utf-8");
        const filtered = this.filterLogContent(raw, cutoffMs);
        const anonymized = this.anonymizeLogContent(filtered, knownPortfolioNames);
        if (anonymized.trim().length > 0) {
          zip.file("portfolio.log", anonymized);
          totalLogsCount += anonymized.split("\n").length;
        }
      } catch (err) {
        appLogger.log("warning", `Could not read main log file: ${err}`);
      }
    }

    // Process rotated portfolio.log.1 if it exists and modified within cutoff
    const rotatedLogPath = join(logDir, "portfolio.log.1");
    if (existsSync(rotatedLogPath)) {
      try {
        const stats = statSync(rotatedLogPath);
        if (stats.mtimeMs >= cutoffMs) {
          const raw = readFileSync(rotatedLogPath, "utf-8");
          const filtered = this.filterLogContent(raw, cutoffMs);
          const anonymized = this.anonymizeLogContent(filtered, knownPortfolioNames);
          if (anonymized.trim().length > 0) {
            zip.file("portfolio.log.1", anonymized);
            totalLogsCount += anonymized.split("\n").length;
          }
        }
      } catch {}
    }

    // 2. Process session JSONL logs
    const sessionDirs = [logDir];
    const projectLogs = getProjectLogDir();
    if (existsSync(projectLogs) && projectLogs !== logDir) {
      sessionDirs.push(projectLogs);
    }

    const sessionFolder = zip.folder("session_logs");
    const processedFiles = new Set<string>();

    for (const dir of sessionDirs) {
      if (!existsSync(dir)) continue;
      try {
        const files = readdirSync(dir);
        for (const file of files) {
          if (!file.endsWith(".jsonl") || processedFiles.has(file)) continue;
          processedFiles.add(file);

          const fullPath = join(dir, file);
          try {
            const stats = statSync(fullPath);
            if (stats.mtimeMs < cutoffMs) continue;

            const content = readFileSync(fullPath, "utf-8");
            const lines = content.split("\n").filter((l) => l.trim().length > 0);
            const validLines: string[] = [];

            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.timestamp) {
                  const itemTime = new Date(parsed.timestamp).getTime();
                  if (itemTime >= cutoffMs) {
                    validLines.push(line);
                  }
                } else {
                  validLines.push(line);
                }
              } catch {
                validLines.push(line);
              }
            }

            if (validLines.length > 0 && sessionFolder) {
              const anonymizedLines = validLines.map((l) => this.anonymizeLogContent(l, knownPortfolioNames));
              sessionFolder.file(file, anonymizedLines.join("\n") + "\n");
              totalLogsCount += validLines.length;
            }
          } catch {}
        }
      } catch {}
    }

    // 3. System info
    let appVersion = "0.1.0";
    try {
      const pkgPath = new URL("../../../package.json", import.meta.url).pathname;
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.version) appVersion = pkg.version;
      }
    } catch {}

    const systemInfo = {
      application: "Portfolio Desktop",
      version: appVersion,
      platform: process.platform,
      arch: process.arch,
      bunVersion: process.versions.bun || "unknown",
      generatedAt: new Date().toISOString(),
      logEntriesCount: totalLogsCount,
      anonymized: true,
      anonymizationPolicy: "Paths, API credentials, portfolio names, tickers, quantities, and balances are redacted.",
    };
    zip.file("system_info.json", JSON.stringify(systemInfo, null, 2));

    // 4. README note in Simplified English
    const readmeText = [
      "# Portfolio Desktop Diagnostic Logs Archive",
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
    zip.file("README.txt", readmeText);

    // 5. Generate ZIP buffer
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    // 6. Save ZIP file
    const downloads = join(homedir(), "Downloads");
    const saveDirectory = outputDir || (existsSync(downloads) ? downloads : logDir);
    const dateStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const zipPath = join(saveDirectory, `portfolio-support-logs-${dateStamp}.zip`);

    writeFileSync(zipPath, buffer);
    appLogger.log("info", `Diagnostic log ZIP created at: ${zipPath} (${totalLogsCount} entries)`);

    return { zipPath, logCount: totalLogsCount };
  }

  /**
   * Create and open a support ticket email with optional ZIP logs attachment.
   */
  public async openSupportTicket(options: CreateSupportTicketOptions): Promise<CreateSupportTicketResult> {
    const recipient = SUPPORT_EMAIL_RECIPIENT;
    const ticketSubject = options.subject?.trim() || "Portfolio Desktop Support Request";
    const userMessage = options.message?.trim() || "";

    let zipPath: string | undefined;
    let logCount = 0;

    if (options.includeLogs) {
      try {
        const packaged = await this.packageRecentLogs();
        zipPath = packaged.zipPath;
        logCount = packaged.logCount;
      } catch (err) {
        appLogger.log("error", `Failed to package logs for support ticket: ${err}`);
      }
    }

    let appVersion = "0.1.0";
    try {
      const pkgPath = new URL("../../../package.json", import.meta.url).pathname;
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.version) appVersion = pkg.version;
      }
    } catch {}

    const bodySections: string[] = [];
    if (userMessage) {
      bodySections.push(`Issue Description:\n${userMessage}`);
    } else {
      bodySections.push("Issue Description:\n(Please write your question or issue description here)");
    }

    bodySections.push(
      `\n---\nSystem Information:\n- Application: Portfolio Desktop v${appVersion}\n- OS: ${process.platform} (${process.arch})\n- Bun: ${process.versions.bun || "unknown"}\n- Timestamp: ${new Date().toISOString()}`
    );

    if (zipPath) {
      bodySections.push(
        `\nDiagnostic Log Archive:\n${zipPath}\n\nNote: If the diagnostic ZIP archive was not attached automatically, please attach the file shown above.`
      );
    }

    const emailBody = bodySections.join("\n");
    let emailLaunched = false;

    // Try xdg-email on Linux when logs are attached
    if (process.platform === "linux" && zipPath) {
      try {
        const proc = Bun.spawn(["xdg-email", "--utf8", "--subject", ticketSubject, "--body", emailBody, "--attach", zipPath, recipient]);
        const exitCode = await Promise.race([
          proc.exited,
          new Promise<number>((resolve) => setTimeout(() => resolve(0), 1200)),
        ]);
        if (exitCode === 0) {
          emailLaunched = true;
        }
      } catch {
        // Fall back to mailto URL
      }
    }

    // Fallback: Open mailto URL
    if (!emailLaunched) {
      const mailtoUrl = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(ticketSubject)}&body=${encodeURIComponent(emailBody)}`;
      try {
        const electrobun = await import("electrobun/bun").catch(() => null);
        if (electrobun?.Utils?.openExternal) {
          await electrobun.Utils.openExternal(mailtoUrl);
          emailLaunched = true;
        }
      } catch {}

      if (!emailLaunched) {
        try {
          const opener = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
          Bun.spawn([opener, mailtoUrl]);
          emailLaunched = true;
        } catch (err) {
          appLogger.log("warning", `Failed to open mailto URL: ${err}`);
        }
      }
    }

    return {
      success: true,
      recipient,
      zipPath,
      logCount,
      message: zipPath
        ? "Support ticket email opened. Diagnostic logs archive created."
        : "Support ticket email opened.",
    };
  }

  /**
   * Open the file manager to reveal a file or directory.
   */
  public async revealInFileManager(targetPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!existsSync(targetPath)) {
        return { success: false, error: "Target path does not exist" };
      }

      if (process.platform === "win32") {
        Bun.spawn(["explorer", `/select,${targetPath}`]);
      } else if (process.platform === "darwin") {
        Bun.spawn(["open", "-R", targetPath]);
      } else {
        const folder = statSync(targetPath).isDirectory() ? targetPath : dirname(targetPath);
        Bun.spawn(["xdg-open", folder]);
      }
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }
}

export const supportTicketService = new SupportTicketService();
