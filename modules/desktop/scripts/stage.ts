/**
 * Builds the GUI and the service and collects everything the desktop app
 * ships into `stage/`, which electrobun.config.ts copies into the bundle:
 *
 *   stage/service/main.js   single-file service bundle (bun build --target=bun)
 *   stage/gui/              Vite build, served by the service on /
 *   stage/service/sponsor.html   offline fallback of the sponsor page
 *
 * The version and the PostHog key are baked into the service bundle here, so
 * no .env file is needed at runtime. Run with `bun run stage`.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");
const repoRoot = resolve(desktopDir, "../..");
const serviceDir = join(repoRoot, "modules/service");
const guiDir = join(repoRoot, "modules/gui");
const stageDir = join(desktopDir, "stage");
const version = (await Bun.file(join(repoRoot, "package.json")).json()).version as string;

function run(cwd: string, cmd: string[]): void {
  console.log(`[stage] ${cmd.join(" ")} (${cwd})`);
  const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    console.error(`[stage] "${cmd.join(" ")}" failed in ${cwd}`);
    process.exit(result.exitCode || 1);
  }
}

run(repoRoot, ["bun", "run", "scripts/build-metrics.ts"]);
run(guiDir, ["bun", "run", "build"]);
run(serviceDir, [
  "bun",
  "build",
  "src/main.ts",
  "--target=bun",
  "--outfile",
  "dist-bundle/main.js",
  `--define=process.env.PORTFOLIO_VERSION=${JSON.stringify(version)}`,
  `--define=process.env.POSTHOG_API_KEY=${JSON.stringify(process.env.POSTHOG_API_KEY || "")}`,
]);

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "service"), { recursive: true });

const files: [string, string][] = [
  [join(serviceDir, "dist-bundle/main.js"), join(stageDir, "service/main.js")],
  [join(guiDir, "dist"), join(stageDir, "gui")],
  [join(repoRoot, "extras/website/sponsor/index.html"), join(stageDir, "service/sponsor.html")],
];
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.error(`[stage] missing ${from}`);
    process.exit(1);
  }
  cpSync(from, to, { recursive: true });
}
writeFileSync(join(stageDir, "version.txt"), version + "\n");
console.log(`[stage] ready in ${stageDir} (version ${version})`);
