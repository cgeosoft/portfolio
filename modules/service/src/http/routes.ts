/**
 * HTTP API of the service. Handlers stay thin: they validate the request,
 * call a service and return its result (the same rule the RPC handlers
 * followed). Paths are grouped by resource; the GUI client is
 * modules/gui/src/api.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HttpError, Router, json, type RequestContext } from "./router";
import { appLogger } from "../logger";
import { loadConfig, maskSecrets, unmaskLlmKey, unmaskSecret, unmaskUpdates, updateConfig } from "../config";
import { listSettings } from "../services/settings-catalog";
import { getAppVersion, getEnvironmentName, isDev } from "../environment";
import { getLogDir } from "../paths";
import { getDatabasePath } from "../db/database";
import * as portfolioRepo from "../db/portfolio.repo";
import { authService, clearSessionCookie, readSessionCookie, sessionCookie } from "../services/auth";
import { hostSettings } from "../services/host-settings";
import { revealInFileManager, saveToDownloads } from "../services/files";
import { supportTicketService } from "../services/support-ticket";
import { appUpdateService } from "../services/app-update";
import { telemetry } from "../services/telemetry";
import * as portfolioMetrics from "../services/portfolio-metrics";
import { WEBPAGE_URL, SUPPORT_EMAIL } from "portfolio-shared/brand";
import type { AppServices } from "../services/container";
import type {
  ChatWithPortfolioRequest,
  CompleteSetupRequest,
  CreatePortfolioRequest,
  GetSettingsResponse,
  EvaluatePortfolioMetricsRequest,
  GenerateReportRequest,
  GetProviderModelsRequest,
  InstallMetricRequest,
  LogClientEventRequest,
  ManageTransactionRequest,
  OpenSupportTicketRequest,
  PrepareReportPromptRequest,
  PreviewMetricInstallRequest,
  SavePortfolioMetricsRequest,
  StartReportStreamRequest,
  TestFinnhubConnectionRequest,
  TestLlmRequest,
  TestLlmStepRequest,
  UpdatePortfolioRequest,
} from "portfolio-shared/api-types";
import type { DesktopConfig } from "portfolio-shared/config-types";

const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/status", "/api/auth/login"]);
/** Routes a signed-in client may call before accepting the Terms of Use. */
const PRE_TERMS_PATHS = new Set(["/api/auth/me", "/api/auth/accept-terms", "/api/auth/logout"]);

function authStatus() {
  return { pinEnabled: authService.isPinEnabled(), hasAcceptedTerms: authService.hasAcceptedTerms(), acceptedTermsAt: authService.acceptedTermsAt() };
}

function assertLocal(ctx: RequestContext, what: string): void {
  if (!ctx.isLocal) throw new HttpError(403, `${what} is only available from the desktop window`);
}

function str(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${name} is required`);
  return value.trim();
}

function toItem(row: portfolioRepo.PortfolioRow) {
  return { id: row.id, name: row.name, description: row.description, baseCurrency: row.baseCurrency, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** Bundled sponsor page: set by the desktop shell, or the website source in development. */
function sponsorFallbackFile(theme?: string): string | null {
  const isLight = theme === "light";
  const configured = isLight
    ? process.env["PORTFOLIO_SPONSOR_LIGHT_FILE"]?.trim()
    : process.env["PORTFOLIO_SPONSOR_FILE"]?.trim();
  const relFile = isLight ? "sponsor/light/index.html" : "sponsor/index.html";
  const candidates = [
    configured,
    resolve(dirname(new URL(import.meta.url).pathname), `../../../../extras/website/${relFile}`),
    join(process.cwd(), `extras/website/${relFile}`),
    ...(isLight
      ? [
          resolve(dirname(new URL(import.meta.url).pathname), "../../../../extras/website/sponsor/light.html"),
          join(process.cwd(), "extras/website/sponsor/light.html"),
        ]
      : []),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;
  if (isLight) return sponsorFallbackFile();
  return null;
}

export function registerRoutes(router: Router, services: AppServices, onQuit: () => void): void {
  const { portfolioService, reportService, chatService, metricsService, marketData, llm, finnhub, yahoo } = services;

  // ── middleware: remote-access gate and session ──────────────────────────

  router.use((ctx) => {
    if (!ctx.isLocal && !hostSettings.allowRemoteConnections) {
      throw new HttpError(403, "Remote connections are disabled on this Portfolio");
    }
  });

  router.use((ctx) => {
    if (PUBLIC_PATHS.has(ctx.url.pathname)) return;
    const sessionId = readSessionCookie(ctx.req);
    if (!authService.validateSession(sessionId)) throw new HttpError(401, sessionId ? "Invalid or expired session" : "Session cookie is missing");
    ctx.sessionId = sessionId;
    if (!authService.hasAcceptedTerms() && !PRE_TERMS_PATHS.has(ctx.url.pathname)) {
      throw new HttpError(403, "Terms of Use must be accepted before using the application");
    }
  });

  // ── health ──────────────────────────────────────────────────────────────

  router.get("/api/health", () => ({ status: "ok", version: getAppVersion(), env: getEnvironmentName() }));

  // ── auth ────────────────────────────────────────────────────────────────

  router.get("/api/auth/status", () => authStatus());

  router.post("/api/auth/login", async (ctx) => {
    const body = await ctx.body<{ pin?: string }>();
    const id = authService.login(body.pin);
    const secure = ctx.req.headers.get("x-forwarded-proto") === "https";
    ctx.responseHeaders.append("Set-Cookie", sessionCookie(id, secure));
    return { success: true, ...authStatus() };
  });

  router.post("/api/auth/logout", (ctx) => {
    if (ctx.sessionId) authService.deleteSession(ctx.sessionId);
    ctx.responseHeaders.append("Set-Cookie", clearSessionCookie());
    return { success: true };
  });

  router.get("/api/auth/me", () => authStatus());

  router.post("/api/auth/accept-terms", () => {
    authService.acceptTerms();
    return authStatus();
  });

  router.put("/api/auth/pin", async (ctx) => {
    const body = await ctx.body<{ pin?: string; currentPin?: string }>();
    authService.setPin(String(body.pin ?? ""), body.currentPin);
    authService.revokeOtherSessions(ctx.sessionId);
    return { pinEnabled: true };
  });

  router.delete("/api/auth/pin", async (ctx) => {
    const body = await ctx.body<{ currentPin?: string }>();
    authService.removePin(String(body.currentPin ?? ""));
    if (hostSettings.allowRemoteConnections) await hostSettings.setAllowRemoteConnections(false);
    return { pinEnabled: false };
  });

  // ── host (remote access) ────────────────────────────────────────────────

  const remoteInfo = () => ({
    enabled: hostSettings.allowRemoteConnections,
    port: hostSettings.listenPort,
    urls: hostSettings.allowRemoteConnections ? hostSettings.lanUrls() : [],
    pinRequired: !authService.isPinEnabled(),
  });

  router.get("/api/host/remote-access", (ctx) => {
    assertLocal(ctx, "Remote access control");
    return remoteInfo();
  });

  router.patch("/api/host/remote-access", async (ctx) => {
    assertLocal(ctx, "Remote access control");
    const body = await ctx.body<{ enabled?: boolean }>();
    const enabled = body.enabled === true;
    if (enabled && !authService.isPinEnabled()) throw new HttpError(400, "Set a PIN before allowing remote connections");
    await hostSettings.setAllowRemoteConnections(enabled);
    return remoteInfo();
  });

  // ── portfolios ──────────────────────────────────────────────────────────

  router.get("/api/portfolios", () => ({ portfolios: portfolioRepo.findAll().map(toItem) }));

  router.post("/api/portfolios", async (ctx) => {
    const body = await ctx.body<CreatePortfolioRequest>();
    const row = portfolioService.createPortfolio(body);
    telemetry.capture("portfolio_created");
    return toItem(row);
  });

  router.patch("/api/portfolios/:id", async (ctx) => {
    const body = await ctx.body<UpdatePortfolioRequest>();
    const row = portfolioService.updatePortfolio(ctx.params.id!, { name: body.name, description: body.description, baseCurrency: body.baseCurrency });
    if (!row) throw new HttpError(404, "Portfolio not found");
    return toItem(row);
  });

  router.delete("/api/portfolios/:id", (ctx) => ({ success: portfolioService.deletePortfolio(ctx.params.id!) }));

  router.get("/api/portfolios/:id/data", async (ctx) => {
    const timer = appLogger.startTimer("api", "portfolioData");
    try {
      const baseCurrency = ctx.url.searchParams.get("baseCurrency") || undefined;
      const refresh = ctx.url.searchParams.get("refresh") === "true";
      const data = await portfolioService.getPortfolioData(ctx.params.id!, baseCurrency, refresh);
      timer.end("info", `Returned ${data.holdings?.length ?? 0} holdings`, { refresh });
      return data;
    } catch (err) {
      timer.fail(err, "portfolioData failed");
      throw err;
    }
  });

  // ── overview metrics and metric modules ─────────────────────────────────

  router.get("/api/portfolios/:id/metrics", (ctx) => ({ portfolioId: ctx.params.id!, metrics: portfolioMetrics.getPortfolioMetrics(ctx.params.id!) }));

  router.put("/api/portfolios/:id/metrics", async (ctx) => {
    const body = await ctx.body<SavePortfolioMetricsRequest>();
    const id = ctx.params.id!;
    const metrics = body.reset ? portfolioMetrics.resetPortfolioMetrics(id) : portfolioMetrics.savePortfolioMetrics(id, body.metrics ?? []);
    return { portfolioId: id, metrics };
  });

  router.post("/api/portfolios/:id/metrics/evaluate", async (ctx) => {
    const body = await ctx.body<EvaluatePortfolioMetricsRequest>();
    const results = await metricsService.evaluateForPortfolio({ ...body, portfolioId: ctx.params.id! });
    return { portfolioId: ctx.params.id!, results };
  });

  router.get("/api/metrics/catalog", () => metricsService.getCatalog());

  router.post("/api/metrics/preview", async (ctx) => {
    const body = await ctx.body<PreviewMetricInstallRequest>();
    return metricsService.previewInstall(str(body.url, "url"));
  });

  router.post("/api/metrics/install", async (ctx) => {
    const body = await ctx.body<InstallMetricRequest>();
    const metric = await metricsService.install(str(body.url, "url"), body.grantedScopes ?? []);
    telemetry.capture("metric_installed");
    return { metric };
  });

  router.delete("/api/metrics/:id", async (ctx) => ({ success: await metricsService.uninstall(ctx.params.id!) }));

  // ── transactions ────────────────────────────────────────────────────────

  router.get("/api/portfolios/:id/transactions", async (ctx) => ({ transactions: await portfolioService.getTransactions(ctx.params.id!) }));

  router.post("/api/portfolios/:id/transactions", async (ctx) => {
    const body = await ctx.body<ManageTransactionRequest>();
    const result = await portfolioService.manageTransactions(ctx.params.id!, {
      action: body.action,
      transaction: body.transaction,
      transactionId: body.transactionId,
      transactions: body.transactions,
      dryRun: body.dryRun,
    });
    if (body.action === "import" && result.success && !body.dryRun) telemetry.capture("csv_imported", { count: result.newTransactionsCount });
    return result;
  });

  router.get("/api/symbols/search", async (ctx) => ({ results: await marketData.searchSymbols(ctx.url.searchParams.get("q") || "") }));

  // ── reports ─────────────────────────────────────────────────────────────

  router.get("/api/portfolios/:id/reports", (ctx) => reportService.getReports(ctx.params.id!));

  router.post("/api/portfolios/:id/reports/prompt", async (ctx) => {
    const body = await ctx.body<PrepareReportPromptRequest>();
    return reportService.prepareReportPrompt(ctx.params.id!, { provider: body.provider, model: body.model, weekKey: body.weekKey });
  });

  router.post("/api/portfolios/:id/reports/stream", async (ctx) => {
    const body = await ctx.body<StartReportStreamRequest>();
    const res = await reportService.startReportStream({ ...body, portfolioId: ctx.params.id! });
    telemetry.capture("report_generated", { provider: body.provider, streaming: true });
    return res;
  });

  router.get("/api/reports/stream/:sessionId", (ctx) => reportService.pollReportStream(ctx.params.sessionId!));
  router.delete("/api/reports/stream/:sessionId", (ctx) => reportService.cancelReportStream(ctx.params.sessionId!));

  router.post("/api/portfolios/:id/reports", async (ctx) => {
    const body = await ctx.body<GenerateReportRequest>();
    const portfolio = portfolioRepo.findById(ctx.params.id!);
    if (!portfolio) throw new HttpError(404, "Portfolio not found");
    const report = await reportService.generateReport(
      { id: portfolio.id, name: portfolio.name, baseCurrency: portfolio.baseCurrency },
      { provider: body.provider, model: body.model, apiKey: unmaskLlmKey(body.apiKey), baseUrl: body.baseUrl, weekKey: body.weekKey },
    );
    telemetry.capture("report_generated", { provider: body.provider });
    return report;
  });

  router.delete("/api/portfolios/:id/reports/:reportId", (ctx) => ({ success: reportService.deleteReport(ctx.params.id!, ctx.params.reportId!) }));

  // ── assistant ───────────────────────────────────────────────────────────

  router.get("/api/portfolios/:id/assistant/conversations", (ctx) => ({ conversations: chatService.getConversations(ctx.params.id!) }));

  router.delete("/api/portfolios/:id/assistant/conversations/:conversationId", (ctx) => ({
    success: chatService.deleteConversation(ctx.params.id!, ctx.params.conversationId!),
  }));

  router.get("/api/portfolios/:id/assistant/system-prompt", async (ctx) => ({
    systemPrompt: await chatService.getSystemPrompt(ctx.params.id!),
    portfolioName: portfolioRepo.findById(ctx.params.id!)?.name ?? "",
  }));

  router.post("/api/portfolios/:id/assistant/chat", async (ctx) => {
    const body = await ctx.body<ChatWithPortfolioRequest>();
    const res = await chatService.chat(ctx.params.id!, body.messages ?? [], {
      conversationId: body.conversationId,
      title: body.title,
      provider: body.provider,
      model: body.model,
    });
    telemetry.capture("assistant_chat_sent", { provider: res.provider });
    return res;
  });

  // ── LLM and data providers ──────────────────────────────────────────────

  router.post("/api/llm/test", async (ctx) => {
    const body = await ctx.body<TestLlmRequest>();
    try {
      const result = await llm.chat(
        [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say 'LLM connection verified' in exactly those words." },
        ],
        { provider: body.provider, model: body.model, apiKey: unmaskLlmKey(body.apiKey), baseUrl: body.baseUrl, maxTokens: 50 },
      );
      return { success: true, message: result.slice(0, 200) };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  router.post("/api/llm/test-step", async (ctx) => {
    const body = await ctx.body<TestLlmStepRequest>();
    try {
      return await llm.testStep(body.step, { provider: body.provider, model: body.model, apiKey: unmaskLlmKey(body.apiKey), baseUrl: body.baseUrl, previousOutput: body.previousOutput });
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  router.post("/api/llm/models", async (ctx) => {
    const body = await ctx.body<GetProviderModelsRequest>();
    try {
      return { models: await llm.getAvailableModels(body.provider, body.baseUrl, unmaskLlmKey(body.apiKey)) };
    } catch {
      return { models: [] };
    }
  });

  router.get("/api/llm/claude-cli/status", () => llm.claudeCliStatus());

  router.post("/api/providers/finnhub/test", async (ctx) => finnhub.testConnection(unmaskSecret((await ctx.body<TestFinnhubConnectionRequest>()).apiKey, loadConfig().finnhubApiKey)));
  router.get("/api/providers/yahoo/test", () => yahoo.testConnection());

  router.post("/api/market/cache/clear", () => {
    const res = marketData.clearMarketCache();
    portfolioService.clearPortfolioCache();
    return res;
  });

  router.post("/api/market/sync", async () => {
    try {
      appLogger.logStep("info", "market", "sync", "Refreshing quotes for every portfolio");
      const now = new Date().toISOString();
      for (const portfolio of portfolioRepo.findAll()) {
        try {
          const data = await portfolioService.getPortfolioData(portfolio.id, portfolio.baseCurrency, true);
          portfolioService.saveDailySnapshot(portfolio.id, data);
        } catch (err) {
          appLogger.logStep("warning", "market", "sync", `Quotes refresh failed for one portfolio: ${err}`);
        }
      }
      updateConfig({ lastQuotesSync: now });
      telemetry.capture("quotes_sync_completed");
      return { success: true, lastSync: now };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appLogger.logStep("error", "market", "sync", `Quotes sync failed: ${msg}`);
      return { success: false, lastSync: loadConfig().lastQuotesSync || "", error: msg };
    }
  });

  // ── config ──────────────────────────────────────────────────────────────

  router.get("/api/config", () => maskSecrets(loadConfig()));

  router.get("/api/settings", (): GetSettingsResponse => ({ settings: listSettings() }));

  router.patch("/api/config", async (ctx) => {
    const body = await ctx.body<Partial<DesktopConfig>>();
    delete (body as Record<string, unknown>).deviceId;
    const updated = updateConfig(unmaskUpdates(body));
    if ("telemetryEnabled" in body) telemetry.reinitialize();
    if (body.checkForUpdates === true) appUpdateService.checkForUpdates().catch(() => {});
    return maskSecrets(updated);
  });

  router.post("/api/setup/complete", async (ctx) => {
    const body = await ctx.body<CompleteSetupRequest>();
    if (body.populateDemo) {
      await portfolioService.createDemoPortfolio(loadConfig().baseCurrency);
      appLogger.logStep("success", "setup", "demo", "Demo portfolio created");
    }
    updateConfig({ setupCompleted: true, telemetryEnabled: body.enableTelemetry === true });
    telemetry.reinitialize();
    telemetry.capture("setup_completed", { demo: body.populateDemo, telemetry: body.enableTelemetry });
    return { success: true };
  });

  // ── app: info, updates, logs, support, files ────────────────────────────

  router.get("/api/app/info", (ctx) => {
    const version = getAppVersion();
    return {
      version,
      majorMinor: version.split(".").slice(0, 2).join("."),
      webpageUrl: WEBPAGE_URL,
      devEmail: SUPPORT_EMAIL,
      isDev: isDev(),
      channel: getEnvironmentName(),
      lastQuotesSync: loadConfig().lastQuotesSync,
      isLocalClient: ctx.isLocal,
      paths: { data: getDatabasePath(), logs: getLogDir() },
    };
  });

  router.get("/api/app/update", () => appUpdateService.getUpdateInfo());
  router.post("/api/app/update/check", async (ctx) => appUpdateService.checkForUpdates(Boolean((await ctx.body<{ force?: boolean }>()).force)));
  router.post("/api/app/update/download", async (ctx) => appUpdateService.downloadUpdate(str((await ctx.body<{ version?: string }>()).version, "version")));

  router.post("/api/app/logs", async (ctx) => {
    const p = await ctx.body<LogClientEventRequest>();
    appLogger.logStep(p.level || "info", p.source || "gui", p.step || "client_event", String(p.message ?? ""), p.durationMs, p.data);
    return { success: true };
  });

  router.get("/api/app/sponsor", async (ctx) => {
    const rawUrl = (ctx.url.searchParams.get("url") || "").trim();
    const themeParam = (ctx.url.searchParams.get("theme") || "").trim().toLowerCase();
    const isLight = themeParam === "light" || rawUrl.includes("/sponsor/light");
    let targetUrl: string;
    if (rawUrl) {
      const clean = rawUrl.replace(/\/+$/, "");
      targetUrl = clean.endsWith(".html") ? clean : `${clean}/`;
    } else {
      const base = WEBPAGE_URL.replace(/\/+$/, "");
      targetUrl = isLight ? `${base}/sponsor/light/` : `${base}/sponsor/`;
    }
    try {
      const res = await fetch(targetUrl, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const html = await res.text();
        if (html.trim()) return { success: true, html };
      }
    } catch {
      // offline: fall back to the bundled page
    }
    const file = sponsorFallbackFile(isLight ? "light" : "dark");
    if (file) return { success: true, html: readFileSync(file, "utf-8") };
    return { success: false, html: "", error: "Failed to load sponsor banner" };
  });

  router.post("/api/app/support", async (ctx) => {
    const body = await ctx.body<OpenSupportTicketRequest>();
    const ticket = await supportTicketService.buildSupportTicket(body);
    let zipPath: string | undefined;
    if (ticket.zip && ticket.zipFileName && ctx.isLocal) {
      zipPath = saveToDownloads(ticket.zipFileName, undefined, ticket.zip.toString("base64"));
    }
    return { success: true, recipient: ticket.recipient, subject: ticket.subject, body: ticket.body, zipPath, zipFileName: ticket.zipFileName, logCount: ticket.logCount };
  });

  router.get("/api/app/support/diagnostics", async () => {
    const packaged = await supportTicketService.packageRecentLogs();
    return new Response(new Uint8Array(packaged.zip), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${packaged.fileName}"` },
    });
  });

  router.post("/api/files/save", async (ctx) => {
    assertLocal(ctx, "Saving to the Downloads folder");
    const body = await ctx.body<{ fileName?: string; content?: string; base64Data?: string }>();
    const filePath = saveToDownloads(str(body.fileName, "fileName"), body.content, body.base64Data);
    return { success: true, filePath };
  });

  router.post("/api/files/reveal", async (ctx) => {
    assertLocal(ctx, "Revealing a file");
    return revealInFileManager(str((await ctx.body<{ filePath?: string }>()).filePath, "filePath"));
  });

  router.post("/api/app/quit", (ctx) => {
    assertLocal(ctx, "Quitting");
    setTimeout(onQuit, 50);
    return json({ success: true }, 200, ctx.responseHeaders);
  });
}
