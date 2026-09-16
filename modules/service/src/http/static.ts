/**
 * Serves the built GUI (modules/gui/dist) next to the API. Content-hashed
 * files under /assets are immutable; index.html is revalidated on every load
 * so a new build is picked up on reload. Unknown non-API paths fall back to
 * index.html for client-side routes.
 */
import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http: https:; frame-src 'self' https:;",
};

export class StaticSite {
  private readonly indexFile: string;

  constructor(private readonly root: string) {
    this.indexFile = join(root, "index.html");
  }

  get available(): boolean {
    return existsSync(this.indexFile);
  }

  serve(req: Request, url: URL): Response | null {
    if (!this.available || (req.method !== "GET" && req.method !== "HEAD")) return null;
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (relative.split(sep).includes("..")) return new Response("Forbidden", { status: 403 });
    const candidate = join(this.root, relative);
    if (relative && existsSync(candidate) && statSync(candidate).isFile()) {
      const immutable = relative.startsWith(`assets${sep}`) || relative.startsWith("assets/");
      return this.file(candidate, immutable ? "public, max-age=31536000, immutable" : "no-cache");
    }
    if (!(req.headers.get("accept") || "").includes("text/html")) return null;
    return this.file(this.indexFile, "no-cache");
  }

  private file(path: string, cacheControl: string): Response {
    const headers = new Headers(SECURITY_HEADERS);
    headers.set("Cache-Control", cacheControl);
    return new Response(Bun.file(path), { headers });
  }
}
