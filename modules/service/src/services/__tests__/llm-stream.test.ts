/** LLM service over the OpenAI-compatible API: streaming frames, errors, headers and stored-key scoping. */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { LlmService } from "../llm.js";
import { loadConfig, updateConfig } from "../../config.js";

interface Call {
  url: string;
  init: RequestInit;
}

const enc = new TextEncoder();
const sse = (chunks: (string | Uint8Array)[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(typeof ch === "string" ? enc.encode(ch) : ch);
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
const d = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`;
const completion = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const msgs = [{ role: "user" as const, content: "Hi" }];
const originalFetch = globalThis.fetch;
let calls: Call[] = [];

function stubFetch(reply: (call: Call, index: number) => Response | Promise<Response>): void {
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return reply(call, calls.length - 1);
  }) as unknown as typeof fetch;
}
const headers = (i = 0) => (calls[i]!.init.headers ?? {}) as Record<string, string>;
const body = (i = 0) => JSON.parse(String(calls[i]!.init.body));

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("chatStream: chunk boundaries", () => {
  it("reassembles frames split across chunks", async () => {
    const tail = enc.encode('data: {"choices":[{"delta":{"content":"wörld"}}]}\r\n');
    const cut = tail.indexOf(0xc3) + 1;
    stubFetch(() =>
      sse([
        d("Hel") + "\n\n" + 'data: {"choi',
        'ces":[{"delta":{"content":"lo "}}]}\n',
        ": keep-alive\n",
        'data: {"choices":[{"delta":{}}]}\n',
        tail.slice(0, cut),
        tail.slice(cut),
        "data: [DONE]\n",
      ]),
    );
    const seen: string[] = [];
    const text = await new LlmService().chatStream(msgs, (s) => seen.push(s), { baseUrl: "http://127.0.0.1:19401", model: "m1" });
    expect(text).toBe("Hello wörld");
    expect(seen).toEqual(["Hel", "lo ", "wörld"]);
  });

  it("reads a final line without newline and the legacy text field", async () => {
    stubFetch(() => sse([d("A") + "\n", 'data: {"choices":[{"text":"!"}]}']));
    const text = await new LlmService().chatStream(msgs, () => {}, { baseUrl: "http://127.0.0.1:19402", model: "m1" });
    expect(text).toBe("A!");
  });

  it("skips a malformed frame", async () => {
    stubFetch(() => sse([d("A") + "\n", "data: {not json}\n", d("B") + "\n"]));
    const text = await new LlmService().chatStream(msgs, () => {}, { baseUrl: "http://127.0.0.1:19403", model: "m1" });
    expect(text).toBe("AB");
  });

  it("streams raw deltas but resolves the sanitized answer", async () => {
    stubFetch(() => sse([d("<think>plan") + "\n", d("</think>Answer") + "\n"]));
    const seen: string[] = [];
    const text = await new LlmService().chatStream(msgs, (s) => seen.push(s), { baseUrl: "http://127.0.0.1:19404", model: "m1" });
    expect(seen).toEqual(["<think>plan", "</think>Answer"]);
    expect(text).toBe("Answer");
  });

  it("drops a report preamble", async () => {
    stubFetch(() => sse([d("Sure:\n") + "\n", d("# R\nx") + "\n"]));
    const text = await new LlmService().chatStream(msgs, () => {}, { baseUrl: "http://127.0.0.1:19405", model: "m1", isReport: true });
    expect(text).toBe("# R\nx");
  });

  it("sends a streaming request", async () => {
    stubFetch(() => sse([d("ok") + "\n"]));
    await new LlmService().chatStream(msgs, () => {}, { baseUrl: "http://127.0.0.1:19406", model: "m1", temperature: 0.7 });
    expect(calls[0]!.url).toBe("http://127.0.0.1:19406/v1/chat/completions");
    const b = body();
    expect(b.stream).toBe(true);
    expect(b.model).toBe("m1");
    expect(b.max_tokens).toBe(3000);
    expect(b.temperature).toBe(0.7);
    expect(b.messages).toEqual(msgs);
  });

  it("stops when aborted mid-stream", async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    stubFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              ctrl = c;
              c.enqueue(enc.encode(d("A") + "\n"));
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    const ac = new AbortController();
    const seen: string[] = [];
    const run = new LlmService().chatStream(
      msgs,
      (s) => {
        seen.push(s);
        if (s === "A") {
          ac.abort();
          ctrl.enqueue(enc.encode(d("B") + "\n"));
        }
      },
      { baseUrl: "http://127.0.0.1:19407", model: "m1", signal: ac.signal },
    );
    let error: unknown;
    try {
      await run;
    } catch (e) {
      error = e;
    }
    expect((error as Error | undefined)?.name).toBe("AbortError");
    expect(seen).toEqual(["A"]);
  });

  it("reports a failed stream request", async () => {
    stubFetch(() => new Response("server exploded", { status: 500 }));
    await expect(new LlmService().chatStream(msgs, () => {}, { baseUrl: "http://127.0.0.1:19408", model: "m1" })).rejects.toThrow(
      "OpenAI-compatible API request failed with status 500: server exploded",
    );
  });
});

describe("chat: errors and headers", () => {
  it("sends a Bearer header only with a key", async () => {
    stubFetch(() => completion("ok"));
    await new LlmService().chat(msgs, { baseUrl: "http://127.0.0.1:19411", model: "m", apiKey: "sk-test" });
    expect(headers().Authorization).toBe("Bearer sk-test");
    stubFetch(() => completion("ok"));
    await new LlmService().chat(msgs, { baseUrl: "http://127.0.0.1:19412", model: "m" });
    expect("Authorization" in headers()).toBe(false);
  });

  it("collapses and truncates the error detail", async () => {
    stubFetch(() => new Response("a\n\n   b", { status: 500 }));
    let error = "";
    try {
      await new LlmService().chat(msgs, { baseUrl: "http://127.0.0.1:19413", model: "m" });
    } catch (e) {
      error = (e as Error).message;
    }
    expect(error.endsWith("status 500: a b")).toBe(true);

    stubFetch(() => new Response("x".repeat(400), { status: 500 }));
    error = "";
    try {
      await new LlmService().chat(msgs, { baseUrl: "http://127.0.0.1:19414", model: "m" });
    } catch (e) {
      error = (e as Error).message;
    }
    expect(error.endsWith(`: ${"x".repeat(299)}…`)).toBe(true);
  });

  it("rejects an empty completion", async () => {
    stubFetch(() => completion("  "));
    await expect(new LlmService().chat(msgs, { baseUrl: "http://127.0.0.1:19415", model: "m" })).rejects.toThrow(
      "No completion content returned from OpenAI-compatible",
    );
  });

  it("refuses a non-http base URL", async () => {
    stubFetch(() => completion("ok"));
    const svc = new LlmService();
    await expect(svc.chat(msgs, { baseUrl: "file:///etc/passwd", model: "m" })).rejects.toThrow(
      "OpenAI-compatible server URL must start with http:// or https://",
    );
    expect(await svc.getAvailableModels("openai-compatible", "file:///etc/passwd")).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("learns the token field from a 400 reply", async () => {
    stubFetch((_call, i) =>
      i === 0 ? new Response("Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.", { status: 400 }) : completion("ok"),
    );
    const opts = { baseUrl: "http://127.0.0.1:19416", model: "custom-r1" };
    expect(await new LlmService().chat(msgs, opts)).toBe("ok");
    expect(calls.length).toBe(2);
    const second = body(1);
    expect(second.max_completion_tokens).toBe(3000);
    expect("max_tokens" in second).toBe(false);
    expect("temperature" in second).toBe(true);

    stubFetch(() => completion("ok"));
    await new LlmService().chat(msgs, opts);
    expect(calls.length).toBe(1);
    expect(body().max_completion_tokens).toBe(3000);
  });

  it("knows only the CLI providers in cliStatus", async () => {
    const svc = new LlmService() as unknown as { cliStatus: (p: string) => Promise<unknown> };
    expect(await svc.cliStatus("openai-compatible")).toEqual({ installed: false, loggedIn: false, message: "Unknown CLI provider: openai-compatible" });
    expect(((await svc.cliStatus("gemini-cli")) as { message: string }).message).toBe("Unknown CLI provider: gemini-cli");
  });

  it("lists Claude CLI models without a request", async () => {
    stubFetch(() => completion("ok"));
    const models = await new LlmService().getAvailableModels("claude-cli");
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) expect(typeof m).toBe("string");
    expect(calls.length).toBe(0);
  });
});

describe("resolve: stored key goes only to the stored server", () => {
  type Cfg = Record<string, unknown> & { llmApiKeys?: Record<string, string>; llmBaseUrls?: Record<string, string>; llmModels?: Record<string, string> };
  let saved: Cfg = {};

  beforeAll(() => {
    const cfg = loadConfig() as unknown as Cfg;
    saved = {
      llmProvider: cfg.llmProvider,
      llmBaseUrl: cfg.llmBaseUrl,
      llmApiKey: cfg.llmApiKey,
      llmModel: cfg.llmModel,
      llmTemperature: cfg.llmTemperature,
      llmApiKeys: { "openai-compatible": cfg.llmApiKeys?.["openai-compatible"] ?? "", "claude-cli": cfg.llmApiKeys?.["claude-cli"] ?? "" },
      llmBaseUrls: { "openai-compatible": cfg.llmBaseUrls?.["openai-compatible"] ?? "", "claude-cli": cfg.llmBaseUrls?.["claude-cli"] ?? "" },
      llmModels: { "openai-compatible": cfg.llmModels?.["openai-compatible"] ?? "", "claude-cli": cfg.llmModels?.["claude-cli"] ?? "" },
    };
    updateConfig({
      llmProvider: "openai-compatible",
      llmBaseUrl: "http://127.0.0.1:19501",
      llmApiKey: "stored-key",
      llmModel: "stored-model",
      llmApiKeys: { "openai-compatible": "" },
      llmBaseUrls: { "openai-compatible": "" },
      llmModels: { "openai-compatible": "", "claude-cli": "" },
    } as Parameters<typeof updateConfig>[0]);
  });

  afterAll(() => {
    updateConfig(saved as Parameters<typeof updateConfig>[0]);
  });

  it("resolves the stored server and key", () => {
    expect(new LlmService().resolve()).toMatchObject({
      provider: "openai-compatible",
      name: "OpenAI-compatible",
      model: "stored-model",
      apiKey: "stored-key",
      baseUrl: "http://127.0.0.1:19501",
    });
  });

  it("matches the stored server with a trailing slash", () => {
    const r = new LlmService().resolve({ baseUrl: "http://127.0.0.1:19501/" });
    expect(r.apiKey).toBe("stored-key");
    expect(r.baseUrl).toBe("http://127.0.0.1:19501");
  });

  it("drops the stored key for another server", () => {
    expect(new LlmService().resolve({ baseUrl: "http://127.0.0.1:19502" }).apiKey).toBe("");
  });

  it("uses the caller's own key", () => {
    expect(new LlmService().resolve({ baseUrl: "https://evil.example", apiKey: " own " }).apiKey).toBe("own");
  });

  it("gives a CLI provider no key, URL or model", () => {
    expect(new LlmService().resolve({ provider: "claude-cli" })).toMatchObject({ provider: "claude-cli", apiKey: "", baseUrl: "", model: "" });
  });

  it("maps unknown providers to OpenAI-compatible", () => {
    const svc = new LlmService() as unknown as { resolve: (o: { provider: string }) => { provider: string } };
    expect(svc.resolve({ provider: "Groq" }).provider).toBe("openai-compatible");
    expect(svc.resolve({ provider: "llamacpp" }).provider).toBe("openai-compatible");
  });

  it("keeps temperature 0 and trims the model", () => {
    expect(new LlmService().resolve({ temperature: 0 }).temperature).toBe(0);
    expect(new LlmService().resolve({ model: "  x  " }).model).toBe("x");
  });

  it("prefers the per-provider key", () => {
    updateConfig({ llmApiKeys: { "openai-compatible": "map-key" } } as Parameters<typeof updateConfig>[0]);
    try {
      expect(new LlmService().resolve().apiKey).toBe("map-key");
    } finally {
      updateConfig({ llmApiKeys: { "openai-compatible": "" } } as Parameters<typeof updateConfig>[0]);
    }
  });

  it("never sends the stored key to another server", async () => {
    stubFetch(() => completion("ok"));
    await new LlmService().chat(msgs, { baseUrl: "http://127.0.0.1:19503", model: "m" });
    expect(calls.length).toBe(1);
    expect("Authorization" in headers()).toBe(false);
  });
});
