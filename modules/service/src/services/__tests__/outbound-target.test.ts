import { describe, it, expect, afterEach } from "bun:test";
import { loadConfig, saveConfig, updateConfig } from "../../config.js";
import { blockedRemoteTargets, fetchWithCheckedRedirects, isInternalAddress, isInternalTarget } from "../outbound-target.js";

const original = loadConfig();
const realFetch = globalThis.fetch;
afterEach(() => {
  saveConfig({ ...original });
  globalThis.fetch = realFetch;
});

describe("isInternalAddress", () => {
  it("flags loopback, private, link-local and unspecified addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "[::1]"]) {
      expect(isInternalAddress(ip)).toBe(true);
    }
  });

  it("passes public addresses", () => {
    for (const ip of ["1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:101:101"]) {
      expect(isInternalAddress(ip)).toBe(false);
    }
  });
});

describe("isInternalTarget", () => {
  it("reads the host of a URL, in any notation", async () => {
    expect(await isInternalTarget("http://127.0.0.1:8080/x")).toBe(true);
    expect(await isInternalTarget("http://2130706433/")).toBe(true);
    expect(await isInternalTarget("http://[::ffff:127.0.0.1]:9000")).toBe(true);
    expect(await isInternalTarget("http://localhost:3000")).toBe(true);
    expect(await isInternalTarget("https://1.1.1.1/")).toBe(false);
    expect(await isInternalTarget("not a url")).toBe(false);
  });
});

describe("blockedRemoteTargets", () => {
  it("blocks a new internal server and allows a saved one", async () => {
    updateConfig({ gotifyUrl: "http://192.168.1.5:8080", ntfyUrl: "https://ntfy.sh", llmBaseUrl: "", llmBaseUrls: {} });
    expect(await blockedRemoteTargets(["http://127.0.0.1:6379"])).toEqual(["http://127.0.0.1:6379"]);
    expect(await blockedRemoteTargets(["http://192.168.1.5:8080/"])).toEqual([]);
    expect(await blockedRemoteTargets(["http://127.0.0.1:1234/v1"])).toEqual([]);
    expect(await blockedRemoteTargets(["", undefined, "https://1.1.1.1"])).toEqual([]);
  });
});

describe("fetchWithCheckedRedirects", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  function queue(...responses: Response[]) {
    calls.length = 0;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return responses.shift() ?? new Response("end");
    }) as unknown as typeof fetch;
  }
  const redirect = (status: number, location: string) => new Response(null, { status, headers: { location } });
  const headersOf = (i: number) => new Headers(calls[i]!.init.headers);

  it("returns the first answer and asks fetch not to follow redirects", async () => {
    queue(new Response("ok"));
    const res = await fetchWithCheckedRedirects("https://1.1.1.1/a");
    expect(await res.text()).toBe("ok");
    expect(calls.length).toBe(1);
    expect(calls[0]!.init.redirect).toBe("manual");
  });

  it("keeps credentials on a same-origin redirect", async () => {
    queue(redirect(302, "/c"), new Response("ok"));
    await fetchWithCheckedRedirects("https://1.1.1.1/a", { headers: { Authorization: "Bearer k" } });
    expect(calls[1]!.url).toBe("https://1.1.1.1/c");
    expect(headersOf(1).get("authorization")).toBe("Bearer k");
  });

  it("strips credentials on a cross-origin redirect and keeps a 307 POST", async () => {
    queue(redirect(307, "https://8.8.8.8/b"), new Response("ok"));
    await fetchWithCheckedRedirects("https://1.1.1.1/a", {
      method: "POST",
      headers: { Authorization: "Bearer k", "X-Api-Key": "k", "Content-Type": "application/json", Accept: "application/json", "User-Agent": "t" },
      body: "{}",
    });
    const h = headersOf(1);
    expect([...h.keys()].sort()).toEqual(["accept", "content-type", "user-agent"]);
    expect(h.get("authorization")).toBeNull();
    expect(h.get("x-api-key")).toBeNull();
    expect(calls[1]!.init.method).toBe("POST");
    expect(calls[1]!.init.body).toBe("{}");
  });

  it("switches to GET after 303 and 302 on POST, and keeps the method otherwise", async () => {
    queue(redirect(303, "/b"), new Response("ok"));
    await fetchWithCheckedRedirects("https://1.1.1.1/a", { method: "POST", body: "{}" });
    expect(calls[1]!.init.method).toBe("GET");
    expect(calls[1]!.init.body).toBeUndefined();

    queue(redirect(302, "/b"), new Response("ok"));
    await fetchWithCheckedRedirects("https://1.1.1.1/a", { method: "POST", body: "{}" });
    expect(calls[1]!.init.method).toBe("GET");

    queue(redirect(301, "/b"), new Response("ok"));
    await fetchWithCheckedRedirects("https://1.1.1.1/a", { method: "GET" });
    expect(calls[1]!.init.method).toBe("GET");

    queue(redirect(308, "/b"), new Response("ok"));
    await fetchWithCheckedRedirects("https://1.1.1.1/a", { method: "POST", body: "{}" });
    expect(calls[1]!.init.method).toBe("POST");
    expect(calls[1]!.init.body).toBe("{}");
  });

  it("refuses a redirect from a public server to an internal one", async () => {
    for (const target of ["http://192.168.1.1/admin", "http://127.0.0.1:6379/", "http://[::1]/"]) {
      queue(redirect(302, target), new Response("secret"));
      await expect(fetchWithCheckedRedirects("https://1.1.1.1/")).rejects.toThrow("Refusing a redirect from a public server to this computer or the local network");
      expect(calls.length).toBe(1);
    }
  });

  it("allows a redirect between internal addresses", async () => {
    queue(redirect(302, "http://127.0.0.1:1234/v2"), new Response("second"));
    const res = await fetchWithCheckedRedirects("http://127.0.0.1:1234/v1");
    expect(await res.text()).toBe("second");
    expect(calls[1]!.url).toBe("http://127.0.0.1:1234/v2");
  });

  it("refuses a redirect to a non-HTTP address", async () => {
    for (const target of ["file:///etc/passwd", "javascript:alert(1)"]) {
      queue(redirect(302, target));
      await expect(fetchWithCheckedRedirects("https://1.1.1.1/")).rejects.toThrow("Refusing a redirect to a non-HTTP address");
    }
  });

  it("stops after too many redirects", async () => {
    calls.length = 0;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return redirect(302, "https://1.1.1.1/loop");
    }) as unknown as typeof fetch;
    await expect(fetchWithCheckedRedirects("https://1.1.1.1/")).rejects.toThrow("Too many redirects");
    expect(calls.length).toBe(6);
  });

  it("returns a 3xx without Location as is", async () => {
    queue(new Response(null, { status: 304 }));
    expect((await fetchWithCheckedRedirects("https://1.1.1.1/")).status).toBe(304);
    expect(calls.length).toBe(1);
    queue(new Response(null, { status: 302 }));
    expect((await fetchWithCheckedRedirects("https://1.1.1.1/")).status).toBe(302);
    expect(calls.length).toBe(1);
  });
});

describe("internal address extras", () => {
  it("flags multicast, broadcast, unique-local and link-local ranges", () => {
    for (const ip of ["224.0.0.1", "255.255.255.255", "ff02::1", "fc00::1", "feb0::1"]) expect(isInternalAddress(ip)).toBe(true);
    for (const ip of ["fec0::1", "100.63.255.255", "8.8.8.8", "not-an-ip", ""]) expect(isInternalAddress(ip)).toBe(false);
  });

  it("reads the host of more URL forms", async () => {
    expect(await isInternalTarget("http://foo.localhost/")).toBe(true);
    expect(await isInternalTarget("http://[fe80::1]/")).toBe(true);
    expect(await isInternalTarget("ftp://127.0.0.1/")).toBe(true);
    expect(await isInternalTarget("  http://127.0.0.1  ")).toBe(true);
    expect(await isInternalTarget("")).toBe(false);
  });

  it("ignores non-string targets and treats the default local LLM URL as saved", async () => {
    updateConfig({ llmBaseUrl: "", llmBaseUrls: {} });
    expect(await blockedRemoteTargets([42, null, {}, "  "] as unknown as string[])).toEqual([]);
    expect(await blockedRemoteTargets(["http://127.0.0.1:1234/v1"])).toEqual([]);
    expect(await blockedRemoteTargets(["http://127.0.0.1:1235/v1"])).toEqual(["http://127.0.0.1:1235/v1"]);
  });
});
