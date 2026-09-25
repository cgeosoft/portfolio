/**
 * Runtime environment of the service: whether it runs from a checkout and
 * the application version. Nothing here reads an environment variable.
 *
 * The version comes from the `APP_VERSION` constant that
 * modules/desktop/scripts/stage.ts bakes into the bundle with
 * `bun build --define`, else from `version.txt` next to the bundle, else from
 * the root package.json of the checkout.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./paths";

let cachedVersion: string | null = null;

/** True when the service runs from a checkout (`bun start`), not from the desktop bundle. */
export function isDev(): boolean {
  return REPO_ROOT !== undefined;
}

export function isProduction(): boolean {
  return !isDev();
}

export function getEnvironmentName(): "production" | "development" {
  return isProduction() ? "production" : "development";
}

/** True when a URL points to localhost or a loopback address. */
export function isLocalhostUrl(url?: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.includes("localhost") || trimmed.includes("127.0.0.1") || trimmed.startsWith("http://[::1]");
}

function readTrimmed(file: string): string | undefined {
  try {
    return existsSync(file) ? readFileSync(file, "utf-8").trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** Semver of the running application. */
export function getAppVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  const baked = typeof APP_VERSION !== "undefined" ? APP_VERSION?.trim() : undefined;
  const fromFile = baked ? undefined : readTrimmed(join(import.meta.dir, "version.txt"));
  let fromPackage: string | undefined;
  if (!baked && !fromFile && REPO_ROOT) {
    try {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version?: string };
      if (typeof pkg.version === "string") fromPackage = pkg.version.trim();
    } catch {
      // fall through
    }
  }
  cachedVersion = baked || fromFile || fromPackage || "0.0.0";
  return cachedVersion;
}
