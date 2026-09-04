/**
 * Portfolio Desktop - Bun main process entry point.
 * Initializes the database, services, RPC handlers, and window.
 */

import { BrowserWindow, BrowserView, Utils } from "electrobun/bun";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import type { PortfolioRPC } from "../shared/rpc-types.js";
import { loadConfig, updateConfig } from "./config.js";
import { appLogger } from "./logger.js";
import { getDatabase, closeDatabase } from "./db/database.js";
import * as portfolioRepo from "./db/portfolio.repo.js";
import * as txRepo from "./db/transaction.repo.js";
import { YahooFinanceService } from "./services/yahoo-finance.js";
import { LlmService } from "./services/llm.js";
import { PortfolioService } from "./services/portfolio.js";
import { PortfolioReportService } from "./services/portfolio-report.js";
import { generateDemoTransactions, DEMO_ASSETS } from "./services/demo-portfolio.js";
import { telemetry } from "./services/telemetry.js";

// ── Initialize ──────────────────────────────────────────────────────────────

appLogger.log("info", "Starting Portfolio Desktop...");

// Initialize database
const db = getDatabase();
appLogger.log("success", "Database initialized");

// Initialize services
const yahoo = new YahooFinanceService();
const llm = new LlmService();
const portfolioService = new PortfolioService(yahoo);
const reportService = new PortfolioReportService(llm, portfolioService);

// Initialize telemetry
telemetry.initialize();
telemetry.capture("app_launched");

// ── RPC Handlers ────────────────────────────────────────────────────────────

const rpc = BrowserView.defineRPC<PortfolioRPC>({
  maxRequestTime: 120_000,
  handlers: {
    requests: {
      // ── Portfolio CRUD ──

      getPortfolios: async () => {
        const rows = portfolioRepo.findAll();
        return {
          portfolios: rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            baseCurrency: r.baseCurrency,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
        };
      },

      getPortfolioData: async (params) => {
        return portfolioService.getPortfolioData(
          params.portfolioId,
          params.baseCurrency,
          params.refresh,
        );
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

      // ── Config ──

      getConfig: async () => {
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

      // ── Setup Wizard ──

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

const mainWindow = new BrowserWindow({
  title: "Portfolio",
  url: "views://main/index.html",
  frame: {
    width: 1400,
    height: 900,
    x: undefined,
    y: undefined,
  },
  rpc,
});

// ── Market data refresh on start ────────────────────────────────────────────

async function refreshMarketDataOnStart(): Promise<void> {
  const portfolios = portfolioRepo.findAll();
  if (portfolios.length === 0) return;

  appLogger.log("info", `Refreshing market data for ${portfolios.length} portfolio(s)...`);

  for (const portfolio of portfolios) {
    try {
      const data = await portfolioService.getPortfolioData(portfolio.id, portfolio.baseCurrency, true);
      portfolioService.saveDailySnapshot(portfolio.id, data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appLogger.log("warning", `Failed to refresh portfolio "${portfolio.name}": ${msg}`);
    }
  }

  appLogger.log("success", "Market data refresh complete");
}

// Kick off non-blocking refresh
refreshMarketDataOnStart().catch((err) => {
  appLogger.log("error", `Market data refresh failed: ${err}`);
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  appLogger.log("info", "Shutting down...");
  await telemetry.shutdown();
  closeDatabase();
  Utils.quit(0);
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

appLogger.log("success", "Portfolio Desktop started");
