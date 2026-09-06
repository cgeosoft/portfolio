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
   * Package diagnostic logs from the previous 24 hours into a ZIP archive.
   */
  public async packageRecentLogs(outputDir?: string): Promise<{ zipPath: string; logCount: number }> {
    const zip = new JSZip();
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const logDir = this.getLogsDirectory();
    let totalLogsCount = 0;

    // 1. Process portfolio.log
    const mainLogPath = join(logDir, "portfolio.log");
    if (existsSync(mainLogPath)) {
      try {
        const raw = readFileSync(mainLogPath, "utf-8");
        const filtered = this.filterLogContent(raw, cutoffMs);
        if (filtered.trim().length > 0) {
          zip.file("portfolio.log", filtered);
          totalLogsCount += filtered.split("\n").length;
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
          if (filtered.trim().length > 0) {
            zip.file("portfolio.log.1", filtered);
            totalLogsCount += filtered.split("\n").length;
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
              sessionFolder.file(file, validLines.join("\n") + "\n");
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
    };
    zip.file("system_info.json", JSON.stringify(systemInfo, null, 2));

    // 4. README note in Simplified English
    const readmeText = [
      "# Portfolio Desktop Diagnostic Logs Archive",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Support Recipient: ${SUPPORT_EMAIL_RECIPIENT}`,
      "",
      "This archive contains diagnostic log events from the previous 24 hours.",
      "The archive does not contain personal financial balances, quantities, or portfolio keys.",
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
