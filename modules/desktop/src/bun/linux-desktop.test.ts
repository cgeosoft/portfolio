/** Linux desktop entry install, run in a child process with a temporary HOME. */
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODULE = join(import.meta.dir, "linux-desktop.ts");

function install(home: string, opts: object): string {
  const r = Bun.spawnSync(
    [process.execPath, "-e", `import { installDesktopEntry } from ${JSON.stringify(MODULE)}; installDesktopEntry(${JSON.stringify(opts)});`],
    { env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe" },
  );
  return r.stdout.toString() + r.stderr.toString();
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function layout(withLauncher = true): { tmp: string; home: string; repo: string; appDir: string; apps: string } {
  const tmp = mkdtempSync(join(tmpdir(), "portfolio-desktop-entry-"));
  dirs.push(tmp);
  const home = join(tmp, "home");
  const repo = join(tmp, "repo");
  const appDir = join(tmp, "install", "Resources", "app");
  mkdirSync(home);
  mkdirSync(repo);
  mkdirSync(join(appDir, "icons"), { recursive: true });
  writeFileSync(join(appDir, "icons", "app-icon-16x16.png"), "PNG16");
  writeFileSync(join(appDir, "icons", "app-icon.svg"), "<svg/>");
  if (withLauncher) {
    mkdirSync(join(tmp, "install", "bin"));
    writeFileSync(join(tmp, "install", "bin", "launcher"), "");
  }
  return { tmp, home, repo, appDir, apps: join(home, ".local", "share", "applications") };
}

describe.skipIf(process.platform !== "linux")("installDesktopEntry", () => {
  it("writes the development entries", () => {
    const { tmp, home, apps } = layout();
    const repo = join(tmp, "repo");
    const out = install(home, { packaged: false, appDir: join(tmp, "nope"), repoRoot: repo });
    expect(out).toContain("[desktop] desktop entry installed (development)");
    const main = [
      "[Desktop Entry]",
      "Version=1.0",
      "Type=Application",
      "Name=Portfolio (Development)",
      "GenericName=Personal Investment Tracker",
      "Comment=Offline-first personal investment portfolio tracker (development checkout)",
      `Exec=/usr/bin/env bash -c "cd '${repo}' && bun start"`,
      "Icon=portfolio-dev",
      "Terminal=false",
      "StartupNotify=true",
      "StartupWMClass=Portfolio-dev-dev",
      "Categories=Office;Finance;",
    ];
    const alt = main.map((line) => (line.startsWith("StartupWMClass=") ? "StartupWMClass=Portfolio-dev" : line));
    alt.splice(alt.indexOf("Categories=Office;Finance;"), 0, "NoDisplay=true");
    const mainFile = join(apps, "portfolio-dev.desktop");
    const altFile = join(apps, "portfolio-dev-alt.desktop");
    expect(readFileSync(mainFile, "utf-8")).toBe(main.join("\n") + "\n");
    expect(readFileSync(altFile, "utf-8")).toBe(alt.join("\n") + "\n");
    expect(statSync(mainFile).mode & 0o777).toBe(0o644);
    expect(statSync(altFile).mode & 0o777).toBe(0o644);
  }, 15_000);

  it("writes the packaged entries and icons", () => {
    const { tmp, home, appDir, apps } = layout();
    install(home, { packaged: true, appDir, repoRoot: undefined });
    const main = readFileSync(join(apps, "portfolio.desktop"), "utf-8");
    const lines = main.split("\n");
    expect(lines).toContain("Name=Portfolio");
    expect(lines).toContain("Comment=Offline-first personal investment portfolio tracker");
    expect(lines).toContain(`Exec="${join(tmp, "install", "bin", "launcher")}"`);
    expect(lines).toContain("Icon=portfolio");
    expect(lines).toContain("StartupWMClass=Portfolio");
    expect(main).not.toContain("NoDisplay");
    const alt = readFileSync(join(apps, "portfolio-alt.desktop"), "utf-8").split("\n");
    expect(alt).toContain("StartupWMClass=portfolio");
    expect(alt).toContain("NoDisplay=true");

    const hicolor = join(home, ".local", "share", "icons", "hicolor");
    expect(readFileSync(join(hicolor, "16x16", "apps", "portfolio.png"), "utf-8")).toBe("PNG16");
    expect(existsSync(join(hicolor, "scalable", "apps", "portfolio.svg"))).toBe(true);
    const sizes = readdirSync(hicolor, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(sizes).toEqual(["16x16", "scalable"]);
  }, 15_000);

  it("is idempotent", () => {
    const { home, appDir, apps } = layout();
    install(home, { packaged: true, appDir, repoRoot: undefined });
    const before = readFileSync(join(apps, "portfolio.desktop"), "utf-8");
    const beforeAlt = readFileSync(join(apps, "portfolio-alt.desktop"), "utf-8");
    const out = install(home, { packaged: true, appDir, repoRoot: undefined });
    expect(out).not.toContain("desktop entry installed");
    expect(readFileSync(join(apps, "portfolio.desktop"), "utf-8")).toBe(before);
    expect(readFileSync(join(apps, "portfolio-alt.desktop"), "utf-8")).toBe(beforeAlt);
  }, 15_000);

  it("skips a packaged install without a launcher", () => {
    const { home, appDir, apps } = layout(false);
    const out = install(home, { packaged: true, appDir, repoRoot: undefined });
    expect(out).toContain("launcher not found; desktop entry not written");
    expect(existsSync(join(apps, "portfolio.desktop"))).toBe(false);
  }, 15_000);

  it("skips a development run without a checkout root", () => {
    const { tmp, home } = layout();
    const out = install(home, { packaged: false, appDir: join(tmp, "nope"), repoRoot: undefined });
    expect(out).toContain("checkout root not found; desktop entry not written");
  }, 15_000);
});
