import { describe, it, expect, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { AuthService, REMOTE_SESSION_TTL_MS, pinLockoutMs, sessionCookie } from "../auth";
import { getDatabase } from "../../db/database";

const PIN = "246810";
const WRONG = "135791";
const MINUTE = 60_000;

function reset(): void {
  getDatabase().run("DELETE FROM kv_entries WHERE key = 'auth:pinHash' OR key LIKE 'rate-limit:pin%'");
}

function withPin(): AuthService {
  reset();
  const auth = new AuthService();
  auth.setPin(PIN);
  return auth;
}

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "";
}

function unlockNow(scope: "local" | "remote"): void {
  const key = `rate-limit:pin:${scope}`;
  const row = getDatabase().query("SELECT value FROM kv_entries WHERE key = ?").get(key) as { value: string };
  const state = JSON.parse(row.value) as { failures: number; lockedUntil: number };
  getDatabase().run("UPDATE kv_entries SET value = ? WHERE key = ?", [JSON.stringify({ ...state, lockedUntil: Date.now() - 1 }), key]);
}

afterEach(reset);

describe("PIN lockout", () => {
  it("locks for 5 minutes after 5 wrong PINs and doubles after every 5 more, up to a day", () => {
    expect(pinLockoutMs(4)).toBe(0);
    expect(pinLockoutMs(5)).toBe(5 * MINUTE);
    expect(pinLockoutMs(6)).toBe(0);
    expect(pinLockoutMs(10)).toBe(10 * MINUTE);
    expect(pinLockoutMs(15)).toBe(20 * MINUTE);
    expect(pinLockoutMs(500)).toBe(24 * 60 * MINUTE);
  });

  it("refuses even the right PIN while locked", () => {
    const auth = withPin();
    for (let i = 0; i < 4; i++) expect(message(() => auth.login(WRONG))).toBe("Wrong PIN");
    expect(message(() => auth.login(WRONG))).toBe("Wrong PIN");
    expect(message(() => auth.login(PIN))).toMatch(/^Too many attempts\. Try again in 5 minutes\.$/);
  });

  it("keeps counting after a lockout ends, and the right PIN resets the count", () => {
    const auth = withPin();
    for (let i = 0; i < 5; i++) message(() => auth.login(WRONG));
    unlockNow("local");
    for (let i = 0; i < 5; i++) message(() => auth.login(WRONG));
    expect(message(() => auth.login(PIN))).toBe("Too many attempts. Try again in 10 minutes.");
    unlockNow("local");
    expect(auth.validateSession(auth.login(PIN))).toBe(true);
    for (let i = 0; i < 4; i++) message(() => auth.login(WRONG));
    expect(auth.validateSession(auth.login(PIN))).toBe(true);
  });

  it("keeps other devices' wrong PINs apart from the desktop window", () => {
    const auth = withPin();
    for (let i = 0; i < 5; i++) message(() => auth.login(WRONG, "remote"));
    expect(message(() => auth.login(PIN, "remote"))).toStartWith("Too many attempts");
    expect(auth.validateSession(auth.login(PIN, "local"))).toBe(true);
  });

  it("applies the counter to PIN changes too", () => {
    const auth = withPin();
    for (let i = 0; i < 5; i++) message(() => auth.removePin(WRONG, "remote"));
    expect(message(() => auth.removePin(PIN, "remote"))).toStartWith("Too many attempts");
    expect(auth.isPinEnabled()).toBe(true);
    auth.removePin(PIN, "local");
    expect(auth.isPinEnabled()).toBe(false);
  });
});

describe("remote session lifetime", () => {
  const expiresAt = (id: string) =>
    (getDatabase().query("SELECT expiresAt FROM sessions WHERE id = ?").get(createHash("sha256").update(id).digest("hex")) as { expiresAt: number }).expiresAt;

  it("gives a session opened from another device one day", () => {
    const auth = new AuthService();
    const id = auth.login(undefined, "remote");
    expect(expiresAt(id) - Date.now()).toBeLessThanOrEqual(REMOTE_SESSION_TTL_MS);
    expect(expiresAt(id) - Date.now()).toBeGreaterThan(REMOTE_SESSION_TTL_MS - MINUTE);
    auth.deleteSession(id);
  });

  it("shortens a week-long session once it is used from another device", () => {
    const auth = new AuthService();
    const id = auth.login();
    expect(expiresAt(id) - Date.now()).toBeGreaterThan(REMOTE_SESSION_TTL_MS);
    expect(auth.validateSession(id, "remote")).toBe(true);
    expect(expiresAt(id) - Date.now()).toBeLessThanOrEqual(REMOTE_SESSION_TTL_MS);
    auth.deleteSession(id);
  });

  it("sets a one-day cookie for other devices", () => {
    expect(sessionCookie("abc", false, "remote")).toContain(`Max-Age=${REMOTE_SESSION_TTL_MS / 1000}`);
    expect(sessionCookie("abc", false)).toContain(`Max-Age=${7 * 24 * 60 * 60}`);
  });
});
