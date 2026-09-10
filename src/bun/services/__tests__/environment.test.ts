import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  isProduction,
  isDev,
  getEnvironmentName,
  isLocalhostUrl,
  resolveWebpageUrl,
  resolveDevEmail,
  getAppVersion,
  _resetEnvironmentCache,
} from "../../environment.js";

describe("Environment Detection & Required Configuration", () => {
  const originalNodeEnv = process.env["NODE_ENV"];
  const originalWebpageUrl = process.env["WEBPAGE_URL"];
  const originalWebpageEmail = process.env["WEBPAGE_EMAIL"];

  beforeEach(() => {
    _resetEnvironmentCache();
    delete process.env["WEBPAGE_URL"];
    delete process.env["WEBPAGE_EMAIL"];
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
    if (originalWebpageEmail !== undefined) {
      process.env["WEBPAGE_EMAIL"] = originalWebpageEmail;
    } else {
      delete process.env["WEBPAGE_EMAIL"];
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

  describe("environment detection", () => {
    it("detects development, production, and names them correctly", () => {
      process.env["NODE_ENV"] = "development";
      _resetEnvironmentCache();
      expect(isDev()).toBe(true);
      expect(isProduction()).toBe(false);
      expect(getEnvironmentName()).toBe("development");

      process.env["NODE_ENV"] = "production";
      _resetEnvironmentCache();
      expect(isProduction()).toBe(true);
      expect(isDev()).toBe(false);
      expect(getEnvironmentName()).toBe("production");
    });
  });

  describe("resolveWebpageUrl", () => {
    it("returns the required WEBPAGE_URL when set", () => {
      process.env["WEBPAGE_URL"] = "  https://portfolio.cgeosoft.com/  ";
      expect(resolveWebpageUrl()).toBe("https://portfolio.cgeosoft.com");
    });

    it("fails when WEBPAGE_URL is missing or blank", () => {
      expect(() => resolveWebpageUrl()).toThrow();
      process.env["WEBPAGE_URL"] = "   ";
      expect(() => resolveWebpageUrl()).toThrow();
    });
  });

  describe("resolveDevEmail", () => {
    it("returns the required WEBPAGE_EMAIL when set", () => {
      process.env["WEBPAGE_EMAIL"] = "  sponsors@example.com  ";
      expect(resolveDevEmail()).toBe("sponsors@example.com");
    });

    it("fails when WEBPAGE_EMAIL is missing or blank", () => {
      expect(() => resolveDevEmail()).toThrow();
      process.env["WEBPAGE_EMAIL"] = "   ";
      expect(() => resolveDevEmail()).toThrow();
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

  describe("config integration", () => {
    it("loads the baked WEBPAGE_URL into the persisted config", async () => {
      process.env["WEBPAGE_URL"] = "https://portfolio.cgeosoft.com";
      const { loadConfig } = await import("../../config.js");
      const config = loadConfig();
      expect(config.webpageUrl).toBe("https://portfolio.cgeosoft.com");
    });
  });
});