/**
 * Typed HTTP client of the service (modules/service/src/http/routes.ts).
 * Every call goes through `request()`, which throws an `ApiError` carrying the
 * server message so callers can show it instead of swallowing failures.
 */
import type {
  AppUpdateInfo,
  AssistantConversation,
  CancelReportStreamResponse,
  ChatWithPortfolioRequest,
  ChatWithPortfolioResponse,
  ClearMarketCacheResponse,
  CompleteSetupRequest,
  CreatePortfolioRequest,
  DesktopConfig,
  DownloadUpdateResponse,
  EvaluatePortfolioMetricsRequest,
  EvaluatePortfolioMetricsResponse,
  GenerateReportRequest,
  GetAppInfoResponse,
  GetAssistantSystemPromptResponse,
  GetMetricCatalogResponse,
  GetPortfolioMetricsResponse,
  GetPortfoliosResponse,
  GetProviderModelsRequest,
  GetProviderModelsResponse,
  InstallMetricResponse,
  LogClientEventRequest,
  ManageTransactionRequest,
  ManageTransactionResponse,
  OpenSupportTicketRequest,
  OpenSupportTicketResponse,
  PollReportStreamResponse,
  PrepareReportPromptRequest,
  PrepareReportPromptResponse,
  PreviewMetricInstallResponse,
  RemoteAccessInfo,
  SavePortfolioMetricsRequest,
  SearchSymbolResponse,
  StartReportStreamRequest,
  StartReportStreamResponse,
  SyncQuotesResponse,
  TestFinnhubConnectionResponse,
  TestLlmRequest,
  TestLlmStepRequest,
  TestLlmStepResponse,
  TestYahooConnectionResponse,
  UpdatePortfolioRequest,
} from "portfolio-shared/api-types";
import type { PortfolioItem, PortfolioReport, PortfolioTransaction, FinancialPortfolioData } from "portfolio-shared/portfolio";
import type { MetricScope } from "portfolio-shared/metric-abi";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let onUnauthorized: (() => void) | null = null;
/** Called on any 401 outside the login flow (the session is gone). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

interface RequestOptions {
  /** Do not treat a 401 as a lost session (login and PIN checks report it themselves). */
  ownUnauthorized?: boolean;
  timeoutMs?: number;
}

export async function request<T = unknown>(url: string, init: RequestInit = {}, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body && typeof init.body === "string" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers,
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : init.signal ?? undefined,
  });
  if (res.status === 401 && !opts.ownUnauthorized) onUnauthorized?.();
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let requestId: string | undefined;
    try {
      const data = await res.json();
      message = data.message || data.error || message;
      requestId = data.requestId;
    } catch {
      // keep the status text
    }
    throw new ApiError(res.status, message, requestId);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, "Invalid JSON response from the server");
  }
}

const json = (body: unknown) => JSON.stringify(body);
const enc = encodeURIComponent;

export interface AuthStatus {
  /** Whether the app lock is on. */
  pinEnabled: boolean;
  /** False until the Terms of Use are accepted on first run. */
  hasAcceptedTerms: boolean;
  acceptedTermsAt: string | null;
}

export const api = {
  // ---- health and auth
  health: () => request<{ status: string; version: string }>("/api/health", {}, { ownUnauthorized: true, timeoutMs: 4000 }),
  authStatus: () => request<AuthStatus>("/api/auth/status", {}, { ownUnauthorized: true }),
  login: (pin?: string) => request<AuthStatus & { success: boolean }>("/api/auth/login", { method: "POST", body: json(pin ? { pin } : {}) }, { ownUnauthorized: true }),
  me: () => request<AuthStatus>("/api/auth/me", {}, { ownUnauthorized: true }),
  acceptTerms: () => request<AuthStatus>("/api/auth/accept-terms", { method: "POST" }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  setPin: (pin: string, currentPin?: string) => request<{ pinEnabled: boolean }>("/api/auth/pin", { method: "PUT", body: json({ pin, currentPin }) }, { ownUnauthorized: true }),
  removePin: (currentPin: string) => request<{ pinEnabled: boolean }>("/api/auth/pin", { method: "DELETE", body: json({ currentPin }) }, { ownUnauthorized: true }),

  // ---- remote access (desktop window only; 403 from a remote client)
  remoteAccess: () => request<RemoteAccessInfo>("/api/host/remote-access"),
  setRemoteAccess: (enabled: boolean) => request<RemoteAccessInfo>("/api/host/remote-access", { method: "PATCH", body: json({ enabled }) }),

  // ---- portfolios
  getPortfolios: () => request<GetPortfoliosResponse>("/api/portfolios"),
  getPortfolioData: (portfolioId: string, baseCurrency?: string, refresh?: boolean) => {
    const q = new URLSearchParams();
    if (baseCurrency) q.set("baseCurrency", baseCurrency);
    if (refresh) q.set("refresh", "true");
    const qs = q.toString();
    return request<FinancialPortfolioData>(`/api/portfolios/${enc(portfolioId)}/data${qs ? `?${qs}` : ""}`);
  },
  createPortfolio: (body: CreatePortfolioRequest) => request<PortfolioItem>("/api/portfolios", { method: "POST", body: json(body) }),
  updatePortfolio: (body: UpdatePortfolioRequest) => request<PortfolioItem>(`/api/portfolios/${enc(body.portfolioId)}`, { method: "PATCH", body: json(body) }),
  deletePortfolio: (portfolioId: string) => request<{ success: boolean }>(`/api/portfolios/${enc(portfolioId)}`, { method: "DELETE" }),

  // ---- metrics
  getPortfolioMetrics: (portfolioId: string) => request<GetPortfolioMetricsResponse>(`/api/portfolios/${enc(portfolioId)}/metrics`),
  savePortfolioMetrics: (body: SavePortfolioMetricsRequest) => request<GetPortfolioMetricsResponse>(`/api/portfolios/${enc(body.portfolioId)}/metrics`, { method: "PUT", body: json(body) }),
  evaluatePortfolioMetrics: (body: EvaluatePortfolioMetricsRequest) =>
    request<EvaluatePortfolioMetricsResponse>(`/api/portfolios/${enc(body.portfolioId)}/metrics/evaluate`, { method: "POST", body: json(body) }),
  getMetricCatalog: () => request<GetMetricCatalogResponse>("/api/metrics/catalog"),
  previewMetricInstall: (url: string) => request<PreviewMetricInstallResponse>("/api/metrics/preview", { method: "POST", body: json({ url }) }),
  installMetric: (url: string, grantedScopes: MetricScope[]) => request<InstallMetricResponse>("/api/metrics/install", { method: "POST", body: json({ url, grantedScopes }) }),
  uninstallMetric: (id: string) => request<{ success: boolean }>(`/api/metrics/${enc(id)}`, { method: "DELETE" }),

  // ---- transactions
  getTransactions: (portfolioId: string) => request<{ transactions: PortfolioTransaction[] }>(`/api/portfolios/${enc(portfolioId)}/transactions`),
  manageTransactions: (body: ManageTransactionRequest) =>
    request<ManageTransactionResponse>(`/api/portfolios/${enc(body.portfolioId)}/transactions`, { method: "POST", body: json(body) }),
  searchSymbol: (query: string) => request<SearchSymbolResponse>(`/api/symbols/search?q=${enc(query)}`),

  // ---- reports
  getReports: (portfolioId: string) => request<{ reports: PortfolioReport[]; latestReport?: PortfolioReport }>(`/api/portfolios/${enc(portfolioId)}/reports`),
  prepareReportPrompt: (body: PrepareReportPromptRequest) =>
    request<PrepareReportPromptResponse>(`/api/portfolios/${enc(body.portfolioId)}/reports/prompt`, { method: "POST", body: json(body) }),
  startReportStream: (body: StartReportStreamRequest) =>
    request<StartReportStreamResponse>(`/api/portfolios/${enc(body.portfolioId)}/reports/stream`, { method: "POST", body: json(body) }),
  pollReportStream: (sessionId: string) => request<PollReportStreamResponse>(`/api/reports/stream/${enc(sessionId)}`),
  cancelReportStream: (sessionId: string) => request<CancelReportStreamResponse>(`/api/reports/stream/${enc(sessionId)}`, { method: "DELETE" }),
  generateReport: (body: GenerateReportRequest) => request<PortfolioReport>(`/api/portfolios/${enc(body.portfolioId)}/reports`, { method: "POST", body: json(body) }),
  deleteReport: (portfolioId: string, reportId: string) => request<{ success: boolean }>(`/api/portfolios/${enc(portfolioId)}/reports/${enc(reportId)}`, { method: "DELETE" }),

  // ---- assistant
  getAssistantConversations: (portfolioId: string) => request<{ conversations: AssistantConversation[] }>(`/api/portfolios/${enc(portfolioId)}/assistant/conversations`),
  deleteAssistantConversation: (portfolioId: string, conversationId: string) =>
    request<{ success: boolean }>(`/api/portfolios/${enc(portfolioId)}/assistant/conversations/${enc(conversationId)}`, { method: "DELETE" }),
  getAssistantSystemPrompt: (portfolioId: string) => request<GetAssistantSystemPromptResponse>(`/api/portfolios/${enc(portfolioId)}/assistant/system-prompt`),
  chatWithPortfolio: (body: ChatWithPortfolioRequest) =>
    request<ChatWithPortfolioResponse>(`/api/portfolios/${enc(body.portfolioId)}/assistant/chat`, { method: "POST", body: json(body) }),

  // ---- providers
  testLlm: (body: TestLlmRequest) => request<{ success: boolean; message: string }>("/api/llm/test", { method: "POST", body: json(body) }),
  testLlmStep: (body: TestLlmStepRequest) => request<TestLlmStepResponse>("/api/llm/test-step", { method: "POST", body: json(body) }),
  getProviderModels: (body: GetProviderModelsRequest) => request<GetProviderModelsResponse>("/api/llm/models", { method: "POST", body: json(body) }),
  testFinnhubConnection: (apiKey?: string) => request<TestFinnhubConnectionResponse>("/api/providers/finnhub/test", { method: "POST", body: json({ apiKey }) }),
  testYahooConnection: () => request<TestYahooConnectionResponse>("/api/providers/yahoo/test"),
  clearMarketCache: () => request<ClearMarketCacheResponse>("/api/market/cache/clear", { method: "POST" }),
  syncQuotes: () => request<SyncQuotesResponse>("/api/market/sync", { method: "POST" }),

  // ---- config and setup
  getConfig: () => request<DesktopConfig>("/api/config"),
  saveConfig: (updates: Partial<DesktopConfig>) => request<DesktopConfig>("/api/config", { method: "PATCH", body: json(updates) }),
  completeSetup: (body: CompleteSetupRequest) => request<{ success: boolean }>("/api/setup/complete", { method: "POST", body: json(body) }),

  // ---- app
  getAppInfo: () => request<GetAppInfoResponse>("/api/app/info"),
  getUpdateInfo: () => request<AppUpdateInfo>("/api/app/update"),
  checkForUpdates: (force = false) => request<AppUpdateInfo>("/api/app/update/check", { method: "POST", body: json({ force }) }),
  downloadUpdate: (version: string) => request<DownloadUpdateResponse>("/api/app/update/download", { method: "POST", body: json({ version }) }),
  logClientEvent: (entry: LogClientEventRequest) => request<{ success: boolean }>("/api/app/logs", { method: "POST", body: json(entry) }, { timeoutMs: 2000 }),
  getSponsorBanner: (url?: string, theme?: string) => {
    const params = [url ? `url=${enc(url)}` : "", theme ? `theme=${enc(theme)}` : ""].filter(Boolean).join("&");
    return request<{ success: boolean; html: string; error?: string }>(`/api/app/sponsor${params ? `?${params}` : ""}`);
  },
  openSupportTicket: (body: OpenSupportTicketRequest) => request<OpenSupportTicketResponse>("/api/app/support", { method: "POST", body: json(body) }),
  /** URL of the anonymised diagnostics zip (browser download for remote clients). */
  diagnosticsUrl: () => "/api/app/support/diagnostics",
  saveFile: (fileName: string, content?: string, base64Data?: string) =>
    request<{ success: boolean; filePath?: string; error?: string }>("/api/files/save", { method: "POST", body: json({ fileName, content, base64Data }) }),
  revealFile: (filePath: string) => request<{ success: boolean; error?: string }>("/api/files/reveal", { method: "POST", body: json({ filePath }) }),
  quitApp: () => request<{ success: boolean }>("/api/app/quit", { method: "POST" }),
};

export type Api = typeof api;
