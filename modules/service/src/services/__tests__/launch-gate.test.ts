/**
 * Launch gate: the proof that a client is the desktop window, for the login without a PIN.
 */
import { afterAll, describe, it, expect } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { LAUNCH_PARAM, disableLaunchGateForTests, enableLaunchGate, hasLaunchProof, isLaunchGateEnabled, launchRedirect, launchTokenFile } from "../launch-gate";

const page = (query = "", init: RequestInit = {}) => {
  const url = new URL(`http://127.0.0.1:4000/${query}`);
  return { req: new Request(url, init), url };
};

afterAll(() => disableLaunchGateForTests());

describe("launch gate", () => {
  it("is off until enabled, so every client has proof", () => {
    expect(isLaunchGateEnabled()).toBe(false);
    expect(hasLaunchProof(page().req)).toBe(true);
    const { req, url } = page(`?${LAUNCH_PARAM}=abc`);
    expect(launchRedirect(req, url)).toBeNull();
  });

  it("writes a private token file and trades the token for a cookie", () => {
    enableLaunchGate();
    const token = readFileSync(launchTokenFile(), "utf8");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") expect(statSync(launchTokenFile()).mode & 0o777).toBe(0o600);

    expect(hasLaunchProof(page().req)).toBe(false);

    const { req, url } = page(`?onboarding=1&${LAUNCH_PARAM}=${token}`);
    const res = launchRedirect(req, url)!;
    expect(res.status).toBe(302);
    // The token leaves the address; the other parameters stay.
    expect(res.headers.get("location")).toBe("/?onboarding=1");
    const cookie = res.headers.getSetCookie()[0]!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(hasLaunchProof(page("", { headers: { cookie: cookie.split(";")[0]! } }).req)).toBe(true);
  });

  it("gives a wrong token no cookie", () => {
    const { req, url } = page(`?${LAUNCH_PARAM}=${"0".repeat(64)}`);
    const res = launchRedirect(req, url)!;
    expect(res.status).toBe(302);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(hasLaunchProof(page("", { headers: { cookie: `portfolio_launch=${"0".repeat(64)}` } }).req)).toBe(false);
  });

  it("ignores a request that is not a page load", () => {
    const { req, url } = page(`?${LAUNCH_PARAM}=x`, { method: "POST" });
    expect(launchRedirect(req, url)).toBeNull();
  });
});
