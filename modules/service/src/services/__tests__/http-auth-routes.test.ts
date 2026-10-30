/**
 * Auth routes over HTTP: status, login with and without a PIN, PIN set, change and removal, session
 * listing and revocation, logout, the Terms of Use gate and the desktop-only remote access route.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { Router } from "../../http/router";
import { registerRoutes } from "../../http/routes";
import { authService, sessionCookieName } from "../auth";
import { getDatabase } from "../../db/database";
import type { AppServices } from "../container";

const BASE = "http://127.0.0.1:4000";
const PIN = "246810";
const WRONG = "135791";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const router = new Router();
registerRoutes(router, {} as AppServices, () => {});

let cookie = "";

function resetPin(): void {
  getDatabase().run("DELETE FROM kv_entries WHERE key = 'auth:pinHash' OR key LIKE 'rate-limit:pin%'");
}

function cookieFor(sid: string): string {
  return `${sessionCookieName()}=${sid}`;
}

type CallOptions = { cookie?: string | null; ip?: string; isLocal?: boolean; headers?: Record<string, string> };

async function call(method: string, path: string, body?: unknown, o: CallOptions = {}) {
  const headers: Record<string, string> = { host: new URL(BASE).host, ...(o.headers ?? {}) };
  const c = o.cookie === undefined ? cookie : o.cookie;
  if (c) headers.cookie = c;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await router.handle(new Request(BASE + path, init), o.ip ?? "127.0.0.1", o.isLocal);
  expect(res).not.toBeNull();
  const text = await res!.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res!.status, body: (text ? JSON.parse(text) : null) as any, text, res: res! };
}

function sessionFrom(res: Response): string {
  return res.headers.getSetCookie()[0]!.split(";")[0]!.split("=")[1]!;
}

beforeAll(() => {
  authService.acceptTerms();
});

beforeEach(() => {
  resetPin();
  cookie = cookieFor(authService.login());
});

afterAll(() => {
  resetPin();
  authService.acceptTerms();
});

describe("auth status and login", () => {
  it("reports status without a cookie", async () => {
    const { status, body } = await call("GET", "/api/auth/status", undefined, { cookie: null });
    expect(status).toBe(200);
    expect(body.pinEnabled).toBe(false);
    expect(body.hasAcceptedTerms).toBe(true);
    expect(body.acceptedTermsAt).toMatch(ISO);
  });

  it("logs in without a PIN and sets a strict cookie", async () => {
    const { status, body, text, res } = await call("POST", "/api/auth/login", undefined, { cookie: null });
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, pinEnabled: false, hasAcceptedTerms: true, acceptedTermsAt: body.acceptedTermsAt });
    expect(body.acceptedTermsAt).toMatch(ISO);
    const cookies = res.headers.getSetCookie();
    expect(cookies.length).toBe(1);
    const set = cookies[0]!;
    expect(set.startsWith(`${sessionCookieName()}=`)).toBe(true);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Strict");
    expect(set).toContain("Path=/");
    expect(set).toContain("Max-Age=604800");
    expect(set).not.toContain("Secure");
    expect(text).not.toContain(sessionFrom(res));

    const secure = await call("POST", "/api/auth/login", undefined, { cookie: null, headers: { "x-forwarded-proto": "https" } });
    expect(secure.res.headers.getSetCookie()[0]).toContain("; Secure");
  });

  it("asks for the PIN once one is set and trims it", async () => {
    authService.setPin(PIN);
    const none = await call("POST", "/api/auth/login", {}, { cookie: null });
    expect(none.status).toBe(401);
    expect(none.body.message).toBe("PIN required");
    const wrong = await call("POST", "/api/auth/login", { pin: WRONG }, { cookie: null });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe("Wrong PIN");
    const number = await call("POST", "/api/auth/login", { pin: 246810 }, { cookie: null });
    expect(number.status).toBe(401);
    expect(number.body.message).toBe("PIN required");
    const padded = await call("POST", "/api/auth/login", { pin: " 246810 " }, { cookie: null });
    expect(padded.status).toBe(200);
    expect(padded.body.pinEnabled).toBe(true);
  });

  it("refuses a login body over 4096 bytes", async () => {
    const { status, body } = await call("POST", "/api/auth/login", { pin: "1".repeat(5000) }, { cookie: null });
    expect(status).toBe(413);
    expect(body.message).toBe("Request body is too large");
  });
});

describe("PIN routes", () => {
  it("sets a PIN, keeps the caller's session and revokes the others", async () => {
    const a = cookie.split("=")[1]!;
    const b = authService.login();
    const { status, body } = await call("PUT", "/api/auth/pin", { pin: PIN });
    expect(status).toBe(200);
    expect(body).toEqual({ pinEnabled: true });
    expect(authService.validateSession(b)).toBe(false);
    expect(authService.validateSession(a)).toBe(true);
    const after = await call("GET", "/api/auth/status");
    expect(after.body.pinEnabled).toBe(true);
  });

  it("requires exactly 6 digits", async () => {
    for (const body of [{ pin: "12345" }, { pin: "1234567" }, { pin: "abcdef" }, {}]) {
      const res = await call("PUT", "/api/auth/pin", body);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("PIN must be exactly 6 digits");
    }
  });

  it("changes the PIN only with the current one", async () => {
    authService.setPin(PIN);
    cookie = cookieFor(authService.login(PIN));
    const missing = await call("PUT", "/api/auth/pin", { pin: "111111" });
    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe("PIN required");
    const wrong = await call("PUT", "/api/auth/pin", { pin: "111111", currentPin: WRONG });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe("Wrong PIN");
    resetCounters();
    const ok = await call("PUT", "/api/auth/pin", { pin: "111111", currentPin: PIN });
    expect(ok.status).toBe(200);
    expect(() => authService.login("111111")).not.toThrow();
    expect(() => authService.login(PIN)).toThrow();
  });

  it("removes the PIN only with the current one", async () => {
    authService.setPin(PIN);
    cookie = cookieFor(authService.login(PIN));
    const wrong = await call("DELETE", "/api/auth/pin", { currentPin: WRONG });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe("Wrong PIN");
    expect(authService.isPinEnabled()).toBe(true);
    resetCounters();
    const ok = await call("DELETE", "/api/auth/pin", { currentPin: PIN });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ pinEnabled: false });
    const again = await call("DELETE", "/api/auth/pin", {});
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ pinEnabled: false });
  });
});

function resetCounters(): void {
  getDatabase().run("DELETE FROM kv_entries WHERE key LIKE 'rate-limit:pin%'");
}

describe("sessions and logout", () => {
  it("counts sessions and revokes all but the caller's", async () => {
    authService.login();
    authService.login();
    const before = await call("GET", "/api/auth/sessions");
    expect(before.body.active).toBeGreaterThanOrEqual(3);
    const revoked = await call("POST", "/api/auth/sessions/revoke-others");
    expect(revoked.body.revoked).toBeGreaterThanOrEqual(2);
    expect(authService.validateSession(cookie.split("=")[1]!)).toBe(true);
    const after = await call("GET", "/api/auth/sessions");
    expect(after.body).toEqual({ active: 1 });
  });

  it("logs out and clears the cookie", async () => {
    const { status, body, res } = await call("POST", "/api/auth/logout");
    expect(status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(res.headers.getSetCookie()).toContain(`${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    const me = await call("GET", "/api/auth/me");
    expect(me.status).toBe(401);
    expect(me.body.message).toBe("Invalid or expired session");
    const anon = await call("POST", "/api/auth/logout", undefined, { cookie: null });
    expect(anon.status).toBe(401);
    expect(anon.body.message).toBe("Session cookie is missing");
  });
});

describe("Terms of Use gate", () => {
  it("blocks the app until the terms are accepted", async () => {
    getDatabase().run("DELETE FROM kv_entries WHERE key = 'auth:acceptedTermsAt'");
    (authService as unknown as { termsCache: unknown }).termsCache = undefined;
    try {
      const blocked = await call("GET", "/api/portfolios");
      expect(blocked.status).toBe(403);
      expect(blocked.body.message).toBe("Terms of Use must be accepted before using the application");
      const me = await call("GET", "/api/auth/me");
      expect(me.status).toBe(200);
      expect(me.body).toEqual({ pinEnabled: false, hasAcceptedTerms: false, acceptedTermsAt: null });
      const health = await call("GET", "/api/health", undefined, { cookie: null });
      expect(health.status).toBe(200);
      const accept = await call("POST", "/api/auth/accept-terms");
      expect(accept.status).toBe(200);
      expect(accept.body.hasAcceptedTerms).toBe(true);
      expect(accept.body.acceptedTermsAt).toMatch(ISO);
      const again = await call("POST", "/api/auth/accept-terms");
      expect(again.body.acceptedTermsAt).toBe(accept.body.acceptedTermsAt);
      const open = await call("GET", "/api/portfolios");
      expect(open.status).not.toBe(403);
    } finally {
      authService.acceptTerms();
    }
  });

  it("lets logout through while the terms are not accepted", async () => {
    getDatabase().run("DELETE FROM kv_entries WHERE key = 'auth:acceptedTermsAt'");
    (authService as unknown as { termsCache: unknown }).termsCache = undefined;
    try {
      const out = await call("POST", "/api/auth/logout");
      expect(out.status).not.toBe(403);
    } finally {
      authService.acceptTerms();
    }
  });
});

describe("public paths and host controls", () => {
  it("matches public paths exactly", async () => {
    const { status } = await call("GET", "/api/health/", undefined, { cookie: null });
    expect(status).toBe(401);
  });

  it("reports and guards the remote access switch for the local window", async () => {
    const info = await call("GET", "/api/host/remote-access");
    expect(info.status).toBe(200);
    expect(info.body).toEqual({ enabled: false, port: info.body.port, urls: [], pinRequired: true, listening: false });
    expect(typeof info.body.port).toBe("number");
    const noPin = await call("PATCH", "/api/host/remote-access", { enabled: true });
    expect(noPin.status).toBe(400);
    expect(noPin.body.message).toBe("Set a PIN before allowing remote connections");
    for (const port of [80, "abc"]) {
      const res = await call("PATCH", "/api/host/remote-access", { port });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("The port must be a whole number from 1024 to 65535");
    }
  });
});
