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
  ReportMetrics,
  FinancialPortfolioData,
  ManualPrice,
} from "./portfolio";
import type { DesktopConfig, DataProviderId, DataProviderCategoryRouting, AppTheme } from "./config-types";
import type { PortfolioMetricPreference } from "./metrics";
import type { MetricManifest } from "./metric-manifest";
import type { MetricScope } from "./metric-abi";
import type { MetricOutput } from "./metric-output";
import type { PortfolioSuggestion, SuggestionQuote } from "./suggestions";
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
  /** Colour of the portfolio dot, `#rrggbb`; null for the default. */
  color?: string | null;
}

export interface UpdatePortfolioRequest {
  portfolioId: string;
  name?: string;
  description?: string;
  baseCurrency?: string;
  /** Colour of the portfolio dot, `#rrggbb`; null for the default; absent keeps it. */
  color?: string | null;
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

export interface SuggestPortfolioMetricsRequest {
  portfolioId: string;
  baseCurrency?: string;
}

/** Dashboard layout the assistant proposes. Nothing is saved until the GUI sends `metrics` to savePortfolioMetrics. */
export interface SuggestPortfolioMetricsResponse {
  portfolioId: string;
  /** Full preference list with the proposed slots applied. */
  metrics: PortfolioMetricPreference[];
  /** Proposed large cards, in display order. */
  large: string[];
  /** Proposed compact tiles, in display order. */
  compact: string[];
  /** Short explanation from the assistant. */
  reason: string;
}

// ── portfolio suggestions ───────────────────────────────────────────────────

export interface SuggestionGeneration {
  status: "idle" | "running" | "fail";
  startedAt?: string;
  error?: string;
}

export interface GetSuggestionsResponse {
  portfolioId: string;
  /** Every suggestion of the portfolio, active and past, by priority then age. */
  suggestions: PortfolioSuggestion[];
  /** Prices of suggestion symbols the portfolio does not hold. Held symbols use the holdings. */
  quotes: SuggestionQuote[];
  /** Time of the last successful generation. */
  generatedAt?: string;
  /** True when transactions changed after the last generation. */
  stale: boolean;
  /** Notes from the last generation, for example suggestions that were dropped. */
  notes: string[];
  /** Short overview from the model. */
  summary?: string;
  generation: SuggestionGeneration;
}

export interface GenerateSuggestionsRequest {
  portfolioId: string;
  baseCurrency?: string;
}

export interface UpdateSuggestionStatusRequest {
  portfolioId: string;
  suggestionId: string;
  /** "active" undoes a dismissal or a manual "done". */
  status: "active" | "done" | "dismissed";
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
  /** "unavailable": a data provider the metric needs has no API key. */
  status: "ready" | "quarantined" | "unavailable";
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
  | { id: string; status: "error" | "quarantined" | "missing" | "unavailable"; error: string };

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
  /** SHA-256 of the module the user reviewed in the preview; the install refuses any other bytes. */
  sha256?: string;
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

/** `PUT /api/symbol-map/:isin`: the user's own ticker for an ISIN. */
export interface SetIsinSymbolRequest {
  symbol: string;
  name?: string;
}

export interface SetIsinSymbolResponse {
  success: boolean;
  /** Portfolios whose transactions now use the symbol. */
  portfolios: number;
  error?: string;
}

/** `PUT /api/portfolios/:id/manual-prices/:symbol`: the user's price or NAV for a private holding. */
export interface SetManualPriceRequest {
  price: number;
  /** Currency of the price; defaults to the holding's currency. */
  currency?: string;
}

/** Answer of the set and clear calls (`DELETE` on the same path clears it). */
export interface ManualPriceResponse {
  success: boolean;
  /** The stored price; absent after a clear. */
  manualPrice?: ManualPrice;
  error?: string;
}

/** `POST /api/portfolios/:id/symbols/resolve`: tickers looked up for ISIN-only transactions. */
export interface ResolvePortfolioSymbolsResponse {
  success: boolean;
  /** Transactions that got a ticker. */
  updated: number;
  error?: string;
}

export interface SearchSymbolRequest {
  query: string;
}

export interface SearchSymbolResponse {
  results: { symbol: string; name: string; exchange: string; quoteType: string; typeDisp?: string }[];
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
  /** Data the key's plan does not include (for example "analyst estimates"), when the key works. */
  restricted?: string[];
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

export interface GetReportsRequest {
  portfolioId: string;
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

/** A conversation in the history list, without its messages. */
export interface AssistantConversationSummary {
  id: string;
  portfolioId: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GetAssistantConversationsResponse {
  conversations: AssistantConversationSummary[];
}

export interface GetAssistantConversationResponse {
  conversation: AssistantConversation;
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
  enableAnalytics: boolean;
  enableErrorReporting: boolean;
}

export type ConsentSource = "setup" | "settings" | "update-prompt";

export interface ConsentChoice {
  granted: boolean;
  /** ISO timestamp of the last change */
  at: string;
  source: ConsentSource;
}

export interface ConsentRecord {
  noticeVersion: number;
  analytics: ConsentChoice;
  errorReporting: ConsentChoice;
}

export interface PrivacyConsentResponse {
  record: ConsentRecord | null;
  needsPrompt: boolean;
  analyticsEnabled: boolean;
  errorReportingEnabled: boolean;
  /** False on a client on another device: only the desktop window changes consent. */
  canChange: boolean;
  /** Only for the desktop window. */
  analyticsId?: string;
}

export interface PrivacyPromptAnswerRequest {
  analytics: boolean;
  errorReporting: boolean;
}

export interface ReportClientErrorRequest {
  name?: string;
  stack?: string;
  source: "boundary" | "window";
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

/** Whether a vendor CLI on this machine (Claude Code, Codex, Gemini) can serve as the inference provider. */
export interface CliProviderStatusResponse {
  installed: boolean;
  loggedIn: boolean;
  version?: string;
  /** How the CLI signed in, e.g. "claude.ai" for a Claude subscription. */
  authMethod?: string;
  /** Subscription plan, e.g. "pro" or "max". */
  subscriptionType?: string;
  message: string;
}

export type ClaudeCliStatusResponse = CliProviderStatusResponse;

/** Starts the OpenRouter sign-in: the window opens `authUrl` in the system browser. */
export interface StartOpenRouterConnectResponse {
  authUrl: string;
  /** One-time id of this sign-in, polled with `/api/llm/openrouter/connect/<state>`. */
  state: string;
}

export interface OpenRouterConnectStatusResponse {
  status: "pending" | "connected" | "failed" | "expired";
  message?: string;
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
  /** Data and log folders, only for the desktop window: they name the OS user. */
  paths?: { data: string; logs: string };
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

/** Desktop-only switch of the MCP server that other LLM clients on this computer connect to. */
export interface McpAccessInfo {
  enabled: boolean;
  /** Port of the MCP listener on 127.0.0.1 (a setting). */
  port: number;
  /** Address an MCP client connects to (Streamable HTTP). */
  url: string;
  /** True while the MCP listener runs. */
  listening: boolean;
  /** True when an access token exists. The service keeps only its hash, so it cannot show it again. */
  hasToken: boolean;
  /** The new access token, only in the response that created it. */
  token?: string;
  /** Why the MCP listener is not running although the switch is on (e.g. the port is in use). */
  error?: string;
}

/** `PATCH /api/host/mcp`: either field may be left out. */
export interface UpdateMcpAccessRequest {
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
  /** Title of the folder dialog, in the interface language. */
  dialogTitle?: string;
}

export interface DownloadUpdateResponse {
  success: boolean;
  /**
   * Desktop window: the service asks for a folder and downloads the installer
   * there in the background; the GUI follows `GET /api/app/update/download`.
   */
  started?: boolean;
  /** Other devices: the installer URL, which the GUI opens in the browser. */
  url?: string;
  fileName?: string;
  error?: string;
}

export type UpdateDownloadStatus = "idle" | "picking" | "downloading" | "done" | "cancelled" | "error";

/** Progress of the installer download the desktop window started. */
export interface UpdateDownloadState {
  status: UpdateDownloadStatus;
  fileName?: string;
  /** Where the installer was saved, once `status` is `done`. */
  filePath?: string;
  receivedBytes?: number;
  /** Size from Content-Length; absent when the server does not send it. */
  totalBytes?: number;
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

/** The Settings page a catalog setting shows on. */
export type SettingSection = "appearance" | "security" | "market" | "app" | "providers" | "assistant";

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
  /** True when this client may not change the setting. */
  readOnly?: boolean;
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

/** A push notification channel of Settings, Notifications, Phone Apps. */
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

// ── dividends, splits and earnings (services/intel/calendar.ts, services/income.ts) ──

/** How often a symbol pays a dividend. */
export type DividendFrequency = "monthly" | "quarterly" | "semiannual" | "annual" | "irregular";

/** One dividend. Amounts are per share in the trading currency of the symbol, adjusted for later splits. */
export interface DividendEvent {
  /** Ex-dividend date, YYYY-MM-DD. */
  exDate: string;
  payDate?: string;
  recordDate?: string;
  declarationDate?: string;
  amount: number;
  /** True for a date and amount projected from the past pattern, not declared by the company. */
  estimated?: boolean;
}

/** One stock split: `numerator` new shares for every `denominator` old shares. */
export interface SplitEvent {
  date: string;
  numerator: number;
  denominator: number;
}

/** One earnings report. EPS values are per share in the reporting currency. */
export interface EarningsEvent {
  date: string;
  epsEstimate?: number | null;
  epsActual?: number | null;
  /** (actual - estimate) / |estimate| in percent. */
  surprisePercent?: number | null;
  revenueEstimate?: number | null;
  revenueActual?: number | null;
  /** "bmo" before the open, "amc" after the close, when the provider says. */
  time?: string;
}

/** Dividends, splits and earnings of one symbol, each with the provider it came from. */
export interface SymbolCalendar {
  symbol: string;
  dividends: {
    /** Past and declared dividends, oldest first. */
    history: DividendEvent[];
    /** Declared dividends with an ex-date or pay date from today on. */
    upcoming: DividendEvent[];
    frequency?: DividendFrequency;
    source: DataProviderId | null;
  };
  splits: {
    history: SplitEvent[];
    upcoming: SplitEvent[];
    source: DataProviderId | null;
  };
  earnings: {
    upcoming?: EarningsEvent;
    last?: EarningsEvent;
    source: DataProviderId | null;
  };
}

/** Dividend income of one holding. Money amounts are in the portfolio base currency. */
export interface DividendIncomeHolding {
  symbol: string;
  name: string;
  /** Trading currency of the per-share amounts. */
  currency: string;
  frequency?: DividendFrequency;
  /** Dividends per share expected over the next 12 months (declared plus projected), trading currency. */
  forwardDividendPerShare: number;
  /** Dividends per share with an ex-date in the last 12 months, trading currency. */
  trailingDividendPerShare: number;
  /** Expected income over the next 12 months, base currency. */
  projectedIncome12m: number;
  /** Dividends recorded as DIVIDEND transactions in the last 12 months, base currency. */
  receivedIncome12m: number;
  /** Forward income over the cost basis, percent. */
  yieldOnCostPercent?: number;
  /** Forward income over the current value, percent. */
  currentYieldPercent?: number;
  nextExDate?: string;
  nextPayDate?: string;
  /** Part of the projection follows the past pattern instead of a declared dividend. */
  estimated: boolean;
  /** No exchange rate for the trading currency; money amounts are 0. */
  fxMissing?: boolean;
  source: DataProviderId | null;
}

/** A split after the first purchase that the recorded quantities may not reflect. Only a hint; data is never changed. */
export interface SplitWarning {
  symbol: string;
  name: string;
  date: string;
  numerator: number;
  denominator: number;
  message: string;
  source: DataProviderId | null;
}

/** `GET /api/portfolios/:id/income`. Money amounts are in `baseCurrency`. */
export interface PortfolioIncomeSummary {
  portfolioId: string;
  baseCurrency: string;
  generatedAt: string;
  projected12m: {
    total: number;
    /** 12 calendar months from the current one; income by pay date (ex-date when the pay date is unknown). */
    months: { month: string; declared: number; estimated: number }[];
  };
  /** DIVIDEND transactions of the last 12 months. `count` 0 means none were recorded. */
  received12m: { total: number; count: number };
  yieldOnCostPercent?: number;
  currentYieldPercent?: number;
  /** Holdings with a dividend in the last two years or a declared one, by projected income. */
  holdings: DividendIncomeHolding[];
  splitWarnings: SplitWarning[];
  /** Providers behind the data, in first-seen order. */
  sources: DataProviderId[];
}

export type PortfolioEventKind = "exDividend" | "dividendPayment" | "earnings" | "split";

/** One upcoming event of a held symbol. */
export interface PortfolioEvent {
  date: string;
  kind: PortfolioEventKind;
  symbol: string;
  name: string;
  /** Projected from the past pattern, not declared. */
  estimated?: boolean;
  /** Dividend per share, trading currency. */
  amountPerShare?: number;
  currency?: string;
  /** Expected dividend income of the holding, base currency. */
  expectedIncome?: number;
  epsEstimate?: number | null;
  /** Earnings time, "bmo" or "amc". */
  time?: string;
  numerator?: number;
  denominator?: number;
  source: DataProviderId | null;
}

/** `GET /api/portfolios/:id/events?days=30`. */
export interface PortfolioEventsResponse {
  portfolioId: string;
  baseCurrency: string;
  days: number;
  from: string;
  to: string;
  events: PortfolioEvent[];
  sources: DataProviderId[];
}

// ── market intelligence: macro context, benchmarks, market hours ────────────

/** One maturity of the US Treasury yield curve. `yield` is in percent (4.25 = 4.25%). */
export interface YieldCurvePoint {
  /** "month3", "year2", "year10" and so on, the FMP field names. */
  tenor: string;
  /** Short label for the GUI: "3M", "2Y", "10Y". */
  label: string;
  /** Maturity in years, for ordering and plotting. */
  years: number;
  yield: number;
}

/** The yield curve on one date plus the history of its key maturities. */
export interface YieldCurveSnapshot {
  date: string;
  points: YieldCurvePoint[];
  /** Key maturities over the last year, one point a week, oldest first. Percent. */
  history: Array<{ date: string; month3?: number; year2?: number; year10?: number; year30?: number }>;
  source: DataProviderId;
}

export type EconomicIndicatorId = "gdp" | "cpi" | "inflationRate" | "unemploymentRate" | "federalFunds";

/** The latest US reading of one economic indicator and the reading before it. */
export interface EconomicIndicatorReading {
  id: EconomicIndicatorId;
  name: string;
  /** "%" for rates, "index" for CPI, "bn USD" for GDP. */
  unit: string;
  value: number;
  date: string;
  previous?: number;
  previousDate?: string;
}

/** One release of the economic calendar. `date` is UTC, "YYYY-MM-DD HH:mm:ss". */
export interface EconomicEvent {
  date: string;
  country: string;
  currency: string;
  event: string;
  impact: "High" | "Medium" | "Low" | string;
  previous?: number | null;
  estimate?: number | null;
  actual?: number | null;
  unit?: string | null;
}

/** Equity risk premium of a country, in percent. */
export interface MarketRiskPremiumRow {
  country: string;
  totalEquityRiskPremium: number;
  countryRiskPremium: number;
}

/** Average change of a sector on one day, in percent, and its P/E when known. */
export interface SectorPerformanceRow {
  sector: string;
  changePercent: number;
  pe?: number;
  /** The sector ETF that stood in when FMP had no snapshot. */
  etf?: string;
}

/** Macro context of `GET /api/market/macro`. Every piece is null when no provider had it. */
export interface MacroSnapshot {
  asOf: string;
  baseCurrency: string;
  yieldCurve: YieldCurveSnapshot | null;
  indicators: { items: EconomicIndicatorReading[]; source: DataProviderId } | null;
  /** Releases of the next 7 days, high impact or in the base currency (and USD). */
  calendar: { from: string; to: string; events: EconomicEvent[]; source: DataProviderId } | null;
  /** The base currency's country and the United States. */
  riskPremium: { items: MarketRiskPremiumRow[]; source: DataProviderId } | null;
  sectors: { date: string; items: SectorPerformanceRow[]; source: DataProviderId; peSource?: DataProviderId } | null;
  /** The 3-month T-bill yield as a decimal (0.042), or the built-in default. */
  riskFreeRate: { rate: number; source: DataProviderId | "default" };
}

/** One close of a benchmark. */
export interface BenchmarkPoint {
  date: string;
  close: number;
}

/** `GET /api/market/benchmark?symbol=&range=`. `points` is empty when no provider had the symbol. */
export interface BenchmarkHistoryResponse {
  symbol: string;
  label: string;
  range: string;
  points: BenchmarkPoint[];
  source: DataProviderId | null;
}

/** Portfolio against a benchmark over one range, both in percent from the first common date. */
export interface BenchmarkComparison {
  symbol: string;
  label: string;
  range: string;
  from: string;
  to: string;
  /** Time-weighted return of the invested holdings (cost-basis changes treated as cash flows). */
  portfolioReturnPercent: number;
  benchmarkReturnPercent: number;
  /** Portfolio minus benchmark, in percentage points. */
  excessReturnPercent: number;
  series: Array<{ date: string; portfolio: number; benchmark: number }>;
  source: DataProviderId | null;
}

/** Trading state of one exchange. */
export interface ExchangeStatus {
  exchange: string;
  name: string;
  timezone: string;
  tradingDay: boolean;
  open: boolean;
  /** "fmp" when FMP supplied the hours or the holidays, "builtin" for the built-in table. */
  source: DataProviderId | "builtin";
}

/** `GET /api/market/status`: the exchanges of the held symbols across every portfolio. */
export interface MarketStatusResponse {
  now: string;
  /** True when any exchange is open (or within the sync grace window), or when no exchange applies. */
  anyOpen: boolean;
  markets: ExchangeStatus[];
}

// ── portfolio exposure: ETF and fund look-through (services/exposure.ts, services/intel/etf.ts) ──

/** One bucket of an exposure breakdown. Percent of the whole portfolio value, cash included. */
export interface ExposureSlice {
  name: string;
  percent: number;
  /** Value in the portfolio base currency. */
  value: number;
}

/** Sector, country or asset-class exposure of a portfolio. */
export interface ExposureBreakdown {
  /** Largest first. */
  items: ExposureSlice[];
  /** Value that should have a bucket but no provider had the data. */
  unknownPercent: number;
  /** Value where the bucket does not apply (cash, crypto, private assets, bond parts of funds). */
  notApplicablePercent: number;
}

/** Where one part of an underlying stock exposure comes from. */
export interface ExposureStockPart {
  /** "direct" for a holding of the portfolio, otherwise the fund symbol. */
  via: string;
  percent: number;
  value: number;
}

/** One stock the portfolio holds directly, through funds or both. */
export interface ExposureUnderlyingStock {
  symbol: string;
  name?: string;
  isin?: string;
  percent: number;
  value: number;
  directPercent: number;
  viaFundsPercent: number;
  /** Largest part first. */
  breakdown: ExposureStockPart[];
}

/** One fund of the portfolio and what was found out about it. */
export interface ExposureFund {
  symbol: string;
  name?: string;
  /** Share of the portfolio value. */
  percent: number;
  value: number;
  /** Annual expense ratio in percent (0.07 means 0.07 %). */
  expenseRatio?: number;
  /** Assets under management in `aumCurrency`. */
  aum?: number;
  aumCurrency?: string;
  holdingsCount?: number;
  /** False when only the top holdings are known (Yahoo). */
  holdingsComplete: boolean;
  /** Sum of the known holding weights, percent of the fund. */
  holdingsKnownPercent: number;
  sources: {
    holdings: DataProviderId | null;
    sectors: DataProviderId | null;
    countries: DataProviderId | null;
    assetClasses: DataProviderId | null;
    info: DataProviderId | null;
  };
}

/** How much two funds hold in common: the sum over shared holdings of the smaller weight. */
export interface ExposureOverlap {
  a: string;
  b: string;
  overlapPercent: number;
  commonHoldings: number;
  /** True when a fund's list is its top holdings only, so the real overlap can be higher. */
  partial: boolean;
}

export type ExposureWarningKind = "stock" | "sector" | "country" | "overlap";

export interface ExposureWarning {
  kind: ExposureWarningKind;
  /** The stock symbol, sector, country or "A / B" fund pair. */
  name: string;
  percent: number;
  limit: number;
  message: string;
}

/** Thresholds behind the warnings, in percent. */
export interface ExposureLimits {
  stockPercent: number;
  sectorPercent: number;
  countryPercent: number;
  overlapPercent: number;
}

/** How much of the portfolio value the exposure is based on. Percent of the portfolio value. */
export interface ExposureCoverage {
  /** Held directly and classified: stocks with a profile, cash, crypto, private assets. */
  directPercent: number;
  /** Funds with holdings, sector or country data. */
  lookedThroughPercent: number;
  /** Funds and stocks no provider had data for. */
  unknownPercent: number;
  /** Value whose underlying single names are known (direct stocks plus known fund holdings). */
  holdingsKnownPercent: number;
}

/** `GET /api/portfolios/:id/exposure`. */
export interface PortfolioExposureResponse {
  portfolioId: string;
  baseCurrency: string;
  totalValue: number;
  /** ISO timestamp. */
  generatedAt: string;
  sectors: ExposureBreakdown;
  countries: ExposureBreakdown;
  assetClasses: ExposureBreakdown;
  /** Largest first, at most 25. */
  topStocks: ExposureUnderlyingStock[];
  funds: ExposureFund[];
  /** Largest first, pairs with any overlap. */
  overlaps: ExposureOverlap[];
  warnings: ExposureWarning[];
  limits: ExposureLimits;
  coverage: ExposureCoverage;
  /** Value-weighted expense ratio of the funds with a known ratio. */
  weightedExpenseRatio?: { percent: number; coveragePercent: number };
  /** Providers behind the data, in quality order. */
  sources: DataProviderId[];
}

// ── company intelligence ────────────────────────────────────────────────────

/** `GET /api/symbols/:symbol/intel?include=profile,analyst,...&assetType=Stock&private=1`. */
export type GetCompanyIntelResponse = import("./company-intel").CompanyIntel;

/** `GET /api/symbols/:symbol/transcript`: the latest earnings call (FMP only). */
export interface GetTranscriptResponse {
  transcript: import("./company-intel").EarningsTranscript | null;
  source: DataProviderId | null;
  /** The cached LLM summary of this call, when one exists. */
  summary: import("./company-intel").TranscriptSummary | null;
}

/** `POST /api/symbols/:symbol/transcript/summary`. */
export interface SummarizeTranscriptRequest {
  /** Ask the model again instead of returning the cached summary. */
  force?: boolean;
}

export interface SummarizeTranscriptResponse {
  summary: import("./company-intel").TranscriptSummary | null;
  /** Why there is no summary: no transcript, or the model failed. */
  error?: string;
}

// ── portfolio brief & wizard ────────────────────────────────────────────────

export type { PortfolioBrief, TargetBand } from "./portfolio";

export interface UpdatePortfolioBriefRequest {
  brief: import("./portfolio").PortfolioBrief;
}

export interface GetPortfolioBriefResponse {
  portfolioId: string;
  brief: import("./portfolio").PortfolioBrief | null;
  briefUpdatedAt?: string | null;
}

export interface ScanAmountsRequest {
  texts: string[];
}

export interface ScanAmountsResponse {
  hasAmounts: boolean;
  /** The amounts found, as written, so the form can name them. */
  matches: string[];
}

export interface BriefWizardFollowupRequest {
  answers: Record<string, unknown>;
}

export interface BriefWizardFollowupResponse {
  followups: Array<{ id: string; question: string; options?: string[] }>;
}

export interface BriefWizardDraftRequest {
  answers: Record<string, unknown>;
  /** Keyed by follow-up id: `{ question, answer }`. */
  followupAnswers?: Record<string, { question: string; answer: string }>;
}

export interface BriefWizardDraftResponse {
  prose: string;
  brief: import("./portfolio").PortfolioBrief;
}

// ── guided portfolio analysis graph ─────────────────────────────────────────

export type AnalysisNodeKind =
  | "brief"
  | "allocation"
  | "holding"
  | "question"
  | "news"
  | "indicator"
  | "metric"
  | "calc"
  | "macro"
  | "company"
  | "event"
  | "theme"
  | "finding"
  | "suggestion"
  | "report";

export type AnalysisEdgeType =
  | "about"
  | "measures"
  | "exposes"
  | "derived_from"
  | "answers"
  | "supports"
  | "contradicts"
  | "against_goal"
  | "motivates";

export interface AnalysisNodeSource {
  provider?: string;
  url?: string;
  fetchTime?: string;
}

export interface AnalysisNode {
  id: string;
  runId: string;
  kind: AnalysisNodeKind;
  title: string;
  /** Percent-only facts, checked by the privacy gate; the only part a prompt sees. */
  facts: Record<string, unknown>;
  /** Amounts and quantities for the GUI only; follows the hide-values switch. Never sent to a model. */
  local?: Record<string, unknown>;
  /** At most 300 characters: the text the model sees. */
  summary: string;
  source?: AnalysisNodeSource;
  createdBy: string;
  depth: number;
  relevance: number;
  status: "ready" | "failed" | "pruned";
  createdAt: string;
}

export interface AnalysisEdge {
  id: string;
  runId: string;
  sourceId: string;
  targetId: string;
  type: AnalysisEdgeType;
  rationale: string;
  createdAt: string;
}

export interface AnalysisStep {
  id: string;
  runId: string;
  stepIndex: number;
  phase: AnalysisPhase;
  /** One line on what the step asked, for the side log. */
  requestSummary?: string;
  /** Tool calls and model outputs of the step, prompt-safe. */
  actions?: unknown;
  /** Short results: node ids made, errors. */
  results?: unknown;
  /** The model's own short note of the step, cleaned. */
  note?: string;
  durationMs: number;
  createdAt: string;
}

export type AnalysisPhase = "seed" | "survey" | "expand" | "synthesise" | "suggest" | "report" | "done";

export const ANALYSIS_PHASES: readonly AnalysisPhase[] = ["seed", "survey", "expand", "synthesise", "suggest", "report"];

export type AnalysisRunStatus = "running" | "completed" | "failed" | "cancelled";

/** How the harness talks to the model: real tools, the JSON action protocol, or not at all. */
export type AnalysisToolMode = "native" | "json" | "none";

export interface AnalysisRun {
  id: string;
  portfolioId: string;
  status: AnalysisRunStatus;
  phase: AnalysisPhase;
  briefSnapshot: import("./portfolio").PortfolioBrief;
  provider?: string;
  model?: string;
  toolMode?: AnalysisToolMode;
  /** "manual" or "schedule". */
  trigger?: string;
  stepCount: number;
  toolCount: number;
  nodeCount: number;
  /** Two or three sentences: where the portfolio stands against its brief. */
  summary?: string;
  /** Notes for the user: budgets reached, dropped suggestions, failed tools. */
  notes: string[];
  startedAt: string;
  endedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** A run as the list shows it, with flags computed on read. */
export interface AnalysisRunListItem extends AnalysisRun {
  /** The brief was saved after this run started. */
  briefChanged: boolean;
  /** Transactions changed after this run started. */
  stale: boolean;
  findingsCount: number;
  suggestionsCount: number;
}

export interface StartAnalysisRunRequest {
  portfolioId: string;
  baseCurrency?: string;
}

export interface GetAnalysisRunResponse {
  run: AnalysisRunListItem;
  nodes: AnalysisNode[];
  edges: AnalysisEdge[];
  steps: AnalysisStep[];
  report?: import("./portfolio").PortfolioReport | null;
  suggestions?: import("./suggestions").PortfolioSuggestion[];
  /** While running: what the harness does right now. */
  live?: { phase: AnalysisPhase; message: string; since: string };
}

export interface ListAnalysisRunsResponse {
  portfolioId: string;
  runs: AnalysisRunListItem[];
  /** The run in progress for this portfolio, if any. */
  activeRunId?: string;
}

/** Whether the AI features can run with the current setup. */
export interface AiCapabilityResponse {
  /** An AI provider is chosen in Settings. */
  configured: boolean;
  /** The current setup answered a request (the Settings test or any feature). Gates the brief wizard. */
  aiReady: boolean;
  provider: string;
  providerName: string;
  model: string;
  /** How Guided Analysis would talk to the model; "none" blocks a run. Undefined until probed. */
  toolMode?: AnalysisToolMode;
  /** True when the tool mode is forced in Settings, not probed. */
  toolModeForced?: boolean;
  /** Why a run cannot start, for the note under the Run button. */
  reason?: "not_configured" | "not_verified" | "no_tool_calling" | "turned_off";
}

export interface WeightDriftComparison {
  symbol: string;
  previousWeight: number;
  currentWeight: number;
  diff: number;
}

export interface CompareAnalysisRunsResponse {
  currentRunId: string;
  /** Undefined when there is no earlier finished run to compare with. */
  previousRunId?: string;
  newFindings: AnalysisNode[];
  resolvedFindings: AnalysisNode[];
  /** Findings of both runs, matched by title and holdings. */
  keptFindings: AnalysisNode[];
  changedWeights: WeightDriftComparison[];
}
