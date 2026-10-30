/**
 * One-time settings imports: the old `config` table and `<data>/config.json`.
 * They run on the first config access of a process, so each case runs in a fresh
 * Bun child with HOME and the data dir in a temp folder.
 */
import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../..");

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

interface ChildResult {
  cfg: Record<string, any>;
  rows: Record<string, string>;
  configTable: boolean;
}

function setup(): { home: string; dir: string } {
  const home = mkdtempSync(join(tmpdir(), "portfolio-cfgmig-"));
  const dir = join(home, "data");
  mkdirSync(dir);
  return { home, dir };
}

async function loadInChild(home: string, dir: string): Promise<ChildResult> {
  const code = `
const paths = await import(${JSON.stringify(join(SRC, "paths.ts"))});
paths.setDataDirForTests(${JSON.stringify(dir)});
const { loadConfig } = await import(${JSON.stringify(join(SRC, "config.ts"))});
const { getDatabase } = await import(${JSON.stringify(join(SRC, "db/database.ts"))});
const cfg = loadConfig();
const db = getDatabase();
console.log(JSON.stringify({
  cfg,
  rows: Object.fromEntries(db.query("SELECT key, value FROM settings").all().map(r => [r.key, r.value])),
  configTable: !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='config'").get(),
}));
`;
  const res = await runChild(code, home);
  if (res.code !== 0) throw new Error(`child exited ${res.code}: ${res.err}`);
  return JSON.parse(res.out.trim().split("\n").at(-1)!) as ChildResult;
}

function seedConfigTable(dir: string, entries: [string, string][]): void {
  const db = new Database(join(dir, "portfolio.sqlite"), { create: true });
  db.run("CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT)");
  for (const [k, v] of entries) db.query("INSERT INTO config (key, value) VALUES (?, ?)").run(k, v);
  db.close();
}

describe("legacy config imports", () => {
  it("imports the old config table and drops it", async () => {
    const { home, dir } = setup();
    seedConfigTable(dir, [
      ["baseCurrency", '"USD"'],
      ["llmProvider", '"ollama"'],
      ["llmModel", '"llama3"'],
      ["windowState", '{"x":1}'],
      ["zoomLevel", "1.5"],
      ["bad", "{oops"],
      ["dataProviderRouting", '{"quotes":"yahoo"}'],
    ]);
    const { cfg, rows, configTable } = await loadInChild(home, dir);
    expect(cfg.baseCurrency).toBe("USD");
    expect(cfg.zoomLevel).toBe(1.5);
    expect(cfg.llmProvider).toBe("openai-compatible");
    expect(cfg.llmBaseUrl).toBe("http://127.0.0.1:11434");
    expect(cfg.llmModel).toBe("llama3");
    expect(cfg.dataProviderRouting.quotes).toBe("yahoo");
    expect(cfg.dataProviderRouting.news).toBe("fmp");
    expect(configTable).toBe(false);
    expect("windowState" in rows).toBe(false);
    expect("bad" in rows).toBe(false);
    expect(rows.baseCurrency).toBe("USD");
  });

  it("imports config.json and renames it", async () => {
    const { home, dir } = setup();
    const content = '{"baseCurrency":"GBP","theme":"light","lastImportDirectory":"/x"}';
    writeFileSync(join(dir, "config.json"), content);
    const { cfg, rows } = await loadInChild(home, dir);
    expect(cfg.baseCurrency).toBe("GBP");
    expect(cfg.theme).toBe("light");
    expect(existsSync(join(dir, "config.json"))).toBe(false);
    expect(readFileSync(join(dir, "config.json.migrated"), "utf8")).toBe(content);
    expect("lastImportDirectory" in rows).toBe(false);
  });

  it("ignores config.json when settings already exist but still renames it", async () => {
    const { home, dir } = setup();
    const db = new Database(join(dir, "portfolio.sqlite"), { create: true });
    db.run("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.run("INSERT INTO settings (key, value) VALUES ('baseCurrency', 'CHF')");
    db.close();
    writeFileSync(join(dir, "config.json"), '{"baseCurrency":"GBP"}');
    const { cfg } = await loadInChild(home, dir);
    expect(cfg.baseCurrency).toBe("CHF");
    expect(existsSync(join(dir, "config.json"))).toBe(false);
    expect(existsSync(join(dir, "config.json.migrated"))).toBe(true);
  });

  it("leaves a corrupt config.json in place and uses defaults", async () => {
    const { home, dir } = setup();
    writeFileSync(join(dir, "config.json"), "{nope");
    const { cfg } = await loadInChild(home, dir);
    expect(cfg.baseCurrency).toBe("EUR");
    expect(existsSync(join(dir, "config.json"))).toBe(true);
    expect(existsSync(join(dir, "config.json.migrated"))).toBe(false);
  });

  it("prefers the config table over config.json", async () => {
    const { home, dir } = setup();
    seedConfigTable(dir, [["baseCurrency", '"USD"']]);
    writeFileSync(join(dir, "config.json"), '{"baseCurrency":"GBP"}');
    const { cfg } = await loadInChild(home, dir);
    expect(cfg.baseCurrency).toBe("USD");
    expect(existsSync(join(dir, "config.json"))).toBe(false);
    expect(existsSync(join(dir, "config.json.migrated"))).toBe(true);
  });
});
