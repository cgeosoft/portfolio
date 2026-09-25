/**
 * Compatibility layer over `api` for components written against the former
 * Electrobun RPC bridge: `rpc.request.<name>(params)` keeps working while the
 * transport is plain HTTP. New code should call `api` directly.
 */
import { api } from "./api";
import { openExternal } from "./environment";
import type { AppUpdateInfo, LogClientEventRequest } from "portfolio-shared/api-types";
import { buildConsoleLogLine, CONTINUATION_INDENT, type ConsoleLogLevel } from "portfolio-shared/log-format";

export const rpc = {
  request: {
    logClientEvent: (p: LogClientEventRequest) => api.logClientEvent(p),
    getPortfolios: (_p?: unknown) => api.getPortfolios(),
    getPortfolioData: (p: { portfolioId: string; baseCurrency?: string; refresh?: boolean }) => api.getPortfolioData(p.portfolioId, p.baseCurrency, p.refresh),
    createPortfolio: api.createPortfolio,
    updatePortfolio: api.updatePortfolio,
    deletePortfolio: (p: { portfolioId: string }) => api.deletePortfolio(p.portfolioId),
    getPortfolioMetrics: (p: { portfolioId: string }) => api.getPortfolioMetrics(p.portfolioId),
    savePortfolioMetrics: api.savePortfolioMetrics,
    getMetricCatalog: (_p?: unknown) => api.getMetricCatalog(),
    evaluatePortfolioMetrics: api.evaluatePortfolioMetrics,
    previewMetricInstall: (p: { url: string }) => api.previewMetricInstall(p.url),
    installMetric: (p: Parameters<typeof api.installMetric> extends [infer U, infer S] ? { url: U; grantedScopes: S } : never) => api.installMetric(p.url, p.grantedScopes),
    uninstallMetric: (p: { id: string }) => api.uninstallMetric(p.id),
    manageTransactions: api.manageTransactions,
    getTransactions: (p: { portfolioId: string }) => api.getTransactions(p.portfolioId),
    searchSymbol: (p: { query: string }) => api.searchSymbol(p.query),
    getReports: (p: { portfolioId: string }) => api.getReports(p.portfolioId),
    generateReport: api.generateReport,
    prepareReportPrompt: api.prepareReportPrompt,
    startReportStream: api.startReportStream,
    pollReportStream: (p: { sessionId: string }) => api.pollReportStream(p.sessionId),
    cancelReportStream: (p: { sessionId: string }) => api.cancelReportStream(p.sessionId),
    deleteReport: (p: { portfolioId: string; reportId: string }) => api.deleteReport(p.portfolioId, p.reportId),
    chatWithPortfolio: api.chatWithPortfolio,
    getAssistantSystemPrompt: (p: { portfolioId: string }) => api.getAssistantSystemPrompt(p.portfolioId),
    getAssistantConversations: (p: { portfolioId: string }) => api.getAssistantConversations(p.portfolioId),
    deleteAssistantConversation: (p: { portfolioId: string; conversationId: string }) => api.deleteAssistantConversation(p.portfolioId, p.conversationId),
    testLlm: api.testLlm,
    testLlmStep: api.testLlmStep,
    getProviderModels: api.getProviderModels,
    getClaudeCliStatus: (_p?: unknown) => api.getClaudeCliStatus(),
    testFinnhubConnection: (p: { apiKey?: string }) => api.testFinnhubConnection(p.apiKey),
    testYahooConnection: (_p?: unknown) => api.testYahooConnection(),
    clearMarketCache: (_p?: unknown) => api.clearMarketCache(),
    getConfig: (_p?: unknown) => api.getConfig(),
    saveConfig: api.saveConfig,
    getAppInfo: (_p?: unknown) => api.getAppInfo(),
    checkForUpdates: (p?: { force?: boolean }) => api.checkForUpdates(Boolean(p?.force)),
    getUpdateInfo: (_p?: unknown) => api.getUpdateInfo(),
    downloadUpdate: (p: { version: string }) => api.downloadUpdate(p.version),
    openExternalUrl: async (p: { url: string }) => ({ success: openExternal(p.url) }),
    openSupportTicket: api.openSupportTicket,
    revealFile: (p: { filePath: string }) => api.revealFile(p.filePath),
    saveFile: (p: { fileName: string; content?: string; base64Data?: string }) => api.saveFile(p.fileName, p.content, p.base64Data),
    syncQuotes: (_p?: unknown) => api.syncQuotes(),
    getSponsorBanner: (p?: { url?: string; theme?: string }) => api.getSponsorBanner(p?.url, p?.theme),
    completeSetup: api.completeSetup,
    quitApp: (_p?: unknown) => api.quitApp(),
    reloadApp: async (_p?: unknown) => {
      window.location.reload();
      return { success: true };
    },
  },
};

// ── update notifications (polled) ───────────────────────────────────────────

let updateAvailableHandler: ((info: AppUpdateInfo) => void) | null = null;
let updatePollTimer: ReturnType<typeof setInterval> | null = null;

/** Calls `handler` when the service reports a newer version (checked every 10 minutes). */
export function onUpdateAvailable(handler: (info: AppUpdateInfo) => void): void {
  updateAvailableHandler = handler;
  if (updatePollTimer) return;
  updatePollTimer = setInterval(() => {
    api
      .getUpdateInfo()
      .then((info) => {
        if (info?.hasUpdate) updateAvailableHandler?.(info);
      })
      .catch(() => {});
  }, 10 * 60 * 1000);
}

// ── client logger (mirrors the service console layout) ──────────────────────

export type ClientLogLevel = ConsoleLogLevel;

export interface ClientLogEntry {
  level: ClientLogLevel;
  source: string;
  step?: string;
  message: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

const LEVEL_STYLES: Record<ConsoleLogLevel, string> = {
  debug: "color:#8b949e",
  info: "color:#58a6ff",
  success: "color:#3fb950",
  warning: "color:#d29922",
  error: "color:#f85149",
};
const DIM_STYLE = "color:#8b949e";

function writeConsole(record: ClientLogEntry): void {
  const parts = buildConsoleLogLine(record);
  const [headline = "", ...rest] = parts.messageLines;
  const scope = parts.step ? `${parts.source}:${parts.step}` : parts.source;
  let format = `%c${parts.time}  %c${parts.levelLabel}  %c${scope}${parts.scopePadding}  %c${headline}`;
  const styles: string[] = [DIM_STYLE, `${LEVEL_STYLES[parts.level]};font-weight:bold`, DIM_STYLE, parts.level === "error" || parts.level === "warning" ? LEVEL_STYLES[parts.level] : "color:inherit"];
  if (parts.duration) {
    format += `  %c${parts.duration}`;
    styles.push(DIM_STYLE);
  }
  if (parts.data) {
    format += `  %c${parts.data}`;
    styles.push(DIM_STYLE);
  }
  for (const line of rest) {
    format += `\n%c${CONTINUATION_INDENT}${line}`;
    styles.push(DIM_STYLE);
  }
  console.log(format, ...styles);
}

class ClientLogger {
  private buffer: ClientLogEntry[] = [];
  private flushing = false;

  log(level: ClientLogLevel, step: string, message: string, durationMs?: number, data?: Record<string, unknown>): void {
    const entry: ClientLogEntry = { level, source: "gui", step, message, durationMs, data };
    writeConsole(entry);
    if (level === "debug") return;
    if (this.buffer.length >= 200) this.buffer.shift();
    this.buffer.push(entry);
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    try {
      while (this.buffer.length > 0) {
        const item = this.buffer[0]!;
        try {
          await api.logClientEvent(item);
          this.buffer.shift();
        } catch {
          // Service not reachable (or not logged in yet): retry on the next log call.
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  startTimer(step: string, startMessage?: string) {
    const startTime = performance.now();
    if (startMessage) this.log("info", `${step}:start`, startMessage);
    return {
      end: (level: ClientLogLevel = "info", endMessage = "completed", data?: Record<string, unknown>) => {
        const durationMs = Math.round(performance.now() - startTime);
        this.log(level, step, endMessage, durationMs, data);
        return durationMs;
      },
      fail: (error: unknown, failMessage = "failed", data?: Record<string, unknown>) => {
        const durationMs = Math.round(performance.now() - startTime);
        const errMsg = error instanceof Error ? error.message : String(error);
        this.log("error", step, `${failMessage}: ${errMsg}`, durationMs, { ...data, error: errMsg });
        return durationMs;
      },
    };
  }
}

export const clientLogger = new ClientLogger();

/** Resolves once the service answers /api/health (false after `timeoutMs`). */
export async function ensureRpcReady(timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await api.health();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}
