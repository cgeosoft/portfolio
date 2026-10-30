import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailyLogWriter, ServiceProcess, dailyLogFileName, logShellEvent, parseServicePort, pruneDailyLogs } from "./service";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portfolio-logs-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseServicePort", () => {
  it("reads the port from the exact line, trailing CR allowed", () => {
    expect(parseServicePort("SERVICE_PORT=5123")).toBe(5123);
    expect(parseServicePort("SERVICE_PORT=5123\r")).toBe(5123);
  });

  it("ignores an indented continuation line or a line with other text", () => {
    expect(parseServicePort("                      SERVICE_PORT=5123")).toBeNull();
    expect(parseServicePort("note: SERVICE_PORT=5123")).toBeNull();
    expect(parseServicePort("2026-09-16T21:34:27.134Z  INFO   http  Listening")).toBeNull();
  });
});

describe("DailyLogWriter", () => {
  it("writes to the day's file and creates it owner-only", () => {
    const dir = tempDir();
    const writer = new DailyLogWriter(dir, "desktop");
    writer.write("one\n");
    writer.write("two\n");
    const file = join(dir, dailyLogFileName("desktop"));
    expect(readFileSync(file, "utf-8")).toBe("one\ntwo\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("caps the file and writes a single capped notice", () => {
    const dir = tempDir();
    const writer = new DailyLogWriter(dir, "service", 20);
    writer.write("0123456789\n"); // 11 bytes, under the cap
    writer.write("this line pushes past the cap\n"); // dropped, replaced by the notice
    writer.write("and this is dropped too\n");
    const text = readFileSync(join(dir, dailyLogFileName("service")), "utf-8");
    expect(text).toContain("0123456789");
    expect(text).not.toContain("pushes past");
    expect(text).not.toContain("dropped too");
    expect((text.match(/log capped for today/g) || []).length).toBe(1);
  });
});

describe("pruneDailyLogs", () => {
  it("removes daily logs older than the retention window and keeps the rest", () => {
    const dir = tempDir();
    const now = new Date("2026-10-13T00:00:00Z");
    const old = join(dir, "service-2026-09-01.log");
    const recent = join(dir, "desktop-2026-10-10.log");
    const other = join(dir, "notes.txt");
    for (const file of [old, recent, other]) writeFileSync(file, "x");
    pruneDailyLogs(dir, 14, now);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it("does nothing for a missing directory", () => {
    expect(() => pruneDailyLogs(join(tempDir(), "nope"))).not.toThrow();
  });

  it("leaves everything when all files are inside the window", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "service-2026-10-12.log"), "x");
    pruneDailyLogs(dir, 14, new Date("2026-10-13T00:00:00Z"));
    expect(readdirSync(dir)).toContain("service-2026-10-12.log");
  });
});

describe("dailyLogFileName", () => {
  it("uses the zero padded local date", () => {
    expect(dailyLogFileName("service", new Date(2026, 0, 5, 10))).toBe("service-2026-01-05.log");
  });
});

describe("DailyLogWriter rotation", () => {
  it("resets the cap on a new day", () => {
    const dir = tempDir();
    try {
      setSystemTime(new Date(2026, 0, 5, 23, 59));
      const writer = new DailyLogWriter(dir, "desktop", 5);
      writer.write("abcdef");
      writer.write("x");
      setSystemTime(new Date(2026, 0, 6, 0, 1));
      writer.write("ab");
    } finally {
      setSystemTime();
    }
    const first = readFileSync(join(dir, "desktop-2026-01-05.log"), "utf-8");
    const lines = first.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(first.endsWith("  WARN   desktop  log capped for today at 5 bytes\n")).toBe(true);
    expect(readFileSync(join(dir, "desktop-2026-01-06.log"), "utf-8")).toBe("ab");
  });

  it("counts the bytes already in the file against the cap", () => {
    const dir = tempDir();
    const file = join(dir, dailyLogFileName("service"));
    const existing = "fifteen bytes!\n";
    expect(existing.length).toBe(15);
    writeFileSync(file, existing);
    new DailyLogWriter(dir, "service", 20).write("0123456789");
    const text = readFileSync(file, "utf-8");
    expect(text.startsWith(existing)).toBe(true);
    expect(text).toContain("log capped for today at 20 bytes");
    expect(text).not.toContain("0123456789");
  });

  it("never throws for an unwritable directory", () => {
    expect(() => new DailyLogWriter("/proc/forbidden-dir", "x").write("a")).not.toThrow();
  });
});

describe("logShellEvent", () => {
  it("appends an INFO line to the desktop log", () => {
    const dir = tempDir();
    logShellEvent(dir, "hello", false);
    const text = readFileSync(join(dir, dailyLogFileName("desktop")), "utf-8");
    expect(text).toMatch(/^\S+  INFO   desktop  hello\n$/);
  });

  it("echoes to stdout when asked", () => {
    const dir = tempDir();
    const written: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      logShellEvent(dir, "hello", true);
    } finally {
      process.stdout.write = original;
    }
    expect(written.join("")).toContain("[desktop] hello\n");
  });
});

describe("ServiceProcess", () => {
  const SCRIPT_A =
    'console.log("\\x1b[32mhello\\x1b[0m"); console.log("SERVICE_PORT=4321"); console.log("SERVICE_PORT=4322"); console.error("oops");';
  const SCRIPT_B =
    'const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => new URL(r.url).pathname === "/api/health" ? new Response("ok") : new Response("no", { status: 404 }) }); console.log("SERVICE_PORT=" + s.port); process.stdin.on("data", (d) => { if (String(d).includes("quit")) process.exit(3); });';

  function service(script: string, singlePort?: boolean): { sp: ServiceProcess; logDir: string } {
    const logDir = tempDir();
    const sp = new ServiceProcess({ command: [process.execPath, "-e", script], cwd: logDir, logDir, echo: false, singlePort });
    return { sp, logDir };
  }

  it("follows every port line", async () => {
    const { sp } = service(SCRIPT_A);
    const ports: number[] = [];
    sp.onPort((port) => ports.push(port));
    const code = await new Promise<number | null>((r) => sp.start(r));
    await Bun.sleep(50);
    expect(ports).toEqual([4321, 4322]);
    expect(sp.port).toBe(4322);
    expect(code).toBe(0);
    expect(sp.exited).toBe(true);
    expect(sp.exitCode).toBe(0);
  }, 10_000);

  it("keeps the first port with singlePort", async () => {
    const { sp } = service(SCRIPT_A, true);
    const ports: number[] = [];
    sp.onPort((port) => ports.push(port));
    await new Promise((r) => sp.start(r));
    await Bun.sleep(50);
    expect(ports).toEqual([4321]);
    expect(sp.port).toBe(4321);
  }, 10_000);

  it("strips escape codes from the tail and the log file", async () => {
    const { sp, logDir } = service(SCRIPT_A);
    await new Promise((r) => sp.start(r));
    await Bun.sleep(50);
    const tail = sp.tail();
    expect(tail).toContain("hello");
    expect(tail).toContain("SERVICE_PORT=4321");
    expect(tail).toContain("oops");
    expect(tail).not.toContain("\x1b");
    expect(sp.serviceLogFile.startsWith(logDir)).toBe(true);
    const logText = readFileSync(sp.serviceLogFile, "utf-8");
    expect(logText).toContain("hello\n");
    expect(logText).not.toContain("\x1b");
    const desktop = readFileSync(join(logDir, dailyLogFileName("desktop")), "utf-8");
    expect(desktop.split("\n").some((line) => line.endsWith("service exited with code 0"))).toBe(true);
  }, 10_000);

  it("is not ready after the child exited", async () => {
    const { sp } = service(SCRIPT_A);
    await new Promise((r) => sp.start(r));
    await Bun.sleep(50);
    expect(await sp.waitUntilReady(1000)).toBe(false);
  }, 10_000);

  it("answers the health check and exits on a stdin command", async () => {
    const { sp } = service(SCRIPT_B);
    const codes: (number | null)[] = [];
    sp.start((code) => codes.push(code));
    try {
      expect(await sp.waitUntilReady(5000)).toBe(true);
      sp.send("quit");
      await Bun.sleep(300);
      expect(codes).toEqual([3]);
      expect(sp.exited).toBe(true);
      expect(() => sp.send("x")).not.toThrow();
      expect(() => sp.stop()).not.toThrow();
    } finally {
      if (!sp.exited) sp.stop();
    }
  }, 10_000);

  it("is not ready without a port line and stop ends the child", async () => {
    const { sp } = service("setTimeout(() => {}, 10000)");
    const codes: (number | null)[] = [];
    sp.start((code) => codes.push(code));
    const started = Date.now();
    expect(await sp.waitUntilReady(600)).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    sp.stop();
    for (let i = 0; i < 50 && !sp.exited; i++) await Bun.sleep(20);
    expect(sp.exited).toBe(true);
    expect(codes).toHaveLength(1);
    expect(codes[0]).not.toBe(0);
  }, 10_000);

  it("returns only the last line from tail(1)", async () => {
    // One write of three lines arrives as one chunk; tail counts lines, not chunks.
    const { sp } = service('process.stdout.write("one\\ntwo\\nthree\\n");');
    await new Promise((r) => sp.start(r));
    await Bun.sleep(50);
    expect(sp.tail(1).split("\n").filter(Boolean)).toEqual(["three"]);
  }, 10_000);
});
