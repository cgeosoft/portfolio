/**
 * Stdout rendering for `appLogger`: the file layout of
 * portfolio-shared/log-format.ts (`renderFileLogLine`, full ISO timestamp)
 * with optional colour. The desktop shell strips the colour and appends each
 * line to `service-YYYY-MM-DD.log`, so the support ticket can filter the
 * lines by their timestamp.
 */

import { buildConsoleLogLine, renderFileLogLine, type ConsoleLogLevel, type ConsoleLogRecord } from "portfolio-shared/log-format";
import { isDev } from "./environment.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

const LEVEL_COLORS: Record<ConsoleLogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  success: "\x1b[32m",
  warning: "\x1b[33m",
  error: "\x1b[31m",
};

/** Stable per-source colours so `db`, `rpc`, and `webview` stay distinguishable. */
const SOURCE_COLORS = ["\x1b[36m", "\x1b[35m", "\x1b[34m", "\x1b[32m", "\x1b[33m", "\x1b[96m", "\x1b[95m"];

function sourceColor(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return SOURCE_COLORS[hash % SOURCE_COLORS.length] as string;
}

/**
 * Colour when stdout is a terminal, or when running from a checkout: the
 * desktop shell then pipes the output to the developer's terminal (and strips
 * the colour for the log file).
 */
function detectColorSupport(): boolean {
  if (process.stdout?.isTTY) return true;
  try {
    return isDev();
  } catch {
    return false;
  }
}

let colorEnabled = detectColorSupport();

/** Test hook: force colour on or off regardless of the detected environment. */
export function setConsoleColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

export function isConsoleColorEnabled(): boolean {
  return colorEnabled;
}

function paint(text: string, color: string): string {
  return colorEnabled && text ? `${color}${text}${RESET}` : text;
}

function durationColor(durationMs: number): string {
  if (durationMs >= 2000) return "\x1b[31m";
  if (durationMs >= 500) return "\x1b[33m";
  return DIM;
}

function isoTime(timestamp?: string | Date): string {
  const date = timestamp instanceof Date ? timestamp : timestamp ? new Date(timestamp) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** Formats one record as a single (possibly multi-line) terminal string. */
export function formatConsoleLogLine(record: ConsoleLogRecord): string {
  if (!colorEnabled) return renderFileLogLine(record);
  const parts = buildConsoleLogLine(record);
  const time = isoTime(record.timestamp);

  const levelColor = LEVEL_COLORS[parts.level] ?? "";
  const scope = parts.step
    ? `${paint(parts.source, sourceColor(parts.source))}${paint(`:${parts.step}`, DIM)}`
    : paint(parts.source, sourceColor(parts.source));

  const [headline = "", ...rest] = parts.messageLines;
  const message =
    parts.level === "error" || parts.level === "warning"
      ? paint(headline, levelColor)
      : parts.level === "debug"
        ? paint(headline, DIM)
        : headline;

  const segments = [
    paint(time, DIM),
    "  ",
    paint(parts.levelLabel, `${BOLD}${levelColor}`),
    "  ",
    scope,
    parts.scopePadding,
    "  ",
    message,
  ];

  if (parts.duration) {
    segments.push("  ", paint(parts.duration, durationColor(record.durationMs ?? 0)));
  }
  if (parts.data) {
    segments.push("  ", paint(parts.data, DIM));
  }

  const lines = [segments.join("")];
  const indent = " ".repeat(time.length + 2 + parts.levelLabel.length + 2);
  for (const line of rest) {
    lines.push(`${indent}${paint(line, DIM)}`);
  }
  return lines.join("\n");
}

/** Writes one record to stdout. */
export function writeConsoleLog(record: ConsoleLogRecord): void {
  console.log(formatConsoleLogLine(record));
}
