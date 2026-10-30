/**
 * Router contract: loopback helpers, error mapping, request ids, body parsing, middleware order,
 * Response pass-through and the per-error logging rules. No database, no services.
 */
import { describe, it, expect, spyOn } from "bun:test";
import { HttpError, MAX_BODY_BYTES, Router, boundedErrorMessage, hostnameOf, isAllowedOrigin, isLoopbackAddress, isLoopbackHostname, json } from "../../http/router";
import { appLogger } from "../../logger";

const BASE = "http://127.0.0.1:4000";

function request(method: string, path: string, init: { headers?: Record<string, string>; body?: string } = {}): Request {
  const headers: Record<string, string> = { host: "127.0.0.1:4000", ...(init.headers ?? {}) };
  const r: RequestInit = { method, headers };
  if (init.body !== undefined) r.body = init.body;
  return new Request(BASE + path, r);
}

async function send(router: Router, method: string, path: string, init: { headers?: Record<string, string>; body?: string } = {}) {
  return router.handle(request(method, path, init), "127.0.0.1");
}

async function bodyOf(res: Response | null): Promise<Record<string, unknown>> {
  expect(res).not.toBeNull();
  return (await res!.json()) as Record<string, unknown>;
}

describe("isLoopbackAddress", () => {
  it("accepts 127.0.0.0/8, ::1 and mapped 127.x", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.5.6.7")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects other addresses and empty values", () => {
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isLoopbackAddress("")).toBe(false);
    expect(isLoopbackAddress(null)).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress("::2")).toBe(false);
  });
});

describe("hostnameOf edge cases", () => {
  it("handles brackets, case, padding and odd input", () => {
    expect(hostnameOf("[::1]")).toBe("::1");
    expect(hostnameOf("[::1")).toBe("");
    expect(hostnameOf("  LOCALHOST:80  ")).toBe("localhost");
    expect(hostnameOf(":80")).toBe(":80");
    expect(hostnameOf("")).toBe("");
  });
});

describe("DNS rebinding", () => {
  it("does not treat a DNS name that starts with 127. as loopback", () => {
    expect(isLoopbackHostname("127.0.0.1.evil.example")).toBe(false);
    expect(isLoopbackHostname(hostnameOf("127.0.0.1.evil.example:4000"))).toBe(false);
    expect(isLoopbackAddress("127.evil")).toBe(false);
    const req = new Request("http://x/", { method: "POST", headers: { host: "127.0.0.1:4000", origin: "http://127.0.0.1.evil.example:9" } });
    expect(isAllowedOrigin(req, true)).toBe(false);
  });
});

describe("boundedErrorMessage", () => {
  it("returns short messages as they are", () => {
    expect(boundedErrorMessage(new Error("abc"))).toBe("abc");
    expect(boundedErrorMessage("plain")).toBe("plain");
    const exact = "z".repeat(1000);
    expect(boundedErrorMessage(new Error(exact))).toBe(exact);
  });

  it("cuts a long message to 1000 characters ending in an ellipsis", () => {
    const out = boundedErrorMessage(new Error("y".repeat(1500)));
    expect(out.length).toBe(1000);
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("y".repeat(999))).toBe(true);
  });
});

describe("json", () => {
  it("sets status, body and the safety headers", async () => {
    const res = json({ a: 1 });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"a":1}');
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("serializes undefined as null and keeps a custom status", async () => {
    expect(await json(undefined).text()).toBe("null");
    expect(json({}, 418).status).toBe(418);
  });
});

describe("Router matching", () => {
  it("returns null for an unknown path", async () => {
    const router = new Router();
    router.get("/api/a", () => ({}));
    expect(await send(router, "GET", "/api/b")).toBeNull();
  });

  it("answers 405 for a known path with another method", async () => {
    const router = new Router();
    router.get("/api/a", () => ({}));
    const res = await send(router, "DELETE", "/api/a");
    expect(res?.status).toBe(405);
    expect(await bodyOf(res)).toEqual({ statusCode: 405, message: "Method DELETE not allowed" });
    expect(res!.headers.get("X-Request-Id")).toBeNull();
    const head = await send(router, "HEAD", "/api/a");
    expect(head?.status).toBe(405);
  });

  // Suspected bug: modules/service/src/http/router.ts:247-265 HEAD of a GET route answers 405
  it.failing("answers HEAD on a GET route like GET without a body", async () => {
    const router = new Router();
    router.get("/api/a", () => ({ ok: true }));
    const res = await send(router, "HEAD", "/api/a");
    expect(res?.status).toBe(200);
    expect(await res!.text()).toBe("");
  });

  it("decodes path params and ignores a trailing slash and the query", async () => {
    const router = new Router();
    router.get("/api/items/:id", (ctx) => ({ id: ctx.params.id }));
    expect(await bodyOf(await send(router, "GET", "/api/items/a%20b"))).toEqual({ id: "a b" });
    expect(await bodyOf(await send(router, "GET", "/api/items/a%2Fb"))).toEqual({ id: "a/b" });
    expect(await bodyOf(await send(router, "GET", "/api/items/x/"))).toEqual({ id: "x" });
    expect(await bodyOf(await send(router, "GET", "/api/items/x?y=1"))).toEqual({ id: "x" });
    expect(await send(router, "GET", "/api/items/x/y")).toBeNull();
  });

  it("lets the first registered route win", async () => {
    const router = new Router();
    router.get("/api/a/:id", () => ({ which: "param" }));
    router.get("/api/a/special", () => ({ which: "fixed" }));
    expect(await bodyOf(await send(router, "GET", "/api/a/special"))).toEqual({ which: "param" });
  });

  it("answers success true when a handler returns nothing", async () => {
    const router = new Router();
    router.get("/api/a", () => undefined);
    const res = await send(router, "GET", "/api/a");
    expect(res?.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ success: true });
  });
});

describe("Router request ids", () => {
  function build(): Router {
    const router = new Router();
    router.get("/api/ok", () => ({ ok: true }));
    router.get("/api/fail", () => {
      throw new HttpError(400, "bad");
    });
    return router;
  }

  it("echoes a safe incoming id in the header and the error body", async () => {
    const router = build();
    const ok = await send(router, "GET", "/api/ok", { headers: { "x-request-id": "abc-123_X" } });
    expect(ok!.headers.get("X-Request-Id")).toBe("abc-123_X");
    const fail = await send(router, "GET", "/api/fail", { headers: { "x-request-id": "abc-123_X" } });
    expect(fail!.headers.get("X-Request-Id")).toBe("abc-123_X");
    expect((await bodyOf(fail)).requestId).toBe("abc-123_X");
  });

  it("replaces an unsafe or too long id with a random one", async () => {
    const router = build();
    const bad = await send(router, "GET", "/api/ok", { headers: { "x-request-id": "bad id!" } });
    expect(bad!.headers.get("X-Request-Id")).toMatch(/^[0-9a-f]{8}$/);
    const max = await send(router, "GET", "/api/ok", { headers: { "x-request-id": "a".repeat(64) } });
    expect(max!.headers.get("X-Request-Id")).toBe("a".repeat(64));
    const long = await send(router, "GET", "/api/ok", { headers: { "x-request-id": "a".repeat(65) } });
    expect(long!.headers.get("X-Request-Id")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("Router body parsing", () => {
  function build(): Router {
    const router = new Router();
    router.post("/api/b", async (ctx) => ({ got: await ctx.body() }));
    router.post("/api/twice", async (ctx) => {
      const a = await ctx.body();
      const b = await ctx.body();
      return { same: a === b };
    });
    return router;
  }

  it("reads blank and missing bodies as an empty object", async () => {
    const router = build();
    expect(await bodyOf(await send(router, "POST", "/api/b", { body: "   " }))).toEqual({ got: {} });
    expect(await bodyOf(await send(router, "POST", "/api/b"))).toEqual({ got: {} });
  });

  it("answers 400 for invalid JSON and passes arrays through", async () => {
    const router = build();
    const bad = await send(router, "POST", "/api/b", { body: "{not json" });
    expect(bad?.status).toBe(400);
    const body = await bodyOf(bad);
    expect(body.statusCode).toBe(400);
    expect(body.message).toBe("Request body is not valid JSON");
    expect(typeof body.requestId).toBe("string");
    expect(await bodyOf(await send(router, "POST", "/api/b", { body: "[1,2]" }))).toEqual({ got: [1, 2] });
  });

  it("returns the same object when the body is read twice", async () => {
    expect(await bodyOf(await send(build(), "POST", "/api/twice", { body: '{"a":1}' }))).toEqual({ same: true });
  });

  it("applies a per-route limit and caps a larger one at MAX_BODY_BYTES", async () => {
    expect(MAX_BODY_BYTES).toBe(30 * 1024 * 1024);
    const router = new Router();
    router.post("/api/t", (ctx) => ctx.body(10));
    router.post("/api/big", (ctx) => ctx.body(MAX_BODY_BYTES * 2));
    const text = JSON.stringify({ a: "x".repeat(20) });
    const res = await send(router, "POST", "/api/t", { body: text, headers: { "content-length": String(text.length) } });
    expect(res?.status).toBe(413);
    expect((await bodyOf(res)).message).toBe("Request body is too large");
    const small = JSON.stringify({ a: "x".repeat(90) });
    const ok = await send(router, "POST", "/api/big", { body: small, headers: { "content-length": String(small.length) } });
    expect(ok?.status).toBe(200);
  });
});

describe("Router errors and middleware", () => {
  it("maps HttpError and other thrown values", async () => {
    const router = new Router();
    router.get("/api/tea", () => {
      throw new HttpError(418, "teapot");
    });
    router.get("/api/boom", () => {
      throw new Error("boom");
    });
    router.get("/api/str", () => {
      throw "str";
    });
    const tea = await send(router, "GET", "/api/tea");
    expect(tea?.status).toBe(418);
    const teaBody = await bodyOf(tea);
    expect(teaBody).toEqual({ statusCode: 418, message: "teapot", requestId: teaBody.requestId });
    expect(typeof teaBody.requestId).toBe("string");
    const boom = await send(router, "GET", "/api/boom");
    expect(boom?.status).toBe(500);
    expect((await bodyOf(boom)).message).toBe("boom");
    const str = await send(router, "GET", "/api/str");
    expect(str?.status).toBe(500);
    expect((await bodyOf(str)).message).toBe("str");
  });

  it("checks the Origin of unsafe methods before any middleware", async () => {
    const router = new Router();
    let calls = 0;
    router.use(() => {
      calls++;
    });
    router.post("/api/a", () => ({ ok: true }));
    router.get("/api/a", () => ({ ok: true }));
    const res = await send(router, "POST", "/api/a", { headers: { origin: "https://evil.example" } });
    expect(res?.status).toBe(403);
    expect((await bodyOf(res)).message).toBe("Cross-origin requests are not allowed");
    expect(calls).toBe(0);
    const read = await send(router, "GET", "/api/a", { headers: { origin: "https://evil.example" } });
    expect(read?.status).toBe(200);
  });

  it("stops at a middleware that throws and runs middlewares in order", async () => {
    const router = new Router();
    let handled = false;
    router.use(() => {
      throw new HttpError(401, "nope");
    });
    router.get("/api/a", () => {
      handled = true;
      return {};
    });
    const res = await send(router, "GET", "/api/a");
    expect(res?.status).toBe(401);
    expect((await bodyOf(res)).message).toBe("nope");
    expect(handled).toBe(false);

    const order: string[] = [];
    const second = new Router();
    second.use(() => void order.push("a"));
    second.use(() => void order.push("b"));
    second.get("/api/a", () => ({}));
    await send(second, "GET", "/api/a");
    expect(order).toEqual(["a", "b"]);
  });
});

describe("Router Response pass-through", () => {
  it("keeps a handler's Cache-Control and adds no-store otherwise, with a request id on both", async () => {
    const router = new Router();
    router.get("/api/cached", () => new Response("x", { headers: { "Cache-Control": "max-age=60" } }));
    router.get("/api/plain", () => new Response("x"));
    const cached = await send(router, "GET", "/api/cached");
    expect(cached!.headers.get("Cache-Control")).toBe("max-age=60");
    expect(cached!.headers.get("X-Request-Id")).toBeTruthy();
    const plain = await send(router, "GET", "/api/plain");
    expect(plain!.headers.get("Cache-Control")).toBe("no-store");
    expect(plain!.headers.get("X-Request-Id")).toBeTruthy();
  });

  function withCookies(): Router {
    const router = new Router();
    router.use((ctx) => {
      ctx.responseHeaders.append("Set-Cookie", "a=1");
      ctx.responseHeaders.append("Set-Cookie", "b=2");
    });
    router.get("/api/response", () => new Response("x"));
    router.get("/api/json", () => ({ ok: true }));
    return router;
  }

  it("keeps every Set-Cookie on a JSON answer", async () => {
    const res = await send(withCookies(), "GET", "/api/json");
    expect(res!.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  // Suspected bug: modules/service/src/http/router.ts:292-294 only the first Set-Cookie is copied onto a handler Response
  it.failing("keeps every Set-Cookie when the handler returns a Response", async () => {
    const res = await send(withCookies(), "GET", "/api/response");
    expect(res!.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });
});

describe("Router logging", () => {
  it("logs a 500 with the route pattern, never the real path", async () => {
    const spy = spyOn(appLogger, "logStep");
    try {
      const router = new Router();
      router.get("/api/items/:id", () => {
        throw new Error("db down");
      });
      await send(router, "GET", "/api/items/SECRET-TICKER");
      const http = spy.mock.calls.filter((c) => c[1] === "http");
      expect(http.length).toBe(1);
      expect(http[0]![0]).toBe("error");
      expect(http[0]![3]).toBe("GET /api/items/:id -> 500 db down");
      expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET-TICKER");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not log 401 or 404", async () => {
    const spy = spyOn(appLogger, "logStep");
    try {
      const router = new Router();
      router.get("/api/401", () => {
        throw new HttpError(401, "who");
      });
      router.get("/api/404", () => {
        throw new HttpError(404, "where");
      });
      await send(router, "GET", "/api/401");
      await send(router, "GET", "/api/404");
      expect(spy.mock.calls.filter((c) => c[1] === "http").length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("logs other 4xx at debug without a session and at warning with one", async () => {
    const spy = spyOn(appLogger, "logStep");
    try {
      const anon = new Router();
      anon.get("/api/a", () => {
        throw new HttpError(400, "bad");
      });
      await send(anon, "GET", "/api/a");
      const withSession = new Router();
      withSession.use((ctx) => {
        ctx.sessionId = "s";
      });
      withSession.get("/api/a", () => {
        throw new HttpError(400, "bad");
      });
      await send(withSession, "GET", "/api/a");
      const levels = spy.mock.calls.filter((c) => c[1] === "http").map((c) => c[0]);
      expect(levels).toEqual(["debug", "warning"]);
    } finally {
      spy.mockRestore();
    }
  });
});
