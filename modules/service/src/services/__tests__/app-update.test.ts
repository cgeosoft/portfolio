import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { parseSemver, isNewerVersion, getReleaseAssetName, AppUpdateService, isAllowedDownloadUrl, normalizeSha256, sha256FromSums } from "../app-update";
import { releasePlatformKey } from "../app-update";
import { getAppVersion } from "../../environment";
import { loadConfig, updateConfig } from "../../config";

describe("Semver parsing and comparison", () => {
  it("parses valid semver versions correctly", () => {
    expect(parseSemver("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0, prerelease: undefined });
    expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: undefined });
    expect(parseSemver("V2.0.0-rc.1")).toEqual({ major: 2, minor: 0, patch: 0, prerelease: "rc.1" });
    expect(parseSemver("invalid")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });

  it("identifies newer versions accurately", () => {
    // Newer major
    expect(isNewerVersion("0.1.0", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(false);

    // Newer minor
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.1.9")).toBe(false);

    // Newer patch
    expect(isNewerVersion("0.1.0", "0.1.1")).toBe(true);
    expect(isNewerVersion("0.1.1", "0.1.0")).toBe(false);

    // Same version
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "v0.1.0")).toBe(false);

    // Prerelease comparison: stable is newer than prerelease
    expect(isNewerVersion("0.2.0-beta", "0.2.0")).toBe(true);
  });
});

describe("Release asset naming", () => {
  it("resolves the versioned asset filename per platform", () => {
    expect(getReleaseAssetName("0.2.1", "linux")).toBe("portfolio_0.2.1_amd64.deb");
    expect(getReleaseAssetName("0.2.1", "win32")).toBe("portfolio_0.2.1_x64_setup.exe");
    expect(getReleaseAssetName("0.2.1", "darwin")).toBe("portfolio_0.2.1_universal.dmg");
  });

  it("strips a leading v from the version", () => {
    expect(getReleaseAssetName("v0.2.1", "linux")).toBe("portfolio_0.2.1_amd64.deb");
  });
});

describe("AppUpdateService", () => {
  it("instantiates with valid default state", () => {
    const service = new AppUpdateService();
    const info = service.getUpdateInfo();
    expect(info.currentVersion).toBeDefined();
    expect(typeof info.enabled).toBe("boolean");
    expect(info.hasUpdate).toBe(false);
  });
});

describe("Installer download checks", () => {
  it("allows only https release hosts", () => {
    expect(isAllowedDownloadUrl("https://github.com/cgeosoft/portfolio/releases/download/v1.0.0/a.deb")).toBe(true);
    expect(isAllowedDownloadUrl("https://objects.githubusercontent.com/x")).toBe(true);
    expect(isAllowedDownloadUrl("https://portfolio.cgeosoft.com/releases/1.0.0/a.deb")).toBe(true);
    expect(isAllowedDownloadUrl("http://github.com/cgeosoft/portfolio/a.deb")).toBe(false);
    expect(isAllowedDownloadUrl("https://evil.example/a.deb")).toBe(false);
    expect(isAllowedDownloadUrl("https://github.com.evil.example/a.deb")).toBe(false);
    expect(isAllowedDownloadUrl("https://user:pw@github.com/a.deb")).toBe(false);
    expect(isAllowedDownloadUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedDownloadUrl("not a url")).toBe(false);
  });

  it("normalizes SHA-256 digests", () => {
    const hex = "a".repeat(64);
    expect(normalizeSha256(hex)).toBe(hex);
    expect(normalizeSha256(`sha256:${hex.toUpperCase()}`)).toBe(hex);
    expect(normalizeSha256("")).toBeUndefined();
    expect(normalizeSha256("sha512:abc")).toBeUndefined();
    expect(normalizeSha256(undefined)).toBeUndefined();
  });

  it("reads a digest from a SHA256SUMS listing", () => {
    const a = "1".repeat(64);
    const b = "2".repeat(64);
    const sums = `${a} *portfolio_1.0.0_amd64.deb\n${b}  portfolio_1.0.0_x64_setup.exe\n`;
    expect(sha256FromSums(sums, "portfolio_1.0.0_amd64.deb")).toBe(a);
    expect(sha256FromSums(sums, "portfolio_1.0.0_x64_setup.exe")).toBe(b);
    expect(sha256FromSums(sums, "portfolio_1.0.0_universal.dmg")).toBeUndefined();
  });

  it("rejects a version that is not semver", () => {
    const service = new AppUpdateService();
    expect(service.downloadUpdate("1.0.0/../../x", false, "")).toEqual({ success: false, error: "Invalid release version" });
    expect(service.downloadUpdate("v1.2.3", false, "").success).toBe(true);
  });
});

describe("releasePlatformKey", () => {
  it("maps Node platforms to release keys", () => {
    expect(releasePlatformKey("win32")).toBe("windows");
    expect(releasePlatformKey("darwin")).toBe("macos");
    expect(releasePlatformKey("linux")).toBe("linux");
    expect(releasePlatformKey("freebsd" as NodeJS.Platform)).toBe("linux");
  });
});

describe("AppUpdateService.checkForUpdates", () => {
  const GITHUB = "https://api.github.com/repos/cgeosoft/portfolio/releases/latest";
  const MANIFEST = "https://portfolio.cgeosoft.com/releases/latest.json";
  const current = getAppVersion();
  const next = `${parseSemver(current)!.major + 1}.0.0`;
  const canUpdate = current !== "0.0.0";
  const realFetch = globalThis.fetch;
  type Call = { url: string; init?: RequestInit };
  let calls: Call[] = [];
  let saved: { checkForUpdates: unknown; lastUpdateCheck: unknown; dismissedUpdateVersion: unknown };

  const assetUrl = (name: string) => `https://github.com/cgeosoft/portfolio/releases/download/v${next}/${name}`;
  const asset = (p: NodeJS.Platform, name = getReleaseAssetName(next, p)) => ({
    name,
    browser_download_url: assetUrl(getReleaseAssetName(next, p)),
    size: 1000,
    digest: `sha256:${"A".repeat(64)}`,
  });
  const release = (extra: Record<string, unknown> = {}) => ({
    tag_name: `v${next}`,
    name: `Portfolio ${next}`,
    body: "Notes",
    html_url: `https://github.com/cgeosoft/portfolio/releases/tag/v${next}`,
    published_at: "2026-10-01T00:00:00Z",
    assets: (["linux", "win32", "darwin"] as NodeJS.Platform[]).map((p) => asset(p)),
    ...extra,
  });
  const oldManifest = { app: "portfolio", version: "v0.0.1", name: "Old", notes: "", url: "https://portfolio.cgeosoft.com/#downloads", files: {} };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  function stubFetch(routes: { github?: () => Response; manifest?: () => Response }) {
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, init });
      if (url === GITHUB && routes.github) return routes.github();
      if (url === MANIFEST && routes.manifest) return routes.manifest();
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;
  }
  const headersOf = (call: Call | undefined) => (call?.init?.headers ?? {}) as Record<string, string>;

  beforeEach(() => {
    const cfg = loadConfig() as unknown as Record<string, unknown>;
    saved = { checkForUpdates: cfg.checkForUpdates, lastUpdateCheck: cfg.lastUpdateCheck, dismissedUpdateVersion: cfg.dismissedUpdateVersion };
    updateConfig({ checkForUpdates: true, lastUpdateCheck: undefined, dismissedUpdateVersion: undefined } as never);
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    updateConfig(saved as never);
  });

  it.skipIf(!canUpdate)("reads the latest GitHub release and reports an update", async () => {
    stubFetch({ github: () => json(release()) });
    const service = new AppUpdateService(MANIFEST);
    const seen: unknown[] = [];
    service.setOnUpdateAvailable((info: unknown) => seen.push(info));
    const info = await service.checkForUpdates();

    expect(info.hasUpdate).toBe(true);
    expect(info.latestVersion).toBe(next);
    expect(info.releaseName).toBe(`Portfolio ${next}`);
    expect(info.releaseUrl).toBe(`https://github.com/cgeosoft/portfolio/releases/tag/v${next}`);
    expect(info.releaseNotes).toBe("Notes");
    expect(info.publishedAt).toBe("2026-10-01T00:00:00Z");
    expect(typeof info.lastChecked).toBe("string");
    expect(info.lastChecked).toBe((loadConfig() as unknown as { lastUpdateCheck: string }).lastUpdateCheck);
    expect(info.error).toBeUndefined();

    const github = calls.find((c) => c.url === GITHUB);
    expect(headersOf(github).Accept).toBe("application/vnd.github.v3+json");
    expect(headersOf(github)["User-Agent"]).toBe(`Portfolio-Desktop/${current}`);
    expect(calls.some((c) => c.url === MANIFEST)).toBe(false);
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual(info);

    const download = service.downloadUpdate(next, false, "");
    expect(download).toMatchObject({ success: true, url: assetUrl(getReleaseAssetName(next)), fileName: getReleaseAssetName(next) });
  });

  it.skipIf(!canUpdate)("does not announce a dismissed version", async () => {
    updateConfig({ dismissedUpdateVersion: next } as never);
    stubFetch({ github: () => json(release()) });
    const service = new AppUpdateService(MANIFEST);
    let called = 0;
    service.setOnUpdateAvailable(() => called++);
    await service.checkForUpdates();
    expect(called).toBe(0);
  });

  it("falls back to the website manifest when GitHub refuses", async () => {
    stubFetch({ github: () => json({ message: "rate limited" }, 403), manifest: () => json(oldManifest) });
    const info = await new AppUpdateService(MANIFEST).checkForUpdates();
    const manifest = calls.find((c) => c.url === MANIFEST);
    expect(manifest).toBeDefined();
    expect(headersOf(manifest).Accept).toBe("application/json");
    expect(info.hasUpdate).toBe(false);
    expect(info.latestVersion).toBe("0.0.1");
  });

  it("falls back to the manifest when the GitHub release has no tag", async () => {
    stubFetch({ github: () => json(release({ tag_name: undefined })), manifest: () => json(oldManifest) });
    const info = await new AppUpdateService(MANIFEST).checkForUpdates();
    expect(calls.some((c) => c.url === MANIFEST)).toBe(true);
    expect(info.latestVersion).toBe("0.0.1");
  });

  it("reports the manifest error when both sources fail", async () => {
    stubFetch({
      github: () => {
        throw new Error("no route");
      },
      manifest: () => new Response("down", { status: 500 }),
    });
    const info = await new AppUpdateService(MANIFEST).checkForUpdates();
    expect(info.error).toBe("HTTP 500");
    expect(info.hasUpdate).toBe(false);

    stubFetch({
      github: () => {
        throw new Error("no route");
      },
      manifest: () => {
        throw new Error("offline");
      },
    });
    const offline = await new AppUpdateService(MANIFEST).checkForUpdates();
    expect(offline.error).toBe("offline");
  });

  it("does not fetch when checks are off unless forced", async () => {
    updateConfig({ checkForUpdates: false } as never);
    stubFetch({ github: () => json(release()) });
    const service = new AppUpdateService(MANIFEST);
    const info = await service.checkForUpdates();
    expect(info.enabled).toBe(false);
    expect(calls.length).toBe(0);
    await service.checkForUpdates(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it.skipIf(!canUpdate)("refuses an installer the manifest places on another host", async () => {
    const evil = (name: string) => ({ installer: { name, url: `https://evil.example/${name}` } });
    const manifest = { version: next, files: { linux: evil("x.deb"), windows: evil("x.exe"), macos: evil("x.dmg") } };
    stubFetch({ github: () => json({}, 403), manifest: () => json(manifest) });
    const service = new AppUpdateService(MANIFEST);
    await service.checkForUpdates();
    expect(service.downloadUpdate(next, false, "")).toEqual({ success: false, error: "Installer URL is not on a release download host" });
  });

  it.skipIf(!canUpdate)("keeps only the base name of an installer", async () => {
    const assets = (["linux", "win32", "darwin"] as NodeJS.Platform[]).map((p) => asset(p, "../../evil/" + getReleaseAssetName(next, p)));
    stubFetch({ github: () => json(release({ assets })) });
    const service = new AppUpdateService(MANIFEST);
    await service.checkForUpdates();
    expect(service.downloadUpdate(next, false, "").fileName).toBe(getReleaseAssetName(next));
  });

  it("uses the default GitHub URL for a version it has not seen", () => {
    const res = new AppUpdateService(MANIFEST).downloadUpdate("1.2.3", false, "");
    expect(res.url).toBe(`https://github.com/cgeosoft/portfolio/releases/download/v1.2.3/${getReleaseAssetName("1.2.3")}`);
  });
});

describe("Semver parsing extras", () => {
  it("accepts a missing patch and surrounding spaces, and rejects letters", () => {
    expect(parseSemver("1.2")).toEqual({ major: 1, minor: 2, patch: 0, prerelease: undefined });
    expect(parseSemver(" v1.2.3 ")).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver("1.x.0")).toBeNull();
  });

  // Suspected bug: modules/service/src/services/app-update.ts:35-44 prereleases of the same version are never compared
  it.failing("orders two prereleases of the same version", () => {
    expect(isNewerVersion("1.0.0-beta.1", "1.0.0-beta.2")).toBe(true);
  });

  it("does not treat an older prerelease or a prerelease of the current version as newer", () => {
    expect(isNewerVersion("1.0.0-rc.1", "1.0.0-beta.9")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.0.0-rc.1")).toBe(false);
  });
});
