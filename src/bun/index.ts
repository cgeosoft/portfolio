/**
 * Portfolio Desktop - Bun main process entry point.
 * Initializes the database, services, RPC handlers, and window.
 */

import { BrowserWindow, BrowserView, Utils } from "electrobun/bun";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { PortfolioRPC } from "../shared/rpc-types.js";
import { loadConfig, updateConfig } from "./config.js";
import { appLogger } from "./logger.js";
import { getDatabase, closeDatabase } from "./db/database.js";
import * as portfolioRepo from "./db/portfolio.repo.js";
import * as txRepo from "./db/transaction.repo.js";
import * as marketCache from "./db/market-cache.repo.js";
import { YahooFinanceService } from "./services/yahoo-finance.js";
import { LlmService } from "./services/llm.js";
import { PortfolioService } from "./services/portfolio.js";
import { PortfolioReportService } from "./services/portfolio-report.js";
import { PortfolioChatService } from "./services/portfolio-chat.js";
import { generateDemoTransactions, DEMO_ASSETS } from "./services/demo-portfolio.js";
import { telemetry } from "./services/telemetry.js";
import { setupLinuxDesktop, setNativeWindowIcon } from "./services/linux-desktop.js";
import { WindowStateManager, normalizeWindowState } from "./services/window-state.js";

// ── Initialize ──────────────────────────────────────────────────────────────

appLogger.logStep("info", "main", "process_start", "Starting Portfolio Desktop process", undefined, {
  pid: process.pid,
  platform: process.platform,
  arch: process.arch,
  bunVersion: Bun.version,
  sessionLogFiles: appLogger.getSessionLogPaths(),
});

// Initialize database
const dbTimer = appLogger.startTimer("db", "init_database", "Initializing SQLite database pool");
const db = getDatabase();
const portfolioCount = portfolioRepo.findAll().length;
const txCount = txRepo.countTotal();
dbTimer.end("success", `Database initialized (${portfolioCount} portfolios, ${txCount} transactions)`);

// Initialize services
const yahoo = new YahooFinanceService();
const llm = new LlmService();
const portfolioService = new PortfolioService(yahoo);
const reportService = new PortfolioReportService(llm, portfolioService);
const chatService = new PortfolioChatService(llm, portfolioService);

// Initialize telemetry
telemetry.initialize();
telemetry.capture("app_launched");

// Initialize window state manager
const initialConfig = loadConfig();
const initialWindowState = normalizeWindowState(initialConfig.windowState);
const windowStateManager = new WindowStateManager(initialConfig.windowState);
let mainWindow: BrowserWindow;

// ── RPC Handlers ────────────────────────────────────────────────────────────

const rpc = BrowserView.defineRPC<PortfolioRPC>({
  maxRequestTime: 120_000,
  handlers: {
    requests: {
      // ── Client Logging ──
      logClientEvent: async (params) => {
        appLogger.logStep(
          params.level,
          params.source || "webview",
          params.step || "client_event",
          params.message,
          params.durationMs,
          params.data,
        );
        return { success: true };
      },

      // ── Portfolio CRUD ──

      getPortfolios: async () => {
        const timer = appLogger.startTimer("rpc", "getPortfolios", "RPC: getPortfolios requested");
        try {
          const rows = portfolioRepo.findAll();
          const result = {
            portfolios: rows.map((r) => ({
              id: r.id,
              name: r.name,
              description: r.description,
              baseCurrency: r.baseCurrency,
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
            })),
          };
          timer.end("info", `Returned ${result.portfolios.length} portfolio(s)`, { count: result.portfolios.length });
          return result;
        } catch (err) {
          timer.fail(err, "getPortfolios failed");
          throw err;
        }
      },

      getPortfolioData: async (params) => {
        const timer = appLogger.startTimer(
          "rpc",
          "getPortfolioData",
          `RPC: getPortfolioData requested (portfolioId=${params.portfolioId}, baseCurrency=${params.baseCurrency || "default"}, refresh=${Boolean(params.refresh)})`,
        );
        try {
          const data = await portfolioService.getPortfolioData(
            params.portfolioId,
            params.baseCurrency,
            params.refresh,
          );
          timer.end("info", `Returned portfolioData with ${data.holdings?.length ?? 0} holdings`, {
            portfolioId: params.portfolioId,
            holdingsCount: data.holdings?.length ?? 0,
            hasSummary: Boolean(data.summary),
          });
          return data;
        } catch (err) {
          timer.fail(err, `getPortfolioData failed for ${params.portfolioId}`);
          throw err;
        }
      },

      createPortfolio: async (params) => {
        const row = portfolioService.createPortfolio(params);
        telemetry.capture("portfolio_created");
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          baseCurrency: row.baseCurrency,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      },

      updatePortfolio: async (params) => {
        const row = portfolioService.updatePortfolio(params.portfolioId, {
          name: params.name,
          description: params.description,
          baseCurrency: params.baseCurrency,
        });
        if (!row) throw new Error("Portfolio not found");
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          baseCurrency: row.baseCurrency,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      },

      deletePortfolio: async (params) => {
        const success = portfolioService.deletePortfolio(params.portfolioId);
        return { success };
      },

      // ── Transactions ──

      getTransactions: async (params) => {
        const transactions = await portfolioService.getTransactions(params.portfolioId);
        return { transactions };
      },

      manageTransactions: async (params) => {
        const result = await portfolioService.manageTransactions(params.portfolioId, {
          action: params.action,
          transaction: params.transaction,
          transactionId: params.transactionId,
          transactions: params.transactions,
          dryRun: params.dryRun,
        });
        if (params.action === "import" && result.success) {
          telemetry.capture("csv_imported", { count: result.newTransactionsCount });
        }
        return result;
      },

      // ── Symbol Search ──

      searchSymbol: async (params) => {
        const results = await yahoo.searchSymbols(params.query);
        return { results };
      },

      // ── Reports ──

      getReports: async (params) => {
        return reportService.getReports(params.portfolioId);
      },

      generateReport: async (params) => {
        const portfolio = portfolioRepo.findById(params.portfolioId);
        if (!portfolio) throw new Error("Portfolio not found");
        const report = await reportService.generateReport(
          {
            id: portfolio.id,
            name: portfolio.name,
            baseCurrency: portfolio.baseCurrency,
          },
          {
            provider: params.provider,
            model: params.model,
            apiKey: params.apiKey,
            baseUrl: params.baseUrl,
          },
        );
        telemetry.capture("report_generated", { provider: params.provider });
        return report;
      },

      deleteReport: async (params) => {
        const success = reportService.deleteReport(params.portfolioId, params.reportId);
        return { success };
      },

      // ── Assistant & Chat ──

      chatWithPortfolio: async (params) => {
        appLogger.log("info", `RPC: chatWithPortfolio requested for portfolio ${params.portfolioId}`);
        const res = await chatService.chat(params.portfolioId, params.messages, {
          conversationId: params.conversationId,
          title: params.title,
          provider: params.provider,
          model: params.model,
        });
        telemetry.capture("assistant_chat_sent", { provider: res.provider });
        return res;
      },

      getAssistantConversations: async (params) => {
        const conversations = chatService.getConversations(params.portfolioId);
        return { conversations };
      },

      deleteAssistantConversation: async (params) => {
        const success = chatService.deleteConversation(params.portfolioId, params.conversationId);
        return { success };
      },

      // ── LLM ──

      testLlm: async (params) => {
        try {
          const result = await llm.chat(
            [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "Say 'LLM connection verified' in exactly those words." },
            ],
            {
              provider: params.provider,
              model: params.model,
              apiKey: params.apiKey,
              baseUrl: params.baseUrl,
              maxTokens: 50,
            },
          );
          return { success: true, message: result.slice(0, 200) };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, message: msg };
        }
      },

      testLlmStep: async (params) => {
        try {
          return await llm.testStep(params.step, {
            provider: params.provider,
            model: params.model,
            apiKey: params.apiKey,
            baseUrl: params.baseUrl,
            previousOutput: params.previousOutput,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, message: msg };
        }
      },

      getProviderModels: async (params) => {
        try {
          const models = await llm.getAvailableModels(params.provider, params.baseUrl, params.apiKey);
          return { models };
        } catch {
          return { models: [] };
        }
      },

      // ── Config ──

      getConfig: async () => {
        appLogger.log("info", "RPC: getConfig requested");
        return loadConfig();
      },

      saveConfig: async (params) => {
        const updated = updateConfig(params);
        // Re-initialize telemetry if the setting changed
        if ("telemetryEnabled" in params) {
          telemetry.reinitialize();
        }
        return updated;
      },

      // -- App Info and External Links --

      getAppInfo: async () => {
        let version = "0.1.0";
        try {
          const pkgPath = new URL("../../package.json", import.meta.url).pathname;
          if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
            if (pkg.version) version = pkg.version;
          }
        } catch {
          // Keep default version
        }
        const majorMinor = version.split(".").slice(0, 2).join(".");
        const cfg = loadConfig();
        const webpageUrl = process.env["WEBPAGE_URL"] || cfg.webpageUrl || "http://localhost:3000";
        return {
          version,
          majorMinor,
          webpageUrl,
          lastQuotesSync: cfg.lastQuotesSync,
        };
      },

      openExternalUrl: async (params) => {
        try {
          if (typeof Utils !== "undefined" && typeof Utils.openExternal === "function") {
            await Utils.openExternal(params.url);
            return { success: true };
          }
        } catch (err) {
          appLogger.log("warning", `Utils.openExternal failed: ${err}`);
        }
        try {
          const opener = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
          Bun.spawn([opener, params.url]);
          return { success: true };
        } catch (err) {
          appLogger.log("error", `Failed to open external URL ${params.url}: ${err}`);
          return { success: false };
        }
      },

      syncQuotes: async () => {
        try {
          appLogger.log("info", "Starting market quotes sync with Yahoo Finance...");
          const now = new Date().toISOString();
          const portfolios = portfolioRepo.findAll();
          for (const portfolio of portfolios) {
            try {
              const data = await portfolioService.getPortfolioData(portfolio.id, portfolio.baseCurrency, true);
              portfolioService.saveDailySnapshot(portfolio.id, data);
            } catch (err) {
              appLogger.log("warning", `Quotes refresh failed for ${portfolio.name}: ${err}`);
            }
          }
          updateConfig({ lastQuotesSync: now });
          telemetry.capture("quotes_sync_completed");
          appLogger.log("success", `Quotes sync completed at ${now}`);
          return { success: true, lastSync: now };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          appLogger.log("error", `Quotes sync failed: ${msg}`);
          return {
            success: false,
            lastSync: loadConfig().lastQuotesSync || "",
            error: msg,
          };
        }
      },

      getSponsorBanner: async (params) => {
        const cfg = loadConfig();
        const base = (params.url || cfg.webpageUrl || "http://localhost:3000").replace(/\/+$/, "");
        const targetUrl = base.endsWith("/sponsor") ? base : `${base}/sponsor`;

        // 1. Try fetching from remote/local website server
        try {
          const res = await fetch(targetUrl, {
            headers: { Accept: "text/html,application/xhtml+xml" },
            signal: AbortSignal.timeout(4000),
          });
          if (res.ok) {
            const html = await res.text();
            if (html.trim().length > 0) {
              return { success: true, html };
            }
          }
        } catch (err) {
          appLogger.log("info", `Remote sponsor fetch failed, checking local file fallback: ${err}`);
        }

        // 2. Fallback to local workspace sponsor HTML template if available
        try {
          const projectRoot = new URL("../..", import.meta.url).pathname;
          const candidatePaths = [
            join(projectRoot, "extras/website/sponsor/index.html"),
          ];
          for (const filePath of candidatePaths) {
            if (existsSync(filePath)) {
              const html = readFileSync(filePath, "utf-8");
              return { success: true, html };
            }
          }
        } catch (err) {
          appLogger.log("warning", `Local sponsor file read failed: ${err}`);
        }

        return { success: false, html: "", error: "Failed to load sponsor banner" };
      },

      // -- Setup Wizard --

      completeSetup: async (params) => {
        const config = loadConfig();

        // Create demo portfolio if opted in
        if (params.populateDemo) {
          await portfolioService.createDemoPortfolio(config.baseCurrency);
          appLogger.log("success", "Demo portfolio created");
        }

        // Update config
        updateConfig({
          setupCompleted: true,
          telemetryEnabled: params.enableTelemetry,
        });

        // Re-initialize telemetry with new setting
        telemetry.reinitialize();
        telemetry.capture("setup_completed", {
          demo: params.populateDemo,
          telemetry: params.enableTelemetry,
        });

        appLogger.log("success", "Setup wizard completed");
        return { success: true };
      },

      // ── File System ──

      pickFile: async (params) => {
        try {
          const cfg = loadConfig();
          let startingFolder = params.startingFolder || cfg.lastImportDirectory;
          if (startingFolder) {
            try {
              if (!existsSync(startingFolder) || !statSync(startingFolder).isDirectory()) {
                startingFolder = homedir();
              }
            } catch {
              startingFolder = homedir();
            }
          } else {
            startingFolder = homedir();
          }

          const selected = await Utils.openFileDialog({
            startingFolder,
            canChooseFiles: true,
            canChooseDirectory: false,
            allowsMultipleSelection: false,
            allowedFileTypes: params.filters?.map((f: string) => {
              const ext = f.replace(/^\./, "");
              return `*.${ext},*.${ext.toUpperCase()},${ext},${ext.toUpperCase()}`;
            }).join(",") || "*.csv,*.CSV,csv,CSV",
          });
          const path = Array.isArray(selected) ? selected[0] : (typeof selected === "string" ? selected : null);
          if (!path) return { path: null };

          try {
            const dir = dirname(path);
            updateConfig({ lastImportDirectory: dir });
            appLogger.log("info", `Remembered last import directory: ${dir}`);
          } catch (e) {
            appLogger.log("warning", `Failed to save last import directory: ${e}`);
          }

          const content = readFileSync(path, "utf-8");
          return { path, content };
        } catch (err) {
          appLogger.log("error", `pickFile failed: ${err}`);
          return { path: null, content: undefined };
        }
      },

      setLastImportDirectory: async (params) => {
        try {
          if (params.directory && existsSync(params.directory)) {
            updateConfig({ lastImportDirectory: params.directory });
            return { success: true };
          }
        } catch {
          // ignore
        }
        return { success: false };
      },

      readFile: async (params) => {
        const content = readFileSync(params.path, "utf-8");
        return { content };
      },

      quitApp: async () => {
        try {
          if (mainWindow) {
            windowStateManager.updateFromWindow(mainWindow);
          }
          windowStateManager.flushSave();
        } catch {
          // Best effort
        }
        setTimeout(() => {
          shutdown().catch(() => process.exit(0));
        }, 50);
        return { success: true };
      },
    },

    messages: {},
  },
});

// ── Window ──────────────────────────────────────────────────────────────────

mainWindow = new BrowserWindow({
  title: "Portfolio",
  url: "views://main/index.html",
  frame: {
    width: initialWindowState.frame.width,
    height: initialWindowState.frame.height,
    x: initialWindowState.frame.x,
    y: initialWindowState.frame.y,
  },
  rpc,
});

if (initialWindowState.isMaximized) {
  try {
    mainWindow.maximize();
  } catch (err) {
    appLogger.log("warning", `Failed to restore maximized state: ${err}`);
  }
  // Verify maximize state after window mapping
  setTimeout(() => {
    try {
      if (initialWindowState.isMaximized && !mainWindow.isMaximized()) {
        mainWindow.maximize();
      }
    } catch {
      // Best effort
    }
  }, 50);
}

// Track window geometry and state changes
mainWindow.on("resize", () => {
  windowStateManager.updateFromWindow(mainWindow);
});

mainWindow.on("move", () => {
  windowStateManager.updateFromWindow(mainWindow);
});

mainWindow.on("will-close", () => {
  windowStateManager.updateFromWindow(mainWindow);
  windowStateManager.flushSave();
});

mainWindow.on("close", () => {
  windowStateManager.flushSave();
});

if (process.platform === "linux") {
  setupLinuxDesktop();
  if (mainWindow.ptr) {
    setNativeWindowIcon(mainWindow.ptr);
  }
}

// ── Market data refresh on start ────────────────────────────────────────────

async function refreshMarketDataOnStart(): Promise<void> {
  const portfolios = portfolioRepo.findAll();
  if (portfolios.length === 0) return;

  const cfg = loadConfig();
  const now = Date.now();
  const SIXTY_MINUTES_MS = 60 * 60 * 1000;

  // Check if market quotes were synced recently (< 60 min ago)
  if (cfg.lastQuotesSync) {
    const lastSyncTime = new Date(cfg.lastQuotesSync).getTime();
    if (!isNaN(lastSyncTime) && now - lastSyncTime < SIXTY_MINUTES_MS) {
      appLogger.log(
        "info",
        `Market quotes were synced recently (${cfg.lastQuotesSync}, < 60m ago). Skipping startup sync.`
      );
      return;
    }
  }

  // Filter portfolios: only refresh those that lack valid cached market data (< 60 min old)
  const stalePortfolios = portfolios.filter((portfolio) => {
    const cacheKey = `${portfolio.id}_${portfolio.baseCurrency || "EUR"}`;
    const cached = marketCache.get(`portfolio:${cacheKey}`);
    return !cached || cached.isExpired;
  });

  if (stalePortfolios.length === 0) {
    appLogger.log("info", "All portfolios have valid cached market data (< 60m old). Skipping startup sync.");
    return;
  }

  appLogger.log("info", `Refreshing market data for ${stalePortfolios.length} portfolio(s) without recent cache...`);

  for (const portfolio of stalePortfolios) {
    try {
      const data = await portfolioService.getPortfolioData(portfolio.id, portfolio.baseCurrency, true);
      portfolioService.saveDailySnapshot(portfolio.id, data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appLogger.log("warning", `Failed to refresh portfolio "${portfolio.name}": ${msg}`);
    }
  }

  updateConfig({ lastQuotesSync: new Date().toISOString() });
  appLogger.log("success", "Market data refresh complete");
}

// Kick off non-blocking background refresh after window initialization
setTimeout(() => {
  refreshMarketDataOnStart().catch((err) => {
    appLogger.log("error", `Market data refresh failed: ${err}`);
  });
}, 10000);

// ── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  appLogger.log("info", "Shutting down...");
  try {
    if (mainWindow) {
      windowStateManager.updateFromWindow(mainWindow);
    }
    windowStateManager.flushSave();
  } catch {
    // Best effort
  }
  await telemetry.shutdown();
  closeDatabase();
  Utils.quit(0);
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

appLogger.log("success", "Portfolio Desktop started");
