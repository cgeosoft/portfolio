/**
 * One local account, optionally locked with a PIN (Settings → Privacy & Security).
 * Sessions are cookies stored in the `sessions` table so a phone on the LAN
 * (remote connections) gets its own session and the PIN applies to it too.
 * The table keeps the SHA-256 of each session id, not the id, so a copy of
 * the database (a backup in Downloads) opens no session. The PIN hash, the
 * attempt counters and the Terms of Use acceptance live in `kv_entries`.
 *
 * The LAN listener speaks plain HTTP, so a session opened from another device
 * lasts a day after its last use instead of a week, and wrong PINs from other
 * devices count apart from the desktop window's: a LAN client cannot lock the
 * window out.
 */
import * as crypto from "node:crypto";
import { resolve } from "node:path";
import { getDatabase } from "../db/database";
import { appLogger } from "../logger";
import { HttpError } from "../http/router";
import { DATA_DIR } from "../paths";

const PIN_RULE = /^[0-9]{6}$/;
/** Wrong PINs allowed before a lockout; each further run of this many doubles the lockout. */
const PIN_ATTEMPTS_LIMIT = 5;
const PIN_LOCKOUT_BASE_MS = 5 * 60 * 1000;
const PIN_LOCKOUT_MAX_MS = 24 * 60 * 60 * 1000;
/** A counter with no wrong PIN for this long after its lockout ends starts over. */
const PIN_ATTEMPTS_FORGET_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Lifetime of a session used from another device over the LAN listener. */
export const REMOTE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 60 * 60 * 1000;
const SCRYPT_KEYLEN = 32;
const PIN_KEY = "auth:pinHash";
/** One counter for the desktop window, one for other devices. */
const ATTEMPTS_KEY = { local: "rate-limit:pin:local", remote: "rate-limit:pin:remote" } as const;
const TERMS_KEY = "auth:acceptedTermsAt";

/** The old cookie name, shared by every instance on the same host. Read only as a fallback. */
export const LEGACY_SESSION_COOKIE = "portfolio_session";

/**
 * The session cookie name for a data directory. Browsers scope cookies by
 * host and ignore the port, so two instances on 127.0.0.1 overwrote each
 * other's cookie under one name. The name carries a short hash of the data
 * directory: instances on one database share sessions anyway, and the name
 * survives restarts, random ports and the remote-access port.
 */
export function sessionCookieName(dataDir: string = DATA_DIR): string {
  const hash = crypto.createHash("sha256").update(resolve(dataDir)).digest("hex").slice(0, 12);
  return `${LEGACY_SESSION_COOKIE}_${hash}`;
}

/** Where a request comes from: the loopback listener (`local`) or the LAN listener (`remote`). */
export type ClientScope = keyof typeof ATTEMPTS_KEY;

interface PinAttempts {
  /** Wrong PINs since the counter started. */
  failures: number;
  /** Epoch ms until which every PIN is refused; 0 when not locked. */
  lockedUntil: number;
}

/** Lockout after `failures` wrong PINs: 5 minutes after the 5th, doubling after every 5 more, at most a day. */
export function pinLockoutMs(failures: number): number {
  if (failures < PIN_ATTEMPTS_LIMIT || failures % PIN_ATTEMPTS_LIMIT !== 0) return 0;
  const step = failures / PIN_ATTEMPTS_LIMIT - 1;
  return Math.min(PIN_LOCKOUT_BASE_MS * 2 ** Math.min(step, 20), PIN_LOCKOUT_MAX_MS);
}

function sessionTtl(scope: ClientScope): number {
  return scope === "remote" ? REMOTE_SESSION_TTL_MS : SESSION_TTL_MS;
}

interface KvRow {
  value: string;
  expiresAt: number | null;
}

/** The `sessions` key of a session id. The id is random (122 bits), so a plain SHA-256 is enough. */
function sessionKey(id: string): string {
  return crypto.createHash("sha256").update(id).digest("hex");
}

/** Length of a `sessionKey()`; rows of another length hold a raw id from an earlier release. */
const SESSION_KEY_LENGTH = 64;

export class AuthService {
  /** The Terms of Use timestamp, read once: it is checked on every request and written once. */
  private termsCache: string | null | undefined;
  /** True once the sessions stored with raw ids (releases up to 0.11) are hashed. */
  private sessionsHashed = false;

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

  private readAttempts(scope: ClientScope): PinAttempts {
    const raw = this.kvGet(ATTEMPTS_KEY[scope]);
    if (!raw) return { failures: 0, lockedUntil: 0 };
    try {
      const parsed = JSON.parse(raw) as Partial<PinAttempts>;
      return { failures: Number(parsed.failures) || 0, lockedUntil: Number(parsed.lockedUntil) || 0 };
    } catch {
      return { failures: 0, lockedUntil: 0 };
    }
  }

  /**
   * Verifies a PIN. Each scope has its own counter: after 5 wrong PINs every
   * PIN is refused for 5 minutes, and each further 5 doubles that, up to a day.
   * The right PIN resets the counter.
   */
  private checkPin(pin: string | undefined, scope: ClientScope): void {
    const stored = this.kvGet(PIN_KEY);
    if (!stored) return;
    const attempt = (pin || "").trim();
    if (!attempt) throw new HttpError(401, "PIN required");
    const now = Date.now();
    const state = this.readAttempts(scope);
    if (state.lockedUntil > now) {
      const minutes = Math.ceil((state.lockedUntil - now) / 60_000);
      throw new HttpError(401, `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }
    if (this.pinMatches(attempt, stored)) {
      this.kvDel(ATTEMPTS_KEY[scope]);
      return;
    }
    const failures = state.failures + 1;
    const lockout = pinLockoutMs(failures);
    const lockedUntil = lockout ? now + lockout : 0;
    this.kvSet(ATTEMPTS_KEY[scope], JSON.stringify({ failures, lockedUntil }), lockout + PIN_ATTEMPTS_FORGET_MS);
    if (lockout) appLogger.logStep("warning", "auth", "pin", `${failures} wrong PINs from ${scope === "remote" ? "other devices" : "this computer"}; locked for ${Math.round(lockout / 60_000)} min`);
    throw new HttpError(401, "Wrong PIN");
  }

  /** Sets or changes the PIN; the current PIN is required when one is set. */
  setPin(pin: string, currentPin?: string, scope: ClientScope = "local"): void {
    if (!PIN_RULE.test(pin || "")) throw new HttpError(400, "PIN must be exactly 6 digits");
    this.checkPin(currentPin, scope);
    const hadPin = this.isPinEnabled();
    this.kvSet(PIN_KEY, this.hashPin(pin));
    appLogger.logStep("info", "auth", "pin", hadPin ? "PIN changed" : "PIN enabled");
  }

  removePin(currentPin: string, scope: ClientScope = "local"): void {
    if (!this.isPinEnabled()) return;
    this.checkPin(currentPin, scope);
    this.kvDel(PIN_KEY);
    appLogger.logStep("info", "auth", "pin", "PIN disabled");
  }

  // -------------------------------------------------------------- terms ----

  /** ISO timestamp of the Terms of Use acceptance, null on first run. */
  acceptedTermsAt(): string | null {
    if (this.termsCache === undefined) this.termsCache = this.kvGet(TERMS_KEY);
    return this.termsCache;
  }

  hasAcceptedTerms(): boolean {
    return !!this.acceptedTermsAt();
  }

  /** Records the acceptance once; later calls keep the original timestamp. */
  acceptTerms(): string {
    const existing = this.kvGet(TERMS_KEY);
    if (existing) return existing;
    const at = new Date().toISOString();
    this.kvSet(TERMS_KEY, at);
    this.termsCache = at;
    appLogger.logStep("info", "auth", "terms", "Terms of Use accepted");
    return at;
  }

  // ----------------------------------------------------------- sessions ----

  /** Replaces the raw ids that earlier releases stored with their hashes, once, so nobody has to sign in again. */
  private hashStoredSessions(): void {
    if (this.sessionsHashed) return;
    const db = getDatabase();
    const rows = db.query("SELECT id FROM sessions WHERE length(id) != ?").all(SESSION_KEY_LENGTH) as { id: string }[];
    if (rows.length > 0) {
      const update = db.prepare("UPDATE OR IGNORE sessions SET id = ? WHERE id = ?");
      db.transaction(() => {
        for (const row of rows) update.run(sessionKey(row.id), row.id);
      })();
    }
    this.sessionsHashed = true;
  }

  /** Opens a session. Without a PIN this is automatic; with one it must match. */
  login(pin?: string, scope: ClientScope = "local"): string {
    this.checkPin(pin, scope);
    this.hashStoredSessions();
    const id = crypto.randomUUID();
    getDatabase().run("INSERT INTO sessions (id, expiresAt) VALUES (?, ?)", [sessionKey(id), Date.now() + sessionTtl(scope)]);
    return id;
  }

  /**
   * True for a live session; extends it at most once per hour. A session used
   * from another device lasts at most `REMOTE_SESSION_TTL_MS` from that use.
   */
  validateSession(id: string | null | undefined, scope: ClientScope = "local"): boolean {
    if (!id) return false;
    this.hashStoredSessions();
    const key = sessionKey(id);
    const row = getDatabase().query("SELECT expiresAt FROM sessions WHERE id = ?").get(key) as { expiresAt: number } | null;
    if (!row) return false;
    const now = Date.now();
    if (row.expiresAt < now) {
      getDatabase().run("DELETE FROM sessions WHERE id = ?", [key]);
      return false;
    }
    const ttl = sessionTtl(scope);
    const remaining = row.expiresAt - now;
    if (remaining < ttl - SESSION_REFRESH_MS || remaining > ttl) {
      getDatabase().run("UPDATE sessions SET expiresAt = ? WHERE id = ?", [now + ttl, key]);
    }
    return true;
  }

  deleteSession(id: string): void {
    this.hashStoredSessions();
    getDatabase().run("DELETE FROM sessions WHERE id = ?", [sessionKey(id)]);
  }

  /** Ends every session except `keep` (after a PIN change, or on request from Settings). Returns how many ended. */
  revokeOtherSessions(keep: string | null): number {
    this.hashStoredSessions();
    const db = getDatabase();
    const result = keep ? db.run("DELETE FROM sessions WHERE id != ?", [sessionKey(keep)]) : db.run("DELETE FROM sessions");
    if (result.changes > 0) appLogger.logStep("info", "auth", "sessions", `Revoked ${result.changes} other session(s)`);
    return result.changes;
  }

  /** Number of live sessions (this window, other browsers and devices). */
  activeSessionCount(): number {
    const row = getDatabase().query("SELECT COUNT(*) AS n FROM sessions WHERE expiresAt >= ?").get(Date.now()) as { n: number } | null;
    return row?.n ?? 0;
  }

  /** Drops expired sessions and counters (called at start and hourly). */
  prune(): void {
    const now = Date.now();
    getDatabase().run("DELETE FROM sessions WHERE expiresAt < ?", [now]);
    getDatabase().run("DELETE FROM kv_entries WHERE expiresAt IS NOT NULL AND expiresAt < ?", [now]);
  }
}

function readCookie(req: Request, cookieName: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== cookieName) continue;
    try {
      return decodeURIComponent(rest.join("=")) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The session id a request carries. `legacy` is true when it came under the
 * old shared name; the auth middleware then moves it to the new name.
 */
export function readSession(req: Request): { id: string; legacy: boolean } | null {
  const current = readCookie(req, sessionCookieName());
  if (current) return { id: current, legacy: false };
  const legacy = readCookie(req, LEGACY_SESSION_COOKIE);
  return legacy ? { id: legacy, legacy: true } : null;
}

/** Reads the session cookie from a request. */
export function readSessionCookie(req: Request): string | null {
  return readSession(req)?.id ?? null;
}

/**
 * The session cookie. `SameSite=Strict`: a link or redirect from another site
 * opens the app without the session, so no request a foreign page starts
 * carries it, a GET included. The app's own requests carry it as before.
 */
export function sessionCookie(id: string, secure: boolean, scope: ClientScope = "local"): string {
  const maxAge = Math.floor(sessionTtl(scope) / 1000);
  return `${sessionCookieName()}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(): string {
  return `${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** Expires the old shared cookie once its session moved to the new name. */
export function clearLegacySessionCookie(): string {
  return `${LEGACY_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export const authService = new AuthService();
