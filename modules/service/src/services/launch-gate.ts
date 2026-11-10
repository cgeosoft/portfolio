/**
 * Proof that a client is the desktop window, for the login without a PIN.
 *
 * Without a PIN the app signs in automatically, so any program that reaches
 * the loopback port could open a session. The installed service therefore
 * writes a random token to `<data>/launch-token` (mode 0600) at start. The
 * desktop shell reads it and loads the first page with `?launch=<token>`. The
 * service answers that page with a cookie and a redirect to the address
 * without the token, and the PIN-less login asks for the cookie. Another user
 * of this computer cannot read the file, so gets no session.
 *
 * The gate is off until `enableLaunchGate()` runs: a development run and the
 * tests sign in as before.
 */
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../paths";

/** Query parameter of the first page the desktop window loads. */
export const LAUNCH_PARAM = "launch";
const LAUNCH_FILE = "launch-token";
const LAUNCH_COOKIE = "portfolio_launch";

let token: string | null = null;

/** The file the desktop shell reads the token from. */
export function launchTokenFile(dataDir: string = DATA_DIR): string {
  return join(dataDir, LAUNCH_FILE);
}

/** Creates the token of this run and writes it for the desktop shell. Call before the port is announced. */
export function enableLaunchGate(): void {
  const next = crypto.randomBytes(32).toString("hex");
  // The mode applies to a new file only; the data directory is 0700 as well.
  writeFileSync(launchTokenFile(), next, { mode: 0o600 });
  token = next;
}

/** Turns the gate off again. Tests share one process. */
export function disableLaunchGateForTests(): void {
  token = null;
}

export function isLaunchGateEnabled(): boolean {
  return token !== null;
}

function matches(candidate: string | null | undefined): boolean {
  if (!token || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieOf(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LAUNCH_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/** True when the gate is off or the request carries the launch cookie of this run. */
export function hasLaunchProof(req: Request): boolean {
  return token === null || matches(cookieOf(req));
}

/**
 * The answer to a page request that carries the launch token: the cookie and
 * a redirect to the same address without the token, so the token stays out of
 * the page address. Null for any other request.
 */
export function launchRedirect(req: Request, url: URL): Response | null {
  if (token === null || req.method.toUpperCase() !== "GET" || !url.searchParams.has(LAUNCH_PARAM)) return null;
  const ok = matches(url.searchParams.get(LAUNCH_PARAM));
  const target = new URL(url);
  target.searchParams.delete(LAUNCH_PARAM);
  const headers = new Headers({ Location: target.pathname + target.search, "Cache-Control": "no-store" });
  // The cookie lasts for the session of the window. A reload keeps it; the next start gets a new token.
  if (ok) headers.append("Set-Cookie", `${LAUNCH_COOKIE}=${token}; Path=/api/auth; HttpOnly; SameSite=Strict`);
  return new Response(null, { status: 302, headers });
}
