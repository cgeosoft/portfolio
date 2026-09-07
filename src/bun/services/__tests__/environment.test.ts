import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  isProduction,
  isDev,
  getEnvironmentName,
  isLocalhostUrl,
  resolveWebpageUrl,
  getAppVersion,
  PROD_WEBPAGE_URL,
  DEV_WEBPAGE_URL,
  _resetEnvironmentCache,
} from "../../environment.js";

describe("Environment Detection & URL Resolution", () => {
  const originalNodeEnv = process.env["NODE_ENV"];
  const originalWebpageUrl = process.env["WEBPAGE_URL"];

  beforeEach(() => {
    _resetEnvironmentCache();
    delete process.env["WEBPAGE_URL"];
  });

  afterEach(() => {
    _resetEnvironmentCache();
    if (originalNodeEnv !== undefined) {
      process.env["NODE_ENV"] = originalNodeEnv;
    } else {
      delete process.env["NODE_ENV"];
    }
    if (originalWebpageUrl !== undefined) {
      process.env["WEBPAGE_URL"] = originalWebpageUrl;
    } else {
      delete process.env["WEBPAGE_URL"];
    }
  });

  describe("isLocalhostUrl", () => {
    it("identifies localhost and 127.0.0.1 URLs", () => {
      expect(isLocalhostUrl("http://localhost:3000")).toBe(true);
      expect(isLocalhostUrl("http://localhost:3000/terms")).toBe(true);
      expect(isLocalhostUrl("http://127.0.0.1:3000")).toBe(true);
      expect(isLocalhostUrl("http://127.0.0.1:9100")).toBe(true);
      expect(isLocalhostUrl("localhost:3000")).toBe(true);
      expect(isLocalhostUrl("http://[::1]:3000")).toBe(true);
    });

    it("identifies non-localhost external URLs", () => {
      expect(isLocalhostUrl("https://portfolio.cgeosoft.com")).toBe(false);
      expect(isLocalhostUrl("https://portfolio.cgeosoft.com/terms")).toBe(false);
      expect(isLocalhostUrl("https://cgeosoft.com")).toBe(false);
      expect(isLocalhostUrl("")).toBe(false);
      expect(isLocalhostUrl(undefined)).toBe(false);
    });
  });

  describe("resolveWebpageUrl", () => {
    it("defaults to DEV_WEBPAGE_URL when running in development", () => {
      process.env["NODE_ENV"] = "development";
      _resetEnvironmentCache();

      expect(isDev()).toBe(true);
      expect(isProduction()).toBe(false);
      expect(getEnvironmentName()).toBe("development");
      expect(resolveWebpageUrl()).toBe(DEV_WEBPAGE_URL);
    });

    it("honors custom URL or environment variable in development", () => {
      process.env["NODE_ENV"] = "development";
      _resetEnvironmentCache();

      expect(resolveWebpageUrl("http://localhost:8080")).toBe("http://localhost:8080");

      process.env["WEBPAGE_URL"] = "http://localhost:4000";
      expect(resolveWebpageUrl()).toBe("http://localhost:4000");
    });

    it("defaults to PROD_WEBPAGE_URL when running in production", () => {
      process.env["NODE_ENV"] = "production";
      _resetEnvironmentCache();

      expect(isProduction()).toBe(true);
      expect(isDev()).toBe(false);
      expect(getEnvironmentName()).toBe("production");
      expect(resolveWebpageUrl()).toBe(PROD_WEBPAGE_URL);
    });

    it("rejects localhost URLs in production and falls back to PROD_WEBPAGE_URL", () => {
      process.env["NODE_ENV"] = "production";
      _resetEnvironmentCache();

      // Configured localhost URL should be ignored in production
      expect(resolveWebpageUrl("http://localhost:3000")).toBe(PROD_WEBPAGE_URL);
      expect(resolveWebpageUrl("http://127.0.0.1:3000")).toBe(PROD_WEBPAGE_URL);

      // Environment variable pointing to localhost should also be ignored in production
      process.env["WEBPAGE_URL"] = "http://localhost:3000";
      expect(resolveWebpageUrl()).toBe(PROD_WEBPAGE_URL);
    });

    it("allows valid external production overrides", () => {
      process.env["NODE_ENV"] = "production";
      _resetEnvironmentCache();

      expect(resolveWebpageUrl("https://custom-site.example.com")).toBe("https://custom-site.example.com");
      expect(resolveWebpageUrl("https://custom-site.example.com/")).toBe("https://custom-site.example.com");
    });
  });

  describe("getAppVersion", () => {
    it("returns a valid semver version string", () => {
      const version = getAppVersion();
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("loadConfig migration", () => {
    it("migrates stale localhost webpageUrl in production", async () => {
      const { loadConfig } = await import("../../config.js");
      process.env["NODE_ENV"] = "production";
      _resetEnvironmentCache();

      const config = loadConfig();
      expect(config.webpageUrl).toBe(PROD_WEBPAGE_URL);
    });
  });
});

