import { describe, it, expect } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import {
  AuthService,
  LEGACY_SESSION_COOKIE,
  authService,
  clearLegacySessionCookie,
  clearSessionCookie,
  readSession,
  readSessionCookie,
  sessionCookie,
  sessionCookieName,
} from "../auth";
import { Router } from "../../http/router";
import { registerRoutes } from "../../http/routes";
import { getDatabase } from "../../db/database";
import type { AppServices } from "../container";

function withCookie(cookie: string | null, path = "/api/auth/me", method = "GET"): Request {
  const headers: Record<string, string> = { host: "127.0.0.1:4000" };
  if (cookie) headers["cookie"] = cookie;
  return new Request(`http://127.0.0.1:4000${path}`, { method, headers });
}

function cookieNames(res: Response): string[] {
  return res.headers.getSetCookie().map((c) => c.split("=")[0] ?? "");
}

describe("session cookie name", () => {
  it("differs per data directory and stays stable for one", () => {
    const a = sessionCookieName("/home/u/.local/share/portfolio");
    const b = sessionCookieName("/home/u/.local/share/portfolio-dev");
    expect(a).not.toBe(b);
    expect(sessionCookieName("/home/u/.local/share/portfolio")).toBe(a);
    expect(sessionCookieName("/home/u/.local/share/portfolio/../portfolio")).toBe(a);
    expect(a).toMatch(/^portfolio_session_[0-9a-f]{12}$/);
  });

  it("names the cookie it sets and clears after this data directory", () => {
    const name = sessionCookieName();
    expect(sessionCookie("abc", false).startsWith(`${name}=abc;`)).toBe(true);
    expect(sessionCookie("abc", true)).toContain("; Secure");
    expect(sessionCookie("abc", false)).toContain("HttpOnly");
    expect(sessionCookie("abc", false)).toContain("SameSite=Strict");
    expect(clearSessionCookie().startsWith(`${name}=;`)).toBe(true);
    expect(clearLegacySessionCookie().startsWith(`${LEGACY_SESSION_COOKIE}=;`)).toBe(true);
  });
});

describe("stored sessions", () => {
  const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
  const storedIds = () => (getDatabase().query("SELECT id FROM sessions").all() as { id: string }[]).map((row) => row.id);

  it("keeps the hash of a session id, never the id", () => {
    const id = authService.login();
    expect(storedIds()).not.toContain(id);
    expect(storedIds()).toContain(sha256(id));
    expect(authService.validateSession(id)).toBe(true);
    expect(authService.validateSession(sha256(id))).toBe(false);
    authService.deleteSession(id);
    expect(authService.validateSession(id)).toBe(false);
  });

  it("hashes a session an earlier release stored as a raw id, and keeps it valid", () => {
    const raw = randomUUID();
    getDatabase().run("INSERT INTO sessions (id, expiresAt) VALUES (?, ?)", [raw, Date.now() + 60_000]);
    expect(new AuthService().validateSession(raw)).toBe(true);
    expect(storedIds()).not.toContain(raw);
    expect(storedIds()).toContain(sha256(raw));
  });
});

describe("readSession", () => {
  it("reads this instance's cookie and ignores another instance's", () => {
    const own = sessionCookieName();
    const other = sessionCookieName("/somewhere/else");
    expect(readSession(withCookie(`${other}=theirs; ${own}=mine`))).toEqual({ id: "mine", legacy: false });
    expect(readSession(withCookie(`${other}=theirs`))).toBeNull();
  });

  it("falls back to the old shared name and prefers the new one", () => {
    const own = sessionCookieName();
    expect(readSession(withCookie(`${LEGACY_SESSION_COOKIE}=old`))).toEqual({ id: "old", legacy: true });
    expect(readSession(withCookie(`${LEGACY_SESSION_COOKIE}=old; ${own}=new`))).toEqual({ id: "new", legacy: false });
    expect(readSessionCookie(withCookie(null))).toBeNull();
  });

  it("treats an empty or malformed value as no session", () => {
    const own = sessionCookieName();
    expect(readSession(withCookie(`${own}=`))).toBeNull();
    expect(readSession(withCookie(`${own}=%E0%A4%A`))).toBeNull();
  });
});

describe("auth middleware", () => {
  const router = new Router();
  registerRoutes(router, {} as AppServices, () => {});
  authService.acceptTerms();

  it("accepts a session under the new name without setting cookies", async () => {
    const id = authService.login();
    const res = (await router.handle(withCookie(`${sessionCookieName()}=${id}`), "127.0.0.1"))!;
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("moves a valid session from the old name to the new one", async () => {
    const id = authService.login();
    const res = (await router.handle(withCookie(`${LEGACY_SESSION_COOKIE}=${id}`), "127.0.0.1"))!;
    expect(res.status).toBe(200);
    expect(cookieNames(res)).toEqual([sessionCookieName(), LEGACY_SESSION_COOKIE]);
    expect(res.headers.getSetCookie()[0]).toContain(`=${id};`);
  });

  it("leaves another instance's old cookie alone and answers 401", async () => {
    const res = (await router.handle(withCookie(`${LEGACY_SESSION_COOKIE}=not-ours`), "127.0.0.1"))!;
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("sets the new name on login", async () => {
    const res = (await router.handle(withCookie(null, "/api/auth/login", "POST"), "127.0.0.1"))!;
    expect(res.status).toBe(200);
    expect(cookieNames(res)).toEqual([sessionCookieName()]);
  });
});
