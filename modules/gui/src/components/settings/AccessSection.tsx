import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Lock, Wifi } from "lucide-react";
import { api, ApiError } from "../../api";
import type { RemoteAccessInfo } from "portfolio-shared/api-types";
import { PinInput, type PinInputHandle } from "../common/PinInput";
import { SettingItem, Toggle } from "./SettingsFields";

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
      if (!PIN_RULE.test(pin)) return setError("The PIN must be exactly 6 digits.");
      if (pin !== confirmPin) return setError("The two PINs do not match.");
    }
    if (mode !== "enable" && !PIN_RULE.test(currentPin)) return setError("Enter the current 6-digit PIN.");

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
      setError(err instanceof Error ? err.message : "Could not update the PIN.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingItem
      icon={Lock}
      title="App lock"
      description={
        <>
          Ask for a PIN before opening Portfolio. Applies to this computer and to any device that connects over the network. Without it the app opens straight away.
          {pinEnabled && mode === "idle" && (
            <button type="button" onClick={() => setMode("change")} className="block text-xs font-semibold text-accent-400 hover:text-accent-300 mt-1 cursor-pointer">
              Change PIN
            </button>
          )}
        </>
      }
      control={
        <Toggle
          checked={pinEnabled}
          disabled={busy}
          onChange={() => (mode !== "idle" ? reset() : setMode(pinEnabled ? "disable" : "enable"))}
          label="App lock"
        />
      }
    >
      {mode !== "idle" && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {mode !== "enable" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Current PIN</label>
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
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">New PIN</label>
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
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Repeat new PIN</label>
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
              {mode === "disable" ? "Turn off" : mode === "change" ? "Change PIN" : "Turn on"}
            </button>
            <button type="button" onClick={reset} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer">
              Cancel
            </button>
          </div>
        </form>
      )}
    </SettingItem>
  );
}

/**
 * The app lock and the remote-connections rows of Settings → General. The
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
      setRemoteError(err instanceof ApiError ? err.message : "Could not change the setting.");
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
      setRemoteError("The port must be a whole number from 1024 to 65535.");
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

      {remote && (
        <SettingItem
          icon={Wifi}
          title="Allow remote connections"
          description="Let phones and other devices on the same network open this Portfolio. The app lock PIN is required first. When off, only this computer can connect."
          control={
            <span title={!remote.enabled && remote.pinRequired ? "Set a PIN first" : undefined}>
              <Toggle
                checked={remote.enabled}
                disabled={remoteBusy || (!remote.enabled && remote.pinRequired)}
                onChange={toggleRemote}
                label="Allow remote connections"
              />
            </span>
          }
        >
          <div className="flex items-center gap-2">
            <label htmlFor="remote-port" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Port
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
            <span className="text-[11px] text-slate-500">Other devices connect on this port.</span>
          </div>
          {remoteError && <p className="text-xs text-rose-400">{remoteError}</p>}
          {!remoteError && remote.error && <p className="text-xs text-rose-400">{remote.error}</p>}
          {remote.enabled && (
            <div className="flex flex-wrap gap-2">
              {remote.urls.length === 0 ? (
                <span className="text-xs text-slate-500">No network interface found. Connect this computer to your Wi-Fi or LAN.</span>
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
    </>
  );
}
