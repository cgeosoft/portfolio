/**
 * How the shell decides what to do with a URL the webview asks to open in a
 * new window (`new-window-open`): keep an app route in a window of its own,
 * hand an http(s) or mailto link to the system, drop everything else.
 *
 * The system opener on Linux can fall back to `system("xdg-open \"<url>\"")`
 * inside Electrobun, so a crafted link could carry shell metacharacters. The
 * shell spawns `xdg-open` itself with an argv array (no shell), and
 * `encodeForShell` percent-encodes the dangerous characters for the rare
 * fallback and for the other platforms' single-string openers.
 */

/** Only these reach the system; every other scheme is dropped. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Characters that must never reach a shell command line. */
const SHELL_CHARS = /["'`$\\]/g;

export interface ExternalUrlDecision {
  /** `app`: open in a new app window; `external`: hand to the system; `ignore`: drop. */
  kind: "app" | "external" | "ignore";
  /** The URL to act on (the parsed href for `external`), or empty for `ignore`. */
  url: string;
}

/** Percent-encodes the characters a shell would act on, so `xdg-open "<url>"` is inert. */
export function encodeForShell(url: string): string {
  return url.replace(SHELL_CHARS, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/**
 * Classifies a `new-window-open` URL. `appOrigin` is the app's own origin
 * (`http://127.0.0.1:<port>`, or the Vite URL in development), or null before
 * the window shows the app. An app route keeps its exact URL; an external link
 * is returned as its parsed href so the caller controls any encoding.
 */
export function classifyExternalUrl(raw: unknown, appOrigin: string | null): ExternalUrlDecision {
  if (typeof raw !== "string" || raw === "") return { kind: "ignore", url: "" };
  if (appOrigin && raw.startsWith(`${appOrigin}/`)) return { kind: "app", url: raw };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: "ignore", url: "" };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return { kind: "ignore", url: "" };
  return { kind: "external", url: parsed.href };
}
