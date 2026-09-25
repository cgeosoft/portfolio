/**
 * Portfolio service: HTTP API plus the built GUI on one port. Started by the
 * desktop shell (modules/desktop) or directly with `bun run dev`.
 *
 *   PORTFOLIO_PORT       listen port (default 5130)
 *   PORTFOLIO_HOST       force a bind address (servers); otherwise the
 *                        remote-access switch decides (127.0.0.1 or 0.0.0.0)
 */
import { ensureDataDir } from "./bootstrap";
import { DATA_DIR, getGuiDir } from "./paths";
import { appLogger } from "./logger";
import { getDatabase, closeDatabase, getDatabasePath } from "./db/database";
import * as portfolioRepo from "./db/portfolio.repo";
import * as txRepo from "./db/transaction.repo";
import * as marketCache from "./db/market-cache.repo";
import { loadConfig, updateConfig } from "./config";
import { getAppVersion, getEnvironmentName, isDev } from "./environment";
import { createServices } from "./services/container";
import { telemetry } from "./services/telemetry";
import { appUpdateService } from "./services/app-update";
import { authService } from "./services/auth";
import { hostSettings } from "./services/host-settings";
import { Router, json } from "./http/router";
import { registerRoutes } from "./http/routes";
import { StaticSite } from "./http/static";

const PORT = Number(process.env["PORTFOLIO_PORT"]) || 5130;

appLogger.logStep("info", "main", "start", `Portfolio service ${getAppVersion()} (${getEnvironmentName()})`, undefined, {
  pid: process.pid,
  platform: process.platform,
  arch: process.arch,
  bun: Bun.version,
});

// ── database and services ───────────────────────────────────────────────────

const imported = ensureDataDir();
if (imported) appLogger.logStep("success", "main", "migrate", `Copied the data of ${imported} into ${DATA_DIR}`);

const dbTimer = appLogger.startTimer("db", "open", `Opening ${getDatabasePath()}`);
getDatabase();
loadConfig();
authService.prune();
dbTimer.end("success", `Database ready (${portfolioRepo.findAll().length} portfolios, ${txRepo.countTotal()} transactions)`);

const services = createServices();
telemetry.initialize();
telemetry.capture("app_launched");

// ── HTTP ────────────────────────────────────────────────────────────────────

const router = new Router();
const site = new StaticSite(getGuiDir() ?? "");
let server: ReturnType<typeof Bun.serve> | null = null;

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

function listen(host: string): void {
  server = Bun.serve({
    hostname: host,
    port: PORT,
    idleTimeout: 120,
    fetch: (req, srv) => fetchHandler(req, srv),
    error(err) {
      appLogger.logStep("error", "http", "unhandled", err.message);
      return json({ statusCode: 500, message: err.message }, 500);
    },
  });
}

try {
  listen(hostSettings.listenHost());
} catch (err) {
  appLogger.logStep("error", "http", "listen", `Could not listen on ${hostSettings.listenHost()}:${PORT}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

hostSettings.attach(PORT, async (host) => {
  // Detach the listener without dropping in-flight requests, then bind again.
  server?.stop(false);
  listen(host);
});

appLogger.logStep("success", "http", "listen", `Listening on http://${hostSettings.listenHost()}:${PORT}${site.available ? " (serving GUI)" : ""}`);

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

// ── shutdown ────────────────────────────────────────────────────────────────

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  appLogger.logStep("info", "main", "stop", "Shutting down");
  clearInterval(pruneTimer);
  appUpdateService.stopPeriodicChecks();
  services.metricsService.shutdown();
  server?.stop(true);
  await telemetry.shutdown();
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
