import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { OPENROUTER_CALLBACK_PATH, callbackPage, completeOpenRouterConnect, openRouterConnectStatus, startOpenRouterConnect } from "../openrouter-connect.js";

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
