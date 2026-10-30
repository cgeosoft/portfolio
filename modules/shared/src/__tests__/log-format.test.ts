/** Log line helpers not covered by the service tests: times, duration edges, data kinds, file lines and daily file names. */
import { describe, expect, it } from "bun:test";
import {
  CONTINUATION_INDENT,
  DAILY_LOG_FILE_PATTERN,
  FILE_LOG_LINE_PATTERN,
  buildConsoleLogLine,
  dailyLogFileName,
  formatDuration,
  formatLogData,
  formatLogDate,
  formatLogTime,
  renderFileLogLine,
  renderPlainLogLine,
  type ConsoleLogRecord,
} from "../log-format";

describe("formatLogTime", () => {
  it("prints local time with milliseconds", () => {
    expect(formatLogTime(new Date(2026, 0, 2, 13, 4, 5, 7))).toBe("13:04:05.007");
  });

  it("prints 12 spaces for an invalid input", () => {
    expect(formatLogTime("nope")).toBe(" ".repeat(12));
  });

  it("accepts an ISO string", () => {
    expect(formatLogTime(new Date(2026, 0, 2, 1, 2, 3, 4).toISOString())).toBe("01:02:03.004");
  });
});

describe("formatDuration boundaries", () => {
  it("prints nothing for negative and infinite values", () => {
    expect(formatDuration(-1)).toBe("");
    expect(formatDuration(Infinity)).toBe("");
  });

  it("switches units at the boundaries", () => {
    expect(formatDuration(0.4)).toBe("0ms");
    expect(formatDuration(10_000)).toBe("10.0s");
    expect(formatDuration(60_000)).toBe("1m00s");
    expect(formatDuration(3_600_000)).toBe("60m00s");
  });

  it("carries rounded seconds into the minute", () => {
    expect(formatDuration(119_500)).toBe("2m00s");
  });

  it("switches unit when rounding reaches the next one", () => {
    expect(formatDuration(59_999)).toBe("1m00s");
    expect(formatDuration(999.6)).toBe("1.00s");
  });
});

describe("formatLogData value kinds", () => {
  it("prints nothing without data", () => {
    expect(formatLogData(undefined)).toBe("");
    expect(formatLogData({})).toBe("");
    expect(formatLogData({ a: undefined })).toBe("");
  });

  it("renders every value kind", () => {
    expect(
      formatLogData({ n: null, e: "", q: 'a"b', eq: "a=b", arr: [1, "x y", null], err: new Error("boom"), obj: { x: 1 }, big: 10n }),
    ).toBe('n=null e="" q="a\\"b" eq="a=b" arr=[1, "x y", null] err=boom obj={"x":1} big=10');
  });

  it("marks a circular object as unserializable", () => {
    const c: any = {};
    c.self = c;
    expect(formatLogData({ c })).toBe("c=[unserializable]");
  });

  it("truncates values above 72 characters", () => {
    expect(formatLogData({ s: "x".repeat(72) })).toHaveLength(74);
    expect(formatLogData({ s: "x".repeat(73) })).toBe("s=" + "x".repeat(71) + "…");
  });

  it("prints 8 keys in full and counts the rest", () => {
    expect(formatLogData({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 })).toBe("a=1 b=2 c=3 d=4 e=5 f=6 g=7 h=8");
    expect(formatLogData({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 })).toBe(
      "a=1 b=2 c=3 d=4 e=5 f=6 g=7 h=8 +1 more",
    );
  });
});

describe("buildConsoleLogLine extras", () => {
  it("fills defaults for an empty record", () => {
    const p = buildConsoleLogLine({ level: "debug", source: "", message: "" });
    expect(p.source).toBe("app");
    expect(p.step).toBe("");
    expect(p.scopePadding).toHaveLength(23);
    expect(p.messageLines).toEqual([""]);
    expect(p.duration).toBe("");
    expect(p.data).toBe("");
    expect(p.levelLabel).toBe("DEBUG");
  });

  it("upper-cases an unknown level", () => {
    expect(buildConsoleLogLine({ level: "trace" as any, source: "x", message: "m" }).levelLabel).toBe("TRACE");
  });

  it("drops the padding for a long scope", () => {
    const p = buildConsoleLogLine({ level: "info", source: "averyveryverylongsource", step: "andalongstepname", message: "m" });
    expect(p.scopePadding).toBe("");
  });

  it("strips only a trailing ms duration from the message", () => {
    const lines = (r: Omit<ConsoleLogRecord, "level" | "source">) =>
      buildConsoleLogLine({ level: "info", source: "a", ...r }).messageLines;
    expect(lines({ message: "Done (in 12ms).", durationMs: 12 })).toEqual(["Done"]);
    expect(lines({ message: "Loaded in 12ms", durationMs: 99 })).toEqual(["Loaded"]);
    expect(lines({ message: "Took 3s", durationMs: 3000 })).toEqual(["Took 3s"]);
    expect(lines({ message: "after 1.5ms", durationMs: 1 })).toEqual(["after 1.5ms"]);
  });
});

describe("renderPlainLogLine", () => {
  it("renders a line with data and no step", () => {
    const line = renderPlainLogLine(
      buildConsoleLogLine({ timestamp: new Date(2026, 0, 2, 3, 4, 5, 60), level: "info", source: "main", message: "hi", data: { a: 1 } }),
    );
    expect(line).toBe("03:04:05.060  INFO   main" + " ".repeat(24) + "hi  a=1");
  });

  it("indents continuation lines by 21 spaces", () => {
    expect(CONTINUATION_INDENT).toBe(" ".repeat(21));
  });
});

describe("renderFileLogLine", () => {
  it("renders the ISO time, step, duration, data and continuation lines", () => {
    const line = renderFileLogLine({
      timestamp: "2026-01-02T03:04:05.060Z",
      level: "warning",
      source: "db",
      step: "x",
      message: "one\ntwo",
      durationMs: 1500,
      data: { k: "v" },
    });
    expect(line).toBe("2026-01-02T03:04:05.060Z  WARN   db:x                        one  1.50s  k=v\n" + " ".repeat(33) + "two");
  });

  it("matches FILE_LOG_LINE_PATTERN and captures the time", () => {
    const line = renderFileLogLine({ timestamp: "2026-01-02T03:04:05.060Z", level: "info", source: "a", message: "m" });
    expect(FILE_LOG_LINE_PATTERN.exec(line)?.[1]).toBe("2026-01-02T03:04:05.060Z");
  });

  it("falls back to now for an invalid timestamp", () => {
    const line = renderFileLogLine({ timestamp: "garbage", level: "info", source: "a", message: "m" });
    expect(FILE_LOG_LINE_PATTERN.test(line)).toBe(true);
  });
});

describe("daily log files", () => {
  it("formats the local date", () => {
    expect(formatLogDate(new Date(2026, 8, 7, 23, 59))).toBe("2026-09-07");
  });

  it("names the daily file", () => {
    expect(dailyLogFileName("service", new Date(2026, 8, 17))).toBe("service-2026-09-17.log");
  });

  it("captures base and date", () => {
    const m = DAILY_LOG_FILE_PATTERN.exec("service-2026-09-17.log");
    expect(m?.[1]).toBe("service");
    expect(m?.[2]).toBe("2026-09-17");
  });

  it("rejects other names", () => {
    expect(DAILY_LOG_FILE_PATTERN.test("Service-2026-09-17.log")).toBe(false);
    expect(DAILY_LOG_FILE_PATTERN.test("service-2026-9-17.log")).toBe(false);
    expect(DAILY_LOG_FILE_PATTERN.test("service-2026-09-17.log.1")).toBe(false);
  });

  it("matches its own file names", () => {
    expect(DAILY_LOG_FILE_PATTERN.test(dailyLogFileName("desktop", new Date(2026, 0, 31)))).toBe(true);
  });
});
