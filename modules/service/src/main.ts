/**
 * Portfolio service: the HTTP API plus the built GUI. The desktop shell runs
 * it (`bun start` from a checkout, `service/main.js` in the app); nothing is
 * passed in, the service derives its paths itself (paths.ts).
 *
 * Start-up: data directory (and the one-time import of an old one), database
 * and settings, desktop-settings.json for the shell, background work, then
 * `Bun.serve` on 127.0.0.1 with a random port. Once it listens, the service
 * prints exactly one `SERVICE_PORT=<port>` line to stdout; the shell reads it
 * and polls `/api/health`. The LAN listener of the remote connections switch
 * starts last (services/remote-access.ts).
 */
import { ensureDataDir } from "./bootstrap";
import { DATA_DIR, getGuiDir } from "./paths";
import { appLogger } from "./logger";
import { getDatabase, closeDatabase, getDatabasePath } from "./db/database";
import * as portfolioRepo from "./db/portfolio.repo";
import * as txRepo from "./db/transaction.repo";
import * as marketCache from "./db/market-cache.repo";
import { loadConfig, updateConfig } from "./config";
import { getAppVersion, getEnvironmentName } from "./environment";
import { createServices } from "./services/container";
import { telemetry } from "./services/telemetry";
import { appUpdateService } from "./services/app-update";
import { authService } from "./services/auth";
import { writeDesktopSettingsFile } from "./services/desktop-settings";
import { isRemoteAccessAllowed, remotePort, startRemoteAccess, stopRemoteAccess } from "./services/remote-access";
import { Router, json } from "./http/router";
import { registerRoutes } from "./http/routes";
import { StaticSite } from "./http/static";

const LOOPBACK_HOST = "127.0.0.1";

appLogger.logStep("info", "main", "start", `Portfolio service ${getAppVersion()} (${getEnvironmentName()})`, undefined, {
  pid: process.pid,
  platform: process.platform,
  arch: process.arch,
  bun: Bun.version,
});

// ── data directory, database and settings ───────────────────────────────────

const imported = ensureDataDir();
if (imported) appLogger.logStep("success", "main", "migrate", `Copied the data of ${imported} into ${DATA_DIR}`);

const dbTimer = appLogger.startTimer("db", "open", `Opening ${getDatabasePath()}`);
getDatabase();
loadConfig();
writeDesktopSettingsFile();
authService.prune();
dbTimer.end("success", `Database ready (${portfolioRepo.findAll().length} portfolios, ${txRepo.countTotal()} transactions)`);

const services = createServices();
telemetry.initialize();
telemetry.capture("app_launched");

// ── background work ─────────────────────────────────────────────────────────

async function refreshMarketDataOnStart(): Promise<void> {
  const portfolios = portfolioRepo.findAll();
  if (portfolios.length === 0) return;
  const cfg = loadConfig();
  const SIXTY_MINUTES_MS = 60 * 60 * 1000;
  if (cfg.lastQuotesSync) {
    const last = new Date(cfg.lastQuotesSync).getTime();
    if (!isNaN(last) && Date.now() - last < SIXTY_MINUTES_MS) {
      appLogger.logStep("info", "market", "startup", "Quotes synced less than 60 minutes ago; skipping startup sync");
      return;
    }
  }
  const stale = portfolios.filter((p) => {
    const cached = marketCache.get(`portfolio:${p.id}_${p.baseCurrency || "EUR"}`);
    return !cached || cached.isExpired;
  });
  if (stale.length === 0) {
    appLogger.logStep("info", "market", "startup", "Every portfolio has fresh cached market data; skipping startup sync");
    return;
  }
  appLogger.logStep("info", "market", "startup", `Refreshing market data for ${stale.length} portfolio(s)`);
  for (const p of stale) {
    try {
      const data = await services.portfolioService.getPortfolioData(p.id, p.baseCurrency, true);
      services.portfolioService.saveDailySnapshot(p.id, data);
    } catch (err) {
      appLogger.logStep("warning", "market", "startup", `Refresh failed for one portfolio: ${err instanceof Error ? err.message : err}`);
    }
  }
  updateConfig({ lastQuotesSync: new Date().toISOString() });
  appLogger.logStep("success", "market", "startup", "Market data refresh complete");
}

setTimeout(() => {
  refreshMarketDataOnStart().catch((err) => appLogger.logStep("error", "market", "startup", `Market data refresh failed: ${err}`));
}, 10_000);
appUpdateService.startPeriodicChecks();
void services.metricsService.warmUp();
const pruneTimer = setInterval(() => authService.prune(), 60 * 60 * 1000);

// ── HTTP ────────────────────────────────────────────────────────────────────

const router = new Router();
const site = new StaticSite(getGuiDir() ?? "");

registerRoutes(router, services, () => {
  shutdown().catch(() => process.exit(0));
});

async function fetchHandler(req: Request, srv: { requestIP(req: Request): { address: string } | null }): Promise<Response> {
  const ip = srv.requestIP(req)?.address ?? "";
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    const res = await router.handle(req, ip);
    return res ?? json({ statusCode: 404, message: `No route for ${req.method} ${url.pathname}` }, 404);
  }
  const res = await router.handle(req, ip);
  if (res) return res;
  return site.serve(req, url) ?? new Response("Not found", { status: 404 });
}

/** One listener with the app's handler. The loopback one and the LAN one serve the same app. */
function serve(hostname: string, port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname,
    port,
    idleTimeout: 120,
    development: false,
    fetch: (req, srv) => fetchHandler(req, srv),
    error(err) {
      appLogger.logStep("error", "http", "unhandled", err.message);
      return json({ statusCode: 500, message: err.message }, 500);
    },
  });
}

let server: ReturnType<typeof Bun.serve>;
try {
  server = serve(LOOPBACK_HOST, 0);
} catch (err) {
  appLogger.logStep("error", "http", "listen", `Could not listen on ${LOOPBACK_HOST}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

// The desktop shell reads this exact line from stdout.
console.log(`SERVICE_PORT=${server.port}`);

appLogger.logStep("success", "http", "listen", `Listening on http://${LOOPBACK_HOST}:${server.port}${site.available ? " (serving GUI)" : ""}`);
appLogger.log("info", `Version:  ${getAppVersion()}`);
appLogger.log("info", `Data:     ${DATA_DIR}`);
appLogger.log("info", `Database: ${getDatabasePath()}`);
appLogger.log("info", `App lock: ${authService.isPinEnabled() ? "PIN set" : "off"}`);
appLogger.log("info", `Remote:   ${isRemoteAccessAllowed() ? `on, port ${remotePort()}` : "off"}`);

startRemoteAccess(serve);

// ── shutdown ────────────────────────────────────────────────────────────────

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  appLogger.logStep("info", "main", "stop", "Shutting down");
  clearInterval(pruneTimer);
  appUpdateService.stopPeriodicChecks();
  services.metricsService.shutdown();
  stopRemoteAccess();
  server.stop(true);
  await telemetry.shutdown();
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

process.on("uncaughtException", (err) => {
  appLogger.logStep("error", "main", "uncaught", `Uncaught exception: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
});
process.on("unhandledRejection", (reason) => {
  appLogger.logStep("error", "main", "unhandled", `Unhandled promise rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
});
