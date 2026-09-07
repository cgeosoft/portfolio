/**
 * Version Update Service.
 * Checks GitHub releases for new versions of Portfolio Desktop.
 */

import { readFileSync, existsSync } from "node:fs";
import { appLogger } from "../logger.js";
import { loadConfig, updateConfig } from "../config.js";
import { getAppVersion } from "../environment.js";
import type { AppUpdateInfo } from "../../shared/rpc-types.js";

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/** Parse semver string like "0.1.0" or "v1.2.3-beta" */
export function parseSemver(version: string): ParsedSemver | null {
  if (!version || typeof version !== "string") return null;
  const clean = version.trim().replace(/^[vV]/, "");
  const [core, prerelease] = clean.split("-");
  if (!core) return null;

  const parts = core.split(".").map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return null;

  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
    prerelease,
  };
}

/** Check if candidate version is newer than current version */
export function isNewerVersion(current: string, candidate: string): boolean {
  const c = parseSemver(current);
  const cand = parseSemver(candidate);
  if (!c || !cand) return false;

  if (cand.major !== c.major) return cand.major > c.major;
  if (cand.minor !== c.minor) return cand.minor > c.minor;
  if (cand.patch !== c.patch) return cand.patch > c.patch;

  // If numeric values are identical, a stable release is newer than a prerelease
  if (c.prerelease && !cand.prerelease) return true;

  return false;
}

const GITHUB_REPO = "cgeosoft/portfolio";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export class AppUpdateService {
  private currentVersion = "0.1.0";
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private cachedInfo: AppUpdateInfo = {
    enabled: true,
    currentVersion: "0.1.0",
    latestVersion: "0.1.0",
    hasUpdate: false,
    releaseName: "",
    releaseUrl: "",
  };

  constructor() {
    this.currentVersion = this.readAppVersion();
    const cfg = loadConfig();
    this.cachedInfo = {
      enabled: cfg.checkForUpdates ?? true,
      currentVersion: this.currentVersion,
      latestVersion: this.currentVersion,
      hasUpdate: false,
      releaseName: "",
      releaseUrl: "",
      lastChecked: cfg.lastUpdateCheck,
    };
  }

  /** Read current app version from package.json or runtime version metadata */
  public readAppVersion(): string {
    return getAppVersion();
  }

  /** Get cached update information */
  public getUpdateInfo(): AppUpdateInfo {
    const cfg = loadConfig();
    return {
      ...this.cachedInfo,
      enabled: cfg.checkForUpdates ?? true,
      currentVersion: this.currentVersion,
      lastChecked: cfg.lastUpdateCheck || this.cachedInfo.lastChecked,
    };
  }

  /** Check GitHub releases for a newer version */
  public async checkForUpdates(force = false): Promise<AppUpdateInfo> {
    const cfg = loadConfig();
    const enabled = cfg.checkForUpdates ?? true;

    if (!enabled && !force) {
      appLogger.log("info", "Update check skipped: automatic update checks disabled in preferences");
      return {
        ...this.cachedInfo,
        enabled: false,
        currentVersion: this.currentVersion,
      };
    }

    appLogger.log("info", `Checking for updates on GitHub (${GITHUB_REPO})...`);

    try {
      const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": `Portfolio-Desktop/${this.currentVersion}`,
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        const statusText = response.statusText || String(response.status);
        appLogger.log("warning", `GitHub release check returned HTTP ${response.status}: ${statusText}`);
        const errResult: AppUpdateInfo = {
          ...this.cachedInfo,
          enabled,
          currentVersion: this.currentVersion,
          error: `GitHub HTTP ${response.status}`,
        };
        this.cachedInfo = errResult;
        return errResult;
      }

      const data = (await response.json()) as {
        tag_name?: string;
        name?: string;
        html_url?: string;
        body?: string;
        published_at?: string;
      };

      const rawTag = data.tag_name || "";
      const latestVersion = rawTag.replace(/^[vV]/, "");
      const hasUpdate = isNewerVersion(this.currentVersion, latestVersion);
      const nowIso = new Date().toISOString();

      updateConfig({ lastUpdateCheck: nowIso });

      this.cachedInfo = {
        enabled,
        currentVersion: this.currentVersion,
        latestVersion: latestVersion || this.currentVersion,
        hasUpdate,
        releaseName: data.name || rawTag,
        releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
        releaseNotes: data.body || "",
        publishedAt: data.published_at,
        lastChecked: nowIso,
      };

      if (hasUpdate) {
        appLogger.log("success", `New version available: ${latestVersion} (current: ${this.currentVersion})`);
      } else {
        appLogger.log("info", `Portfolio is up to date (${this.currentVersion})`);
      }

      return this.cachedInfo;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appLogger.log("warning", `Failed to check for updates: ${msg}`);
      const errResult: AppUpdateInfo = {
        ...this.cachedInfo,
        enabled,
        currentVersion: this.currentVersion,
        error: msg,
      };
      this.cachedInfo = errResult;
      return errResult;
    }
  }

  /** Start startup check and hourly timer */
  public startPeriodicChecks(): void {
    this.stopPeriodicChecks();

    // Check after brief initial delay on application start
    setTimeout(() => {
      const cfg = loadConfig();
      if (cfg.checkForUpdates ?? true) {
        this.checkForUpdates().catch((err) => {
          appLogger.log("warning", `Startup update check failed: ${err}`);
        });
      }
    }, 5000);

    // Schedule check every hour
    this.intervalTimer = setInterval(() => {
      const cfg = loadConfig();
      if (cfg.checkForUpdates ?? true) {
        this.checkForUpdates().catch((err) => {
          appLogger.log("warning", `Hourly update check failed: ${err}`);
        });
      }
    }, CHECK_INTERVAL_MS);
  }

  /** Stop hourly timer */
  public stopPeriodicChecks(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}

export const appUpdateService = new AppUpdateService();
