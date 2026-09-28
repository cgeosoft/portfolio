/**
 * User settings of the application. Stored by the service in the `settings`
 * table of the SQLite database (see modules/service/src/config.ts) and edited
 * through Settings in the GUI.
 */

export type DataProviderId = "yahoo" | "finnhub";

export interface DataProviderCategoryRouting {
  quotes: DataProviderId;
  news: DataProviderId;
  charts: DataProviderId;
  fx: DataProviderId;
  fundamentals: DataProviderId;
  search: DataProviderId;
}

export const DEFAULT_DATA_PROVIDER_ROUTING: DataProviderCategoryRouting = {
  quotes: "yahoo",
  news: "finnhub",
  charts: "yahoo",
  fx: "yahoo",
  fundamentals: "finnhub",
  search: "yahoo",
};

/** Window geometry persisted by the desktop shell (not part of DesktopConfig). */
export interface WindowStateConfig {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isMaximized?: boolean;
}

export interface DesktopConfig {
  /** Whether the first-launch setup wizard has been completed */
  setupCompleted: boolean;
  /** Whether anonymous PostHog telemetry is enabled */
  telemetryEnabled: boolean;
  /** Random device identifier (no PII) */
  deviceId: string;
  /** Base display currency for portfolio valuations */
  baseCurrency: string;
  /** Privacy mode: mask monetary values in the UI */
  hideCurrencyValues: boolean;
  /** Active LLM provider: "openai-compatible" or "claude-cli" */
  llmProvider: string;
  /** LLM model identifier */
  llmModel: string;
  /** LLM API key */
  llmApiKey: string;
  /** LLM custom base URL */
  llmBaseUrl: string;
  /** LLM sampling temperature */
  llmTemperature: number;
  /** Per-provider API keys */
  llmApiKeys: Record<string, string>;
  /** Per-provider base URLs */
  llmBaseUrls: Record<string, string>;
  /** Per-provider selected models */
  llmModels?: Record<string, string>;
  /** Optional Finnhub API key for market intelligence in AI reports */
  finnhubApiKey?: string;
  /** Provider assignments for each data category */
  dataProviderRouting: DataProviderCategoryRouting;
  /** ISO timestamp of the last market quotes synchronization */
  lastQuotesSync?: string;
  /** Interval in minutes for automatically refreshing market quotes (0 = manual only) */
  marketQuotesInterval: number;
  /** Whether to start Portfolio on system boot */
  startWithBoot: boolean;
  /** Whether to skip the introduction step in the report wizard */
  skipReportIntro?: boolean;
  /** Whether to automatically check for new application versions on startup and periodically */
  checkForUpdates: boolean;
  /** ISO timestamp of the last check for updates */
  lastUpdateCheck?: string;
  /** Version string dismissed by user to avoid repetitive alerts */
  dismissedUpdateVersion?: string;
  /** UI zoom scaling factor (1.0 = 100%) */
  zoomLevel?: number;
  /** UI theme mode: "dark" | "light" | "system" */
  theme?: AppTheme;
  /**
   * Remote connections switch (Settings, General). Counts only while a PIN is
   * set. Changed through `/api/host/remote-access`, never `PATCH /api/config`.
   */
  allowRemoteConnections: boolean;
  /** Port of the LAN listener on 0.0.0.0 while remote connections are on. */
  remotePort: number;
  /** Closing the desktop window hides it to the tray (mirrored to desktop-settings.json for the shell). */
  closeToTray: boolean;
  /** Base URL of the Gotify server that receives push notifications (Settings, Integrations). */
  gotifyUrl: string;
  /** Application token of the Gotify server. Masked like the API keys. */
  gotifyToken: string;
  /** Gotify message priority, 0 to 10. */
  gotifyPriority: number;
  /** Base URL of the ntfy server (Settings, Integrations); https://ntfy.sh or a self-hosted one. */
  ntfyUrl: string;
  /** The ntfy topic the notifications go to; empty turns ntfy off. */
  ntfyTopic: string;
  /** Optional ntfy access token for a protected topic. Masked like the API keys. */
  ntfyToken: string;
  /** ntfy message priority, 1 (min) to 5 (max). */
  ntfyPriority: number;
  /** Whether the assistant writes the daily brief on a schedule (Settings, Automation). */
  dailyBriefEnabled: boolean;
  /** Local time of day the daily brief runs, "HH:MM". */
  dailyBriefTime: string;
  /** The days the daily brief runs. */
  dailyBriefDays: DailyBriefDays;
  /** The portfolio of the daily brief; empty for every portfolio. */
  dailyBriefPortfolioId: string;
  /** Local date (YYYY-MM-DD) of the last scheduled daily brief. Written by the service. */
  dailyBriefLastRun?: string;
  /** Whether the assistant writes the weekly analysis on a schedule (Settings, Automation). */
  weeklyAnalysisEnabled: boolean;
  /** Day of the week the weekly analysis runs, 0 (Sunday) to 6 (Saturday). */
  weeklyAnalysisDay: number;
  /** Local time of day the weekly analysis runs, "HH:MM". */
  weeklyAnalysisTime: string;
  /** The portfolio of the weekly analysis; empty for every portfolio. */
  weeklyAnalysisPortfolioId: string;
  /** Local date (YYYY-MM-DD) of the last scheduled weekly analysis. Written by the service. */
  weeklyAnalysisLastRun?: string;
}

/** "weekdays" runs Monday to Friday; the Monday brief covers the Friday session. */
export type DailyBriefDays = "daily" | "weekdays";

/** Default Gotify priority: shows a notification on Android without sound override. */
export const DEFAULT_GOTIFY_PRIORITY = 5;

/** The public ntfy server, the default until the user names a self-hosted one. */
export const DEFAULT_NTFY_URL = "https://ntfy.sh";

/** Default ntfy priority: a regular notification. */
export const DEFAULT_NTFY_PRIORITY = 3;

/** Default port of the LAN listener. The loopback listener of the desktop window uses a random port. */
export const DEFAULT_REMOTE_PORT = 5130;

/** Settings the GUI cannot change through `PATCH /api/config`. */
export const PROTECTED_CONFIG_KEYS = ["deviceId", "allowRemoteConnections", "remotePort", "dailyBriefLastRun", "weeklyAnalysisLastRun"] as const;

export type AppTheme = "dark" | "light" | "system";

/**
 * What `GET /api/config` returns in place of a stored API key. The service
 * never sends a key back; a request that carries this value means "use the
 * stored key".
 */
export const SECRET_MASK = "********";
