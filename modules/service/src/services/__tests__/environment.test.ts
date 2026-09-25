import { describe, it, expect } from "bun:test";
import { isProduction, isDev, getEnvironmentName, isLocalhostUrl, getAppVersion } from "../../environment";

describe("Environment detection", () => {
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

  it("counts a run from the checkout as development", () => {
    expect(isDev()).toBe(true);
    expect(isProduction()).toBe(false);
    expect(getEnvironmentName()).toBe("development");
  });

  it("reads the workspace version from the checkout", () => {
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
