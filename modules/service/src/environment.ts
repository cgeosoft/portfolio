/**
 * Runtime environment of the service: production vs development and the
 * application version.
 *
 *   NODE_ENV            "production" in packaged builds (set by the desktop shell)
 *   PORTFOLIO_VERSION   baked into the bundle by modules/desktop/scripts/stage.ts;
 *                       in development the root package.json is read instead
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

let cachedIsProduction: boolean | null = null;
let cachedVersion: string | null = null;
let cachedWorkspaceRoot: string | null = null;

export function isProduction(): boolean {
  if (cachedIsProduction !== null) return cachedIsProduction;
  const nodeEnv = process.env["NODE_ENV"];
  if (nodeEnv === "production") cachedIsProduction = true;
  else if (nodeEnv === "development" || nodeEnv === "test") cachedIsProduction = false;
  else cachedIsProduction = !!process.env["PORTFOLIO_VERSION"];
  return cachedIsProduction;
}

export function isDev(): boolean {
  return !isProduction();
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

/**
 * Root of the Bun workspace in development (the directory whose package.json
 * is named `portfolio`), found by walking up from this file. Undefined inside
 * the packaged bundle, where no such package.json exists.
 */
export function getWorkspaceRoot(): string | undefined {
  if (cachedWorkspaceRoot !== null) return cachedWorkspaceRoot || undefined;
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, "package.json");
    try {
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as { name?: string };
        if (pkg.name === "portfolio") {
          cachedWorkspaceRoot = dir;
          return dir;
        }
      }
    } catch {
      // keep walking
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  cachedWorkspaceRoot = "";
  return undefined;
}

/** Semver of the running application. */
export function getAppVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  const baked = process.env["PORTFOLIO_VERSION"]?.trim();
  if (baked) {
    cachedVersion = baked;
    return baked;
  }
  // Development: the version of the workspace root package.json.
  const root = getWorkspaceRoot();
  if (root) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8")) as { version?: string };
      if (typeof pkg.version === "string") {
        cachedVersion = pkg.version.trim();
        return cachedVersion;
      }
    } catch {
      // fall through
    }
  }
  cachedVersion = "0.0.0";
  return cachedVersion;
}

/** Test helper: clears the cached environment state. */
export function _resetEnvironmentCache(): void {
  cachedIsProduction = null;
  cachedVersion = null;
  cachedWorkspaceRoot = null;
}
