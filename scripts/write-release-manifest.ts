/**
 * Writes releases/latest.json describing the latest release. The app (update check)
 * and the website (download links) both read this file. Asset URLs point directly
 * to GitHub Releases downloads.
 *
 *   bun scripts/write-release-manifest.ts --app=portfolio --name=Portfolio \
 *       --version=0.3.0 --site=https://portfolio.cgeosoft.com --dir=extras/website/releases \
 *       --artifacts=dist/0.3.0 --github=https://github.com/cgeosoft/portfolio
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string]));
const app = args.app!;
const name = args.name || app;
const version = args.version!;
const site = (args.site || "").replace(/\/+$/, "");
const github = (args.github || "").replace(/\/+$/, "");
const dir = args.dir!;
const artifactsDir = args.artifacts || join(dir, version);
const changelog = args.changelog;
const files = existsSync(artifactsDir) ? readdirSync(artifactsDir) : [];

function entry(fileName: string | undefined) {
  if (!fileName) return undefined;
  const path = join(artifactsDir, fileName);
  if (!existsSync(path)) return undefined;
  const bytes = readFileSync(path);
  const downloadUrl = github
    ? `${github}/releases/download/v${version}/${fileName}`
    : `${site}/releases/${version}/${fileName}`;
  return {
    name: fileName,
    url: downloadUrl,
    size: statSync(path).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
const pick = (re: RegExp) => files.find((f) => re.test(f));

let notes = "";
if (changelog && existsSync(changelog)) {
  const text = readFileSync(changelog, "utf-8");
  const m = text.match(new RegExp(`## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`));
  notes = m?.[1]?.trim() || "";
}

const manifest = {
  app,
  name: `${name} ${version}`,
  version,
  publishedAt: new Date().toISOString(),
  notes,
  url: `${site}/#downloads`,
  files: {
    linux: { installer: entry(pick(/_amd64\.deb$/)), portable: entry(pick(/_linux-x64\.tar\.gz$/)) },
    windows: { installer: entry(pick(/_x64_setup\.exe$/)), portable: entry(pick(/_windows-x64_portable\.zip$/)) },
    macos: { installer: entry(pick(/_universal\.dmg$/)), portable: entry(pick(/_macos-universal\.zip$/)) },
  },
};
writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${join(dir, "latest.json")} (${files.length} files)`);
