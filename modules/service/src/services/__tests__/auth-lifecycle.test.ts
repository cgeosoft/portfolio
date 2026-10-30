/**
 * AuthService details: PIN format and storage, corrupt stored values, lockout wording, session expiry,
 * refresh and revocation, pruning, Terms of Use acceptance and the wrong-PIN log line.
 */
import { describe, it, expect, afterEach, setSystemTime, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { AuthService, REMOTE_SESSION_TTL_MS } from "../auth";
import { HttpError } from "../../http/router";
import { getDatabase } from "../../db/database";

const PIN = "246810";
const WRONG = "135791";
const WEEK = 7 * 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

const key = (id: string) => createHash("sha256").update(id).digest("hex");
const expiresAt = (id: string) => (getDatabase().query("SELECT expiresAt FROM sessions WHERE id = ?").get(key(id)) as { expiresAt: number } | null)?.expiresAt;
const setExpires = (id: string, at: number) => getDatabase().run("UPDATE sessions SET expiresAt = ? WHERE id = ?", [at, key(id)]);
const kv = (k: string) => getDatabase().query("SELECT value, expiresAt FROM kv_entries WHERE key = ?").get(k) as { value: string; expiresAt: number | null } | null;

function resetPin(): void {
  getDatabase().run("DELETE FROM kv_entries WHERE key = 'auth:pinHash' OR key LIKE 'rate-limit:pin%'");
}

function errorOf(fn: () => unknown): { status?: number; message: string } | null {
  try {
    fn();
  } catch (err) {
    return { status: err instanceof HttpError ? err.status : undefined, message: (err as Error).message };
  }
  return null;
}

function writeCounter(value: string): void {
  getDatabase().run("INSERT OR REPLACE INTO kv_entries (key, value, expiresAt) VALUES (?, ?, NULL)", ["rate-limit:pin:local", value]);
}

afterEach(() => {
  resetPin();
  setSystemTime();
});

describe("PIN rules and storage", () => {
  it("accepts exactly 6 digits", () => {
    const auth = new AuthService();
    for (const pin of ["12345", "1234567", "12a456", "", " 123456"]) {
      expect(errorOf(() => auth.setPin(pin))).toEqual({ status: 400, message: "PIN must be exactly 6 digits" });
    }
    expect(errorOf(() => auth.setPin("000000"))).toBeNull();
  });

  it("stores a salted scrypt hash, never the PIN", () => {
    const auth = new AuthService();
    auth.setPin(PIN);
    const first = kv("auth:pinHash")!.value;
    expect(first).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(first).not.toContain(PIN);
    // Changing an existing PIN needs the current one, so start again from no PIN.
    resetPin();
    auth.setPin(PIN);
    expect(kv("auth:pinHash")!.value).not.toBe(first);
  });

  it("never accepts a PIN against a corrupt stored hash", () => {
    const auth = new AuthService();
    auth.setPin(PIN);
    getDatabase().run("UPDATE kv_entries SET value = 'md5$x' WHERE key = 'auth:pinHash'");
    expect(errorOf(() => auth.login(PIN))).toEqual({ status: 401, message: "Wrong PIN" });
  });

  it("removes a PIN that was never set without throwing", () => {
    const auth = new AuthService();
    expect(() => auth.removePin("")).not.toThrow();
    expect(auth.isPinEnabled()).toBe(false);
  });
});

describe("PIN lockout details", () => {
  it("rounds the remaining lockout up to whole minutes", () => {
    const auth = new AuthService();
    auth.setPin(PIN);
    writeCounter(JSON.stringify({ failures: 5, lockedUntil: Date.now() + 30_000 }));
    expect(errorOf(() => auth.login(PIN))?.message).toBe("Too many attempts. Try again in 1 minute.");
    writeCounter(JSON.stringify({ failures: 5, lockedUntil: Date.now() + 61_000 }));
    expect(errorOf(() => auth.login(PIN))?.message).toBe("Too many attempts. Try again in 2 minutes.");
  });

  it("treats a corrupt counter as zero failures", () => {
    const auth = new AuthService();
    auth.setPin(PIN);
    writeCounter("not json");
    expect(errorOf(() => auth.login(PIN))).toBeNull();
  });

  it("forgets the counter a day after a wrong PIN", () => {
    const auth = new AuthService();
    auth.setPin(PIN);
    errorOf(() => auth.login(WRONG));
    const row = kv("rate-limit:pin:local");
    expect(row).not.toBeNull();
    expect(Math.abs(row!.expiresAt! - (Date.now() + 24 * HOUR))).toBeLessThanOrEqual(1000);
  });

  it("logs the lockout without the PIN digits", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const auth = new AuthService();
      auth.setPin(PIN);
      for (let i = 0; i < 5; i++) errorOf(() => auth.login(WRONG));
      const lines = logSpy.mock.calls.map((c) => c.join(" "));
      expect(lines.some((l) => l.includes("5 wrong PINs from this computer; locked for 5 min"))).toBe(true);
      expect(lines.some((l) => l.includes(WRONG))).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("session lifecycle", () => {
  it("creates a week-long session and rejects empty ids", () => {
    const auth = new AuthService();
    const id = auth.login();
    const remaining = expiresAt(id)! - Date.now();
    expect(remaining).toBeGreaterThan(WEEK - 60_000);
    expect(remaining).toBeLessThanOrEqual(WEEK);
    expect(auth.validateSession(null)).toBe(false);
    expect(auth.validateSession(undefined)).toBe(false);
    expect(auth.validateSession("")).toBe(false);
  });

  it("deletes an expired session on validation", () => {
    const auth = new AuthService();
    const id = auth.login();
    setExpires(id, Date.now() - 1);
    expect(auth.validateSession(id)).toBe(false);
    expect(expiresAt(id)).toBeUndefined();
  });

  it("refreshes a session only when it is more than an hour short", () => {
    const auth = new AuthService();
    const id = auth.login();
    const near = Date.now() + WEEK - 30 * 60_000;
    setExpires(id, near);
    expect(auth.validateSession(id)).toBe(true);
    expect(expiresAt(id)).toBe(near);
    setExpires(id, Date.now() + WEEK - 2 * HOUR);
    expect(auth.validateSession(id)).toBe(true);
    expect(expiresAt(id)! - Date.now()).toBeGreaterThan(WEEK - 60_000);
  });

  it("extends a remote session to a week when validated as local", () => {
    const auth = new AuthService();
    auth.setPin(PIN);
    const id = auth.login(PIN, "remote");
    const remaining = expiresAt(id)! - Date.now();
    expect(remaining).toBeLessThanOrEqual(REMOTE_SESSION_TTL_MS);
    expect(auth.validateSession(id, "local")).toBe(true);
    expect(expiresAt(id)! - Date.now()).toBeGreaterThan(WEEK - 60_000);
  });

  it("revokes all sessions or all but one", () => {
    const auth = new AuthService();
    const a = auth.login();
    auth.login();
    expect(auth.revokeOtherSessions(null)).toBeGreaterThanOrEqual(2);
    expect(auth.activeSessionCount()).toBe(0);
    const keep = auth.login();
    auth.login();
    auth.login();
    auth.revokeOtherSessions(keep);
    expect(auth.activeSessionCount()).toBe(1);
    expect(auth.validateSession(keep)).toBe(true);
    expect(auth.validateSession(a)).toBe(false);
  });

  it("does not count expired sessions", () => {
    const auth = new AuthService();
    const before = auth.activeSessionCount();
    const stale = createHash("sha256").update(crypto.randomUUID()).digest("hex");
    getDatabase().run("INSERT INTO sessions (id, expiresAt) VALUES (?, ?)", [stale, Date.now() - 1000]);
    try {
      expect(auth.activeSessionCount()).toBe(before);
    } finally {
      getDatabase().run("DELETE FROM sessions WHERE id = ?", [stale]);
    }
  });

  it("prunes expired sessions and kv rows, keeping rows without expiry", () => {
    const auth = new AuthService();
    const stale = createHash("sha256").update(crypto.randomUUID()).digest("hex");
    const keepKey = "test:keep-" + crypto.randomUUID();
    getDatabase().run("INSERT INTO sessions (id, expiresAt) VALUES (?, ?)", [stale, Date.now() - 1000]);
    getDatabase().run("INSERT OR REPLACE INTO kv_entries (key, value, expiresAt) VALUES ('test:old', 'x', ?)", [Date.now() - 1]);
    getDatabase().run("INSERT OR REPLACE INTO kv_entries (key, value, expiresAt) VALUES (?, 'y', NULL)", [keepKey]);
    try {
      auth.prune();
      expect(getDatabase().query("SELECT id FROM sessions WHERE id = ?").get(stale)).toBeNull();
      expect(kv("test:old")).toBeNull();
      expect(kv(keepKey)?.value).toBe("y");
    } finally {
      getDatabase().run("DELETE FROM sessions WHERE id = ?", [stale]);
      getDatabase().run("DELETE FROM kv_entries WHERE key IN ('test:old', ?)", [keepKey]);
    }
  });
});

describe("Terms of Use", () => {
  it("keeps the first acceptance time", () => {
    const auth = new AuthService();
    const first = auth.acceptTerms();
    expect(new Date(first).toISOString()).toBe(first);
    expect(auth.acceptTerms()).toBe(first);
    expect(new AuthService().acceptTerms()).toBe(first);
    expect(auth.acceptedTermsAt()).toBe(first);
  });
});
