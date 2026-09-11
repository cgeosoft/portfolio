/**
 * Type-safe RPC schema for Bun <-> Webview communication.
 * Follows Electrobun's RPCSchema pattern from Aurora.
 */

import type { RPCSchema } from "electrobun/bun";
import type {
  PortfolioItem,
  PortfolioHolding,
  PortfolioSummary,
  PortfolioHistoricalPoint,
  PortfolioTransaction,
  PortfolioReport,
  ReportMetrics,
  FinancialPortfolioData,
} from "../types/portfolio.js";
import type { DesktopConfig, DataProviderId, DataProviderCategoryRouting } from "../bun/config.js";
import type { PortfolioMetricPreference } from "./metrics.js";
import type { MetricManifest } from "./metric-manifest.js";
import type { MetricScope } from "./metric-abi.js";
import type { MetricOutput } from "./metric-output.js";
export type { DesktopConfig, DataProviderId, DataProviderCategoryRouting, ReportMetrics };

// ── Request/Response Payload Types ───────────────────────────────────────────

export interface GetPortfoliosResponse {
  portfolios: PortfolioItem[];
}

export interface GetPortfolioDataRequest {
  portfolioId: string;
  baseCurrency?: string;
  refresh?: boolean;
}

export interface CreatePortfolioRequest {
  name: string;
  description?: string;
  baseCurrency?: string;
}

export interface UpdatePortfolioRequest {
  portfolioId: string;
  name?: string;
  description?: string;
  baseCurrency?: string;
}

export interface GetPortfolioMetricsRequest {
  portfolioId: string;
}

export interface GetPortfolioMetricsResponse {
  portfolioId: string;
  metrics: PortfolioMetricPreference[];
}

export interface SavePortfolioMetricsRequest {
  portfolioId: string;
  /** Full preference list. Omit to restore the defaults. */
  metrics?: PortfolioMetricPreference[];
  reset?: boolean;
}

/** A metric module the application can run, as shown in the Metrics tab. */
export interface MetricListing {
  id: string;
  manifest: MetricManifest;
  source: "builtin" | "url";
  sourceUrl?: string;
  sha256: string;
  /** Built-in modules are reviewed in the repository; URL installs never are. */
  verified: boolean;
  installedAt?: string;
  scopesGranted: MetricScope[];
  status: "ready" | "quarantined";
  statusReason?: string;
}

export interface MetricRepositoryListing {
  id: string;
  bundled: boolean;
  manifest: MetricManifest;
}

export interface GetMetricCatalogResponse {
  installed: MetricListing[];
  repository: MetricRepositoryListing[];
}

export type MetricEvaluation =
  | { id: string; status: "ok"; output: MetricOutput; elapsedMs: number; cached: boolean }
  | { id: string; status: "error" | "quarantined" | "missing"; error: string };

export interface EvaluatePortfolioMetricsRequest {
  portfolioId: string;
  baseCurrency?: string;
  /** Subset of metric ids to evaluate. Defaults to every metric added to the portfolio. */
  ids?: string[];
  /** Quarantined metric ids to give another chance. */
  retry?: string[];
}

export interface EvaluatePortfolioMetricsResponse {
  portfolioId: string;
  results: MetricEvaluation[];
}

export interface PreviewMetricInstallRequest {
  url: string;
}

export interface PreviewMetricInstallResponse {
  url: string;
  manifest: MetricManifest;
  sha256: string;
  size: number;
  /** Set when the id is already taken. */
  conflict?: "builtin" | "installed";
  installedVersion?: string;
}

export interface InstallMetricRequest {
  url: string;
  grantedScopes: MetricScope[];
}

export interface InstallMetricResponse {
  metric: MetricListing;
}

export interface UninstallMetricRequest {
  id: string;
}

export interface ManageTransactionRequest {
  portfolioId: string;
  action: "add" | "edit" | "delete" | "import";
  transaction?: Partial<PortfolioTransaction>;
  transactionId?: string;
  transactions?: Partial<PortfolioTransaction>[];
  dryRun?: boolean;
}

export interface ManageTransactionResponse {
  success: boolean;
  action: string;
  totalTransactions: number;
  newTransactionsCount?: number;
  modifiedTransactionsCount?: number;
  unchangedTransactionsCount?: number;
  addedPreview?: PortfolioTransaction[];
  modifiedPreview?: { tx: PortfolioTransaction; diffs: { field: string; oldVal: unknown; newVal: unknown }[] }[];
  unchangedPreview?: PortfolioTransaction[];
  transaction?: PortfolioTransaction;
  error?: string;
}

export interface SearchSymbolRequest {
  query: string;
}

export interface SearchSymbolResponse {
  results: { symbol: string; name: string; exchange: string; quoteType: string; typeDisp?: string }[];
}

export interface GenerateReportRequest {
  portfolioId: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  weekKey?: string;
}

export interface PrepareReportPromptRequest {
  portfolioId: string;
  provider?: string;
  model?: string;
  weekKey?: string;
}

export interface PrepareReportPromptResponse {
  portfolioId: string;
  portfolioName: string;
  baseCurrency: string;
  period: string;
  weekKey: string;
  weekStartDate: string;
  weekEndDate: string;
  systemPrompt: string;
  userPrompt: string;
  fullPrompt: string;
  provider: string;
  model: string;
  holdingsCount: number;
  metrics: ReportMetrics;
  /** Whether a Finnhub API key is configured and was queried for this prompt */
  finnhubConfigured?: boolean;
  /** Total Finnhub market and company news headlines gathered for this prompt */
  finnhubNewsCount?: number;
}

export interface TestFinnhubConnectionRequest {
  apiKey?: string;
}

export interface TestFinnhubConnectionResponse {
  success: boolean;
  error?: string;
  latencyMs?: number;
}

export interface TestYahooConnectionResponse {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ClearMarketCacheResponse {
  success: boolean;
  clearedEntries?: number;
}

export interface StartReportStreamRequest {
  portfolioId: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  weekKey?: string;
}

export interface StartReportStreamResponse {
  sessionId: string;
}

export interface PollReportStreamRequest {
  sessionId: string;
}

export interface PollReportStreamResponse {
  sessionId: string;
  status: "running" | "success" | "fail" | "cancelled";
  lastWords: string;
  chunkCount: number;
  report?: PortfolioReport;
  error?: string;
}

export interface CancelReportStreamRequest {
  sessionId: string;
}

export interface CancelReportStreamResponse {
  success: boolean;
}

export interface GetReportsRequest {
  portfolioId: string;
}

export interface DeleteReportRequest {
  portfolioId: string;
  reportId: string;
}

export interface PortfolioChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AssistantConversation {
  id: string;
  portfolioId: string;
  title: string;
  messages: PortfolioChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface GetAssistantConversationsRequest {
  portfolioId: string;
}

export interface GetAssistantConversationsResponse {
  conversations: AssistantConversation[];
}

export interface DeleteAssistantConversationRequest {
  portfolioId: string;
  conversationId: string;
}

export interface ChatWithPortfolioRequest {
  portfolioId: string;
  conversationId?: string;
  title?: string;
  messages: PortfolioChatMessage[];
  provider?: string;
  model?: string;
}

export interface ChatWithPortfolioResponse {
  message: PortfolioChatMessage;
  conversationId: string;
  title: string;
  provider: string;
  model: string;
}

export interface GetAssistantSystemPromptRequest {
  portfolioId: string;
}

export interface GetAssistantSystemPromptResponse {
  systemPrompt: string;
  portfolioName: string;
}

export interface CompleteSetupRequest {
  populateDemo: boolean;
  enableTelemetry: boolean;
}

export interface PickFileRequest {
  title?: string;
  filters?: string[];
  startingFolder?: string;
}

export interface PickFileResponse {
  path: string | null;
  content?: string;
}

export interface SetLastImportDirectoryRequest {
  directory: string;
}

export interface SetLastImportDirectoryResponse {
  success: boolean;
}

export interface TestLlmRequest {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export type LlmTestStepId = "config" | "connection" | "inference" | "integrity";

export interface TestLlmStepRequest {
  step: LlmTestStepId;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  previousOutput?: string;
}

export interface TestLlmStepResponse {
  success: boolean;
  message: string;
  latencyMs?: number;
  output?: string;
}

export interface GetProviderModelsRequest {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface GetProviderModelsResponse {
  models: string[];
}

export interface GetAppInfoResponse {
  version: string;
  majorMinor: string;
  webpageUrl: string;
  devEmail: string;
  isDev: boolean;
  channel?: string;
  lastQuotesSync?: string;
}

export interface AppUpdateInfo {
  enabled: boolean;
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseName: string;
  releaseUrl: string;
  publishedAt?: string;
  releaseNotes?: string;
  lastChecked?: string;
  error?: string;
}

export interface CheckForUpdatesRequest {
  force?: boolean;
}

export interface DownloadUpdateRequest {
  /** Version tag to download (e.g. "v0.3.0") */
  version: string;
}

export interface DownloadUpdateResponse {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface OpenExternalUrlRequest {
  url: string;
}

export interface SyncQuotesResponse {
  success: boolean;
  lastSync: string;
  error?: string;
}

export interface GetSponsorBannerRequest {
  url?: string;
}

export interface GetSponsorBannerResponse {
  success: boolean;
  html: string;
  error?: string;
}

export interface OpenSupportTicketRequest {
  subject?: string;
  message?: string;
  includeLogs?: boolean;
}

export interface OpenSupportTicketResponse {
  success: boolean;
  recipient: string;
  zipPath?: string;
  logCount?: number;
  message?: string;
  error?: string;
}

export interface RevealFileRequest {
  filePath: string;
}

export interface RevealFileResponse {
  success: boolean;
  error?: string;
}

export interface LogClientEventRequest {
  level: "info" | "success" | "warning" | "error" | "debug";
  source: string;
  step?: string;
  message: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

export interface PickDirectoryRequest {
  startingFolder?: string;
  title?: string;
}

export interface PickDirectoryResponse {
  path: string | null;
}

export interface SaveFileRequest {
  filePath: string;
  content?: string;
  base64Data?: string;
}

export interface SaveFileResponse {
  success: boolean;
  filePath?: string;
  error?: string;
}

// -- RPC Schema ---------------------------------------------------------------

export type PortfolioRPC = {
  bun: RPCSchema<{
    requests: {
      // Client telemetry & diagnostic logging
      logClientEvent: { params: LogClientEventRequest; response: { success: boolean } };

      // Portfolio CRUD
      getPortfolios: { params: Record<string, never>; response: GetPortfoliosResponse };
      getPortfolioData: { params: GetPortfolioDataRequest; response: FinancialPortfolioData };
      createPortfolio: { params: CreatePortfolioRequest; response: PortfolioItem };
      updatePortfolio: { params: UpdatePortfolioRequest; response: PortfolioItem };
      deletePortfolio: { params: { portfolioId: string }; response: { success: boolean } };

      // Metrics tab: per-portfolio selection, module catalog, sandboxed evaluation, installs
      getPortfolioMetrics: { params: GetPortfolioMetricsRequest; response: GetPortfolioMetricsResponse };
      savePortfolioMetrics: { params: SavePortfolioMetricsRequest; response: GetPortfolioMetricsResponse };
      getMetricCatalog: { params: Record<string, never>; response: GetMetricCatalogResponse };
      evaluatePortfolioMetrics: { params: EvaluatePortfolioMetricsRequest; response: EvaluatePortfolioMetricsResponse };
      previewMetricInstall: { params: PreviewMetricInstallRequest; response: PreviewMetricInstallResponse };
      installMetric: { params: InstallMetricRequest; response: InstallMetricResponse };
      uninstallMetric: { params: UninstallMetricRequest; response: { success: boolean } };

      // Transaction management
      manageTransactions: { params: ManageTransactionRequest; response: ManageTransactionResponse };
      getTransactions: { params: { portfolioId: string }; response: { transactions: PortfolioTransaction[] } };

      // Symbol search
      searchSymbol: { params: SearchSymbolRequest; response: SearchSymbolResponse };

      // Reports
      getReports: { params: GetReportsRequest; response: { reports: PortfolioReport[]; latestReport?: PortfolioReport } };
      generateReport: { params: GenerateReportRequest; response: PortfolioReport };
      prepareReportPrompt: { params: PrepareReportPromptRequest; response: PrepareReportPromptResponse };
      startReportStream: { params: StartReportStreamRequest; response: StartReportStreamResponse };
      pollReportStream: { params: PollReportStreamRequest; response: PollReportStreamResponse };
      cancelReportStream: { params: CancelReportStreamRequest; response: CancelReportStreamResponse };
      deleteReport: { params: DeleteReportRequest; response: { success: boolean } };

      // LLM & Assistant
      chatWithPortfolio: { params: ChatWithPortfolioRequest; response: ChatWithPortfolioResponse };
      getAssistantSystemPrompt: { params: GetAssistantSystemPromptRequest; response: GetAssistantSystemPromptResponse };
      getAssistantConversations: { params: GetAssistantConversationsRequest; response: GetAssistantConversationsResponse };
      deleteAssistantConversation: { params: DeleteAssistantConversationRequest; response: { success: boolean } };
      testLlm: { params: TestLlmRequest; response: { success: boolean; message: string } };
      testLlmStep: { params: TestLlmStepRequest; response: TestLlmStepResponse };
      getProviderModels: { params: GetProviderModelsRequest; response: GetProviderModelsResponse };
      testFinnhubConnection: { params: TestFinnhubConnectionRequest; response: TestFinnhubConnectionResponse };
      testYahooConnection: { params: Record<string, never>; response: TestYahooConnectionResponse };
      clearMarketCache: { params: Record<string, never>; response: ClearMarketCacheResponse };

      // Config
      getConfig: { params: Record<string, never>; response: DesktopConfig };
      saveConfig: { params: Partial<DesktopConfig>; response: DesktopConfig };

      // App info, external browser links, support, and sync
      getAppInfo: { params: Record<string, never>; response: GetAppInfoResponse };
      checkForUpdates: { params: CheckForUpdatesRequest; response: AppUpdateInfo };
      getUpdateInfo: { params: Record<string, never>; response: AppUpdateInfo };
      openExternalUrl: { params: OpenExternalUrlRequest; response: { success: boolean } };
      openSupportTicket: { params: OpenSupportTicketRequest; response: OpenSupportTicketResponse };
      revealFile: { params: RevealFileRequest; response: RevealFileResponse };
      syncQuotes: { params: Record<string, never>; response: SyncQuotesResponse };
      getSponsorBanner: { params: GetSponsorBannerRequest; response: GetSponsorBannerResponse };

      // Setup wizard
      completeSetup: { params: CompleteSetupRequest; response: { success: boolean } };

      // File system
      pickFile: { params: PickFileRequest; response: PickFileResponse };
      pickDirectory: { params: PickDirectoryRequest; response: PickDirectoryResponse };
      saveFile: { params: SaveFileRequest; response: SaveFileResponse };
      readFile: { params: { path: string }; response: { content: string } };
      setLastImportDirectory: { params: SetLastImportDirectoryRequest; response: SetLastImportDirectoryResponse };

      // App lifecycle
      quitApp: { params: Record<string, never>; response: { success: boolean } };
      reloadApp: { params: Record<string, never>; response: { success: boolean } };

      // Update download
      downloadUpdate: { params: DownloadUpdateRequest; response: DownloadUpdateResponse };
    };
    messages: {
      // Bun -> Webview: push an update notification when a new version is detected
      updateAvailable: AppUpdateInfo;
    };
  }>;
  webview: RPCSchema<{
    requests: {
      // Webview -> Bun: none needed beyond the above
    };
    messages: {
      // Webview -> Bun: fire-and-forget messages
      logEvent: { type: string; message: string };
    };
  }>;
};
