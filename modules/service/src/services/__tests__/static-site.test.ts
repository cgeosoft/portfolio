import { describe, it, expect, afterAll } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StaticSite, inlineScriptHashes, securityHeaders } from "../../http/static";
import { serveDevGui, type DevGuiServer } from "../../http/dev-gui";
import { sponsorFrameResponse, sponsorTheme } from "../sponsor";

const THEME_SCRIPT = "\n      (function() { document.documentElement.classList.add('dark'); })();\n    ";
const INDEX = `<!DOCTYPE html><html><head><script>${THEME_SCRIPT}</script></head>
<body><div id="root"></div><script type="module" crossorigin src="/assets/index-abc.js"></script></body></html>`;

const sha = (text: string) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

describe("inlineScriptHashes", () => {
  it("hashes the inline theme script and skips scripts loaded by src", () => {
    expect(inlineScriptHashes(INDEX)).toEqual([sha(THEME_SCRIPT)]);
  });

  it("hashes the text with CR LF line ends turned into LF, as browsers do", () => {
    expect(inlineScriptHashes(INDEX.replace(/\n/g, "\r\n"))).toEqual([sha(THEME_SCRIPT)]);
  });
});

describe("securityHeaders", () => {
  const csp = securityHeaders([sha(THEME_SCRIPT)])["Content-Security-Policy"]!;

  it("allows the app's own scripts and the hashed inline one, never any inline script", () => {
    expect(csp).toContain(`script-src 'self' ${sha(THEME_SCRIPT)}`);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("keeps text from providers and models from reaching other servers", () => {
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("StaticSite", () => {
  const root = mkdtempSync(join(tmpdir(), "portfolio-gui-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), INDEX);
  writeFileSync(join(root, "assets", "index-abc.js"), "console.log(1)");
  const site = new StaticSite(root);
  const get = (path: string, accept = "text/html") => site.serve(new Request(`http://127.0.0.1:4000${path}`, { headers: { accept } }), new URL(`http://127.0.0.1:4000${path}`));

  it("serves assets as immutable and index.html with the policy", () => {
    expect(get("/assets/index-abc.js", "*/*")?.headers.get("Cache-Control")).toContain("immutable");
    const index = get("/settings");
    expect(index?.headers.get("Content-Security-Policy")).toContain(sha(THEME_SCRIPT));
    expect(index?.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("refuses paths outside the GUI directory", () => {
    expect(get("/%2e%2e/%2e%2e/etc/passwd", "*/*")?.status ?? 404).not.toBe(200);
    expect(get("/assets/%00x", "*/*")?.status).toBe(400);
  });

  it("serves nothing without a GUI directory (a checkout, where Vite serves the GUI)", () => {
    expect(new StaticSite(undefined).serve(new Request("http://127.0.0.1:4000/"), new URL("http://127.0.0.1:4000/"))).toBeNull();
  });
});

describe("sponsor frame", () => {
  it("serves the banner in a sandbox with an opaque origin", () => {
    const res = sponsorFrameResponse("<html><body>banner</body></html>");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp.startsWith("sandbox allow-scripts allow-popups;")).toBe(true);
    expect(csp).not.toContain("allow-same-origin");
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("answers 204 when no page is there", () => {
    expect(sponsorFrameResponse(null).status).toBe(204);
  });

  it("reads the theme from the parameter or a light page URL", () => {
    expect(sponsorTheme("light")).toBe("light");
    expect(sponsorTheme(null, "https://portfolio.cgeosoft.com/sponsor/light/")).toBe("light");
    expect(sponsorTheme("anything")).toBe("dark");
  });
});

describe("StaticSite edge cases", () => {
  const root = mkdtempSync(join(tmpdir(), "portfolio-gui-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), INDEX);
  writeFileSync(join(root, "assets", "index-abc.js"), "console.log(1)");
  const secretName = `portfolio-secret-${randomUUID()}.txt`;
  const secretPath = join(root, "..", secretName);
  writeFileSync(secretPath, "TOP SECRET");
  const empty = mkdtempSync(join(tmpdir(), "portfolio-gui-empty-"));
  const site = new StaticSite(root);
  const req = (method: string, path: string, accept = "text/html") =>
    site.serve(new Request("http://127.0.0.1:4000" + path, { method, headers: { accept } }), new URL("http://127.0.0.1:4000" + path));

  afterAll(() => {
    rmSync(secretPath, { force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  });

  it("serves GET and HEAD only", () => {
    expect(req("POST", "/")).toBeNull();
    const head = req("HEAD", "/");
    expect(head?.status).toBe(200);
    expect(head?.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("serves /index.html without long caching", () => {
    const res = req("GET", "/index.html");
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("sets the security headers on every file", () => {
    for (const res of [req("GET", "/assets/index-abc.js", "*/*"), req("GET", "/"), req("GET", "/index.html")]) {
      expect(res?.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res?.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res?.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(res?.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    }
  });

  it("limits frames, base and form targets in the policy", () => {
    const csp = req("GET", "/")?.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-src 'self' https://portfolio.cgeosoft.com");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(securityHeaders([])["Content-Security-Policy"]).toContain("script-src 'self';");
  });

  it("falls back to index.html only for page requests", async () => {
    expect(req("GET", "/missing.js", "*/*")).toBeNull();
    const page = req("GET", "/missing.js", "text/html");
    expect(page?.status).toBe(200);
    expect(await page!.text()).toBe(INDEX);
    expect(req("GET", "/assets", "*/*")).toBeNull();
  });

  it("never serves a file next to the GUI directory", async () => {
    for (const path of [`/..%2f${secretName}`, `/assets/..%2f..%2f${secretName}`]) {
      const asset = req("GET", path, "*/*");
      if (asset) expect(await asset.text()).not.toContain("TOP SECRET");
      expect(asset).toBeNull();
      const page = req("GET", path, "text/html");
      const text = await page!.text();
      expect(text).toBe(INDEX);
      expect(text).not.toContain("TOP SECRET");
    }
  });

  it("is unavailable when the directory has no index.html", () => {
    const none = new StaticSite(empty);
    expect(none.available).toBe(false);
    expect(none.serve(new Request("http://127.0.0.1:4000/"), new URL("http://127.0.0.1:4000/"))).toBeNull();
  });

  it("hashes each inline script in order, in any case, and skips src scripts", () => {
    expect(inlineScriptHashes("<script>a()</script><p></p><script>b()</script>")).toEqual([sha("a()"), sha("b()")]);
    expect(inlineScriptHashes("<SCRIPT>a()</SCRIPT>")).toEqual([sha("a()")]);
    expect(inlineScriptHashes("<script></script>")).toEqual(["'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='"]);
    expect(inlineScriptHashes('<script type="module" src="/x.js"></script>')).toEqual([]);
  });
});

describe("dev GUI forwarding", () => {
  it("forwards nothing before Vite reports its URL", async () => {
    expect(await serveDevGui(new Request("http://127.0.0.1:4000/"), new URL("http://127.0.0.1:4000/"), {} as DevGuiServer)).toBeNull();
  });
});
