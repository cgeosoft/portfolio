/**
 * One local account, optionally locked with a PIN (Settings → General).
 * Sessions are cookies stored in the `sessions` table so a phone on the LAN
 * (remote connections) gets its own session and the PIN applies to it too.
 * The PIN hash, the attempt counter and the Terms of Use acceptance live in
 * `kv_entries`.
 */
import * as crypto from "node:crypto";
import { getDatabase } from "../db/database";
import { appLogger } from "../logger";
import { HttpError } from "../http/router";

const PIN_RULE = /^[0-9]{6}$/;
const PIN_ATTEMPTS_LIMIT = 5;
const PIN_ATTEMPTS_WINDOW_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 60 * 60 * 1000;
const SCRYPT_KEYLEN = 32;
const PIN_KEY = "auth:pinHash";
const ATTEMPTS_KEY = "rate-limit:pin";
const TERMS_KEY = "auth:acceptedTermsAt";

export const SESSION_COOKIE = "portfolio_session";

interface KvRow {
  value: string;
  expiresAt: number | null;
}

export class AuthService {
  private kvGet(key: string): string | null {
    const row = getDatabase().query("SELECT value, expiresAt FROM kv_entries WHERE key = ?").get(key) as KvRow | null;
    if (!row) return null;
    if (row.expiresAt !== null && row.expiresAt < Date.now()) {
      getDatabase().run("DELETE FROM kv_entries WHERE key = ?", [key]);
      return null;
    }
    return row.value;
  }

  private kvSet(key: string, value: string, ttlMs?: number): void {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    getDatabase().run(
      "INSERT INTO kv_entries (key, value, expiresAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expiresAt = excluded.expiresAt",
      [key, value, expiresAt],
    );
  }

  private kvDel(key: string): void {
    getDatabase().run("DELETE FROM kv_entries WHERE key = ?", [key]);
  }

  // ---------------------------------------------------------------- pin ----

  isPinEnabled(): boolean {
    return !!this.kvGet(PIN_KEY);
  }

  private hashPin(pin: string): string {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(pin, salt, SCRYPT_KEYLEN);
    return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
  }

  private pinMatches(pin: string, stored: string): boolean {
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  /** Verifies a PIN with a shared attempt counter across every client. */
  private checkPin(pin: string | undefined): void {
    const stored = this.kvGet(PIN_KEY);
    if (!stored) return;
    const attempt = (pin || "").trim();
    if (!attempt) throw new HttpError(401, "PIN required");
    const attempts = Number(this.kvGet(ATTEMPTS_KEY) || 0) + 1;
    this.kvSet(ATTEMPTS_KEY, String(attempts), PIN_ATTEMPTS_WINDOW_MS);
    if (attempts > PIN_ATTEMPTS_LIMIT) throw new HttpError(401, "Too many attempts. Wait a few minutes and try again.");
    if (!this.pinMatches(attempt, stored)) throw new HttpError(401, "Wrong PIN");
    this.kvDel(ATTEMPTS_KEY);
  }

  /** Sets or changes the PIN; the current PIN is required when one is set. */
  setPin(pin: string, currentPin?: string): void {
    if (!PIN_RULE.test(pin || "")) throw new HttpError(400, "PIN must be exactly 6 digits");
    this.checkPin(currentPin);
    const hadPin = this.isPinEnabled();
    this.kvSet(PIN_KEY, this.hashPin(pin));
    appLogger.logStep("info", "auth", "pin", hadPin ? "PIN changed" : "PIN enabled");
  }

  removePin(currentPin: string): void {
    if (!this.isPinEnabled()) return;
    this.checkPin(currentPin);
    this.kvDel(PIN_KEY);
    appLogger.logStep("info", "auth", "pin", "PIN disabled");
  }

  // -------------------------------------------------------------- terms ----

  /** ISO timestamp of the Terms of Use acceptance, null on first run. */
  acceptedTermsAt(): string | null {
    return this.kvGet(TERMS_KEY);
  }

  hasAcceptedTerms(): boolean {
    return !!this.kvGet(TERMS_KEY);
  }

  /** Records the acceptance once; later calls keep the original timestamp. */
  acceptTerms(): string {
    const existing = this.kvGet(TERMS_KEY);
    if (existing) return existing;
    const at = new Date().toISOString();
    this.kvSet(TERMS_KEY, at);
    appLogger.logStep("info", "auth", "terms", "Terms of Use accepted");
    return at;
  }

  // ----------------------------------------------------------- sessions ----

  /** Opens a session. Without a PIN this is automatic; with one it must match. */
  login(pin?: string): string {
    this.checkPin(pin);
    const id = crypto.randomUUID();
    getDatabase().run("INSERT INTO sessions (id, expiresAt) VALUES (?, ?)", [id, Date.now() + SESSION_TTL_MS]);
    return id;
  }

  /** True for a live session; extends it at most once per hour. */
  validateSession(id: string | null | undefined): boolean {
    if (!id) return false;
    const row = getDatabase().query("SELECT expiresAt FROM sessions WHERE id = ?").get(id) as { expiresAt: number } | null;
    if (!row) return false;
    const now = Date.now();
    if (row.expiresAt < now) {
      this.deleteSession(id);
      return false;
    }
    if (row.expiresAt - now < SESSION_TTL_MS - SESSION_REFRESH_MS) {
      getDatabase().run("UPDATE sessions SET expiresAt = ? WHERE id = ?", [now + SESSION_TTL_MS, id]);
    }
    return true;
  }

  deleteSession(id: string): void {
    getDatabase().run("DELETE FROM sessions WHERE id = ?", [id]);
  }

  /** Ends every session except `keep` (after a PIN change). */
  revokeOtherSessions(keep: string | null): void {
    const db = getDatabase();
    const result = keep ? db.run("DELETE FROM sessions WHERE id != ?", [keep]) : db.run("DELETE FROM sessions");
    if (result.changes > 0) appLogger.logStep("info", "auth", "sessions", `Revoked ${result.changes} other session(s)`);
  }

  /** Drops expired sessions and counters (called at start and hourly). */
  prune(): void {
    const now = Date.now();
    getDatabase().run("DELETE FROM sessions WHERE expiresAt < ?", [now]);
    getDatabase().run("DELETE FROM kv_entries WHERE expiresAt IS NOT NULL AND expiresAt < ?", [now]);
  }
}

/** Reads the session cookie from a request. */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(id: string, secure: boolean): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export const authService = new AuthService();
