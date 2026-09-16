/**
 * Update check against the release manifest the release script publishes on
 * the website (`<WEBPAGE_URL>/releases/latest.json`, see scripts/release.sh).
 * The GUI opens the download in the browser; nothing is written to disk here.
 */
import { appLogger } from "../logger";
import { loadConfig, updateConfig } from "../config";
import { getAppVersion } from "../environment";
import { RELEASE_MANIFEST_URL, WEBPAGE_URL } from "portfolio-shared/brand";
import type { AppUpdateInfo, DownloadUpdateResponse, ReleaseManifest, ReleasePlatformKey } from "portfolio-shared/api-types";

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
  return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0, prerelease };
}

/** Check if candidate version is newer than current version */
export function isNewerVersion(current: string, candidate: string): boolean {
  const c = parseSemver(current);
  const cand = parseSemver(candidate);
  if (!c || !cand) return false;
  if (cand.major !== c.major) return cand.major > c.major;
  if (cand.minor !== c.minor) return cand.minor > c.minor;
  if (cand.patch !== c.patch) return cand.patch > c.patch;
  if (c.prerelease && !cand.prerelease) return true;
  return false;
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Platform key of the manifest for the running OS. */
export function releasePlatformKey(platform: NodeJS.Platform = process.platform): ReleasePlatformKey {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

/** Installer filename for a version and platform (scripts/release.sh naming). */
export function getReleaseAssetName(version: string, platform: NodeJS.Platform = process.platform): string {
  const clean = version.replace(/^[vV]/, "");
  switch (platform) {
    case "win32":
      return `portfolio_${clean}_x64_setup.exe`;
    case "darwin":
      return `portfolio_${clean}_universal.dmg`;
    default:
      return `portfolio_${clean}_amd64.deb`;
  }
}

export class AppUpdateService {
  private currentVersion: string;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private onUpdateAvailable: ((info: AppUpdateInfo) => void) | null = null;
  private cachedInfo: AppUpdateInfo;
  private manifest: ReleaseManifest | null = null;

  constructor(private readonly manifestUrl: string = RELEASE_MANIFEST_URL) {
    this.currentVersion = getAppVersion();
    this.cachedInfo = {
      enabled: true,
      currentVersion: this.currentVersion,
      latestVersion: this.currentVersion,
      hasUpdate: false,
      releaseName: "",
      releaseUrl: `${WEBPAGE_URL}/#downloads`,
    };
  }

  public setOnUpdateAvailable(cb: (info: AppUpdateInfo) => void): void {
    this.onUpdateAvailable = cb;
  }

  public getUpdateInfo(): AppUpdateInfo {
    const cfg = loadConfig();
    return {
      ...this.cachedInfo,
      enabled: cfg.checkForUpdates ?? true,
      currentVersion: this.currentVersion,
      lastChecked: cfg.lastUpdateCheck || this.cachedInfo.lastChecked,
    };
  }

  /** Reads the release manifest from the website. */
  public async checkForUpdates(force = false): Promise<AppUpdateInfo> {
    const cfg = loadConfig();
    const enabled = cfg.checkForUpdates ?? true;
    if (!enabled && !force) {
      appLogger.logStep("info", "update", "check", "Skipped: automatic update checks are disabled");
      return { ...this.cachedInfo, enabled: false, currentVersion: this.currentVersion };
    }

    const timer = appLogger.startTimer("update", "check");
    try {
      const response = await fetch(this.manifestUrl, {
        headers: { Accept: "application/json", "User-Agent": `Portfolio-Desktop/${this.currentVersion}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) {
        timer.end("warning", `Release manifest returned HTTP ${response.status}`);
        this.cachedInfo = { ...this.cachedInfo, enabled, currentVersion: this.currentVersion, error: `HTTP ${response.status}` };
        return this.cachedInfo;
      }
      const manifest = (await response.json()) as ReleaseManifest;
      const latestVersion = String(manifest.version || "").replace(/^[vV]/, "");
      const hasUpdate = isNewerVersion(this.currentVersion, latestVersion);
      const nowIso = new Date().toISOString();
      updateConfig({ lastUpdateCheck: nowIso });
      this.manifest = manifest;
      this.cachedInfo = {
        enabled,
        currentVersion: this.currentVersion,
        latestVersion: latestVersion || this.currentVersion,
        hasUpdate,
        releaseName: manifest.name || `Portfolio ${latestVersion}`,
        releaseUrl: manifest.url || `${WEBPAGE_URL}/#downloads`,
        releaseNotes: manifest.notes || "",
        publishedAt: manifest.publishedAt,
        lastChecked: nowIso,
      };
      timer.end(hasUpdate ? "success" : "info", hasUpdate ? `New version available: ${latestVersion}` : `Up to date (${this.currentVersion})`);
      if (hasUpdate && loadConfig().dismissedUpdateVersion !== latestVersion && this.onUpdateAvailable) {
        try {
          this.onUpdateAvailable(this.cachedInfo);
        } catch {
          // best effort
        }
      }
      return this.cachedInfo;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      timer.end("warning", `Update check failed: ${msg}`);
      this.cachedInfo = { ...this.cachedInfo, enabled, currentVersion: this.currentVersion, error: msg };
      return this.cachedInfo;
    }
  }

  public startPeriodicChecks(): void {
    this.stopPeriodicChecks();
    setTimeout(() => {
      if (loadConfig().checkForUpdates ?? true) this.checkForUpdates().catch(() => {});
    }, 5000);
    this.intervalTimer = setInterval(() => {
      if (loadConfig().checkForUpdates ?? true) this.checkForUpdates().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }

  public stopPeriodicChecks(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /**
   * Resolves the download URL of the installer for this platform. The GUI
   * opens it in the system browser, which handles the download itself.
   */
  public async downloadUpdate(version: string): Promise<DownloadUpdateResponse> {
    const cleanVersion = version.replace(/^[vV]/, "");
    const platform = releasePlatformKey();
    const fromManifest = this.manifest?.version?.replace(/^[vV]/, "") === cleanVersion ? this.manifest?.files?.[platform]?.installer : undefined;
    const fileName = fromManifest?.name || getReleaseAssetName(cleanVersion);
    const url = fromManifest?.url || `${WEBPAGE_URL}/releases/${cleanVersion}/${fileName}`;
    return { success: true, url, fileName };
  }

  public getCachedInfo(): AppUpdateInfo {
    return this.cachedInfo;
  }
}

export const appUpdateService = new AppUpdateService();
