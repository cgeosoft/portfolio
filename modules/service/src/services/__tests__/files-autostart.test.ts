/**
 * Saving to Downloads, reveal path checks and the Linux autostart entry.
 * These write under the home directory, so they run in a Bun child with HOME
 * set to a temp folder.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../..");
const linuxOnly = process.platform !== "linux";

/** Runs `code` (an ES module body, top-level await allowed) in a fresh Bun process. */
async function runChild(code: string, home: string): Promise<{ out: string; err: string; code: number }> {
  const proc = Bun.spawn([process.execPath, "-e", code], {
    cwd: home,
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code: exit };
}

async function runJson(code: string, home: string): Promise<any> {
  const res = await runChild(code, home);
  if (res.code !== 0) throw new Error(`child exited ${res.code}: ${res.err}`);
  return JSON.parse(res.out.trim().split("\n").at(-1)!);
}

const FILES = JSON.stringify(join(SRC, "services/files.ts"));
const CONFIG = JSON.stringify(join(SRC, "config.ts"));

const MAIN_CHILD = `
const f = await import(${FILES});
const { syncAutostart } = await import(${CONFIG});
const os = await import("node:os");
const dl = os.homedir() + "/Downloads";
const out = {};
out.a = f.saveToDownloads("a/b:c?.md", "hello");
out.b = f.saveToDownloads("a/b:c?.md", undefined, Buffer.from("xyz").toString("base64"));
out.c = f.saveToDownloads("   ", "x");
out.d = f.saveBytesToDownloads(".hidden", new Uint8Array([1, 2]));
out.e = f.saveBytesToDownloads(".hidden", new Uint8Array([3]));
out.r1 = f.revealInFileManager("/etc/passwd");
out.r2 = f.revealInFileManager(dl + "/nope.txt");
out.r3 = f.revealInFileManager(dl + "/../secret.txt");
out.r4 = f.revealInFileManager(os.homedir() + "/Downloads-evil/x.txt");
${process.platform === "linux" ? "syncAutostart(true);" : ""}
console.log(JSON.stringify(out));
`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let home: string;
let D: string;
let out: Record<string, any>;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "portfolio-files-"));
  D = join(home, "Downloads");
  out = await runJson(MAIN_CHILD, home);
});

describe("saveToDownloads", () => {
  it("keeps the base name and replaces unsafe characters", () => {
    expect(out.a).toBe(join(D, "b_c_.md"));
    expect(readFileSync(out.a, "utf8")).toBe("hello");
    if (process.platform !== "win32") expect(statSync(out.a).mode & 0o777).toBe(0o600);
  });

  it("adds a timestamp when the name is taken and decodes base64", () => {
    expect(out.b).toMatch(new RegExp(`^${escape(D)}/b_c_-\\d+\\.md$`));
    expect(readFileSync(out.b, "utf8")).toBe("xyz");
  });

  it("falls back to a default name for a blank name", () => {
    expect(out.c).toBe(join(D, "portfolio-file"));
    expect(readFileSync(out.c, "utf8")).toBe("x");
  });

  it("does not treat a leading dot as an extension", () => {
    expect(out.d).toBe(join(D, ".hidden"));
    expect([...readFileSync(out.d)]).toEqual([1, 2]);
    expect(out.e).toMatch(new RegExp(`^${escape(D)}/\\.hidden-\\d+$`));
  });
});

describe("revealInFileManager", () => {
  it("refuses paths outside Downloads", () => {
    const refused = { success: false, error: "Only files in the Downloads folder can be revealed" };
    expect(out.r1).toEqual(refused);
    expect(out.r3).toEqual(refused);
    expect(out.r4).toEqual(refused);
  });

  it("reports a missing file", () => {
    expect(out.r2).toEqual({ success: false, error: "Target path does not exist" });
  });
});

describe("syncAutostart", () => {
  const entry = () => join(home, ".config", "autostart", "portfolio.desktop");

  it.skipIf(linuxOnly)("writes the autostart entry", () => {
    expect(readFileSync(entry(), "utf8")).toBe(
      "[Desktop Entry]\nType=Application\nName=Portfolio\nComment=Personal Investment Tracker\nExec=portfolio\nIcon=portfolio\nTerminal=false\nCategories=Finance;Office;\nX-GNOME-Autostart-enabled=true\n",
    );
  });

  it.skipIf(linuxOnly)("removes the entry and tolerates a missing file", async () => {
    const off = `const { syncAutostart } = await import(${CONFIG}); syncAutostart(false); console.log(JSON.stringify({ ok: true }));`;
    expect(await runJson(off, home)).toEqual({ ok: true });
    expect(existsSync(entry())).toBe(false);
    expect(await runJson(off, home)).toEqual({ ok: true });
    expect(existsSync(entry())).toBe(false);
  });
});
