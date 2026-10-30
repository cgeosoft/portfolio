/**
 * Data directory creation and the one-time import of the old Linux data dir
 * (`~/.config/portfolio`). Runs in a Bun child with HOME set to a temp folder.
 */
import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

const CHILD = `
const { ensureDataDir } = await import(${JSON.stringify(join(SRC, "bootstrap.ts"))});
const { DATA_DIR } = await import(${JSON.stringify(join(SRC, "paths.ts"))});
const first = ensureDataDir();
const second = ensureDataDir();
console.log(JSON.stringify({ first: first ?? null, second: second ?? null, dataDir: DATA_DIR }));
`;

async function bootstrap(home: string): Promise<{ first: string | null; second: string | null; dataDir: string }> {
  const res = await runChild(CHILD, home);
  if (res.code !== 0) throw new Error(`child exited ${res.code}: ${res.err}`);
  return JSON.parse(res.out.trim().split("\n").at(-1)!);
}

function setup() {
  const home = mkdtempSync(join(tmpdir(), "portfolio-boot-"));
  return { home, legacy: join(home, ".config", "portfolio"), data: join(home, ".local", "share", "portfolio") };
}

function seedLegacy(legacy: string): void {
  mkdirSync(join(legacy, "data"), { recursive: true });
  const db = new Database(join(legacy, "data", "portfolio.sqlite"), { create: true });
  db.run("PRAGMA journal_mode=WAL");
  db.run("CREATE TABLE portfolios(id TEXT PRIMARY KEY, name TEXT)");
  db.run("INSERT INTO portfolios (id, name) VALUES ('p1', 'Old')");
  db.close();
  mkdirSync(join(legacy, "extra"), { recursive: true });
  writeFileSync(join(legacy, "extra", "f.txt"), "hi");
  writeFileSync(join(legacy, "extra", "a.sqlite-wal"), "x");
  writeFileSync(join(legacy, "notes.txt"), "old");
}

describe("ensureDataDir", () => {
  it.skipIf(linuxOnly)("creates a private data dir when there is nothing to import", async () => {
    const { home, data } = setup();
    const res = await bootstrap(home);
    expect(res).toEqual({ first: null, second: null, dataDir: data });
    expect(existsSync(data)).toBe(true);
    expect(statSync(data).mode & 0o777).toBe(0o700);
  });

  it.skipIf(linuxOnly)("tightens an existing data dir to 0700", async () => {
    const { home, data } = setup();
    mkdirSync(data, { recursive: true, mode: 0o755 });
    chmodSync(data, 0o755);
    await bootstrap(home);
    expect(statSync(data).mode & 0o777).toBe(0o700);
  });

  it.skipIf(linuxOnly)("imports the legacy dir once and leaves it in place", async () => {
    const { home, legacy, data } = setup();
    seedLegacy(legacy);
    const res = await bootstrap(home);
    expect(res.first).toBe(legacy);
    expect(res.second).toBeNull();
    expect(existsSync(join(data, "portfolio.sqlite"))).toBe(true);
    const db = new Database(join(data, "portfolio.sqlite"), { readonly: true });
    expect((db.query("SELECT name FROM portfolios WHERE id='p1'").get() as { name: string }).name).toBe("Old");
    db.close();
    expect(readFileSync(join(data, "extra", "f.txt"), "utf8")).toBe("hi");
    expect(existsSync(join(data, "extra", "a.sqlite-wal"))).toBe(false);
    expect(readFileSync(join(data, "notes.txt"), "utf8")).toBe("old");
    expect(existsSync(join(data, "data"))).toBe(false);
    expect(existsSync(join(legacy, "data", "portfolio.sqlite"))).toBe(true);
  });

  it.skipIf(linuxOnly)("skips the import when the new database exists", async () => {
    const { home, legacy, data } = setup();
    seedLegacy(legacy);
    mkdirSync(data, { recursive: true });
    new Database(join(data, "portfolio.sqlite"), { create: true }).close();
    const res = await bootstrap(home);
    expect(res.first).toBeNull();
    expect(existsSync(join(data, "notes.txt"))).toBe(false);
  });

  it.skipIf(linuxOnly)("does not overwrite an existing entry in the data dir", async () => {
    const { home, legacy, data } = setup();
    seedLegacy(legacy);
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "notes.txt"), "new");
    const res = await bootstrap(home);
    expect(res.first).toBe(legacy);
    expect(readFileSync(join(data, "notes.txt"), "utf8")).toBe("new");
    expect(existsSync(join(data, "portfolio.sqlite"))).toBe(true);
  });

  it.skipIf(linuxOnly)("ignores a legacy dir without a database", async () => {
    const { home, legacy, data } = setup();
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "notes.txt"), "old");
    const res = await bootstrap(home);
    expect(res.first).toBeNull();
    expect(existsSync(join(data, "notes.txt"))).toBe(false);
  });
});
