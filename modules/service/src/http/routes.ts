/**
 * HTTP API of the service. Handlers stay thin: they validate the request,
 * call a service and return its result (the same rule the RPC handlers
 * followed). Paths are grouped by resource; the GUI client is
 * modules/gui/src/api.ts.
 */
import { HttpError, Router, json, type RequestContext } from "./router";
import { appLogger, logClientEvent } from "../logger";
import { CONFIG_KEYS, loadConfig, maskSecrets, requestSecret, unmaskSecret, unmaskUpdates, updateConfig } from "../config";
import { listSettings } from "../services/settings-catalog";
import { getAppVersion, getEnvironmentName, isDev } from "../environment";
import { REPO_ROOT, getLogDir } from "../paths";
import { join } from "node:path";
import { getDatabasePath } from "../db/database";
import * as portfolioRepo from "../db/portfolio.repo";
import { authService, clearLegacySessionCookie, clearSessionCookie, readSession, sessionCookie } from "../services/auth";
import { disableRemoteAccess, isRemoteListening, remoteAccessInfo, setRemoteAccess } from "../services/remote-access";
import { writeDesktopSettingsFile } from "../services/desktop-settings";
import { revealInFileManager, saveBytesToDownloads, saveToDownloads } from "../services/files";
import { createDatabaseBackup } from "../services/backup";
import { loadSponsorPage, sponsorFrameResponse, sponsorTheme } from "../services/sponsor";
import { supportTicketService } from "../services/support-ticket";
import { appUpdateService } from "../services/app-update";
import { telemetry } from "../services/telemetry";
import { sendGotify } from "../services/gotify";
import { sendNtfy } from "../services/ntfy";
import * as portfolioMetrics from "../services/portfolio-metrics";
import { suggestMetricLayout } from "../services/metric-advisor";
import { getMacroSnapshot } from "../services/intel/macro";
import { getBenchmarkComparison, getBenchmarkHistory, normalizeBenchmarkRange } from "../services/intel/benchmark";
import { getHeldMarketStatus } from "../services/intel/market-hours";
import { isIsin } from "../services/providers/identifiers";
import { DEFAULT_BENCHMARK_SYMBOL } from "portfolio-shared/config-types";
import { getCompanyIntel, getTranscriptResponse, parseIntelParts, summarizeTranscriptResponse } from "../services/intel/company";
import { WEBPAGE_URL, SUPPORT_EMAIL } from "portfolio-shared/brand";
import type { AppServices } from "../services/container";
import type {
  ChatWithPortfolioRequest,
  CompleteSetupRequest,
  CreatePortfolioRequest,
  GetReportPromptResponse,
  GetSettingsResponse,
  EvaluatePortfolioMetricsRequest,
  GenerateReportRequest,
  GenerateSuggestionsRequest,
  GetProviderModelsRequest,
  InstallMetricRequest,
  ManageTransactionRequest,
  SetIsinSymbolRequest,
  SetManualPriceRequest,
  OpenSupportTicketRequest,
  PrepareReportPromptRequest,
  PreviewMetricInstallRequest,
  SavePortfolioMetricsRequest,
  SuggestPortfolioMetricsRequest,
  StartReportStreamRequest,
  TestFinnhubConnectionRequest,
  TestFmpConnectionRequest,
  TestGotifyRequest,
  TestNtfyRequest,
  TestLlmRequest,
  TestLlmStepRequest,
  UpdatePortfolioRequest,
  UpdateRemoteAccessRequest,
  UpdateSuggestionStatusRequest,
} from "portfolio-shared/api-types";
import { PROTECTED_CONFIG_KEYS, type DesktopConfig } from "portfolio-shared/config-types";

/**
 * Routes that need no session. The sponsor frame serves only the public
 * website page, in its own sandbox; a frame request then works even where a
 * webview withholds the cookie from a sandboxed frame.
 */
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/status", "/api/auth/login", "/api/app/sponsor/frame", "/intro"]);
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

/**
 * An optional currency code from a request: three letters, or undefined for
 * the portfolio's own. Each value becomes a cache key and an FX lookup, so
 * anything else is refused.
 */
function currencyParam(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const code = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new HttpError(400, "Invalid currency");
  return code;
}

function toItem(row: portfolioRepo.PortfolioRow) {
  return { id: row.id, name: row.name, description: row.description, baseCurrency: row.baseCurrency, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** True behind a TLS proxy, where the session cookie gets `Secure`. */
function isHttps(req: Request): boolean {
  return req.headers.get("x-forwarded-proto") === "https";
}

export function registerRoutes(router: Router, services: AppServices, onQuit: () => void): void {
  const { portfolioService, reportService, chatService, suggestionService, metricsService, marketData, llm, finnhub, fmp, yahoo, dailyBrief, weeklyAnalysis } = services;

  // ── middleware: remote-access gate and session ──────────────────────────

  router.use((ctx) => {
    if (!ctx.isLocal && !isRemoteListening()) {
      throw new HttpError(403, "Remote connections are disabled on this Portfolio");
    }
  });

  router.use((ctx) => {
    if (PUBLIC_PATHS.has(ctx.url.pathname)) return;
    const session = readSession(ctx.req);
    const sessionId = session?.id ?? null;
    if (!authService.validateSession(sessionId)) throw new HttpError(401, sessionId ? "Invalid or expired session" : "Session cookie is missing");
    ctx.sessionId = sessionId;
    // A valid session under the old shared name is ours: move it to the new
    // name. Another instance's old cookie fails the check above and stays.
    if (session?.legacy) {
      ctx.responseHeaders.append("Set-Cookie", sessionCookie(session.id, isHttps(ctx.req)));
      ctx.responseHeaders.append("Set-Cookie", clearLegacySessionCookie());
    }
    if (!authService.hasAcceptedTerms() && !PRE_TERMS_PATHS.has(ctx.url.pathname)) {
      throw new HttpError(403, "Terms of Use must be accepted before using the application");
    }
  });

  // ── health ──────────────────────────────────────────────────────────────

  router.get("/api/health", () => ({ status: "ok", version: getAppVersion(), env: getEnvironmentName() }));

  // Preview of the desktop starting page with the vendor intro, for design review. Only in a
  // checkout: it renders the page from the desktop shell source. Reload to replay.
  router.get("/intro", async () => {
    if (!REPO_ROOT) throw new HttpError(404, "Not found");
    const pages = (await import(join(REPO_ROOT, "modules/desktop/src/bun/pages.ts"))) as { startingPage(hint: string): string };
    return new Response(pages.startingPage("Starting the local service."), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  });

  // ── auth ────────────────────────────────────────────────────────────────

  router.get("/api/auth/status", () => authStatus());

  router.post("/api/auth/login", async (ctx) => {
    // The one body read before a session exists: a PIN needs a few bytes, not 30 MB.
    const body = await ctx.body<{ pin?: unknown }>(4096);
    const id = authService.login(typeof body.pin === "string" ? body.pin : undefined);
    ctx.responseHeaders.append("Set-Cookie", sessionCookie(id, isHttps(ctx.req)));
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

  router.get("/api/auth/sessions", () => ({ active: authService.activeSessionCount() }));

  router.post("/api/auth/sessions/revoke-others", (ctx) => ({ revoked: authService.revokeOtherSessions(ctx.sessionId) }));

  router.delete("/api/auth/pin", async (ctx) => {
    const body = await ctx.body<{ currentPin?: string }>();
    authService.removePin(String(body.currentPin ?? ""));
    disableRemoteAccess();
    return { pinEnabled: false };
  });

  // ── host (remote access) ────────────────────────────────────────────────

  router.get("/api/host/remote-access", (ctx) => {
    assertLocal(ctx, "Remote access control");
    return remoteAccessInfo();
  });

  router.patch("/api/host/remote-access", async (ctx) => {
    assertLocal(ctx, "Remote access control");
    const body = await ctx.body<UpdateRemoteAccessRequest>();
    return setRemoteAccess({
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      port: body.port === undefined ? undefined : Number(body.port),
    });
  });

  // ── portfolios ──────────────────────────────────────────────────────────

  router.get("/api/portfolios", () => ({ portfolios: portfolioRepo.findAll().map(toItem) }));

  router.post("/api/portfolios", async (ctx) => {
    const body = await ctx.body<CreatePortfolioRequest>();
    const row = portfolioService.createPortfolio({ ...body, baseCurrency: currencyParam(body.baseCurrency) });
    telemetry.capture("portfolio_created");
    return toItem(row);
  });

  router.patch("/api/portfolios/:id", async (ctx) => {
    const body = await ctx.body<UpdatePortfolioRequest>();
    const row = portfolioService.updatePortfolio(ctx.params.id!, { name: body.name, description: body.description, baseCurrency: currencyParam(body.baseCurrency) });
    if (!row) throw new HttpError(404, "Portfolio not found");
    return toItem(row);
  });

  router.delete("/api/portfolios/:id", (ctx) => ({ success: portfolioService.deletePortfolio(ctx.params.id!) }));

  router.get("/api/portfolios/:id/data", async (ctx) => {
    const timer = appLogger.startTimer("api", "portfolioData");
    try {
      const baseCurrency = currencyParam(ctx.url.searchParams.get("baseCurrency"));
      const refresh = ctx.url.searchParams.get("refresh") === "true";
      const data = await portfolioService.getPortfolioData(ctx.params.id!, baseCurrency, refresh);
      timer.end("info", `Returned ${data.holdings?.length ?? 0} holdings`, { refresh });
      return data;
    } catch (err) {
      timer.fail(err, "portfolioData failed");
      throw err;
    }
  });

  // Exposure after ETF and fund look-through (services/exposure.ts).
  router.get("/api/portfolios/:id/exposure", async (ctx) => {
    if (!portfolioRepo.findById(ctx.params.id!)) throw new HttpError(404, "Portfolio not found");
    return services.exposure.getExposure(ctx.params.id!, {
      baseCurrency: currencyParam(ctx.url.searchParams.get("baseCurrency")),
      refresh: ctx.url.searchParams.get("refresh") === "true",
    });
  });

  // Dividend income, yields and split hints (services/income.ts).
  router.get("/api/portfolios/:id/income", async (ctx) => {
    if (!portfolioRepo.findById(ctx.params.id!)) throw new HttpError(404, "Portfolio not found");
    return services.income.getIncomeSummary(ctx.params.id!);
  });

  // Ex-dividend dates, pay dates, earnings and splits of held symbols in the next `days` days (1 to 365, default 30).
  router.get("/api/portfolios/:id/events", async (ctx) => {
    if (!portfolioRepo.findById(ctx.params.id!)) throw new HttpError(404, "Portfolio not found");
    const days = Number(ctx.url.searchParams.get("days") ?? 30);
    if (!Number.isFinite(days) || days < 1 || days > 365) throw new HttpError(400, "days must be between 1 and 365");
    return services.income.getUpcomingEvents(ctx.params.id!, days);
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

  // Proposal only; the GUI saves it through PUT /metrics when the user confirms.
  router.post("/api/portfolios/:id/metrics/suggest", async (ctx) => {
    const body = await ctx.body<SuggestPortfolioMetricsRequest>();
    return suggestMetricLayout({ llm, portfolioService, metricsService }, ctx.params.id!, currencyParam(body.baseCurrency));
  });

  router.get("/api/metrics/catalog", () => metricsService.getCatalog());

  router.post("/api/metrics/preview", async (ctx) => {
    const body = await ctx.body<PreviewMetricInstallRequest>();
    return metricsService.previewInstall(str(body.url, "url"));
  });

  router.post("/api/metrics/install", async (ctx) => {
    const body = await ctx.body<InstallMetricRequest>();
    if (body.sha256 !== undefined && (typeof body.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(body.sha256))) throw new HttpError(400, "Invalid sha256");
    const sha256 = body.sha256?.toLowerCase();
    const metric = await metricsService.install(str(body.url, "url"), body.grantedScopes ?? [], sha256);
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

  router.post("/api/portfolios/:id/symbols/resolve", (ctx) => portfolioService.resolvePortfolioSymbols(ctx.params.id!));

  router.put("/api/symbol-map/:isin", async (ctx) => {
    const body = await ctx.body<SetIsinSymbolRequest>();
    const isin = ctx.params.isin!.trim().toUpperCase();
    if (!isIsin(isin)) throw new HttpError(400, "Not a valid ISIN");
    const symbol = str(body.symbol, "symbol").trim();
    if (!/^[A-Za-z0-9.\-_=^]{1,32}$/.test(symbol)) throw new HttpError(400, "Invalid symbol");
    return portfolioService.setSymbolForIsin(isin, symbol, typeof body.name === "string" ? body.name : undefined);
  });

  router.put("/api/portfolios/:id/manual-prices/:symbol", async (ctx) => {
    const body = await ctx.body<SetManualPriceRequest>();
    if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price <= 0) {
      throw new HttpError(400, "price must be a positive number");
    }
    let currency: string | undefined;
    if (body.currency !== undefined) {
      currency = str(body.currency, "currency").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, "Invalid currency");
    }
    return portfolioService.setManualPrice(ctx.params.id!, ctx.params.symbol!, body.price, currency);
  });

  router.delete("/api/portfolios/:id/manual-prices/:symbol", (ctx) => portfolioService.clearManualPrice(ctx.params.id!, ctx.params.symbol!));

  router.get("/api/symbols/search", async (ctx) => ({ results: await marketData.searchSymbols(ctx.url.searchParams.get("q") || "") }));

  // Company intel: public company data, best provider first (services/intel/company.ts).
  router.get("/api/symbols/:symbol/intel", (ctx) =>
    getCompanyIntel(services, ctx.params.symbol!, {
      include: parseIntelParts(ctx.url.searchParams.get("include")),
      assetType: ctx.url.searchParams.get("assetType") || undefined,
      isPrivate: ctx.url.searchParams.get("private") === "1",
    }),
  );
  router.get("/api/symbols/:symbol/transcript", (ctx) => getTranscriptResponse(services, ctx.params.symbol!));
  router.post("/api/symbols/:symbol/transcript/summary", async (ctx) => {
    const body = await ctx.body<{ force?: boolean }>();
    return summarizeTranscriptResponse(services, ctx.params.symbol!, { force: body.force === true });
  });

  // ── reports ─────────────────────────────────────────────────────────────

  router.get("/api/portfolios/:id/reports", (ctx) => reportService.getReports(ctx.params.id!));

  router.post("/api/portfolios/:id/reports/prompt", async (ctx) => {
    const body = await ctx.body<PrepareReportPromptRequest>();
    return reportService.prepareReportPrompt(ctx.params.id!, { provider: body.provider, model: body.model, weekKey: body.weekKey });
  });

  router.post("/api/portfolios/:id/reports/stream", async (ctx) => {
    const body = await ctx.body<StartReportStreamRequest>();
    const res = await reportService.startReportStream({ ...body, apiKey: requestSecret(body.apiKey), portfolioId: ctx.params.id! });
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
      { provider: body.provider, model: body.model, apiKey: requestSecret(body.apiKey), baseUrl: body.baseUrl, weekKey: body.weekKey },
    );
    telemetry.capture("report_generated", { provider: body.provider });
    return report;
  });

  router.get("/api/portfolios/:id/reports/:reportId/prompt", (ctx): GetReportPromptResponse => reportService.getReportPrompt(ctx.params.id!, ctx.params.reportId!));

  router.delete("/api/portfolios/:id/reports/:reportId", (ctx) => ({ success: reportService.deleteReport(ctx.params.id!, ctx.params.reportId!) }));

  // ── suggestions ─────────────────────────────────────────────────────────

  router.get("/api/portfolios/:id/suggestions", (ctx) =>
    suggestionService.getSuggestions(ctx.params.id!, currencyParam(ctx.url.searchParams.get("baseCurrency"))),
  );

  router.post("/api/portfolios/:id/suggestions/generate", async (ctx) => {
    const body = await ctx.body<Partial<GenerateSuggestionsRequest>>();
    const generation = suggestionService.startGeneration(ctx.params.id!, currencyParam(body.baseCurrency));
    telemetry.capture("suggestions_generated");
    return generation;
  });

  router.post("/api/portfolios/:id/suggestions/:suggestionId/status", async (ctx) => {
    const body = await ctx.body<Partial<UpdateSuggestionStatusRequest> & { baseCurrency?: string }>();
    const status = body.status;
    if (status !== "active" && status !== "done" && status !== "dismissed") throw new HttpError(400, "status must be active, done or dismissed");
    return suggestionService.updateStatus(ctx.params.id!, ctx.params.suggestionId!, status, currencyParam(body.baseCurrency));
  });

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
        { provider: body.provider, model: body.model, apiKey: requestSecret(body.apiKey), baseUrl: body.baseUrl, maxTokens: 50 },
      );
      return { success: true, message: result.slice(0, 200) };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  router.post("/api/llm/test-step", async (ctx) => {
    const body = await ctx.body<TestLlmStepRequest>();
    try {
      return await llm.testStep(body.step, { provider: body.provider, model: body.model, apiKey: requestSecret(body.apiKey), baseUrl: body.baseUrl, previousOutput: body.previousOutput });
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  router.post("/api/llm/models", async (ctx) => {
    const body = await ctx.body<GetProviderModelsRequest>();
    try {
      return { models: await llm.getAvailableModels(body.provider, body.baseUrl, requestSecret(body.apiKey)) };
    } catch {
      return { models: [] };
    }
  });

  router.get("/api/llm/claude-cli/status", () => llm.claudeCliStatus());

  router.post("/api/providers/finnhub/test", async (ctx) => finnhub.testConnection(unmaskSecret((await ctx.body<TestFinnhubConnectionRequest>()).apiKey, loadConfig().finnhubApiKey)));
  router.post("/api/providers/fmp/test", async (ctx) => fmp.testConnection(unmaskSecret((await ctx.body<TestFmpConnectionRequest>()).apiKey, loadConfig().fmpApiKey)));
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
          appLogger.logStep("warning", "market", "sync", `Quotes refresh failed for one portfolio (${err instanceof Error ? err.name : typeof err})`);
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

  // ── market intelligence: macro, benchmarks, market hours ────────────────

  router.get("/api/market/macro", (ctx) =>
    getMacroSnapshot(services, {
      baseCurrency: currencyParam(ctx.url.searchParams.get("baseCurrency")),
      forceFresh: ctx.url.searchParams.get("refresh") === "true",
    }),
  );

  router.get("/api/market/benchmark", (ctx) =>
    getBenchmarkHistory(services, ctx.url.searchParams.get("symbol") || DEFAULT_BENCHMARK_SYMBOL, normalizeBenchmarkRange(ctx.url.searchParams.get("range"))),
  );

  router.get("/api/portfolios/:id/benchmark", async (ctx) => {
    const comparison = await getBenchmarkComparison(services, ctx.params.id!, normalizeBenchmarkRange(ctx.url.searchParams.get("range")), ctx.url.searchParams.get("symbol") || undefined);
    return { comparison };
  });

  router.get("/api/market/status", () => getHeldMarketStatus(portfolioService, new Date(), fmp));

  // ── config ──────────────────────────────────────────────────────────────

  router.get("/api/config", () => maskSecrets(loadConfig()));

  router.get("/api/settings", (): GetSettingsResponse => ({ settings: listSettings() }));

  router.patch("/api/config", async (ctx) => {
    const body = await ctx.body<Partial<DesktopConfig>>();
    const record = body as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!CONFIG_KEYS.has(key)) delete record[key];
    for (const key of PROTECTED_CONFIG_KEYS) delete record[key];
    const updated = updateConfig(unmaskUpdates(body));
    if ("telemetryEnabled" in body) telemetry.reinitialize();
    if ("closeToTray" in body) writeDesktopSettingsFile();
    if (body.checkForUpdates === true) appUpdateService.checkForUpdates().catch(() => {});
    return maskSecrets(updated);
  });

  // ── integrations and automation ─────────────────────────────────────────

  router.post("/api/integrations/gotify/test", async (ctx) => {
    const body = await ctx.body<TestGotifyRequest>();
    return sendGotify(
      { title: "Portfolio", message: "Test message from Portfolio. Daily briefs will arrive here." },
      { url: body.url, token: requestSecret(body.token), priority: body.priority },
    );
  });

  router.post("/api/integrations/ntfy/test", async (ctx) => {
    const body = await ctx.body<TestNtfyRequest>();
    return sendNtfy(
      { title: "Portfolio", message: "Test message from Portfolio. Daily briefs and weekly analyses will arrive here." },
      { url: body.url, topic: body.topic, token: requestSecret(body.token), priority: body.priority },
    );
  });

  router.get("/api/automation/daily-brief", () => dailyBrief.status());

  router.post("/api/automation/daily-brief/run", () => dailyBrief.run("manual"));

  router.get("/api/automation/weekly-analysis", () => weeklyAnalysis.status());

  router.post("/api/automation/weekly-analysis/run", () => weeklyAnalysis.run("manual"));

  router.get("/api/automation/event-alerts", () => services.eventAlerts.status());

  router.post("/api/automation/event-alerts/run", () => services.eventAlerts.run("manual"));

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
    logClientEvent(await ctx.body<Record<string, unknown>>(64 * 1024));
    return { success: true };
  });

  router.get("/api/app/sponsor", async (ctx) => {
    const rawUrl = (ctx.url.searchParams.get("url") || "").trim();
    const html = await loadSponsorPage(sponsorTheme(ctx.url.searchParams.get("theme"), rawUrl), rawUrl);
    return html ? { success: true, html } : { success: false, html: "", error: "Failed to load sponsor banner" };
  });

  // The banner as its own sandboxed document (services/sponsor.ts): the overview frames this URL.
  router.get("/api/app/sponsor/frame", async (ctx) => sponsorFrameResponse(await loadSponsorPage(sponsorTheme(ctx.url.searchParams.get("theme")))));

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

  router.post("/api/app/backup", (ctx) => {
    assertLocal(ctx, "Backing up the database");
    const backup = createDatabaseBackup();
    const filePath = saveBytesToDownloads(backup.fileName, backup.bytes);
    appLogger.logStep("info", "app", "backup", "Database backup saved to Downloads");
    return { success: true, fileName: backup.fileName, filePath, sizeBytes: backup.bytes.length };
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
