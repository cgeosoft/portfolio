import { describe, it, expect, afterEach, setSystemTime, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { loadConfig, saveConfig, updateConfig } from "../../config.js";
import { Router } from "../../http/router";
import { registerRoutes } from "../../http/routes";
import { authService, sessionCookieName } from "../auth";
import type { AppServices } from "../container";
import { OPENROUTER_BASE_URL, OPENROUTER_CALLBACK_PATH, callbackPage, completeOpenRouterConnect, openRouterConnectStatus, startOpenRouterConnect } from "../openrouter-connect.js";

const original = loadConfig();
const realFetch = globalThis.fetch;
afterEach(() => {
  saveConfig({ ...original });
  setSystemTime();
  globalThis.fetch = realFetch;
});

describe("OpenRouter connect", () => {
  it("builds a PKCE sign-in URL whose callback returns to this service on localhost", () => {
    const { authUrl, state } = startOpenRouterConnect("41234");
    const url = new URL(authUrl);
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("callback_url")).toBe(`http://localhost:41234${OPENROUTER_CALLBACK_PATH}${state}`);
    expect(openRouterConnectStatus(state).status).toBe("pending");
  });

  it("issues a different state and challenge for every sign-in", () => {
    const a = startOpenRouterConnect("1");
    const b = startOpenRouterConnect("1");
    expect(a.state).not.toBe(b.state);
    expect(new URL(a.authUrl).searchParams.get("code_challenge")).not.toBe(new URL(b.authUrl).searchParams.get("code_challenge"));
  });

  it("refuses a callback for a state it did not issue, without calling OpenRouter", async () => {
    const realFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    try {
      const res = await completeOpenRouterConnect("not-a-state", "code");
      expect(res.ok).toBe(false);
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(openRouterConnectStatus("not-a-state").status).toBe("expired");
  });

  it("marks the sign-in failed when OpenRouter refuses the code, and sends the verifier that matches the challenge", async () => {
    const { authUrl, state } = startOpenRouterConnect("1");
    const challenge = new URL(authUrl).searchParams.get("code_challenge");
    const realFetch = globalThis.fetch;
    let sent: { code?: string; code_verifier?: string; code_challenge_method?: string } = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response("{}", { status: 403 });
    }) as unknown as typeof fetch;
    try {
      const res = await completeOpenRouterConnect(state, "one-time-code");
      expect(res.ok).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent.code).toBe("one-time-code");
    expect(sent.code_challenge_method).toBe("S256");
    expect(createHash("sha256").update(sent.code_verifier!).digest("base64url")).toBe(challenge!);
    expect(openRouterConnectStatus(state).status).toBe("failed");
    // A state is good for one callback only.
    expect((await completeOpenRouterConnect(state, "again")).ok).toBe(false);
  });

  it("escapes the message on the callback page", () => {
    expect(callbackPage(false, "<script>x</script>")).not.toContain("<script>x");
  });
});

type FetchCall = { url: string; init: RequestInit };
function stubFetch(answer: () => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return answer();
  }) as unknown as typeof fetch;
  return calls;
}
const keyAnswer = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

describe("OpenRouter key exchange", () => {
  it("stores the key, base URL and default model on success", async () => {
    expect(OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1");
    updateConfig({ llmBaseUrls: {}, llmModels: {}, llmApiKeys: {} });
    const { state } = startOpenRouterConnect("1");
    const calls = stubFetch(keyAnswer({ key: "sk-or-v1-test" }));
    expect(await completeOpenRouterConnect(state, "c0de")).toEqual({ ok: true, message: "Portfolio is connected to OpenRouter. You can close this tab and return to the app." });
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(calls[0]!.init.method).toBe("POST");
    expect(new Headers(calls[0]!.init.headers).get("Content-Type")).toBe("application/json");

    const c = loadConfig();
    expect(c.llmProvider).toBe("openai-compatible");
    expect(c.llmBaseUrl).toBe(OPENROUTER_BASE_URL);
    expect(c.llmApiKey).toBe("sk-or-v1-test");
    expect(c.llmModel).toBe("openrouter/auto");
    expect(c.llmBaseUrls["openai-compatible"]).toBe(OPENROUTER_BASE_URL);
    expect(c.llmApiKeys["openai-compatible"]).toBe("sk-or-v1-test");
    expect(c.llmModels["openai-compatible"]).toBe("openrouter/auto");

    expect(openRouterConnectStatus(state)).toEqual({ status: "connected", message: "Connected to OpenRouter." });
    expect((await completeOpenRouterConnect(state, "c0de")).ok).toBe(false);
  });

  it("keeps a model chosen for OpenRouter before, and resets one chosen for another server", async () => {
    updateConfig({ llmBaseUrls: { "openai-compatible": "https://openrouter.ai/api/v1/" }, llmModels: { "openai-compatible": "anthropic/some-model" } });
    let { state } = startOpenRouterConnect("1");
    stubFetch(keyAnswer({ key: "sk-or-v1-test" }));
    expect((await completeOpenRouterConnect(state, "c0de")).ok).toBe(true);
    expect(loadConfig().llmModel).toBe("anthropic/some-model");

    updateConfig({ llmBaseUrls: { "openai-compatible": "http://127.0.0.1:1234/v1" }, llmModels: { "openai-compatible": "local-model" } });
    ({ state } = startOpenRouterConnect("1"));
    expect((await completeOpenRouterConnect(state, "c0de")).ok).toBe(true);
    expect(loadConfig().llmModel).toBe("openrouter/auto");
  });

  it("fails without an authorization code and does not call OpenRouter", async () => {
    const { state } = startOpenRouterConnect("1");
    const calls = stubFetch(keyAnswer({ key: "sk-or-v1-test" }));
    expect(await completeOpenRouterConnect(state, null)).toEqual({ ok: false, message: "OpenRouter did not return an authorization code." });
    expect(calls.length).toBe(0);
    expect(openRouterConnectStatus(state)).toEqual({ status: "failed", message: "OpenRouter did not return an authorization code." });
  });

  it("reports a network error", async () => {
    const { state } = startOpenRouterConnect("1");
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    expect(await completeOpenRouterConnect(state, "c0de")).toEqual({ ok: false, message: "Could not reach OpenRouter: ECONNREFUSED" });
  });

  it("refuses an answer without a key and keeps the stored key", async () => {
    updateConfig({ llmApiKey: "sk-before" });
    const before = loadConfig().llmApiKey;
    for (const body of [{}, { key: "  " }]) {
      const { state } = startOpenRouterConnect("1");
      stubFetch(keyAnswer(body));
      expect(await completeOpenRouterConnect(state, "c0de")).toEqual({ ok: false, message: "OpenRouter returned no API key." });
      expect(loadConfig().llmApiKey).toBe(before);
    }
  });

  it("never logs the key or the code", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const { state } = startOpenRouterConnect("1");
      stubFetch(keyAnswer({ key: "sk-or-v1-test" }));
      expect((await completeOpenRouterConnect(state, "c0de")).ok).toBe(true);
      const logged = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).not.toContain("sk-or-v1-test");
      expect(logged).not.toContain("c0de");
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("OpenRouter state expiry", () => {
  const T0 = new Date("2026-01-01T00:00:00Z").getTime();
  const MIN = 60_000;

  it("expires a sign-in after ten minutes without calling OpenRouter", async () => {
    setSystemTime(new Date(T0));
    const { state } = startOpenRouterConnect("1");
    setSystemTime(new Date(T0 + 10 * MIN + 1000));
    const status = openRouterConnectStatus(state);
    expect(status.status).toBe("expired");
    expect(status.message).toBeUndefined();
    const calls = stubFetch(keyAnswer({ key: "sk-or-v1-test" }));
    expect(await completeOpenRouterConnect(state, "x")).toEqual({ ok: false, message: "This sign-in is no longer valid. Start it again from Settings in Portfolio." });
    expect(calls.length).toBe(0);
  });

  it("stays pending at nine minutes and is gone after twenty", () => {
    setSystemTime(new Date(T0));
    const { state } = startOpenRouterConnect("1");
    setSystemTime(new Date(T0 + 9 * MIN));
    expect(openRouterConnectStatus(state).status).toBe("pending");
    setSystemTime(new Date(T0 + 20 * MIN + 1000));
    expect(openRouterConnectStatus(state)).toEqual({ status: "expired", message: "This sign-in is no longer valid. Start it again." });
  });
});

describe("OpenRouter routes", () => {
  const router = new Router();
  registerRoutes(router, {} as AppServices, () => {});
  const call = (method: string, path: string, cookie: string | null) => {
    const headers: Record<string, string> = { host: "127.0.0.1:4000" };
    if (cookie) headers.cookie = cookie;
    return router.handle(new Request("http://127.0.0.1:4000" + path, { method, headers }), "127.0.0.1");
  };

  it("starts a sign-in whose callback returns to this port and reports it pending", async () => {
    authService.acceptTerms();
    const cookie = `${sessionCookieName()}=${authService.login()}`;
    const res = (await call("POST", "/api/llm/openrouter/connect", cookie))!;
    expect(res.status).toBe(200);
    const { authUrl, state } = (await res.json()) as { authUrl: string; state: string };
    expect(new URL(authUrl).searchParams.get("callback_url")).toBe("http://localhost:4000/api/llm/openrouter/callback/" + state);
    const status = (await call("GET", `/api/llm/openrouter/connect/${state}`, cookie))!;
    expect(await status.json()).toEqual({ status: "pending" });
  });

  it("serves the callback page without a session", async () => {
    const res = (await call("GET", "/api/llm/openrouter/callback/unknown?code=x", null))!;
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toContain("Sign-in failed");
  });

  it("styles success and escapes quotes and ampersands", () => {
    const okPage = callbackPage(true, "ok");
    expect(okPage).toContain("Connected");
    expect(okPage).toContain("#34d399");
    expect(callbackPage(false, "a&b\"'")).toContain("a&#38;b&#34;&#39;");
  });
});
