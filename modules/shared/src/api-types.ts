/**
 * Request and response payloads of the HTTP API served by modules/service and
 * consumed by modules/gui (see modules/gui/src/api.ts).
 */

import type {
  PortfolioItem,
  PortfolioHolding,
  PortfolioSummary,
  PortfolioHistoricalPoint,
  PortfolioTransaction,
  PortfolioReport,
  ReportMetrics,
  FinancialPortfolioData,
} from "./portfolio";
import type { DesktopConfig, DataProviderId, DataProviderCategoryRouting, AppTheme } from "./config-types";
import type { PortfolioMetricPreference } from "./metrics";
import type { MetricManifest } from "./metric-manifest";
import type { MetricScope } from "./metric-abi";
import type { MetricOutput } from "./metric-output";
export type { DesktopConfig, DataProviderId, DataProviderCategoryRouting, ReportMetrics, AppTheme };
export type { DailyBriefDays } from "./config-types";

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

export interface TestFmpConnectionRequest {
  /** A key to test; empty or SECRET_MASK tests the stored key. */
  apiKey?: string;
}

export interface TestFmpConnectionResponse {
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

/** Whether the Claude Code CLI on this machine can serve as the inference provider. */
export interface ClaudeCliStatusResponse {
  installed: boolean;
  loggedIn: boolean;
  version?: string;
  /** "claude.ai" for a subscription sign-in. */
  authMethod?: string;
  /** Subscription plan, e.g. "pro" or "max". */
  subscriptionType?: string;
  message: string;
}

export interface GetAppInfoResponse {
  version: string;
  majorMinor: string;
  webpageUrl: string;
  devEmail: string;
  isDev: boolean;
  channel?: string;
  lastQuotesSync?: string;
  /** True when this client runs on the machine of the service (the desktop window). */
  isLocalClient: boolean;
  paths: { data: string; logs: string };
}

/** `POST /api/app/backup` (desktop window only): a copy of the database written to the Downloads folder. */
export interface CreateBackupResponse {
  success: boolean;
  fileName: string;
  filePath: string;
  sizeBytes: number;
}

/** `GET /api/auth/sessions`: live sessions across every window, browser and device. */
export interface SessionsInfo {
  active: number;
}

/** `POST /api/auth/sessions/revoke-others`: every session but the caller's was ended. */
export interface RevokeOtherSessionsResponse {
  revoked: number;
}

/** Desktop-only switch that opens the service to the local network. */
export interface RemoteAccessInfo {
  enabled: boolean;
  /** Port of the LAN listener (a setting; the desktop window uses a random loopback port). */
  port: number;
  /** URLs another device on the network can open. Empty while off or not listening. */
  urls: string[];
  /** A PIN must be set before remote access can be enabled. */
  pinRequired: boolean;
  /** True while the LAN listener runs. */
  listening: boolean;
  /** Why the LAN listener is not running although the switch is on (e.g. the port is in use). */
  error?: string;
}

/** `PATCH /api/host/remote-access`: either field may be left out. */
export interface UpdateRemoteAccessRequest {
  enabled?: boolean;
  port?: number;
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
  /** Installer URL on the website; the GUI opens it in the browser. */
  url?: string;
  fileName?: string;
  error?: string;
}

export type ReleasePlatformKey = "linux" | "windows" | "macos";

export interface ReleaseFile {
  name: string;
  url: string;
  size: number;
  sha256?: string;
}

/** `releases/latest.json` written by scripts/release.sh on the website. */
export interface ReleaseManifest {
  app: string;
  version: string;
  name?: string;
  publishedAt?: string;
  notes?: string;
  /** Page to open for a manual download. */
  url?: string;
  files: Partial<Record<ReleasePlatformKey, { installer?: ReleaseFile; portable?: ReleaseFile }>>;
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
  subject: string;
  body: string;
  /** Set when the diagnostics zip was saved into Downloads (desktop window). */
  zipPath?: string;
  zipFileName?: string;
  logCount?: number;
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

/** How Settings draws one setting of the catalog (`GET /api/settings`). */
export type SettingKind = "toggle" | "choice" | "text" | "secret";

export type SettingSection = "general" | "providers" | "assistant";

/** One setting as the service lists it: its definition and its current value. */
export interface SettingView {
  key: string;
  section: SettingSection;
  kind: SettingKind;
  label: string;
  description: string;
  placeholder?: string;
  options?: { value: string | number; label: string }[];
  value: string | number | boolean;
  /** Whether a value is stored (a secret comes back masked, so this is the only sign of one). */
  isSet: boolean;
}

export interface GetSettingsResponse {
  settings: SettingView[];
}

// ── integrations and automation ─────────────────────────────────────────────

/** `POST /api/integrations/gotify/test`: sends a test message. Empty fields use the stored settings; SECRET_MASK is the stored token. */
export interface TestGotifyRequest {
  url?: string;
  token?: string;
  priority?: number;
}

/** `POST /api/integrations/ntfy/test`: sends a test message. Empty fields use the stored settings; SECRET_MASK is the stored token. */
export interface TestNtfyRequest {
  url?: string;
  topic?: string;
  token?: string;
  priority?: number;
}

/** A push notification channel of Settings, Integrations. */
export type NotificationChannel = "gotify" | "ntfy";

/** The answer of a notification send or test, for any channel. */
export interface SendNotificationResponse {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

/** `GET /api/automation/daily-brief` and `GET /api/automation/weekly-analysis`. */
export interface AutomationStatus {
  /** A run is in progress. */
  running: boolean;
  /** Local date (YYYY-MM-DD) of the last scheduled run. */
  lastRun?: string;
  /** ISO timestamp of the next scheduled run; absent while the schedule is off. */
  nextRun?: string;
  /** The notification channels that are set up; every run goes to all of them. */
  channels: NotificationChannel[];
  /** Outcome of the last run since the service started. */
  lastResult?: {
    at: string;
    trigger: "schedule" | "manual";
    success: boolean;
    message: string;
    errors: string[];
  };
}

/** `POST /api/automation/daily-brief/run` and `POST /api/automation/weekly-analysis/run`. */
export interface RunAutomationResponse {
  success: boolean;
  /** Portfolios that got a brief or an analysis. */
  portfolios: number;
  /** Portfolios whose notification every set-up channel accepted. */
  delivered: number;
  message?: string;
  error?: string;
}
