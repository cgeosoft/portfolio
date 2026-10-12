import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailyLogWriter, dailyLogFileName, parseServicePort, pruneDailyLogs } from "./service";

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
