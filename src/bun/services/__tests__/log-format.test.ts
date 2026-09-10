import { describe, expect, it } from "bun:test";
import {
  buildConsoleLogLine,
  formatDuration,
  formatLogData,
  renderPlainLogLine,
} from "../../../shared/log-format.js";
import { formatConsoleLogLine, setConsoleColorEnabled } from "../../log-console.js";

describe("formatDuration", () => {
  it("keeps sub-second timings in milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(4)).toBe("4ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("switches to seconds and minutes for slow operations", () => {
    expect(formatDuration(1500)).toBe("1.50s");
    expect(formatDuration(42_000)).toBe("42.0s");
    expect(formatDuration(64_000)).toBe("1m04s");
  });

  it("returns an empty string when there is no duration", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
  });
});

describe("formatLogData", () => {
  it("renders key=value pairs instead of raw JSON", () => {
    expect(formatLogData({ count: 3, cached: true, name: "CGIP" })).toBe("count=3 cached=true name=CGIP");
  });

  it("quotes values that contain whitespace and skips undefined", () => {
    expect(formatLogData({ note: "two words", missing: undefined })).toBe('note="two words"');
  });

  it("truncates long values and caps the number of keys", () => {
    const long = formatLogData({ path: "x".repeat(200) });
    expect(long.length).toBeLessThan(90);
    expect(long.endsWith("…")).toBe(true);

    const many: Record<string, number> = {};
    for (let i = 0; i < 12; i++) many[`k${i}`] = i;
    expect(formatLogData(many)).toContain("+4 more");
  });
});

describe("buildConsoleLogLine", () => {
  it("aligns columns and separates the duration from the message", () => {
    const line = renderPlainLogLine(
      buildConsoleLogLine({
        timestamp: new Date(2026, 0, 2, 3, 4, 5, 60),
        level: "success",
        source: "db",
        step: "init_database",
        message: "Database initialized",
        durationMs: 4,
      }),
    );
    expect(line).toBe("03:04:05.060  OK     db:init_database            Database initialized  4ms");
  });

  it("drops a duration the caller already wrote into the message", () => {
    const parts = buildConsoleLogLine({
      level: "info",
      source: "rpc",
      step: "getPortfolios",
      message: "Returned 1 portfolio(s) in 12ms",
      durationMs: 12,
    });
    expect(parts.messageLines[0]).toBe("Returned 1 portfolio(s)");
    expect(parts.duration).toBe("12ms");
  });

  it("keeps the message intact when no duration is recorded", () => {
    const parts = buildConsoleLogLine({
      level: "info",
      source: "main",
      message: "Synced in 12ms",
    });
    expect(parts.messageLines[0]).toBe("Synced in 12ms");
  });

  it("indents continuation lines of multi-line messages", () => {
    const line = renderPlainLogLine(
      buildConsoleLogLine({ level: "error", source: "llm", message: "failed\nstack frame" }),
    );
    expect(line.split("\n")[1]).toBe(`${" ".repeat(21)}stack frame`);
  });
});

describe("formatConsoleLogLine", () => {
  it("omits ANSI escapes when colour is disabled", () => {
    setConsoleColorEnabled(false);
    const line = formatConsoleLogLine({ level: "warning", source: "yahoo", step: "get_quote", message: "slow" });
    expect(line).not.toContain("\x1b[");
    expect(line).toContain("WARN   yahoo:get_quote");
  });

  it("colours the level and dims the metadata when colour is enabled", () => {
    setConsoleColorEnabled(true);
    const line = formatConsoleLogLine({
      level: "error",
      source: "rpc",
      step: "getPortfolioData",
      message: "boom",
      durationMs: 3000,
      data: { portfolioId: "abc" },
    });
    expect(line).toContain("\x1b[1m\x1b[31mERROR");
    expect(line).toContain("portfolioId=abc");
    expect(line.endsWith("\x1b[0m")).toBe(true);
    setConsoleColorEnabled(false);
  });
});
