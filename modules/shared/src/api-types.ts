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

/** `GET /api/symbols/:symbol/intel?include=profile,analyst,...&assetType=Stock`. */
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
