/**
 * Update check against the release manifest the release script publishes on
 * the website (`<WEBPAGE_URL>/releases/latest.json`, see scripts/release.sh).
 * The desktop window downloads the installer through the service into a
 * folder the user picks; other devices open the download in their browser.
 */
import { existsSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { appLogger } from "../logger";
import { loadConfig, updateConfig } from "../config";
import { getAppVersion } from "../environment";
import { downloadsDir, pickFolder } from "./files";
import { GITHUB_URL, RELEASE_MANIFEST_URL, WEBPAGE_URL } from "portfolio-shared/brand";
import type { AppUpdateInfo, DownloadUpdateResponse, ReleaseManifest, ReleasePlatformKey, UpdateDownloadState } from "portfolio-shared/api-types";

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

const GITHUB_API_LATEST = "https://api.github.com/repos/cgeosoft/portfolio/releases/latest";

/** Hosts an installer may come from, including GitHub's redirect targets for release assets. */
const DOWNLOAD_HOSTS = new Set([
  new URL(GITHUB_URL).hostname,
  new URL(WEBPAGE_URL).hostname,
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const MAX_REDIRECTS = 5;
/** Cap when the release does not declare a size. */
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** True for an https URL on one of the release download hosts. */
export function isAllowedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && DOWNLOAD_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Lowercase hex digest from `abc…` or GitHub's `sha256:abc…`, or undefined when it is not a SHA-256. */
export function normalizeSha256(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.trim().toLowerCase().replace(/^sha256:/, "");
  return SHA256_HEX.test(hex) ? hex : undefined;
}

/** Digest for `fileName` in a `sha256sum` style listing (`<hex> *name` or `<hex>  name`). */
export function sha256FromSums(sums: string, fileName: string): string | undefined {
  for (const line of sums.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m && m[2] === fileName) return m[1]!.toLowerCase();
  }
  return undefined;
}

/** Fetch that follows redirects only to allowed download hosts. */
async function fetchFromReleaseHost(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedDownloadUrl(current)) throw new Error("Refusing download from a host outside the release hosts");
    const response = await fetch(current, { headers, redirect: "manual", signal });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects");
}

interface InstallerSource {
  fileName: string;
  url: string;
  version: string;
  size?: number;
  sha256?: string;
}

export class AppUpdateService {
  private currentVersion: string;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private onUpdateAvailable: ((info: AppUpdateInfo) => void) | null = null;
  private cachedInfo: AppUpdateInfo;
  private manifest: ReleaseManifest | null = null;
  /** True when `manifest` came from the GitHub API, false for the website fallback. */
  private manifestFromGitHub = false;
  private download: UpdateDownloadState = { status: "idle" };

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
    this.currentVersion = getAppVersion();
    return {
      ...this.cachedInfo,
      enabled: cfg.checkForUpdates ?? true,
      currentVersion: this.currentVersion,
      lastChecked: cfg.lastUpdateCheck || this.cachedInfo.lastChecked,
    };
  }

  /** Reads the latest release from GitHub Releases API, with fallback to the website manifest. */
  public async checkForUpdates(force = false): Promise<AppUpdateInfo> {
    this.currentVersion = getAppVersion();
    const cfg = loadConfig();
    const enabled = cfg.checkForUpdates ?? true;
    if (!enabled && !force) {
      appLogger.logStep("info", "update", "check", "Skipped: automatic update checks are disabled");
      return { ...this.cachedInfo, enabled: false, currentVersion: this.currentVersion };
    }

    const timer = appLogger.startTimer("update", "check");
    try {
      let manifest: ReleaseManifest | null = null;
      let fromGitHub = false;

      // 1. Check GitHub Releases API directly (no website deploy needed)
      try {
        const ghRes = await fetch(GITHUB_API_LATEST, {
          headers: { Accept: "application/vnd.github.v3+json", "User-Agent": `Portfolio-Desktop/${this.currentVersion}` },
          signal: AbortSignal.timeout(6000),
        });
        if (ghRes.ok) {
          const gh = (await ghRes.json()) as any;
          if (gh && gh.tag_name) {
            const version = String(gh.tag_name).replace(/^v/, "");
            const assets = Array.isArray(gh.assets) ? gh.assets : [];
            const findAsset = (re: RegExp) => {
              const match = assets.find((a: any) => re.test(a.name));
              // GitHub reports `digest: "sha256:<hex>"` for assets; older ones fall back to SHA256SUMS at download.
              return match ? { name: match.name, url: match.browser_download_url, size: match.size, sha256: normalizeSha256(match.digest) } : undefined;
            };
            fromGitHub = true;
            manifest = {
              app: "portfolio",
              version,
              name: gh.name || `Portfolio ${version}`,
              notes: gh.body || "",
              url: gh.html_url || `${GITHUB_URL}/releases/tag/v${version}`,
              publishedAt: gh.published_at,
              files: {
                linux: { installer: findAsset(/_amd64\.deb$|linux.*\.deb$/i), portable: findAsset(/_linux-x64\.tar\.gz$|linux.*\.tar\.gz$/i) },
                windows: { installer: findAsset(/_x64_setup\.exe$|win.*setup\.(exe|zip)$/i), portable: findAsset(/_windows-x64_portable\.zip$|win.*portable\.zip$/i) },
                macos: { installer: findAsset(/_universal\.dmg$|mac.*\.dmg$/i), portable: findAsset(/_macos-universal\.zip$|mac.*\.zip$/i) },
              },
            };
          }
        }
      } catch {
        // Best-effort GitHub API lookup; fall through to website manifest below.
      }

      // 2. Fallback to website release manifest if GitHub API lookup failed
      if (!manifest) {
        const response = await fetch(this.manifestUrl, {
          headers: { Accept: "application/json", "User-Agent": `Portfolio-Desktop/${this.currentVersion}` },
          signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) {
          timer.end("warning", `Release manifest returned HTTP ${response.status}`);
          this.cachedInfo = { ...this.cachedInfo, enabled, currentVersion: this.currentVersion, error: `HTTP ${response.status}` };
          return this.cachedInfo;
        }
        manifest = (await response.json()) as ReleaseManifest;
      }

      const latestVersion = String(manifest.version || "").replace(/^[vV]/, "");
      const hasUpdate = this.currentVersion !== "0.0.0" && isNewerVersion(this.currentVersion, latestVersion);
      const nowIso = new Date().toISOString();
      updateConfig({ lastUpdateCheck: nowIso });
      this.manifest = manifest;
      this.manifestFromGitHub = fromGitHub;
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

  /** Installer name, URL, size and SHA-256 of a version for this platform. */
  private installerFor(version: string): InstallerSource {
    const cleanVersion = version.trim().replace(/^[vV]/, "");
    if (!RELEASE_VERSION.test(cleanVersion)) throw new Error("Invalid release version");
    const platform = releasePlatformKey();
    const fromManifest = this.manifest?.version?.replace(/^[vV]/, "") === cleanVersion ? this.manifest?.files?.[platform]?.installer : undefined;
    const fileName = basename(fromManifest?.name || getReleaseAssetName(cleanVersion));
    const url = fromManifest?.url || `${GITHUB_URL}/releases/download/v${cleanVersion}/${encodeURIComponent(fileName)}`;
    if (!isAllowedDownloadUrl(url)) throw new Error("Installer URL is not on a release download host");
    const size = typeof fromManifest?.size === "number" && fromManifest.size > 0 ? fromManifest.size : undefined;
    // The website manifest names the installer URL too: a hash from the same file proves nothing
    // if the website is changed, so that installer is checked against the GitHub release's SHA256SUMS.
    const sha256 = this.manifestFromGitHub ? normalizeSha256(fromManifest?.sha256) : undefined;
    return { fileName, url, version: cleanVersion, size, sha256 };
  }

  /** SHA-256 the release publishes for the installer: the GitHub asset digest, else the release's SHA256SUMS. */
  private async expectedSha256(source: InstallerSource): Promise<string> {
    if (source.sha256) return source.sha256;
    const sumsUrl = `${GITHUB_URL}/releases/download/v${source.version}/SHA256SUMS`;
    const response = await fetchFromReleaseHost(sumsUrl, { "User-Agent": `Portfolio-Desktop/${this.currentVersion}` }, AbortSignal.timeout(15000));
    if (!response.ok) throw new Error(`No checksum published for this release (HTTP ${response.status})`);
    const digest = sha256FromSums(await response.text(), source.fileName);
    if (!digest) throw new Error("No checksum published for this installer");
    return digest;
  }

  /**
   * Other devices get the installer URL for their browser. The desktop window
   * gets a folder dialog (opened on Downloads) and the service downloads the
   * installer there in the background; `getDownloadState()` reports progress.
   */
  public downloadUpdate(version: string, isLocal: boolean, dialogTitle: string): DownloadUpdateResponse {
    let source: InstallerSource;
    try {
      source = this.installerFor(version);
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    const { fileName, url } = source;
    if (!isLocal) return { success: true, url, fileName };
    if (this.download.status === "picking" || this.download.status === "downloading") {
      return { success: false, error: "A download is already in progress" };
    }
    this.download = { status: "picking", fileName };
    void this.runDownload(source, dialogTitle);
    return { success: true, started: true, fileName };
  }

  public getDownloadState(): UpdateDownloadState {
    return this.download;
  }

  private async runDownload(source: InstallerSource, dialogTitle: string): Promise<void> {
    const { fileName, url } = source;
    const timer = appLogger.startTimer("update", "download");
    let partPath = "";
    try {
      const startDir = downloadsDir();
      const picked = await pickFolder(startDir, dialogTitle);
      if (picked === null) {
        this.download = { status: "cancelled", fileName };
        timer.end("info", "Download cancelled in the folder dialog");
        return;
      }
      const folder = picked ?? startDir;
      let target = join(folder, fileName);
      if (existsSync(target)) {
        const dot = fileName.lastIndexOf(".");
        target = join(folder, `${fileName.slice(0, dot)}-${Date.now()}${fileName.slice(dot)}`);
      }

      const expectedSha256 = await this.expectedSha256(source);
      const response = await fetchFromReleaseHost(url, { "User-Agent": `Portfolio-Desktop/${this.currentVersion}` });
      if (!response.ok || !response.body) throw new Error(`Download returned HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length")) || undefined;
      if (source.size && contentLength && contentLength !== source.size) throw new Error("Download size does not match the release");
      const maxBytes = source.size ?? MAX_INSTALLER_BYTES;
      if (contentLength && contentLength > maxBytes) throw new Error("Download is larger than the release allows");
      const totalBytes = source.size ?? contentLength;
      this.download = { status: "downloading", fileName, receivedBytes: 0, totalBytes };

      partPath = `${target}.part`;
      const writer = Bun.file(partPath).writer();
      const hasher = new Bun.CryptoHasher("sha256");
      let receivedBytes = 0;
      try {
        for await (const chunk of response.body) {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > maxBytes) throw new Error("Download is larger than the release allows");
          writer.write(chunk);
          hasher.update(chunk);
          this.download = { status: "downloading", fileName, receivedBytes, totalBytes };
        }
      } finally {
        await writer.end();
      }
      if (source.size && receivedBytes !== source.size) throw new Error("Download size does not match the release");
      if (hasher.digest("hex") !== expectedSha256) throw new Error("Installer checksum does not match the release");
      renameSync(partPath, target);
      partPath = "";
      this.download = { status: "done", fileName, filePath: target, receivedBytes, totalBytes };
      timer.end("success", "Installer downloaded");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (partPath) rmSync(partPath, { force: true });
      this.download = { status: "error", fileName, error: msg };
      timer.end("warning", `Download failed: ${msg}`);
    }
  }

  public getCachedInfo(): AppUpdateInfo {
    return this.cachedInfo;
  }
}

export const appUpdateService = new AppUpdateService();
