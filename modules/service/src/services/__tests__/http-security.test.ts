import { describe, it, expect } from "bun:test";
import { rememberJson } from "../../json-cache";
import { Router, hostnameOf, isAllowedOrigin, isLoopbackHostname, jsonFor } from "../../http/router";

function req(method: string, headers: Record<string, string> = {}, url = "http://127.0.0.1:4000/api/ping"): Request {
  return new Request(url, { method, headers });
}

describe("hostnameOf", () => {
  it("strips the port and brackets", () => {
    expect(hostnameOf("127.0.0.1:5130")).toBe("127.0.0.1");
    expect(hostnameOf("localhost")).toBe("localhost");
    expect(hostnameOf("[::1]:80")).toBe("::1");
    expect(hostnameOf("MyPC.local:5130")).toBe("mypc.local");
    expect(hostnameOf(null)).toBe("");
  });
});

describe("isLoopbackHostname", () => {
  it("accepts the names the desktop window and the dev server use", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("192.168.1.10")).toBe(false);
    expect(isLoopbackHostname("attacker.example")).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("allows requests without an Origin header", () => {
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000" }))).toBe(true);
  });

  it("allows a loopback origin on another port in a development run (Vite dev server)", () => {
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000", origin: "http://127.0.0.1:5173" }), true)).toBe(true);
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000", origin: "http://localhost:5173" }), true)).toBe(true);
  });

  it("rejects another port of the same host in the installed app (another program's page)", () => {
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000", origin: "http://127.0.0.1:5173" }), false)).toBe(false);
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000", origin: "http://localhost:4000" }), false)).toBe(false);
    expect(isAllowedOrigin(req("POST", { host: "192.168.1.10:5130", origin: "http://192.168.1.10:8080" }), false)).toBe(false);
  });

  it("allows an origin that matches the request host and port (the window, a phone on the LAN)", () => {
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000", origin: "http://127.0.0.1:4000" }), false)).toBe(true);
    expect(isAllowedOrigin(req("POST", { host: "192.168.1.10:5130", origin: "http://192.168.1.10:5130" }), false)).toBe(true);
    expect(isAllowedOrigin(req("POST", { host: "MyPC.local:5130", origin: "http://mypc.local:5130" }), false)).toBe(true);
  });

  it("rejects a foreign origin, an opaque origin and garbage", () => {
    expect(isAllowedOrigin(req("POST", { host: "192.168.1.10:5130", origin: "https://attacker.example" }))).toBe(false);
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000", origin: "https://attacker.example" }))).toBe(false);
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000", origin: "null" }))).toBe(false);
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000", origin: "not a url" }))).toBe(false);
  });
});

describe("Router", () => {
  function build(): Router {
    const router = new Router();
    router.post("/api/ping", () => ({ pong: true }));
    router.get("/api/big", () => ({ items: Array.from({ length: 2000 }, (_, i) => ({ i, text: "row ".repeat(4) })) }));
    router.get("/api/small", () => ({ ok: true }));
    return router;
  }

  it("answers a same-origin POST and refuses a cross-site one", async () => {
    const router = build();
    const ok = await router.handle(req("POST", { host: "127.0.0.1:4000", origin: "http://127.0.0.1:4000" }), "127.0.0.1");
    expect(ok?.status).toBe(200);
    expect(ok?.headers.get("Cache-Control")).toBe("no-store");
    const refused = await router.handle(req("POST", { host: "127.0.0.1:4000", origin: "https://attacker.example" }), "127.0.0.1");
    expect(refused?.status).toBe(403);
  });

  it("gzips a large body only for a remote client that accepts it", async () => {
    const router = build();
    const lan = "192.168.1.20";
    const plain = await router.handle(req("GET", { host: "192.168.1.10:5130" }, "http://192.168.1.10:5130/api/big"), lan);
    expect(plain?.headers.get("Content-Encoding")).toBeNull();
    const gz = await router.handle(req("GET", { host: "192.168.1.10:5130", "accept-encoding": "gzip, deflate, br" }, "http://192.168.1.10:5130/api/big"), lan);
    expect(gz?.headers.get("Content-Encoding")).toBe("gzip");
    const bytes = new Uint8Array(await gz!.arrayBuffer());
    const parsed = JSON.parse(Buffer.from(Bun.gunzipSync(bytes)).toString("utf-8")) as { items: unknown[] };
    expect(parsed.items.length).toBe(2000);
    const small = await router.handle(req("GET", { host: "192.168.1.10:5130", "accept-encoding": "gzip" }, "http://192.168.1.10:5130/api/small"), lan);
    expect(small?.headers.get("Content-Encoding")).toBeNull();
  });

  it("sends a large body uncompressed to the desktop window on loopback", async () => {
    const router = build();
    const res = await router.handle(req("GET", { host: "127.0.0.1:4000", "accept-encoding": "gzip, deflate, br" }, "http://127.0.0.1:4000/api/big"), "127.0.0.1");
    expect(res?.headers.get("Content-Encoding")).toBeNull();
    expect(((await res!.json()) as { items: unknown[] }).items.length).toBe(2000);
  });

  it("refuses a body over the route's limit, with or without a declared length", async () => {
    const router = new Router();
    router.post("/api/tiny", async (ctx) => ctx.body(64));
    const text = JSON.stringify({ pin: "x".repeat(200) });
    const declared = await router.handle(
      new Request("http://127.0.0.1:4000/api/tiny", { method: "POST", headers: { host: "127.0.0.1:4000", "content-length": String(text.length) }, body: text }),
      "127.0.0.1",
    );
    expect(declared?.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
    const chunked = await router.handle(
      new Request("http://127.0.0.1:4000/api/tiny", { method: "POST", headers: { host: "127.0.0.1:4000" }, body: stream }),
      "127.0.0.1",
    );
    expect(chunked?.status).toBe(413);
    const ok = await router.handle(
      new Request("http://127.0.0.1:4000/api/tiny", { method: "POST", headers: { host: "127.0.0.1:4000" }, body: JSON.stringify({ pin: "123456" }) }),
      "127.0.0.1",
    );
    expect(await ok?.json()).toEqual({ pin: "123456" });
  });

  it("treats a loopback address as remote when the caller says so (the LAN listener)", async () => {
    const router = new Router();
    router.get("/api/where", (ctx) => ({ isLocal: ctx.isLocal }));
    const window = await router.handle(req("GET", { host: "127.0.0.1:4000" }, "http://127.0.0.1:4000/api/where"), "127.0.0.1");
    expect(await window?.json()).toEqual({ isLocal: true });
    const lanPort = await router.handle(req("GET", { host: "127.0.0.1:5130" }, "http://127.0.0.1:5130/api/where"), "127.0.0.1", false);
    expect(await lanPort?.json()).toEqual({ isLocal: false });
  });

  it("answers 400 for a malformed path parameter instead of crashing", async () => {
    const router = new Router();
    router.get("/api/items/:id", (ctx) => ({ id: ctx.params.id }));
    const res = await router.handle(req("GET", {}, "http://127.0.0.1:4000/api/items/%E0%A4%A"), "127.0.0.1");
    expect(res?.status).toBe(400);
  });
});

describe("jsonFor", () => {
  it("never compresses a HEAD response", () => {
    const res = jsonFor(req("HEAD", { "accept-encoding": "gzip" }), { text: "x".repeat(10_000) });
    expect(res.headers.get("Content-Encoding")).toBeNull();
  });

  it("sends the kept text of a remembered payload", async () => {
    const data = { rows: [1, 2] };
    rememberJson(data, '{"rows":[1,2],"kept":true}');
    expect(await jsonFor(req("GET"), data).text()).toBe('{"rows":[1,2],"kept":true}');
    expect(await jsonFor(req("GET"), { rows: [3] }).text()).toBe('{"rows":[3]}');
  });
});
