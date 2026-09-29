import { describe, it, expect } from "bun:test";
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

  it("allows a loopback origin on another port (Vite dev server)", () => {
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000", origin: "http://127.0.0.1:5173" }))).toBe(true);
    expect(isAllowedOrigin(req("POST", { host: "127.0.0.1:4000", origin: "http://localhost:5173" }))).toBe(true);
  });

  it("allows an origin that matches the request host (a phone on the LAN)", () => {
    expect(isAllowedOrigin(req("POST", { host: "192.168.1.10:5130", origin: "http://192.168.1.10:5130" }))).toBe(true);
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

  it("gzips a large body only for a client that accepts it", async () => {
    const router = build();
    const plain = await router.handle(req("GET", { host: "127.0.0.1:4000" }, "http://127.0.0.1:4000/api/big"), "127.0.0.1");
    expect(plain?.headers.get("Content-Encoding")).toBeNull();
    const gz = await router.handle(req("GET", { host: "127.0.0.1:4000", "accept-encoding": "gzip, deflate, br" }, "http://127.0.0.1:4000/api/big"), "127.0.0.1");
    expect(gz?.headers.get("Content-Encoding")).toBe("gzip");
    const bytes = new Uint8Array(await gz!.arrayBuffer());
    const parsed = JSON.parse(Buffer.from(Bun.gunzipSync(bytes)).toString("utf-8")) as { items: unknown[] };
    expect(parsed.items.length).toBe(2000);
    const small = await router.handle(req("GET", { host: "127.0.0.1:4000", "accept-encoding": "gzip" }, "http://127.0.0.1:4000/api/small"), "127.0.0.1");
    expect(small?.headers.get("Content-Encoding")).toBeNull();
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
});
