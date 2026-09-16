/**
 * Shared console log layout used by the main process (ANSI colours) and the
 * webview (browser console). Only affects what humans read in a terminal or
 * devtools console; the plain `portfolio.log` file and the session JSONL keep
 * their machine-readable formats.
 */

export type ConsoleLogLevel = "info" | "success" | "warning" | "error" | "debug";

export interface ConsoleLogRecord {
  timestamp?: string | Date;
  level: ConsoleLogLevel;
  source: string;
  step?: string;
  message: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

export interface ConsoleLogLineParts {
  /** Local wall-clock time, `HH:MM:SS.mmm`. */
  time: string;
  level: ConsoleLogLevel;
  /** Fixed-width level label, e.g. `"INFO "`. */
  levelLabel: string;
  source: string;
  /** Step name without the source prefix; empty when the record has no step. */
  step: string;
  /** Spaces that pad the `source:step` column to its target width. */
  scopePadding: string;
  /** Message split on newlines; the first entry is the headline. */
  messageLines: string[];
  /** Rendered duration such as `"4ms"` or `"1.2s"`; empty when unknown. */
  duration: string;
  /** Metadata rendered as `key=value` pairs; empty when there is none. */
  data: string;
}

const LEVEL_LABELS: Record<ConsoleLogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  success: "OK",
  warning: "WARN",
  error: "ERROR",
};

const TIME_WIDTH = 12;
const LEVEL_WIDTH = 5;
const SCOPE_WIDTH = 26;
const MAX_DATA_KEYS = 8;
const MAX_VALUE_LENGTH = 72;

/** Indent that lines wrapped message lines up under the scope column. */
export const CONTINUATION_INDENT = " ".repeat(TIME_WIDTH + 2 + LEVEL_WIDTH + 2);

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function two(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Local `HH:MM:SS.mmm` timestamp; terminals rarely need the date. */
export function formatLogTime(timestamp?: string | Date): string {
  const date = timestamp instanceof Date ? timestamp : timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) return pad("", TIME_WIDTH);
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${ms}`;
}

/** `4ms`, `340ms`, `1.2s`, `1m04s` — whichever reads fastest at a glance. */
export function formatDuration(durationMs?: number): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return "";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 2 : 1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m${two(seconds)}s`;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    const needsQuotes = value === "" || /[\s"=]/.test(value);
    return truncate(needsQuotes ? JSON.stringify(value) : value);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) return truncate(`[${value.map((item) => formatValue(item)).join(", ")}]`);
  if (value instanceof Error) return truncate(value.message);
  try {
    return truncate(JSON.stringify(value) ?? String(value));
  } catch {
    return "[unserializable]";
  }
}

function truncate(value: string, max = MAX_VALUE_LENGTH): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Flattens metadata into compact `key=value` pairs instead of raw JSON. */
export function formatLogData(data?: Record<string, unknown>): string {
  if (!data) return "";
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return "";
  const shown = entries.slice(0, MAX_DATA_KEYS).map(([key, value]) => `${key}=${formatValue(value)}`);
  if (entries.length > shown.length) shown.push(`+${entries.length - shown.length} more`);
  return shown.join(" ");
}

/** Drops a duration the caller already spelled out in the message text. */
function stripTrailingDuration(message: string, durationMs?: number): string {
  if (durationMs === undefined) return message;
  return message.replace(/\s*\(?\b(?:in|after)\s+\d+(?:\.\d+)?ms\)?\.?$/i, "").trimEnd() || message;
}

export function buildConsoleLogLine(record: ConsoleLogRecord): ConsoleLogLineParts {
  const source = record.source || "app";
  const step = record.step ?? "";
  const scope = step ? `${source}:${step}` : source;
  const message = stripTrailingDuration(record.message ?? "", record.durationMs);

  return {
    time: formatLogTime(record.timestamp),
    level: record.level,
    levelLabel: pad(LEVEL_LABELS[record.level] ?? record.level.toUpperCase(), LEVEL_WIDTH),
    source,
    step,
    scopePadding: " ".repeat(Math.max(0, SCOPE_WIDTH - scope.length)),
    messageLines: message.split("\n"),
    duration: formatDuration(record.durationMs),
    data: formatLogData(record.data),
  };
}

/** Colourless rendering, used when the stream is not an interactive terminal. */
export function renderPlainLogLine(parts: ConsoleLogLineParts): string {
  const scope = parts.step ? `${parts.source}:${parts.step}` : parts.source;
  const [headline = "", ...rest] = parts.messageLines;
  const tail = [parts.duration, parts.data].filter(Boolean).join("  ");
  const first = `${parts.time}  ${parts.levelLabel}  ${scope}${parts.scopePadding}  ${headline}`;
  const lines = [tail ? `${first}  ${tail}` : first];
  for (const line of rest) lines.push(`${CONTINUATION_INDENT}${line}`);
  return lines.join("\n");
}

/**
 * One line of the log file: full ISO timestamp, level, scope, message and the
 * duration / metadata tail. Multi-line messages are indented under the
 * message column. Both Assistant and Portfolio write this exact layout, so
 * the same tooling reads either `service.log`.
 */
export function renderFileLogLine(record: ConsoleLogRecord): string {
  const parts = buildConsoleLogLine(record);
  const timestamp = record.timestamp instanceof Date ? record.timestamp : record.timestamp ? new Date(record.timestamp) : new Date();
  const iso = Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
  const scope = parts.step ? `${parts.source}:${parts.step}` : parts.source;
  const [headline = "", ...rest] = parts.messageLines;
  const tail = [parts.duration, parts.data].filter(Boolean).join("  ");
  const first = `${iso}  ${parts.levelLabel}  ${scope}${parts.scopePadding}  ${headline}`;
  const lines = [tail ? `${first}  ${tail}` : first];
  const indent = " ".repeat(iso.length + 2 + parts.levelLabel.length + 2);
  for (const line of rest) lines.push(`${indent}${line}`);
  return lines.join("\n");
}

/** Matches the start of a file log line and captures its ISO timestamp. */
export const FILE_LOG_LINE_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s{2}/;

/** Local calendar date `YYYY-MM-DD`, the day part of a daily log file name. */
export function formatLogDate(date = new Date()): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * Name of the log file of one local day, e.g. `service-2026-09-17.log`. Every
 * start on that day appends to the same file; a new file begins at midnight.
 */
export function dailyLogFileName(base: string, date = new Date()): string {
  return `${base}-${formatLogDate(date)}.log`;
}

/** Matches a daily log file name and captures its base name and date. */
export const DAILY_LOG_FILE_PATTERN = /^([a-z]+)-(\d{4}-\d{2}-\d{2})\.log$/;
