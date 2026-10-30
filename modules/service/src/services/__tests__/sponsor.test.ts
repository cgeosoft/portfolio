/** Sponsor frame: theme choice, on-site URL scoping, offline fallback, caching and frame headers. */
import { describe, it, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sponsorTheme, loadSponsorPage, sponsorFrameResponse } from "../sponsor.js";
import { REPO_ROOT } from "../../paths.js";

const SITE = "https://portfolio.cgeosoft.com";
const bundled = (rel: string) => readFileSync(join(REPO_ROOT!, rel), "utf-8");
const bundledDark = () => bundled("extras/website/sponsor/index.html");
const bundledLight = () => bundled("extras/website/sponsor/light/index.html");

const originalFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

function stubFetch(reply: () => Response | Promise<Response>): void {
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return reply();
  }) as unknown as typeof fetch;
}
const failFetch = () =>
  stubFetch(() => {
    throw new Error("offline");
  });
const html = (s: string, init: ResponseInit = {}) => () => new Response(s, { status: 200, ...init });

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("sponsorTheme", () => {
  it("picks light only when asked", () => {
    expect(sponsorTheme("light")).toBe("light");
    expect(sponsorTheme(" LIGHT ")).toBe("light");
    expect(sponsorTheme(null, `${SITE}/sponsor/light/`)).toBe("light");
    expect(sponsorTheme("dark")).toBe("dark");
    expect(sponsorTheme(null, null)).toBe("dark");
    expect(sponsorTheme("blue")).toBe("dark");
  });
});

describe("sponsorFrameResponse", () => {
  it("answers 204 without a page", async () => {
    const res = sponsorFrameResponse(null);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("serves the page in a sandbox", async () => {
    const res = sponsorFrameResponse("<p>x</p>");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<p>x</p>");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "sandbox allow-scripts allow-popups; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; connect-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    );
  });
});

describe("loadSponsorPage", () => {
  it("falls back to the bundled pages offline", async () => {
    failFetch();
    expect(await loadSponsorPage("dark")).toBe(bundledDark());
    expect(await loadSponsorPage("light")).toBe(bundledLight());
  });

  it("falls back for an oversized, blank or missing page", async () => {
    stubFetch(html("<html>big</html>", { headers: { "content-length": "2000000" } }));
    expect(await loadSponsorPage("dark", `${SITE}/sponsor/big`)).toBe(bundledDark());
    stubFetch(html("   "));
    expect(await loadSponsorPage("dark", `${SITE}/sponsor/blank`)).toBe(bundledDark());
    stubFetch(() => new Response("nope", { status: 404 }));
    expect(await loadSponsorPage("dark", `${SITE}/sponsor/missing`)).toBe(bundledDark());
  });

  it("fetches an on-site page as HTML", async () => {
    stubFetch(html("<html>S</html>"));
    expect(await loadSponsorPage("dark", `${SITE}/sponsor/spring`)).toBe("<html>S</html>");
    expect(calls[0]!.url).toBe(`${SITE}/sponsor/spring/`);
    expect((calls[0]!.init.headers as Record<string, string>).Accept).toBe("text/html");

    stubFetch(html("<html>A</html>"));
    await loadSponsorPage("dark", `${SITE}/sponsor/a.html`);
    expect(calls[0]!.url).toBe(`${SITE}/sponsor/a.html`);

    stubFetch(html("<html>X</html>"));
    await loadSponsorPage("dark", `${SITE}/sponsor/x///`);
    expect(calls[0]!.url).toBe(`${SITE}/sponsor/x/`);
  });

  it("never fetches an off-site page", async () => {
    for (const raw of ["https://evil.example/x", "https://portfolio.cgeosoft.com.evil.example/"]) {
      failFetch();
      await loadSponsorPage("dark", raw);
      for (const c of calls) {
        expect(c.url).not.toContain("evil.example");
        expect(c.url.startsWith(`${SITE}/`)).toBe(true);
      }
    }
  });

  it("caches a fetched page", async () => {
    stubFetch(html("<html>C</html>"));
    await loadSponsorPage("dark", `${SITE}/sponsor/cached`);
    await loadSponsorPage("dark", `${SITE}/sponsor/cached`);
    expect(calls.length).toBe(1);
  });

  it("uses the default URL per theme", async () => {
    stubFetch(html("<html>D</html>"));
    await loadSponsorPage("dark");
    expect(calls[0]!.url).toBe(`${SITE}/sponsor/`);
    stubFetch(html("<html>L</html>"));
    await loadSponsorPage("light");
    expect(calls[0]!.url).toBe(`${SITE}/sponsor/light/`);
  });
});
