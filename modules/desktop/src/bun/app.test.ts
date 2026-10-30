/** Desktop app identity and the environment switches read by the shell. */
import { afterEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { WEBPAGE_URL } from "../../../shared/src/brand";
import { APP, simulatedVersion, startQuery, userDataDir } from "./app";

const ENV_KEYS = ["PORTFOLIO_ONBOARDING", "PORTFOLIO_SIMULATE_VERSION"] as const;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("startQuery", () => {
  it("adds the onboarding query only for 1", () => {
    setEnv("PORTFOLIO_ONBOARDING", undefined);
    expect(startQuery()).toBe("");
    setEnv("PORTFOLIO_ONBOARDING", "1");
    expect(startQuery()).toBe("?onboarding=1");
    setEnv("PORTFOLIO_ONBOARDING", "true");
    expect(startQuery()).toBe("");
    setEnv("PORTFOLIO_ONBOARDING", "0");
    expect(startQuery()).toBe("");
  });
});

describe("simulatedVersion", () => {
  it("is undefined when unset", () => {
    setEnv("PORTFOLIO_SIMULATE_VERSION", undefined);
    expect(simulatedVersion()).toBeUndefined();
  });

  it("strips a leading v and surrounding spaces", () => {
    setEnv("PORTFOLIO_SIMULATE_VERSION", "v0.1.0");
    expect(simulatedVersion()).toBe("0.1.0");
    setEnv("PORTFOLIO_SIMULATE_VERSION", " V1.2.3-beta.1 ");
    expect(simulatedVersion()).toBe("1.2.3-beta.1");
    setEnv("PORTFOLIO_SIMULATE_VERSION", "01.2.3");
    expect(simulatedVersion()).toBe("01.2.3");
  });

  it("rejects values that are not a full version", () => {
    for (const value of ["1.2", "abc", "1.2.3 x", ""]) {
      setEnv("PORTFOLIO_SIMULATE_VERSION", value);
      expect(simulatedVersion()).toBeUndefined();
    }
  });
});

describe("userDataDir", () => {
  it.skipIf(process.platform !== "linux")("uses ~/.local/share/portfolio on Linux", () => {
    expect(userDataDir()).toBe(join(homedir(), ".local", "share", "portfolio"));
  });
});

describe("APP identity", () => {
  it("stays in step with the service and the website", () => {
    expect(APP.dirName).toBe("portfolio");
    expect(APP.websiteOrigin).toBe("https://portfolio.cgeosoft.com");
    expect(APP.websiteOrigin).toBe(WEBPAGE_URL);
    expect(APP.pages.starting.health(5123)).toBe("Waiting for the service to answer on port 5123.");
  });
});
