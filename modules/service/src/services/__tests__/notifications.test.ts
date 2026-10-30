/** Gotify, ntfy and the notify fan-out: request shape, token scoping and error text. */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { sendGotify, isGotifyConfigured } from "../gotify.js";
import { sendNtfy, isNtfyConfigured } from "../ntfy.js";
import { notifyAll, channelNames, configuredChannels, testNotification } from "../notify.js";
import { loadConfig, updateConfig } from "../../config.js";

interface Call {
  url: string;
  init: RequestInit;
}

const KEYS = ["gotifyUrl", "gotifyToken", "gotifyPriority", "ntfyUrl", "ntfyTopic", "ntfyToken", "ntfyPriority", "language"] as const;
let saved: Record<string, unknown> = {};
const originalFetch = globalThis.fetch;
let calls: Call[] = [];

const msg = { title: "Growth: daily brief", message: "**+1.23%**\n- NVDA +3.50%" };

function stubFetch(reply: (url: string) => Response | Promise<Response> = () => new Response("{}", { status: 200 })): void {
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return reply(url);
  }) as unknown as typeof fetch;
}

const body = (i = 0) => JSON.parse(String(calls[i]!.init.body));
const headers = (i = 0) => calls[i]!.init.headers as Record<string, string>;

beforeAll(() => {
  const cfg = loadConfig() as unknown as Record<string, unknown>;
  saved = Object.fromEntries(KEYS.map((k) => [k, cfg[k]]));
  updateConfig({ language: "en" });
});

afterAll(() => {
  updateConfig(saved as Parameters<typeof updateConfig>[0]);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("sendGotify", () => {
  const configure = () => updateConfig({ gotifyUrl: "https://gotify.example.com", gotifyToken: "stored-token", gotifyPriority: 5 });

  it("posts markdown with the stored token", async () => {
    configure();
    stubFetch();
    const res = await sendGotify(msg);
    expect(res.success).toBe(true);
    expect(typeof res.latencyMs).toBe("number");
    expect(res.latencyMs!).toBeGreaterThanOrEqual(0);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://gotify.example.com/message");
    expect(calls[0]!.init.method).toBe("POST");
    expect(headers()).toEqual({ "Content-Type": "application/json", "X-Gotify-Key": "stored-token" });
    expect(body()).toEqual({
      title: msg.title,
      message: msg.message,
      priority: 5,
      extras: { "client::display": { contentType: "text/markdown" } },
    });
  });

  it("uses the target priority over the config", async () => {
    configure();
    stubFetch();
    await sendGotify(msg, { priority: 8 });
    expect(body().priority).toBe(8);
  });

  it("sends the stored token to the same server spelled with a slash", async () => {
    configure();
    stubFetch();
    await sendGotify(msg, { url: "https://gotify.example.com/" });
    expect(headers()["X-Gotify-Key"]).toBe("stored-token");
  });

  it("never sends the stored token to another server", async () => {
    configure();
    stubFetch();
    const res = await sendGotify(msg, { url: "https://other.example.com" });
    expect(res).toEqual({ success: false, error: "Set the Gotify server URL and application token first." });
    expect(calls.length).toBe(0);
  });

  it("treats a scheme change as another server", async () => {
    configure();
    stubFetch();
    const res = await sendGotify(msg, { url: "http://gotify.example.com" });
    expect(res).toEqual({ success: false, error: "Set the Gotify server URL and application token first." });
    expect(calls.length).toBe(0);
  });

  it("uses the target's own token on another server", async () => {
    configure();
    stubFetch();
    await sendGotify(msg, { url: "https://other.example.com", token: " own " });
    expect(calls[0]!.url).toBe("https://other.example.com/message");
    expect(headers()["X-Gotify-Key"]).toBe("own");
  });

  it("rejects a non-http URL", async () => {
    configure();
    stubFetch();
    const res = await sendGotify(msg, { url: "ftp://gotify.example.com", token: "t" });
    expect(res).toEqual({ success: false, error: "The Gotify server URL must start with http:// or https://." });
    expect(calls.length).toBe(0);
  });

  it("asks for setup when nothing is configured", async () => {
    updateConfig({ gotifyUrl: "", gotifyToken: "" });
    stubFetch();
    const res = await sendGotify(msg);
    expect(res.success).toBe(false);
    expect(res.error).toBe("Set the Gotify server URL and application token first.");
  });

  it("reports the server's error description", async () => {
    configure();
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: "Unauthorized", errorCode: 401, errorDescription: "you need to provide a valid access token" }), {
          status: 401,
        }),
    );
    const res = await sendGotify(msg);
    expect(res.success).toBe(false);
    expect(typeof res.latencyMs).toBe("number");
    expect(res.error).toBe("The Gotify server rejected the message (HTTP 401: you need to provide a valid access token).");
  });

  it("falls back to the error field", async () => {
    configure();
    stubFetch(() => new Response(JSON.stringify({ error: "Bad" }), { status: 400 }));
    const res = await sendGotify(msg);
    expect(res.error).toBe("The Gotify server rejected the message (HTTP 400: Bad).");
  });

  it("reports only the status for a non-JSON body", async () => {
    configure();
    stubFetch(() => new Response("oops", { status: 500 }));
    const res = await sendGotify(msg);
    expect(res.error).toBe("The Gotify server rejected the message (HTTP 500).");
  });

  it("reports a network failure", async () => {
    configure();
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const res = await sendGotify(msg);
    expect(res.success).toBe(false);
    expect(res.error).toBe("Could not reach the Gotify server: ECONNREFUSED");
  });

  it("is configured only with both URL and token", () => {
    updateConfig({ gotifyUrl: "https://gotify.example.com", gotifyToken: "  " });
    expect(isGotifyConfigured()).toBe(false);
    configure();
    expect(isGotifyConfigured()).toBe(true);
  });
});

describe("sendNtfy", () => {
  const configure = () => updateConfig({ ntfyUrl: "https://ntfy.sh", ntfyTopic: "portfolio-test_1", ntfyToken: "tk_stored", ntfyPriority: 3 });

  it("posts JSON with the stored token", async () => {
    configure();
    stubFetch();
    const res = await sendNtfy(msg);
    expect(res.success).toBe(true);
    expect(calls[0]!.url).toBe("https://ntfy.sh/");
    expect(calls[0]!.init.method).toBe("POST");
    expect(headers()).toEqual({ "Content-Type": "application/json", Authorization: "Bearer tk_stored" });
    expect(body()).toEqual({ topic: "portfolio-test_1", title: msg.title, message: msg.message, priority: 3, markdown: true });
  });

  it("sends no Authorization without a token", async () => {
    configure();
    updateConfig({ ntfyToken: "" });
    stubFetch();
    await sendNtfy(msg);
    expect(headers()).toEqual({ "Content-Type": "application/json" });
  });

  it("publishes to another server without the stored token", async () => {
    configure();
    stubFetch();
    await sendNtfy(msg, { url: "https://ntfy.example.org" });
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://ntfy.example.org/");
    expect(headers().Authorization).toBeUndefined();
  });

  it("sends the stored token to the same server spelled with a slash", async () => {
    configure();
    stubFetch();
    await sendNtfy(msg, { url: "https://ntfy.sh/" });
    expect(headers().Authorization).toBe("Bearer tk_stored");
  });

  it("uses the target topic", async () => {
    configure();
    stubFetch();
    await sendNtfy(msg, { topic: "other_topic" });
    expect(body().topic).toBe("other_topic");
  });

  it("rejects an invalid topic", async () => {
    configure();
    stubFetch();
    const error = "An ntfy topic has only letters, digits, - and _ (up to 64 characters).";
    for (const topic of ["bad topic", "a/b", "x".repeat(65)]) {
      expect(await sendNtfy(msg, { topic })).toEqual({ success: false, error });
    }
    expect(calls.length).toBe(0);
  });

  it("asks for a topic", async () => {
    configure();
    updateConfig({ ntfyTopic: "" });
    stubFetch();
    const res = await sendNtfy(msg);
    expect(res.success).toBe(false);
    expect(res.error).toBe("Set the ntfy topic first.");
  });

  it("rejects a non-http URL", async () => {
    configure();
    stubFetch();
    const res = await sendNtfy(msg, { url: "file:///tmp/x" });
    expect(res.error).toBe("The ntfy server URL must start with http:// or https://.");
    expect(calls.length).toBe(0);
  });

  it("reports server rejections", async () => {
    configure();
    stubFetch(() => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
    expect((await sendNtfy(msg)).error).toBe("The ntfy server rejected the message (HTTP 403: forbidden).");
    stubFetch(() => new Response("oops", { status: 500 }));
    expect((await sendNtfy(msg)).error).toBe("The ntfy server rejected the message (HTTP 500).");
  });

  it("reports a network failure", async () => {
    configure();
    globalThis.fetch = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect((await sendNtfy(msg)).error).toBe("Could not reach the ntfy server: timeout");
  });

  it("keeps a Unicode title", async () => {
    configure();
    stubFetch();
    await sendNtfy({ title: "Δοκιμή ✓", message: "x" });
    expect(body().title).toBe("Δοκιμή ✓");
  });

  it("is configured with a topic", () => {
    configure();
    expect(isNtfyConfigured()).toBe(true);
    updateConfig({ ntfyTopic: "" });
    expect(isNtfyConfigured()).toBe(false);
  });
});

describe("notify", () => {
  const both = () =>
    updateConfig({ gotifyUrl: "https://gotify.example.com", gotifyToken: "stored-token", ntfyUrl: "https://ntfy.sh", ntfyTopic: "portfolio-test_1", ntfyToken: "" });

  it("names channels", () => {
    expect(channelNames(["gotify", "ntfy"])).toBe("Gotify and ntfy");
    expect(channelNames(["ntfy"])).toBe("ntfy");
    expect(channelNames([])).toBe("");
  });

  it("lists configured channels in a fixed order", () => {
    both();
    expect(configuredChannels()).toEqual(["gotify", "ntfy"]);
    updateConfig({ gotifyUrl: "", gotifyToken: "" });
    expect(configuredChannels()).toEqual(["ntfy"]);
    updateConfig({ ntfyTopic: "" });
    expect(configuredChannels()).toEqual([]);
  });

  it("builds test notifications", () => {
    expect(testNotification("gotify")).toEqual({ title: "Portfolio", message: "Test message from Portfolio. Daily briefs will arrive here." });
    expect(testNotification("ntfy").message).toBe("Test message from Portfolio. Daily briefs and weekly analyses will arrive here.");
  });

  it("collects the error of a failing channel", async () => {
    both();
    stubFetch((url) => (url.endsWith("/message") ? new Response("{}", { status: 200 }) : new Response("x", { status: 500 })));
    expect(await notifyAll(msg)).toEqual({ ok: false, errors: ["The ntfy server rejected the message (HTTP 500)."] });
    expect(calls.length).toBe(2);
  });

  it("is ok when every channel accepts", async () => {
    both();
    stubFetch();
    expect(await notifyAll(msg)).toEqual({ ok: true, errors: [] });
  });

  it("is vacuously ok with no channels", async () => {
    stubFetch();
    expect(await notifyAll(msg, [])).toEqual({ ok: true, errors: [] });
    expect(calls.length).toBe(0);
  });
});
