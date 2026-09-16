import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { isProduction, isDev, getEnvironmentName, isLocalhostUrl, getAppVersion, _resetEnvironmentCache } from "../../environment";

describe("Environment detection", () => {
  const originalNodeEnv = process.env["NODE_ENV"];
  const originalVersion = process.env["PORTFOLIO_VERSION"];

  beforeEach(() => {
    _resetEnvironmentCache();
    delete process.env["PORTFOLIO_VERSION"];
  });

  afterEach(() => {
    _resetEnvironmentCache();
    if (originalNodeEnv !== undefined) process.env["NODE_ENV"] = originalNodeEnv;
    else delete process.env["NODE_ENV"];
    if (originalVersion !== undefined) process.env["PORTFOLIO_VERSION"] = originalVersion;
    else delete process.env["PORTFOLIO_VERSION"];
  });

  describe("isLocalhostUrl", () => {
    it("identifies localhost and 127.0.0.1 URLs", () => {
      expect(isLocalhostUrl("http://localhost:3000")).toBe(true);
      expect(isLocalhostUrl("http://127.0.0.1:8080")).toBe(true);
      expect(isLocalhostUrl("http://[::1]:3000")).toBe(true);
    });

    it("identifies external URLs", () => {
      expect(isLocalhostUrl("https://portfolio.cgeosoft.com")).toBe(false);
      expect(isLocalhostUrl("")).toBe(false);
      expect(isLocalhostUrl(undefined)).toBe(false);
    });
  });

  it("follows NODE_ENV", () => {
    process.env["NODE_ENV"] = "development";
    _resetEnvironmentCache();
    expect(isDev()).toBe(true);
    expect(getEnvironmentName()).toBe("development");

    process.env["NODE_ENV"] = "production";
    _resetEnvironmentCache();
    expect(isProduction()).toBe(true);
    expect(getEnvironmentName()).toBe("production");
  });

  it("treats a baked version without NODE_ENV as production", () => {
    delete process.env["NODE_ENV"];
    process.env["PORTFOLIO_VERSION"] = "1.2.3";
    _resetEnvironmentCache();
    expect(isProduction()).toBe(true);
    expect(getAppVersion()).toBe("1.2.3");
  });

  it("reads the workspace version in development", () => {
    process.env["NODE_ENV"] = "test";
    _resetEnvironmentCache();
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
