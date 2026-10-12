/**
 * Serves the built GUI (modules/gui/dist) next to the API. Content-hashed
 * files under /assets are immutable; index.html is revalidated on every load
 * so a new build is picked up on reload. Unknown non-API paths fall back to
 * index.html for client-side routes.
 *
 * The Content-Security-Policy allows scripts from the app only, plus the one
 * inline script of index.html (the theme bootstrap) by its hash. The GUI
 * shows text from providers, news and language models, so the policy also
 * keeps that text from loading outside images or calling outside servers.
 * The sponsor banner is a separate sandboxed document with its own policy
 * (services/sponsor.ts), and the terms page is framed from the website.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { WEBPAGE_URL } from "portfolio-shared/brand";

/**
 * `'sha256-…'` sources for the inline scripts of index.html, so the policy
 * needs no 'unsafe-inline'. Browsers hash the text after turning CR LF and a
 * lone CR into LF, so the text is normalised the same way first.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.replace(/\r\n?/g, "\n").matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    hashes.push(`'sha256-${createHash("sha256").update(match[1] ?? "", "utf8").digest("base64")}'`);
  }
  return hashes;
}

/** Response headers for every file of the GUI. */
export function securityHeaders(scriptHashes: string[]): Record<string, string> {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      ["script-src 'self'", ...scriptHashes].join(" "),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      `frame-src 'self' ${new URL(WEBPAGE_URL).origin}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  };
}

export class StaticSite {
  private readonly indexFile: string | null;
  private headers: Record<string, string> | null = null;

  /** `root` is the built GUI directory; without one (a checkout, where Vite serves the GUI) nothing is served. */
  constructor(private readonly root: string | undefined) {
    this.indexFile = root ? join(root, "index.html") : null;
  }

  get available(): boolean {
    return this.indexFile !== null && existsSync(this.indexFile);
  }

  serve(req: Request, url: URL): Response | null {
    if (!this.root || !this.available || (req.method !== "GET" && req.method !== "HEAD")) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (decoded.includes("\0")) return new Response("Bad request", { status: 400 });
    const relative = normalize(decoded).replace(/^([/\\])+/, "");
    if (relative.split(sep).includes("..")) return new Response("Forbidden", { status: 403 });
    const candidate = join(this.root, relative);
    if (relative && existsSync(candidate) && statSync(candidate).isFile()) {
      const immutable = relative.startsWith(`assets${sep}`) || relative.startsWith("assets/");
      return this.file(candidate, immutable ? "public, max-age=31536000, immutable" : "no-cache");
    }
    if (!(req.headers.get("accept") || "").includes("text/html")) return null;
    return this.file(this.indexFile!, "no-cache");
  }

  /** The headers, with the hashes of the index.html on disk; read once, since the bundle does not change while it runs. */
  private securityHeaders(): Record<string, string> {
    if (!this.headers) {
      let html = "";
      try {
        html = readFileSync(this.indexFile!, "utf-8");
      } catch {
        // No index.html: no inline script to allow.
      }
      this.headers = securityHeaders(inlineScriptHashes(html));
    }
    return this.headers;
  }

  private file(path: string, cacheControl: string): Response {
    const headers = new Headers(this.securityHeaders());
    headers.set("Cache-Control", cacheControl);
    return new Response(Bun.file(path), { headers });
  }
}
