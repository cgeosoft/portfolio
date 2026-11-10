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
import { hasLaunchProof } from "../services/launch-gate";
import { authService, clearLegacySessionCookie, clearSessionCookie, readSession, sessionCookie, type ClientScope } from "../services/auth";
import { disableRemoteAccess, isRemoteListening, remoteAccessInfo, setRemoteAccess } from "../services/remote-access";
import { mcpAccessInfo, rotateMcpToken, setMcpAccess } from "../services/mcp-access";
import { blockedRemoteTargets } from "../services/outbound-target";
import { writeDesktopSettingsFile } from "../services/desktop-settings";
import { revealInFileManager, saveBytesToDownloads, saveToDownloads } from "../services/files";
import { createDatabaseBackup } from "../services/backup";
import { supportTicketService } from "../services/support-ticket";
import { appUpdateService } from "../services/app-update";
import { analyticsProvider, telemetry } from "../services/telemetry";
import { errorReporting } from "../services/error-reporting";
import { applyConsent, consentStatus, resetAnalyticsId, takeConsentChanges } from "../services/privacy-consent";
import { sendGotify } from "../services/gotify";
import { sendNtfy } from "../services/ntfy";
import { OPENROUTER_CALLBACK_PATH, callbackPage, completeOpenRouterConnect, openRouterConnectStatus, startOpenRouterConnect } from "../services/openrouter-connect";
import * as portfolioMetrics from "../services/portfolio-metrics";
import { suggestMetricLayout } from "../services/metric-advisor";
import { scanForAmounts, toPromptSafe } from "../services/llm-privacy";
import { readBrief } from "../services/portfolio-brief";
import { getMacroSnapshot } from "../services/intel/macro";
import { getBenchmarkComparison, getBenchmarkHistory, normalizeBenchmarkRange } from "../services/intel/benchmark";
import { getHeldMarketStatus } from "../services/intel/market-hours";
import { isIsin } from "../services/providers/identifiers";
import { DEFAULT_BENCHMARK_SYMBOL } from "portfolio-shared/config-types";
import { getCompanyIntel, getTranscriptResponse, parseIntelParts, summarizeTranscriptResponse } from "../services/intel/company";
import { WEBPAGE_URL, SUPPORT_EMAIL } from "portfolio-shared/brand";
import type { AppServices } from "../services/container";
import type { PrivacyConsentResponse, PrivacyPromptAnswerRequest, ReportClientErrorRequest } from "portfolio-shared/api-types";
import type {
  ChatWithPortfolioRequest,
  CompleteSetupRequest,
  CreatePortfolioRequest,
  GetSettingsResponse,
  EvaluatePortfolioMetricsRequest,
  GenerateSuggestionsRequest,
  GetProviderModelsRequest,
  InstallMetricRequest,
  ManageTransactionRequest,
  SetIsinSymbolRequest,
  SetManualPriceRequest,
  OpenSupportTicketRequest,
  PreviewMetricInstallRequest,
  SavePortfolioMetricsRequest,
  SuggestPortfolioMetricsRequest,
  TestFinnhubConnectionRequest,
  TestFmpConnectionRequest,
  TestGotifyRequest,
  TestNtfyRequest,
  TestLlmRequest,
  TestLlmStepRequest,
  UpdatePortfolioRequest,
  UpdateMcpAccessRequest,
  UpdateRemoteAccessRequest,
  UpdateSuggestionStatusRequest,
  UpdatePortfolioBriefRequest,
  BriefWizardFollowupRequest,
  BriefWizardDraftRequest,
  ScanAmountsRequest,
  ScanAmountsResponse,
  AiCapabilityResponse,
  StartAnalysisRunRequest,
} from "portfolio-shared/api-types";
import { PROTECTED_CONFIG_KEYS, type DesktopConfig } from "portfolio-shared/config-types";

/** The longest one assistant reply may take, the limit of a CLI provider. */
const CHAT_TIMEOUT_MS = 300_000;

/** Routes that need no session. */
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/status", "/api/auth/login", "/intro"]);
/**
 * The OpenRouter sign-in returns through the system browser, which has no
 * session cookie. The route serves only loopback clients and only a one-time
 * state the service issued (openrouter-connect.ts).
 */
const isPublicPath = (path: string) => PUBLIC_PATHS.has(path) || path.startsWith(OPENROUTER_CALLBACK_PATH);
/** Routes a signed-in client may call before accepting the Terms of Use. */
const PRE_TERMS_PATHS = new Set(["/api/auth/me", "/api/auth/accept-terms", "/api/auth/logout"]);

function authStatus() {
  return { pinEnabled: authService.isPinEnabled(), hasAcceptedTerms: authService.hasAcceptedTerms(), acceptedTermsAt: authService.acceptedTermsAt() };
}

/** Applies a changed privacy choice to the running clients, with no restart. */
function reloadPrivacyClients(): void {
  telemetry.reinitialize();
  errorReporting.reinitialize();
}

function assertLocal(ctx: RequestContext, what: string): void {
  if (!ctx.isLocal) throw new HttpError(403, `${what} is only available from the desktop window`);
}

/** A client on another device may not point the service at a new address on this computer or the local network (outbound-target.ts). */
async function assertRemoteTargets(ctx: RequestContext, ...urls: unknown[]): Promise<void> {
  if (ctx.isLocal) return;
  if ((await blockedRemoteTargets(urls)).length) throw new HttpError(403, "A server on this computer or the local network can be set only from the desktop window");
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
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    baseCurrency: row.baseCurrency,
    color: row.color,
    brief: readBrief(row),
    briefUpdatedAt: row.briefUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The PIN counter and session lifetime a request gets: the desktop window's or other devices'. */
function scopeOf(ctx: { isLocal: boolean }): ClientScope {
  return ctx.isLocal ? "local" : "remote";
}

/** True behind a TLS proxy, where the session cookie gets `Secure`. */
function isHttps(req: Request): boolean {
  return req.headers.get("x-forwarded-proto") === "https";
}

export function registerRoutes(router: Router, services: AppServices, onQuit: () => void): void {
  const { portfolioService, reportService, chatService, suggestionService, metricsService, marketData, llm, finnhub, fmp, yahoo, dailyBrief, weeklyAnalysis, briefService, analysis } = services;

  // ── middleware: remote-access gate and session ──────────────────────────

  router.use((ctx) => {
    if (!ctx.isLocal && !isRemoteListening()) {
      throw new HttpError(403, "Remote connections are disabled on this Portfolio");
    }
  });

  router.use((ctx) => {
    if (isPublicPath(ctx.url.pathname)) return;
    // Cookies ignore the port, so a page of another program on this host is same-site and its
    // requests carry the session. A GET it starts (an image, a link) may not reach a route.
    const fetchSite = ctx.req.headers.get("sec-fetch-site");
    if (!isDev() && (fetchSite === "cross-site" || fetchSite === "same-site")) throw new HttpError(403, "Cross-origin requests are not allowed");
    const session = readSession(ctx.req);
    const sessionId = session?.id ?? null;
    if (!authService.validateSession(sessionId, scopeOf(ctx))) throw new HttpError(401, sessionId ? "Invalid or expired session" : "Session cookie is missing");
    ctx.sessionId = sessionId;
    // A valid session under the old shared name is ours: move it to the new
    // name. Another instance's old cookie fails the check above and stays.
    if (session?.legacy) {
      ctx.responseHeaders.append("Set-Cookie", sessionCookie(session.id, isHttps(ctx.req), scopeOf(ctx)));
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
    // Without a PIN only the desktop window signs in (services/launch-gate.ts).
    if (!authService.isPinEnabled() && !hasLaunchProof(ctx.req)) throw new HttpError(401, "Open Portfolio from its own window, or set a PIN");
    const id = authService.login(typeof body.pin === "string" ? body.pin : undefined, scopeOf(ctx));
    ctx.responseHeaders.append("Set-Cookie", sessionCookie(id, isHttps(ctx.req), scopeOf(ctx)));
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
    // A PIN holder on another device could change it and end the desktop session.
    assertLocal(ctx, "Changing the PIN");
    const body = await ctx.body<{ pin?: unknown; currentPin?: unknown }>();
    authService.setPin(String(body.pin ?? ""), typeof body.currentPin === "string" ? body.currentPin : undefined, scopeOf(ctx));
    authService.revokeOtherSessions(ctx.sessionId);
    return { pinEnabled: true };
  });

  router.get("/api/auth/sessions", () => ({ active: authService.activeSessionCount() }));

  router.post("/api/auth/sessions/revoke-others", (ctx) => ({ revoked: authService.revokeOtherSessions(ctx.sessionId) }));

  router.delete("/api/auth/pin", async (ctx) => {
    assertLocal(ctx, "Removing the PIN");
    const body = await ctx.body<{ currentPin?: string }>();
    authService.removePin(String(body.currentPin ?? ""), scopeOf(ctx));
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

  // ── host (MCP server for other LLM clients) ─────────────────────────────

  router.get("/api/host/mcp", (ctx) => {
    assertLocal(ctx, "The MCP server setting");
    return mcpAccessInfo();
  });

  router.patch("/api/host/mcp", async (ctx) => {
    assertLocal(ctx, "The MCP server setting");
    const body = await ctx.body<UpdateMcpAccessRequest>();
    return setMcpAccess({
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      port: body.port === undefined ? undefined : Number(body.port),
    });
  });

  router.post("/api/host/mcp/token", (ctx) => {
    assertLocal(ctx, "The MCP server setting");
    return rotateMcpToken();
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
    const row = portfolioService.updatePortfolio(ctx.params.id!, { name: body.name, description: body.description, baseCurrency: currencyParam(body.baseCurrency), color: body.color });
    if (!row) throw new HttpError(404, "Portfolio not found");
    return toItem(row);
  });

  router.delete("/api/portfolios/:id", (ctx) => ({ success: portfolioService.deletePortfolio(ctx.params.id!) }));

  // ── portfolio brief and wizard ──────────────────────────────────────────

  router.get("/api/portfolios/:id/brief", (ctx) => briefService.getBrief(ctx.params.id!));

  router.put("/api/portfolios/:id/brief", async (ctx) => {
    const body = await ctx.body<UpdatePortfolioBriefRequest>();
    const res = briefService.saveBrief(ctx.params.id!, body.brief ?? {});
    telemetry.capture("portfolio_brief_saved");
    return res;
  });

  router.post("/api/portfolios/:id/brief/wizard/followups", async (ctx) => {
    const body = await ctx.body<BriefWizardFollowupRequest>();
    return briefService.followups(ctx.params.id!, body.answers ?? {});
  });

  router.post("/api/portfolios/:id/brief/wizard/draft", async (ctx) => {
    const body = await ctx.body<BriefWizardDraftRequest>();
    return briefService.draft(ctx.params.id!, body.answers ?? {}, body.followupAnswers ?? {});
  });

  /** Amounts in the user's own text, so a form can ask for percentages before it saves. */
  router.post("/api/privacy/scan-amounts", async (ctx): Promise<ScanAmountsResponse> => {
    const body = await ctx.body<ScanAmountsRequest>();
    const texts = Array.isArray(body.texts) ? body.texts.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
    const matches = [...new Set(texts.flatMap((text) => scanForAmounts(text.slice(0, 4_000)).matches))];
    return { hasAmounts: matches.length > 0, matches };
  });

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
    await assertRemoteTargets(ctx, body.url);
    return metricsService.previewInstall(str(body.url, "url"));
  });

  router.post("/api/metrics/install", async (ctx) => {
    const body = await ctx.body<InstallMetricRequest>();
    await assertRemoteTargets(ctx, body.url);
    // The hash the user saw in the preview. Without it the service would install whatever the URL serves now.
    if (typeof body.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(body.sha256)) throw new HttpError(400, "Invalid sha256");
    const sha256 = body.sha256.toLowerCase();
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

  // ── guided analysis ─────────────────────────────────────────────────────

  /** Whether the AI features can run: an AI setup that answered, and tool calling for Guided Analysis. */
  router.get("/api/ai/capability", (ctx): Promise<AiCapabilityResponse> => analysis.capability(ctx.url.searchParams.get("probe") === "1"));

  router.get("/api/portfolios/:id/analysis/runs", (ctx) => analysis.list(ctx.params.id!));

  router.post("/api/portfolios/:id/analysis/runs", async (ctx) => {
    const body = await ctx.body<Partial<StartAnalysisRunRequest>>();
    return { run: await analysis.start(ctx.params.id!, { baseCurrency: currencyParam(body.baseCurrency), trigger: "manual" }) };
  });

  router.delete("/api/portfolios/:id/analysis/runs/:runId", (ctx) => ({ success: analysis.delete(ctx.params.id!, ctx.params.runId!) }));

  router.get("/api/analysis/runs/:runId", (ctx) => analysis.get(ctx.params.runId!));

  router.post("/api/analysis/runs/:runId/cancel", (ctx) => ({ success: analysis.cancel(ctx.params.runId!) }));

  router.get("/api/analysis/runs/:runId/compare", (ctx) => analysis.compare(ctx.params.runId!));

  // ── assistant ───────────────────────────────────────────────────────────

  router.get("/api/portfolios/:id/assistant/conversations", (ctx) => ({ conversations: chatService.getConversations(ctx.params.id!) }));

  router.get("/api/portfolios/:id/assistant/conversations/:conversationId", (ctx) => {
    const conversation = chatService.getConversation(ctx.params.id!, ctx.params.conversationId!);
    if (!conversation) throw new HttpError(404, "Conversation not found");
    return { conversation };
  });

  router.delete("/api/portfolios/:id/assistant/conversations/:conversationId", (ctx) => ({
    success: chatService.deleteConversation(ctx.params.id!, ctx.params.conversationId!),
  }));

  router.get("/api/portfolios/:id/assistant/system-prompt", async (ctx) => ({
    systemPrompt: await chatService.getSystemPrompt(ctx.params.id!),
    portfolioName: portfolioRepo.findById(ctx.params.id!)?.name ?? "",
  }));

  router.post("/api/portfolios/:id/assistant/chat", async (ctx) => {
    const body = await ctx.body<ChatWithPortfolioRequest>();
    const res = await chatService.chat(ctx.params.id!, Array.isArray(body.messages) ? body.messages : [], {
      // A client that went away stops the model call, and with it a CLI process.
      signal: AbortSignal.any([ctx.req.signal, AbortSignal.timeout(CHAT_TIMEOUT_MS)]),
      conversationId: body.conversationId,
      title: body.title,
      provider: body.provider,
      model: body.model,
    });
    telemetry.capture("assistant_chat_sent", { provider: analyticsProvider(res.provider) });
    return res;
  });

  // ── LLM and data providers ──────────────────────────────────────────────

  router.post("/api/llm/test", async (ctx) => {
    const body = await ctx.body<TestLlmRequest>();
    await assertRemoteTargets(ctx, body.baseUrl);
    try {
      const result = await llm.chat(
        [
          { role: "system", content: toPromptSafe("You are a helpful assistant.") },
          { role: "user", content: toPromptSafe("Say 'LLM connection verified' in exactly those words.") },
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
    await assertRemoteTargets(ctx, body.baseUrl);
    try {
      return await llm.testStep(body.step, { provider: body.provider, model: body.model, apiKey: requestSecret(body.apiKey), baseUrl: body.baseUrl, previousOutput: body.previousOutput });
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  router.post("/api/llm/models", async (ctx) => {
    const body = await ctx.body<GetProviderModelsRequest>();
    await assertRemoteTargets(ctx, body.baseUrl);
    try {
      return { models: await llm.getAvailableModels(body.provider, body.baseUrl, requestSecret(body.apiKey)) };
    } catch {
      return { models: [] };
    }
  });

  router.get("/api/llm/claude-cli/status", () => llm.cliStatus("claude-cli"));
  router.get("/api/llm/cli/:provider/status", (ctx) => llm.cliStatus(ctx.params.provider!));

  router.post("/api/llm/openrouter/connect", (ctx) => {
    assertLocal(ctx, "Connecting OpenRouter");
    return startOpenRouterConnect(ctx.url.port);
  });
  router.get("/api/llm/openrouter/connect/:state", (ctx) => openRouterConnectStatus(ctx.params.state!));
  router.get(`${OPENROUTER_CALLBACK_PATH}:state`, async (ctx) => {
    if (!ctx.isLocal) throw new HttpError(403, "The OpenRouter sign-in completes only on this computer");
    const { ok, message } = await completeOpenRouterConnect(ctx.params.state!, ctx.url.searchParams.get("code"));
    return new Response(callbackPage(ok, message), {
      status: ok ? 200 : 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  });

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
      const portfolios = portfolioRepo.findAll();
      // One quote request per symbol, however many portfolios hold it.
      const quotes = await portfolioService.fetchLiveQuotes(portfolios.map((p) => p.id));
      for (const portfolio of portfolios) {
        try {
          const data = await portfolioService.getPortfolioData(portfolio.id, portfolio.baseCurrency, true, quotes);
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

  router.get("/api/settings", (ctx): GetSettingsResponse => ({ settings: listSettings(ctx.isLocal) }));

  router.patch("/api/config", async (ctx) => {
    const body = await ctx.body<Partial<DesktopConfig>>();
    const record = body as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!CONFIG_KEYS.has(key)) delete record[key];
    for (const key of PROTECTED_CONFIG_KEYS) delete record[key];
    await assertRemoteTargets(ctx, body.llmBaseUrl, ...Object.values(body.llmBaseUrls ?? {}), body.gotifyUrl, body.ntfyUrl);
    const consent = takeConsentChanges(body);
    if (consent) assertLocal(ctx, "Changing a privacy choice");
    let updated = updateConfig(unmaskUpdates(body, ctx.isLocal));
    if (consent) {
      applyConsent(consent, "settings");
      updated = loadConfig();
      reloadPrivacyClients();
    }
    if ("closeToTray" in body) writeDesktopSettingsFile();
    if (body.checkForUpdates === true) appUpdateService.checkForUpdates().catch(() => {});
    return maskSecrets(updated);
  });

  // ── integrations and automation ─────────────────────────────────────────

  router.post("/api/integrations/gotify/test", async (ctx) => {
    const body = await ctx.body<TestGotifyRequest>();
    await assertRemoteTargets(ctx, body.url);
    return sendGotify(
      { title: "Portfolio", message: "Test message from Portfolio. Daily briefs will arrive here." },
      { url: body.url, token: requestSecret(body.token), priority: body.priority },
    );
  });

  router.post("/api/integrations/ntfy/test", async (ctx) => {
    const body = await ctx.body<TestNtfyRequest>();
    await assertRemoteTargets(ctx, body.url);
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
    const alreadyComplete = loadConfig().setupCompleted;
    if (body.populateDemo) {
      await portfolioService.createDemoPortfolio(loadConfig().baseCurrency);
      appLogger.logStep("success", "setup", "demo", "Demo portfolio created");
    }
    updateConfig({ setupCompleted: true });
    // Only the desktop window gives consent: a first setup from another device leaves both options off, and a later call from there changes nothing.
    if (ctx.isLocal || !alreadyComplete) {
      applyConsent({ analytics: ctx.isLocal && body.enableAnalytics === true, errorReporting: ctx.isLocal && body.enableErrorReporting === true }, "setup");
      reloadPrivacyClients();
    }
    telemetry.capture("setup_completed", { demo: body.populateDemo === true });
    return { success: true };
  });

  // ── privacy ─────────────────────────────────────────────────────────────

  router.get("/api/privacy/consent", (ctx): PrivacyConsentResponse => consentStatus(ctx.isLocal));

  router.put("/api/privacy/prompt-answer", async (ctx) => {
    assertLocal(ctx, "Changing a privacy choice");
    const body = await ctx.body<PrivacyPromptAnswerRequest>();
    applyConsent({ analytics: body.analytics === true, errorReporting: body.errorReporting === true }, "update-prompt");
    reloadPrivacyClients();
    return consentStatus(true);
  });

  router.post("/api/privacy/reset-analytics-id", (ctx) => {
    assertLocal(ctx, "Resetting the analytics ID");
    const analyticsId = resetAnalyticsId();
    telemetry.reinitialize();
    return { analyticsId };
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
      // Absolute paths name the OS user; only the desktop window shows them.
      paths: ctx.isLocal ? { data: getDatabasePath(), logs: getLogDir() } : undefined,
    };
  });

  router.get("/api/app/update", () => appUpdateService.getUpdateInfo());
  router.post("/api/app/update/check", async (ctx) => appUpdateService.checkForUpdates(Boolean((await ctx.body<{ force?: boolean }>()).force)));
  router.post("/api/app/update/download", async (ctx) => {
    const body = await ctx.body<{ version?: string; dialogTitle?: string }>();
    return appUpdateService.downloadUpdate(str(body.version, "version"), ctx.isLocal, (body.dialogTitle || "").trim() || "Download folder");
  });
  router.get("/api/app/update/download", () => appUpdateService.getDownloadState());

  router.post("/api/app/error-report", async (ctx) => {
    const body = await ctx.body<ReportClientErrorRequest>(64 * 1024);
    if (body.source !== "boundary" && body.source !== "window") throw new HttpError(400, "source is not valid");
    appLogger.logStep("error", "gui", body.source, `Uncaught error: ${String(body.stack ?? body.name ?? "unknown").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, 8000)}`);
    errorReporting.report({ name: body.name, stack: body.stack }, body.source === "boundary" ? "gui:boundary" : "gui:window");
    return { success: true };
  });

  router.post("/api/app/logs", async (ctx) => {
    logClientEvent(await ctx.body<Record<string, unknown>>(64 * 1024));
    return { success: true };
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

  router.post("/api/app/backup", async (ctx) => {
    assertLocal(ctx, "Backing up the database");
    const backup = await createDatabaseBackup();
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
