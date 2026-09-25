/**
 * Builds the GUI and the service and collects everything the desktop app ships into `stage/`,
 * which electrobun.config.ts copies into `Resources/app/`:
 *
 *   stage/service/main.js        single-file service bundle (bun build --target=bun)
 *   stage/service/version.txt    the version, next to the bundle
 *   stage/gui/                   Vite build, served by the service on / (`<dir of main.js>/../gui`)
 *   + the per-app files below (EXTRA_FILES)
 *
 * The version (and the other build constants in DEFINES) is baked into the bundle with
 * `bun build --define NAME='"value"'`, a plain global constant the service reads with
 * `typeof NAME !== "undefined"`. Nothing reaches the app through environment variables at
 * run time. Development (`bun start`) needs no stage. Run with `bun run stage`.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");
const repoRoot = resolve(desktopDir, "../..");
const serviceDir = join(repoRoot, "modules/service");
const guiDir = join(repoRoot, "modules/gui");
const stageDir = join(desktopDir, "stage");
const version = (await Bun.file(join(repoRoot, "package.json")).json()).version as string;

// ---- per app -----------------------------------------------------------------------------

/** Steps before the GUI and service builds: the metric modules the service embeds. */
const PREBUILD: [cwd: string, cmd: string[]][] = [[repoRoot, ["bun", "run", "scripts/build-metrics.ts"]]];

/**
 * Build constants of the service bundle. The PostHog key is read here, at build time only, from
 * the environment `scripts/release.sh` passes into the build container; empty means telemetry
 * has no key.
 */
const DEFINES: Record<string, string> = {
  APP_VERSION: version,
  POSTHOG_API_KEY: process.env.POSTHOG_API_KEY ?? "",
};

/** Files the service reads next to its bundle (`import.meta.dir`), `[from repo root, to stage/]`. */
const EXTRA_FILES: [string, string][] = [
  ["extras/website/sponsor/index.html", "service/sponsor.html"],
  ["extras/website/sponsor/light/index.html", "service/sponsor-light.html"],
];

// ---- shared ------------------------------------------------------------------------------

function run(cwd: string, cmd: string[]): void {
  console.log(`[stage] ${cmd.join(" ")} (${cwd})`);
  const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    console.error(`[stage] "${cmd.join(" ")}" failed in ${cwd}`);
    process.exit(result.exitCode || 1);
  }
}

for (const [cwd, cmd] of PREBUILD) run(cwd, cmd);
run(guiDir, ["bun", "run", "build"]);
run(serviceDir, [
  "bun",
  "build",
  "src/main.ts",
  "--target=bun",
  "--outfile",
  "dist-bundle/main.js",
  ...Object.entries(DEFINES).flatMap(([name, value]) => ["--define", `${name}=${JSON.stringify(value)}`]),
]);

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "service"), { recursive: true });

const copies: [string, string][] = [
  [join(serviceDir, "dist-bundle/main.js"), join(stageDir, "service/main.js")],
  [join(guiDir, "dist"), join(stageDir, "gui")],
  ...EXTRA_FILES.map(([from, to]): [string, string] => [join(repoRoot, from), join(stageDir, to)]),
];
for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.error(`[stage] missing ${from}`);
    process.exit(1);
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

writeFileSync(join(stageDir, "service/version.txt"), version + "\n");
console.log(`[stage] ready in ${stageDir} (version ${version})`);
