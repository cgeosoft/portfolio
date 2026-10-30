/**
 * Service logger: debug gating, plain line layout, timers, GUI client events
 * (sanitized before logging) and the console colour helpers.
 */
import { describe, it, expect, spyOn, afterEach } from "bun:test";
import { AppLogger, appLogger, logClientEvent, LOG_FILE_BASE } from "../../logger";
import { formatConsoleLogLine, setConsoleColorEnabled, isConsoleColorEnabled } from "../../log-console";
import { formatDuration } from "portfolio-shared/log-format";

const colour = isConsoleColorEnabled();
const spies: { mockRestore: () => void }[] = [];
function track<T extends { mockRestore: () => void }>(spy: T): T {
  spies.push(spy);
  return spy;
}

afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
  setConsoleColorEnabled(colour);
});

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("AppLogger", () => {
  it("uses service as the log file base", () => {
    expect(LOG_FILE_BASE).toBe("service");
  });

  it("prints debug lines only when debug is on", () => {
    const l = new AppLogger();
    l.setDebug(false);
    const spy = track(spyOn(console, "log").mockImplementation(() => {}));
    const entry = l.log("debug", "x");
    expect(entry.type).toBe("debug");
    expect(entry.message).toBe("x");
    expect(entry.timestamp).toMatch(ISO);
    expect(spy).not.toHaveBeenCalled();
    l.setDebug(true);
    l.log("debug", "x");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("prints a plain line without colour", () => {
    setConsoleColorEnabled(false);
    const l = new AppLogger();
    const spy = track(spyOn(console, "log").mockImplementation(() => {}));
    l.log("info", "hello");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z  INFO   main {22}  hello$/);
  });

  it("never throws when the console fails", () => {
    const l = new AppLogger();
    track(
      spyOn(console, "log").mockImplementation(() => {
        throw new Error("x");
      }),
    );
    expect(() => l.log("error", "y")).not.toThrow();
  });

  it("logs timer start, end and failure", () => {
    const l = new AppLogger();
    const s = track(spyOn(l, "logStep").mockImplementation(() => {}));
    const t = l.startTimer("src", "step", "Starting");
    expect(s.mock.calls[0]).toEqual(["info", "src", "step:start", "Starting"]);
    const ms = t.end();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(s.mock.calls[1]).toEqual(["info", "src", "step", "completed", ms, undefined]);
    const failMs = t.fail(new Error("boom"), "failed", { k: 1 });
    expect(typeof failMs).toBe("number");
    expect(s.mock.calls[2]).toEqual(["error", "src", "step", "failed: boom", failMs, { k: 1, error: "boom" }]);
    t.fail("str");
    expect(s.mock.calls[3][3]).toBe("failed: str");

    s.mockClear();
    l.startTimer("src", "quiet");
    expect(s).not.toHaveBeenCalled();
  });
});

describe("logClientEvent", () => {
  function logged(entry: Record<string, unknown>): unknown[] {
    const spy = track(spyOn(appLogger, "logStep").mockImplementation(() => {}));
    logClientEvent(entry);
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0] as unknown[];
    spy.mockRestore();
    return args;
  }

  it("falls back to info, gui and client_event", () => {
    expect(logged({ level: "bogus", message: "hi" })).toEqual(["info", "gui", "client_event", "hi", undefined, undefined]);
  });

  it("flattens control characters in source and step", () => {
    const args = logged({ level: "error", source: "a\nb", step: "x\ty", message: "m" });
    expect(args[0]).toBe("error");
    expect(args[1]).toBe("a b");
    expect(args[2]).toBe("x y");
  });

  it("replaces blank or non-string source and step", () => {
    expect(logged({ source: "   " })[1]).toBe("gui");
    expect(logged({ source: 123 })[1]).toBe("gui");
    expect(logged({ step: "" })[2]).toBe("client_event");
  });

  it("cuts long source and step to 60 characters", () => {
    const args = logged({ source: "s".repeat(100), step: "t".repeat(100) });
    expect((args[1] as string).length).toBe(60);
    expect((args[2] as string).length).toBe(60);
  });

  it("strips escape and delete characters from the message", () => {
    expect(logged({ message: "a\x1b[31mb\nc\td\x7f" })[3]).toBe("a[31mb\nc\td");
  });

  it("limits and stringifies the message", () => {
    expect((logged({ message: "m".repeat(5000) })[3] as string).length).toBe(4000);
    expect(logged({ message: undefined })[3]).toBe("");
    expect(logged({ message: 42 })[3]).toBe("42");
  });

  it("accepts only numeric durations", () => {
    expect(logged({ durationMs: "12" })[4]).toBeUndefined();
    expect(logged({ durationMs: 12 })[4]).toBe(12);
  });

  it("sanitizes the data object", () => {
    expect(logged({ data: [1, 2] })[5]).toBeUndefined();
    expect(logged({ data: null })[5]).toBeUndefined();
    const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    expect(logged({ data: ten })[5]).toEqual(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, i])));
    expect(logged({ data: { "k\ney": 1 } })[5]).toEqual({ "k ey": 1 });
    expect(logged({ data: { "": 1 } })[5]).toEqual({ key: 1 });
    const value = { nested: [1, 2] };
    expect(logged({ data: { ["x".repeat(50)]: value } })[5]).toEqual({ ["x".repeat(40)]: value });
  });
});

describe("console colour helpers", () => {
  it("colours durations by speed", () => {
    setConsoleColorEnabled(true);
    expect(isConsoleColorEnabled()).toBe(true);
    expect(formatConsoleLogLine({ level: "info", source: "s", message: "m", durationMs: 800 } as any)).toContain("\x1b[33m" + formatDuration(800));
    expect(formatConsoleLogLine({ level: "info", source: "s", message: "m", durationMs: 3000 } as any)).toContain("\x1b[31m" + formatDuration(3000));
    expect(formatConsoleLogLine({ level: "info", source: "s", message: "m", durationMs: 5 } as any)).toContain("\x1b[2m" + formatDuration(5));
  });

  it("dims debug headlines only", () => {
    setConsoleColorEnabled(true);
    expect(formatConsoleLogLine({ level: "debug", source: "s", message: "m" } as any)).toContain("\x1b[2mm\x1b[0m");
    expect(formatConsoleLogLine({ level: "info", source: "s", message: "m" } as any)).toContain("  m");
  });

  it("indents and dims continuation lines", () => {
    setConsoleColorEnabled(true);
    const line = formatConsoleLogLine({ level: "error", source: "s", message: "one\ntwo" } as any);
    expect(line.split("\n")[1]).toBe(" ".repeat(33) + "\x1b[2mtwo\x1b[0m");
  });

  it("replaces an invalid timestamp with a valid one", () => {
    setConsoleColorEnabled(true);
    const line = formatConsoleLogLine({ level: "info", source: "s", message: "m", timestamp: "not a date" } as any);
    expect(line.startsWith("\x1b[2m")).toBe(true);
    expect(line.slice(4, 28)).toMatch(ISO);
    expect(line).not.toContain("Invalid");
  });
});
