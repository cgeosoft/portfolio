/**
 * Terminal rendering for `appLogger`. Adds colour and column alignment on top
 * of the shared layout in `src/shared/log-format.ts`.
 */

import {
  buildConsoleLogLine,
  renderPlainLogLine,
  CONTINUATION_INDENT,
  type ConsoleLogLevel,
  type ConsoleLogRecord,
} from "../shared/log-format.js";
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

function detectColorSupport(): boolean {
  const env = process.env;
  if (env["NO_COLOR"]) return false;
  const forced = env["FORCE_COLOR"];
  if (forced !== undefined) return forced !== "0" && forced !== "false";
  if (env["TERM"] === "dumb") return false;
  if (process.stdout?.isTTY) return true;
  // In dev the launcher pipes the main process stdout, so `isTTY` is false even
  // though a developer is watching a real terminal.
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

/** Formats one record as a single (possibly multi-line) terminal string. */
export function formatConsoleLogLine(record: ConsoleLogRecord): string {
  const parts = buildConsoleLogLine(record);
  if (!colorEnabled) return renderPlainLogLine(parts);

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
    paint(parts.time, DIM),
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
  for (const line of rest) {
    lines.push(`${CONTINUATION_INDENT}${paint(line, DIM)}`);
  }
  return lines.join("\n");
}

/** Writes one record to the terminal. */
export function writeConsoleLog(record: ConsoleLogRecord): void {
  console.log(formatConsoleLogLine(record));
}
