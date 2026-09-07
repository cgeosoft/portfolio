/**
 * Environment detection, version resolution, and webpage URL configuration.
 * Distinguishes between development and production runtime contexts.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const PROD_WEBPAGE_URL = "https://portfolio.cgeosoft.com";
export const DEV_WEBPAGE_URL = "http://localhost:3000";

let cachedIsProduction: boolean | null = null;
let cachedVersion: string | null = null;

/**
 * Check if the current execution is in a production environment.
 * Evaluates compile-time define, version metadata, packaging status, and filesystem structure.
 */
export function isProduction(): boolean {
  if (cachedIsProduction !== null) {
    return cachedIsProduction;
  }

  // 1. Explicit NODE_ENV check
  if (process.env["NODE_ENV"] === "production") {
    cachedIsProduction = true;
    return true;
  }
  if (process.env["NODE_ENV"] === "development" || process.env["NODE_ENV"] === "test") {
    cachedIsProduction = false;
    return false;
  }

  // 2. Check Electrobun runtime metadata (version.json)
  const versionData = readVersionJsonMetadata();
  if (versionData?.channel) {
    const isProdChannel = versionData.channel === "stable" || versionData.channel === "canary";
    cachedIsProduction = isProdChannel;
    return isProdChannel;
  }

  // 3. Check for presence of dev-specific repository files
  // If package.json or extras/website exist at standard repo root, we are likely in dev
  try {
    const cwd = process.cwd();
    const repoPkgPath = join(cwd, "package.json");
    const repoWebsitePath = join(cwd, "extras/website");
    if (existsSync(repoPkgPath) && existsSync(repoWebsitePath)) {
      cachedIsProduction = false;
      return false;
    }
  } catch {
    // Filesystem check failed, assume production for safety
  }

  // Fallback default: production
  cachedIsProduction = true;
  return true;
}

/** Check if running in development mode */
export function isDev(): boolean {
  return !isProduction();
}

/** Get human-readable environment name */
export function getEnvironmentName(): "production" | "development" {
  return isProduction() ? "production" : "development";
}

/**
 * Check if a URL points to a local/loopback address (localhost or 127.0.0.1).
 */
export function isLocalhostUrl(url?: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.includes("localhost") ||
    trimmed.includes("127.0.0.1") ||
    trimmed.startsWith("http://[::1]")
  );
}

/**
 * Resolve the appropriate base webpage URL based on environment.
 * - In production: defaults to PROD_WEBPAGE_URL. If configuredUrl is localhost, it is ignored.
 * - In development: defaults to DEV_WEBPAGE_URL or process.env.WEBPAGE_URL.
 */
export function resolveWebpageUrl(configuredUrl?: string): string {
  const prod = isProduction();

  // In production mode
  if (prod) {
    // If an explicit override is passed, verify it is not localhost
    if (configuredUrl && configuredUrl.trim().length > 0) {
      if (!isLocalhostUrl(configuredUrl)) {
        return configuredUrl.trim().replace(/\/+$/, "");
      }
    }
    // Check environment variable WEBPAGE_URL, ignoring localhost in production
    const envUrl = process.env["WEBPAGE_URL"];
    if (envUrl && envUrl.trim().length > 0 && !isLocalhostUrl(envUrl)) {
      return envUrl.trim().replace(/\/+$/, "");
    }
    return PROD_WEBPAGE_URL;
  }

  // In development mode
  if (configuredUrl && configuredUrl.trim().length > 0) {
    return configuredUrl.trim().replace(/\/+$/, "");
  }
  const envUrl = process.env["WEBPAGE_URL"];
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, "");
  }
  return DEV_WEBPAGE_URL;
}

interface VersionJsonShape {
  version?: string;
  channel?: string;
  hash?: string;
  name?: string;
}

/**
 * Read version.json from packaged Resources directories.
 */
function readVersionJsonMetadata(): VersionJsonShape | null {
  const candidatePaths: string[] = [];

  // Relative to process.execPath (for packaged Linux, Windows, macOS binaries)
  if (process.execPath) {
    const binDir = dirname(process.execPath);
    candidatePaths.push(join(binDir, "../Resources/version.json"));
    candidatePaths.push(join(binDir, "Resources/version.json"));
    candidatePaths.push(join(binDir, "../../Resources/version.json"));
  }

  // Relative to import.meta.url
  try {
    const currentDir = dirname(new URL(import.meta.url).pathname);
    candidatePaths.push(join(currentDir, "../../version.json"));
    candidatePaths.push(join(currentDir, "../../metadata.json"));
    candidatePaths.push(join(currentDir, "../../../version.json"));
    candidatePaths.push(join(currentDir, "../../../metadata.json"));
    candidatePaths.push(join(currentDir, "../Resources/version.json"));
    candidatePaths.push(join(currentDir, "../Resources/metadata.json"));
  } catch {
    // URL parsing failed
  }

  // Relative to current working directory
  candidatePaths.push(join(process.cwd(), "Resources/version.json"));
  candidatePaths.push(join(process.cwd(), "Resources/metadata.json"));

  for (const candidate of candidatePaths) {
    try {
      if (existsSync(candidate)) {
        const raw = readFileSync(candidate, "utf-8");
        return JSON.parse(raw) as VersionJsonShape;
      }
    } catch {
      // Continue to next candidate
    }
  }

  return null;
}

/**
 * Resolve the current application semver version across dev and production.
 */
export function getAppVersion(): string {
  if (cachedVersion !== null) {
    return cachedVersion;
  }

  // 1. Try reading from package.json (dev repository context)
  const candidatePkgPaths = [
    resolve(process.cwd(), "package.json"),
  ];
  try {
    const metaDir = dirname(new URL(import.meta.url).pathname);
    candidatePkgPaths.push(resolve(metaDir, "../../package.json"));
    candidatePkgPaths.push(resolve(metaDir, "../../../package.json"));
  } catch {
    // Ignore
  }

  for (const pkgPath of candidatePkgPaths) {
    try {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
        if (pkg.version && typeof pkg.version === "string") {
          cachedVersion = pkg.version.trim();
          return cachedVersion;
        }
      }
    } catch {
      // Continue
    }
  }

  // 2. Try reading from version.json (packaged release context)
  const versionMeta = readVersionJsonMetadata();
  if (versionMeta?.version && typeof versionMeta.version === "string") {
    cachedVersion = versionMeta.version.trim();
    return cachedVersion;
  }

  // 3. Fallback default
  cachedVersion = "0.1.0";
  return cachedVersion;
}

/** Clear cached environment state (useful in test suites) */
export function _resetEnvironmentCache(): void {
  cachedIsProduction = null;
  cachedVersion = null;
}
