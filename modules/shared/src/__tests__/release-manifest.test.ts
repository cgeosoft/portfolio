/** scripts/write-release-manifest.ts run as a subprocess against a temporary artifacts folder. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../../../../scripts/write-release-manifest.ts");

function run(args: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...args]);
  return { code: r.exitCode, out: new TextDecoder().decode(r.stdout) };
}

let dir = "";
let art = "";
let changelog = "";
let n = 0;

/** Runs the script into a fresh output folder and returns the exit code, stdout and parsed latest.json. */
function manifest(args: string[]) {
  const out = join(dir, `out-${n++}`);
  mkdirSync(out);
  const r = run([...args, `--dir=${out}`]);
  return { ...r, json: JSON.parse(readFileSync(join(out, "latest.json"), "utf8")) };
}

const baseArgs = () => ["--app=portfolio", "--name=Portfolio", "--version=1.2.3", "--site=https://example.test/", `--artifacts=${art}`];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "wrm-"));
  art = join(dir, "art");
  mkdirSync(art);
  writeFileSync(join(art, "Portfolio_1.2.3_amd64.deb"), "abc");
  writeFileSync(join(art, "Portfolio_1.2.3_x64_setup.exe"), "hello");
  writeFileSync(join(art, "notes.txt"), "x");
  changelog = join(dir, "CHANGELOG.md");
  writeFileSync(
    changelog,
    "# Changelog\n\n## [1.2.30] - 2026-02-01\n\n- wrong\n\n## [1.2.3] - 2026-01-01\n\n### Added\n- Thing one\n\n## [1.2.2] - 2025-12-01\n\n- old\n",
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("write-release-manifest", () => {
  it("writes site URLs, sizes and hashes", () => {
    const r = manifest(baseArgs());
    expect(r.code).toBe(0);
    expect(r.out).toContain("(3 files)");
    const m = r.json;
    expect(m.name).toBe("Portfolio 1.2.3");
    expect(m.version).toBe("1.2.3");
    expect(m.url).toBe("https://example.test/#downloads");
    expect(Number.isFinite(Date.parse(m.publishedAt))).toBe(true);
    expect(m.notes).toBe("");
    expect(m.files.linux.installer).toEqual({
      name: "Portfolio_1.2.3_amd64.deb",
      url: "https://example.test/releases/1.2.3/Portfolio_1.2.3_amd64.deb",
      size: 3,
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect(m.files.windows.installer.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(m.files.windows.installer.size).toBe(5);
    expect(m.files.linux.portable).toBeUndefined();
    expect(m.files.windows.portable).toBeUndefined();
    expect(m.files.macos).toEqual({});
  });

  it("prefers GitHub download URLs", () => {
    const m = manifest([...baseArgs(), "--github=https://github.com/o/r/"]).json;
    expect(m.files.linux.installer.url).toBe("https://github.com/o/r/releases/download/v1.2.3/Portfolio_1.2.3_amd64.deb");
  });

  it("defaults the name to the app", () => {
    const args = baseArgs().filter((a) => !a.startsWith("--name="));
    expect(manifest(args).json.name).toBe("portfolio 1.2.3");
  });

  it("takes notes from the exact changelog version", () => {
    expect(manifest([...baseArgs(), `--changelog=${changelog}`]).json.notes).toBe("### Added\n- Thing one");
    const last = baseArgs().map((a) => (a.startsWith("--version=") ? "--version=1.2.2" : a));
    expect(manifest([...last, `--changelog=${changelog}`]).json.notes).toBe("- old");
  });

  it("writes empty file lists for a missing artifacts folder", () => {
    const args = baseArgs().map((a) =>
      a.startsWith("--version=") ? "--version=9.9.9" : a.startsWith("--artifacts=") ? `--artifacts=${join(dir, "missing")}` : a,
    );
    const r = manifest(args);
    expect(r.code).toBe(0);
    expect(r.out).toContain("(0 files)");
    expect(r.json.files).toEqual({ linux: {}, windows: {}, macos: {} });
  });

  // Suspected bug: scripts/write-release-manifest.ts:14 splits --key=value on every "=", cutting the value
  it.failing("keeps a value containing =", () => {
    const args = baseArgs().map((a) => (a.startsWith("--site=") ? "--site=https://example.test/a=b" : a));
    expect(manifest(args).json.url).toBe("https://example.test/a=b/#downloads");
  });
});
