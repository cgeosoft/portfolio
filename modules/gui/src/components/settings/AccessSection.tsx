import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Lock, ShieldCheck, Wifi } from "lucide-react";
import { api, ApiError } from "../../api";
import type { RemoteAccessInfo } from "portfolio-shared/api-types";
import { PinInput, type PinInputHandle } from "../common/PinInput";

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
    <div className="py-4 first:pt-0 last:pb-0 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2 rounded-lg bg-accent-500/10 text-accent-300 shrink-0 mt-0.5">
            <Lock className="h-4 w-4" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-50">App lock</span>
            <span className="text-xs text-slate-400 leading-relaxed">
              Ask for a PIN before opening Portfolio. Applies to this computer and to any device that connects over the network. Without it the app opens straight away.
            </span>
            {pinEnabled && mode === "idle" && (
              <button type="button" onClick={() => setMode("change")} className="self-start text-xs font-semibold text-accent-400 hover:text-accent-300 mt-1 cursor-pointer">
                Change PIN
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={pinEnabled}
          disabled={busy}
          onClick={() => (mode !== "idle" ? reset() : setMode(pinEnabled ? "disable" : "enable"))}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-60 ${
            pinEnabled ? "bg-gradient-to-r from-accent-600 to-purple-600 shadow-lg shadow-accent-500/25" : "bg-slate-800 border-slate-800"
          }`}
        >
          <span className="sr-only">App lock</span>
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${pinEnabled ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      {mode !== "idle" && (
        <form onSubmit={submit} className="pl-12 flex flex-col gap-4">
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
    </div>
  );
}

/**
 * Settings → Access: the app lock and the remote-connections switch. The
 * remote card only renders in the desktop window (the service answers 403
 * for other clients) and needs a PIN before it can be turned on.
 */
export function AccessSection({ onPinEnabledChange }: { onPinEnabledChange?: (enabled: boolean) => void } = {}) {
  const [pinEnabled, setPinEnabled] = useState(false);
  const [remote, setRemote] = useState<RemoteAccessInfo | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.authStatus().then((s) => setPinEnabled(s.pinEnabled)).catch(() => {});
    api
      .remoteAccess()
      .then(setRemote)
      .catch(() => setRemote(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRemote = async () => {
    if (!remote || remoteBusy) return;
    setRemoteBusy(true);
    setRemoteError(null);
    try {
      setRemote(await api.setRemoteAccess(!remote.enabled));
    } catch (err: unknown) {
      setRemoteError(err instanceof ApiError ? err.message : "Could not change the setting.");
    } finally {
      setRemoteBusy(false);
    }
  };

  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-2">
      <div className="border-b border-slate-800/80 pb-4 mb-2">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-wider">
          <ShieldCheck className="w-4 h-4 text-[#DD3C73]" />
          <span>Access</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">Lock the app with a 6-digit PIN and decide whether other devices on your network may open it.</p>
      </div>

      <div className="divide-y divide-slate-800/80">
        <AppLockCard
          pinEnabled={pinEnabled}
          onChanged={(enabled) => {
            setPinEnabled(enabled);
            onPinEnabledChange?.(enabled);
            load();
          }}
        />

        {remote && (
          <div className="py-4 first:pt-0 last:pb-0 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="p-2 rounded-lg bg-sky-500/10 text-sky-300 shrink-0 mt-0.5">
                  <Wifi className="h-4 w-4" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-slate-50">Allow remote connections</span>
                  <span className="text-xs text-slate-400 leading-relaxed">
                    Let phones and other devices on the same network open this Portfolio. The app lock PIN is required first. When off, only this computer can connect.
                  </span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={remote.enabled}
                disabled={remoteBusy || (!remote.enabled && remote.pinRequired)}
                onClick={toggleRemote}
                title={!remote.enabled && remote.pinRequired ? "Set a PIN first" : undefined}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed ${
                  remote.enabled ? "bg-gradient-to-r from-accent-600 to-purple-600 shadow-lg shadow-accent-500/25" : "bg-slate-800 border-slate-800"
                }`}
              >
                <span className="sr-only">Allow remote connections</span>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${remote.enabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
            {remoteError && <p className="text-xs text-rose-400 pl-12">{remoteError}</p>}
            {remote.enabled && (
              <div className="pl-12 flex flex-wrap gap-2">
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
          </div>
        )}
      </div>
    </div>
  );
}
