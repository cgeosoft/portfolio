/**
 * Data paths from the checkout, the simulated app version and the JSON text cache.
 * Never opens the database while DATA_DIR points at a made-up path.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  APP_DIR_NAME,
  DATA_DIR,
  LEGACY_DATA_DIR,
  REPO_ROOT,
  defaultDataDir,
  setDataDirForTests,
  getDatabaseFile,
  getLogDir,
  getMetricsDir,
  getDesktopSettingsFile,
  getGuiDir,
  findBundledFile,
  getLangDir,
} from "../../paths";
import { getAppVersion, simulateAppVersion } from "../../environment";
import { rememberJson, toJson } from "../../json-cache";
import { closeDatabase } from "../../db/database";
import { saveConfig } from "../../config";

let previous: string;
beforeAll(() => {
  previous = DATA_DIR;
});
afterAll(() => {
  closeDatabase();
  setDataDirForTests(previous);
  saveConfig({} as any);
});

describe("paths", () => {
  it("names the app dir and the Linux default", () => {
    expect(APP_DIR_NAME).toBe("portfolio");
    if (process.platform === "linux") {
      expect(defaultDataDir()).toBe(join(homedir(), ".local", "share", "portfolio"));
    }
  });

  it("turns off the legacy import under tests", () => {
    expect(LEGACY_DATA_DIR).toBeUndefined();
  });

  it("derives every file from DATA_DIR", () => {
    const saved = DATA_DIR;
    try {
      setDataDirForTests("rel/dir-x");
      expect(DATA_DIR).toBe(resolve("rel/dir-x"));
      expect(getDatabaseFile().endsWith(join("rel", "dir-x", "portfolio.sqlite"))).toBe(true);
      expect(getLogDir()).toBe(join(DATA_DIR, "logs"));
      expect(getMetricsDir()).toBe(join(DATA_DIR, "metrics"));
      expect(getDesktopSettingsFile()).toBe(join(DATA_DIR, "desktop-settings.json"));
    } finally {
      setDataDirForTests(saved);
    }
  });

  it("finds the repo root from the checkout", () => {
    expect(REPO_ROOT).toBe(resolve(import.meta.dir, "../../../../.."));
  });

  it("has no bundled GUI dir in the checkout", () => {
    expect(getGuiDir()).toBeUndefined();
  });

  it("finds bundled files in the repo root", () => {
    expect(findBundledFile("no-such-bundled-file", "package.json")).toBe(join(REPO_ROOT!, "package.json"));
    expect(findBundledFile("no-such", "no-such-either")).toBeUndefined();
    expect(getLangDir()).toBe(join(REPO_ROOT!, "lang"));
  });
});

describe("environment", () => {
  it("simulates an app version", () => {
    const real = getAppVersion();
    try {
      simulateAppVersion("9.9.9");
      expect(getAppVersion()).toBe("9.9.9");
    } finally {
      simulateAppVersion(real);
    }
  });
});

describe("json-cache", () => {
  it("remembers the first text for an object", () => {
    const o = { a: 1 };
    expect(rememberJson(o)).toBe(JSON.stringify(o));
    expect(rememberJson(o, '{"other":1}')).toBe('{"a":1}');
  });

  it("keeps a given text verbatim", () => {
    const o2 = { x: 1 };
    expect(rememberJson(o2, '{"x": 1}')).toBe('{"x": 1}');
    expect(toJson(o2)).toBe('{"x": 1}');
  });

  it("keeps the old text after a mutation", () => {
    const o: { a: number } = { a: 1 };
    const text = rememberJson(o);
    o.a = 2;
    expect(toJson(o)).toBe(text);
  });

  it("stringifies values it has not seen", () => {
    const fresh = { b: [1, "x"] };
    expect(toJson(fresh)).toBe(JSON.stringify(fresh));
    expect(toJson(undefined)).toBe("null");
    expect(toJson(null)).toBe("null");
    expect(toJson(0)).toBe("0");
    expect(toJson(false)).toBe("false");
    expect(toJson("s")).toBe('"s"');
    expect(toJson([1, 2])).toBe("[1,2]");
  });
});
