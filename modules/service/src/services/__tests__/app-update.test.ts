import { describe, it, expect } from "bun:test";
import { parseSemver, isNewerVersion, getReleaseAssetName, AppUpdateService, isAllowedDownloadUrl, normalizeSha256, sha256FromSums } from "../app-update";

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
