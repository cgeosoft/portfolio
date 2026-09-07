import { describe, it, expect } from "bun:test";
import { parseSemver, isNewerVersion, AppUpdateService } from "../app-update.js";

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

describe("AppUpdateService", () => {
  it("instantiates with valid default state", () => {
    const service = new AppUpdateService();
    const info = service.getUpdateInfo();
    expect(info.currentVersion).toBeDefined();
    expect(typeof info.enabled).toBe("boolean");
    expect(info.hasUpdate).toBe(false);
  });
});
