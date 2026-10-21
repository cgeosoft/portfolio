import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, Lock, MonitorSmartphone, ShieldCheck, Wifi } from "lucide-react";
import { api, ApiError } from "../../api";
import { t } from "../../i18n";
import type { McpAccessInfo, RemoteAccessInfo } from "portfolio-shared/api-types";
import { PinInput, type PinInputHandle } from "../common/PinInput";
import { SectionHeader, SettingItem, SettingsFields, Toggle } from "./SettingsFields";

const PIN_RULE = /^[0-9]{6}$/;

interface AppLockCardProps {
  pinEnabled: boolean;
  onChanged: (pinEnabled: boolean) => void;
}

/** App lock switch with an inline form: new PIN to enable, current PIN to disable, both to change. */
function AppLockCard({ pinEnabled, onChanged }: AppLockCardProps) {
  const [mode, setMode] = useState<"idle" | "enable" | "change" | "disable">("idle");
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPinRef = useRef<PinInputHandle | null>(null);
  const newPinRef = useRef<PinInputHandle | null>(null);
  const confirmPinRef = useRef<PinInputHandle | null>(null);

  const reset = () => {
    setMode("idle");
    setCurrentPin("");
    setPin("");
    setConfirmPin("");
    setError(null);
  };

  // Focus the first relevant input when the form opens.
  useEffect(() => {
    if (mode === "idle") return;
    const timer = setTimeout(() => {
      if (mode === "enable") newPinRef.current?.focus(0);
      else currentPinRef.current?.focus(0);
    }, 50);
    return () => clearTimeout(timer);
  }, [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode !== "disable") {
      if (!PIN_RULE.test(pin)) return setError(t("settings.security.lock.pinRule"));
      if (pin !== confirmPin) return setError(t("settings.security.lock.pinMismatch"));
    }
    if (mode !== "enable" && !PIN_RULE.test(currentPin)) return setError(t("settings.security.lock.currentPinRequired"));

    setBusy(true);
    try {
      if (mode === "disable") {
        await api.removePin(currentPin);
        onChanged(false);
      } else {
        await api.setPin(pin, mode === "change" ? currentPin : undefined);
        onChanged(true);
      }
      reset();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("settings.security.lock.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingItem
      icon={Lock}
      title={t("settings.security.lock.title")}
      description={
        <>
          {t("settings.security.lock.description")}
          {pinEnabled && mode === "idle" && (
            <button type="button" onClick={() => setMode("change")} className="block text-xs font-semibold text-accent-400 hover:text-accent-300 mt-1 cursor-pointer">
              {t("settings.security.lock.changePin")}
            </button>
          )}
        </>
      }
      control={
        <Toggle
          checked={pinEnabled}
          disabled={busy}
          onChange={() => (mode !== "idle" ? reset() : setMode(pinEnabled ? "disable" : "enable"))}
          label={t("settings.security.lock.title")}
        />
      }
    >
      {mode !== "idle" && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {mode !== "enable" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{t("settings.security.lock.currentPin")}</label>
                <PinInput
                  ref={currentPinRef}
                  value={currentPin}
                  onChange={(v) => { setCurrentPin(v); setError(null); }}
                  onComplete={() => {
                    if (mode !== "disable") newPinRef.current?.focus(0);
                  }}
                  disabled={busy}
                  size="sm"
                  hasError={!!error}
                />
              </div>
            )}
            {mode !== "disable" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{t("settings.security.lock.newPin")}</label>
                <PinInput
                  ref={newPinRef}
                  value={pin}
                  onChange={(v) => { setPin(v); setError(null); }}
                  onComplete={() => confirmPinRef.current?.focus(0)}
                  disabled={busy}
                  size="sm"
                  hasError={!!error}
                />
              </div>
            )}
            {mode !== "disable" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{t("settings.security.lock.repeatPin")}</label>
                <PinInput
                  ref={confirmPinRef}
                  value={confirmPin}
                  onChange={(v) => { setConfirmPin(v); setError(null); }}
                  disabled={busy}
                  size="sm"
                  hasError={!!error}
                />
              </div>
            )}
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer">
              {mode === "disable" ? t("settings.security.lock.turnOff") : mode === "change" ? t("settings.security.lock.changePin") : t("settings.security.lock.turnOn")}
            </button>
            <button type="button" onClick={reset} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer">
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </SettingItem>
  );
}

/** Live session count with a button that ends every session but this one. */
function SessionsCard() {
  const [active, setActive] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.sessions().then((s) => setActive(s.active)).catch(() => setActive(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.revokeOtherSessions();
      setNotice(res.revoked === 0 ? t("settings.security.sessions.noneRevoked") : t("settings.security.sessions.revoked", { count: res.revoked }));
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : t("settings.security.sessions.failed"));
    } finally {
      setBusy(false);
    }
  };

  const others = active === null ? null : Math.max(0, active - 1);

  return (
    <SettingItem
      icon={MonitorSmartphone}
      title={t("settings.security.sessions.title")}
      description={
        <>
          {t("settings.security.sessions.description")}
          {others !== null && (
            <span className="block text-xs text-slate-500 mt-1">{others === 0 ? t("settings.security.sessions.noneOpen") : t("settings.security.sessions.open", { count: others })}</span>
          )}
          {notice && <span className="block text-xs text-emerald-400 mt-1">{notice}</span>}
          {error && <span className="block text-xs text-rose-400 mt-1">{error}</span>}
        </>
      }
      control={
        <button
          type="button"
          disabled={busy}
          onClick={() => void revoke()}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
        >
          {busy ? t("settings.security.sessions.signingOut") : t("settings.security.sessions.signOut")}
        </button>
      }
    />
  );
}

/**
 * The MCP server row: other AI apps on this computer read percentages of the
 * portfolios through it. Renders only in the desktop window (the service
 * answers 403 for other clients). The access token is shown once, right
 * after the service creates it.
 */
function McpCard() {
  const [info, setInfo] = useState<McpAccessInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portText, setPortText] = useState("");
  const [copied, setCopied] = useState<"token" | "setup" | null>(null);

  useEffect(() => {
    api
      .mcpAccess()
      .then((next) => {
        setInfo(next);
        setPortText(String(next.port));
      })
      .catch(() => setInfo(null));
  }, []);

  const apply = async (call: () => Promise<McpAccessInfo>) => {
    if (!info || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await call();
      setInfo(next);
      setPortText(String(next.port));
      if (next.token) setToken(next.token);
      else if (!next.enabled) setToken(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : t("settings.security.remote.failed"));
      setPortText(String(info.port));
    } finally {
      setBusy(false);
    }
  };

  const savePort = () => {
    if (!info) return;
    const port = Number(portText.trim());
    if (portText.trim() === String(info.port)) return;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setError(t("settings.security.remote.portRule"));
      setPortText(String(info.port));
      return;
    }
    void apply(() => api.setMcpAccess({ port }));
  };

  const copy = async (what: "token" | "setup", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // The text stays selectable.
    }
  };

  if (!info) return null;
  const setup = `claude mcp add --transport http portfolio ${info.url} --header "Authorization: Bearer ${token ?? "<token>"}"`;
  const buttonClass = "px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap";

  return (
    <SettingItem
      icon={Bot}
      title={t("settings.security.mcp.title")}
      description={t("settings.security.mcp.description")}
      control={<Toggle checked={info.enabled} disabled={busy} onChange={() => void apply(() => api.setMcpAccess({ enabled: !info.enabled }))} label={t("settings.security.mcp.title")} />}
    >
      <p className="text-[11px] text-emerald-300">{t("settings.security.mcp.privacy")}</p>
      <div className="flex items-center gap-2">
        <label htmlFor="mcp-port" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          {t("settings.security.remote.port")}
        </label>
        <input
          id="mcp-port"
          type="text"
          inputMode="numeric"
          value={portText}
          disabled={busy}
          onChange={(e) => setPortText(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
          onBlur={savePort}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-24 h-8 px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 text-xs font-mono text-slate-200 focus:outline-none focus:border-accent-500/60 disabled:opacity-60"
        />
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {!error && info.error && <p className="text-xs text-rose-400">{info.error}</p>}
      {info.enabled && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-400">{t("settings.security.mcp.address")}</span>
            <code className="self-start px-2.5 py-1 rounded-lg border border-slate-800 bg-slate-800 text-xs font-mono text-sky-200 select-all">{info.url}</code>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-400">{t("settings.security.mcp.token")}</span>
            {token ? (
              <>
                <div className="flex items-center gap-2">
                  <code className="px-2.5 py-1 rounded-lg border border-slate-800 bg-slate-800 text-xs font-mono text-sky-200 select-all break-all">{token}</code>
                  <button type="button" onClick={() => void copy("token", token)} className={buttonClass}>
                    {copied === "token" ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
                <p className="text-[11px] text-amber-300">{t("settings.security.mcp.tokenOnce")}</p>
              </>
            ) : (
              <p className="text-[11px] text-slate-500">{t("settings.security.mcp.tokenHidden")}</p>
            )}
            <button type="button" disabled={busy} onClick={() => void apply(() => api.rotateMcpToken())} className={`self-start ${buttonClass}`}>
              {t("settings.security.mcp.newToken")}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-400">{t("settings.security.mcp.setup")}</span>
            <div className="flex items-start gap-2">
              <code className="px-2.5 py-1 rounded-lg border border-slate-800 bg-slate-950/60 text-[11px] font-mono text-slate-300 select-all break-all">{setup}</code>
              <button type="button" onClick={() => void copy("setup", setup)} className={buttonClass}>
                {copied === "setup" ? t("common.copied") : t("common.copy")}
              </button>
            </div>
          </div>
        </>
      )}
    </SettingItem>
  );
}

/**
 * The app lock, the remote-connections and the MCP server rows of Settings → Privacy & Security. The
 * remote row only renders in the desktop window (the service answers 403
 * for other clients) and needs a PIN before it can be turned on.
 */
export function AccessRows({ onPinEnabledChange }: { onPinEnabledChange?: (enabled: boolean) => void } = {}) {
  const [pinEnabled, setPinEnabled] = useState(false);
  const [remote, setRemote] = useState<RemoteAccessInfo | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [portText, setPortText] = useState("");

  const load = useCallback(() => {
    api.authStatus().then((s) => setPinEnabled(s.pinEnabled)).catch(() => {});
    api
      .remoteAccess()
      .then((info) => {
        setRemote(info);
        setPortText(String(info.port));
      })
      .catch(() => setRemote(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateRemote = async (update: { enabled?: boolean; port?: number }) => {
    if (!remote || remoteBusy) return;
    setRemoteBusy(true);
    setRemoteError(null);
    try {
      const info = await api.setRemoteAccess(update);
      setRemote(info);
      setPortText(String(info.port));
    } catch (err: unknown) {
      setRemoteError(err instanceof ApiError ? err.message : t("settings.security.remote.failed"));
      setPortText(String(remote.port));
    } finally {
      setRemoteBusy(false);
    }
  };

  const toggleRemote = () => updateRemote({ enabled: !remote?.enabled });

  // Saves the port on blur or Enter, like the other text settings.
  const savePort = () => {
    if (!remote) return;
    const port = Number(portText.trim());
    if (portText.trim() === String(remote.port)) return;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setRemoteError(t("settings.security.remote.portRule"));
      setPortText(String(remote.port));
      return;
    }
    void updateRemote({ port });
  };

  return (
    <>
      <AppLockCard
        pinEnabled={pinEnabled}
        onChanged={(enabled) => {
          setPinEnabled(enabled);
          onPinEnabledChange?.(enabled);
          load();
        }}
      />

      <SessionsCard />

      {remote && (
        <SettingItem
          icon={Wifi}
          title={t("settings.security.remote.title")}
          description={t("settings.security.remote.description")}
          control={
            <span title={!remote.enabled && remote.pinRequired ? t("settings.security.remote.pinFirst") : undefined}>
              <Toggle
                checked={remote.enabled}
                disabled={remoteBusy || (!remote.enabled && remote.pinRequired)}
                onChange={toggleRemote}
                label={t("settings.security.remote.title")}
              />
            </span>
          }
        >
          <p className="text-[11px] text-amber-300">{t("settings.security.remote.plainHttp")}</p>
          <div className="flex items-center gap-2">
            <label htmlFor="remote-port" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              {t("settings.security.remote.port")}
            </label>
            <input
              id="remote-port"
              type="text"
              inputMode="numeric"
              value={portText}
              disabled={remoteBusy}
              onChange={(e) => setPortText(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
              onBlur={savePort}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-24 h-8 px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 text-xs font-mono text-slate-200 focus:outline-none focus:border-accent-500/60 disabled:opacity-60"
            />
            <span className="text-[11px] text-slate-500">{t("settings.security.remote.portHint")}</span>
          </div>
          {remoteError && <p className="text-xs text-rose-400">{remoteError}</p>}
          {!remoteError && remote.error && <p className="text-xs text-rose-400">{remote.error}</p>}
          {remote.enabled && remote.urls.length > 0 && (
            <span className="text-[11px] text-slate-400">{t("settings.security.remote.addresses")}</span>
          )}
          {remote.enabled && (
            <div className="flex flex-wrap gap-2">
              {remote.urls.length === 0 ? (
                <span className="text-xs text-slate-500">{t("settings.security.remote.noInterface")}</span>
              ) : (
                remote.urls.map((url) => (
                  <code key={url} className="px-2.5 py-1 rounded-lg border border-slate-800 bg-slate-800 text-xs font-mono text-sky-200 select-all">
                    {url}
                  </code>
                ))
              )}
            </div>
          )}
        </SettingItem>
      )}

      <McpCard />
    </>
  );
}

/** Settings → Privacy & Security: the app lock, signed-in devices, remote access and usage statistics. */
export function SecuritySection({ onPinEnabledChange }: { onPinEnabledChange?: (enabled: boolean) => void }) {
  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-6">
      <SectionHeader icon={ShieldCheck} title={t("settings.security.title")} description={t("settings.security.description")} />
      <div className="divide-y divide-slate-800/80 -mt-2">
        <AccessRows onPinEnabledChange={onPinEnabledChange} />
        <SettingsFields section="security" />
      </div>
    </div>
  );
}
