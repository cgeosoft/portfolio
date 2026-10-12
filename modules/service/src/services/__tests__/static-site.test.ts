import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StaticSite, inlineScriptHashes, securityHeaders } from "../../http/static";
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
