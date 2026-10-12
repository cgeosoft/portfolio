/**
 * The sponsor banner on the overview: a page of the Portfolio website, or
 * the copy that ships next to the bundle when the website is out of reach.
 *
 * The page is someone else's HTML with its own scripts, so the GUI never
 * puts it into its own document. `GET /api/app/sponsor/frame` serves it as a
 * separate document with the policy below: the `sandbox` directive gives it
 * an opaque origin (no session cookie, no API, no access to the app's DOM),
 * and its scripts talk to the app only through `postMessage`. The app's own
 * Content-Security-Policy (static.ts) then needs neither inline scripts nor
 * outside connections for it.
 */
import { readFileSync } from "node:fs";
import { WEBPAGE_URL } from "portfolio-shared/brand";
import { findBundledFile } from "../paths";

export type SponsorTheme = "light" | "dark";

/** Policy of the banner document; it also covers a browser that opens the URL directly. */
const FRAME_POLICY = [
  "sandbox allow-scripts allow-popups",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: https:",
  "font-src data: https:",
  "connect-src https:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

/** A fetched page is kept this long, so the overview does not ask the website on every visit. */
const CACHE_MS = 10 * 60_000;
/** The banner is a page of about 20 KB; anything far larger is not one. */
const MAX_PAGE_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 4000;

const fetched = new Map<string, { html: string; at: number }>();

/** True for a page on the Portfolio website; the service fetches nothing else for the banner. */
function isWebsiteUrl(value: string): boolean {
  try {
    return new URL(value).origin === new URL(WEBPAGE_URL).origin;
  } catch {
    return false;
  }
}

/** The page to fetch: `rawUrl` when it is on the website, else the banner page for the theme. */
function pageUrl(theme: SponsorTheme, rawUrl?: string): string {
  if (rawUrl && isWebsiteUrl(rawUrl)) {
    const clean = rawUrl.replace(/\/+$/, "");
    return clean.endsWith(".html") ? clean : `${clean}/`;
  }
  const base = WEBPAGE_URL.replace(/\/+$/, "");
  return theme === "light" ? `${base}/sponsor/light/` : `${base}/sponsor/`;
}

/** Offline sponsor page: next to the service bundle, or the website source in a checkout. */
function fallbackFile(theme: SponsorTheme): string | undefined {
  if (theme === "light") {
    const light =
      findBundledFile("sponsor-light.html", "extras/website/sponsor/light/index.html") ??
      findBundledFile("sponsor-light.html", "extras/website/sponsor/light.html");
    if (light) return light;
  }
  return findBundledFile("sponsor.html", "extras/website/sponsor/index.html");
}

/** The theme a request asks for; a URL of the light page counts as asking for light. */
export function sponsorTheme(theme: string | null, rawUrl?: string | null): SponsorTheme {
  return (theme ?? "").trim().toLowerCase() === "light" || (rawUrl ?? "").includes("/sponsor/light") ? "light" : "dark";
}

/** The banner page: from the website, else the bundled copy; null when neither is there. */
export async function loadSponsorPage(theme: SponsorTheme, rawUrl?: string): Promise<string | null> {
  const url = pageUrl(theme, rawUrl);
  const hit = fetched.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.html;
  try {
    const res = await fetch(url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.ok && Number(res.headers.get("content-length") || 0) <= MAX_PAGE_BYTES) {
      const html = await res.text();
      if (html.trim() && html.length <= MAX_PAGE_BYTES) {
        fetched.set(url, { html, at: Date.now() });
        return html;
      }
    }
  } catch {
    // offline: fall back to the bundled page
  }
  const file = fallbackFile(theme);
  return file ? readFileSync(file, "utf-8") : null;
}

/** The banner as its own sandboxed document; 204 when there is no page to show. */
export function sponsorFrameResponse(html: string | null): Response {
  if (!html) return new Response(null, { status: 204 });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": FRAME_POLICY,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
