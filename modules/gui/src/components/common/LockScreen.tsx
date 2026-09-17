import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { AppIcon } from "./AppIcon";
import { AmbientGlow } from "./AmbientGlow";
import { PinInput, type PinInputHandle } from "./PinInput";
import { APP_VERSION } from "../../environment";

interface LockScreenProps {
  /** The account has a PIN and this client has no session yet. */
  locked: boolean;
  /** Neither a session nor the automatic login could be established. */
  authError: string | null;
  onUnlock: (pin: string) => Promise<unknown>;
  onRetry: () => void;
}

/**
 * Full-screen gate shown before the workspace: the PIN prompt when the app
 * lock is on, or a retry card when the service cannot be reached.
 */
export const LockScreen: React.FC<LockScreenProps> = ({ locked, authError, onUnlock, onRetry }) => {
  const step: "pin" | "error" = locked ? "pin" : "error";
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinRef = useRef<PinInputHandle | null>(null);

  useEffect(() => {
    setPin("");
    setError(null);
    setLoading(false);
    if (step === "pin") setTimeout(() => pinRef.current?.focus(0), 50);
  }, [step]);

  const handleUnlock = async (value: string) => {
    if (!/^[0-9]{6}$/.test(value)) {
      setError("Enter your 6-digit PIN");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onUnlock(value);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Wrong PIN");
      setPin("");
      setTimeout(() => pinRef.current?.focus(0), 50);
    } finally {
      setLoading(false);
    }
  };

  const title = step === "pin" ? "Enter your PIN" : "Cannot reach the service";
  const subtitle =
    step === "pin"
      ? "This Portfolio is locked. Enter the 6-digit PIN set under Settings → Access."
      : authError || "The local service did not answer.";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#030712] text-slate-100 overflow-y-auto px-4 sm:px-6 py-6 select-none">
      <AmbientGlow
        pulse
        glows={[
          { x: "50%", y: "25%", radius: 420, rgb: "79, 70, 229", alpha: 0.22 },
          { x: "33%", y: "78%", radius: 330, rgb: "8, 145, 178", alpha: 0.2 },
          { x: "78%", y: "36%", radius: 300, rgb: "147, 51, 234", alpha: 0.14 },
        ]}
      />
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:32px_32px] opacity-25 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center mb-6 sm:mb-8">
        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-tr from-accent-500 via-purple-500 to-cyan-400 p-[1px] shadow-xl shadow-accent-500/20 mb-3">
          <div className="w-full h-full bg-slate-950 rounded-[15px] flex items-center justify-center">
            <AppIcon className="w-6 h-6 sm:w-7 sm:h-7 text-accent-400" />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-accent-200 bg-clip-text text-transparent">Portfolio</h1>
          {APP_VERSION && <span className="text-xs sm:text-sm font-mono text-slate-400 font-medium">v{APP_VERSION}</span>}
        </div>
        <p className="text-xs font-mono text-accent-400 mt-1">Personal investment tracker</p>
      </div>

      <div className="relative z-10 w-full max-w-md p-5 sm:p-8 bg-slate-900/90 border border-slate-800/80 rounded-3xl shadow-2xl">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-slate-100">{title}</h2>
          <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 p-3.5 mb-6 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-2xl animate-shake">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === "pin" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!loading && pin.length === 6) handleUnlock(pin);
            }}
            className="space-y-6"
          >
            <div className="flex flex-col items-center gap-4">
              <PinInput
                ref={pinRef}
                value={pin}
                onChange={(v) => {
                  setPin(v);
                  setError(null);
                }}
                onComplete={handleUnlock}
                disabled={loading}
                autoFocus
                size="lg"
                hasError={!!error}
                ariaLabel="PIN"
              />
            </div>
            <button
              type="submit"
              disabled={loading || pin.length < 6}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-accent-600 to-purple-600 text-white text-sm font-bold shadow-lg shadow-accent-500/25 hover:from-accent-500 hover:to-purple-500 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? "Unlocking…" : "Unlock"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={onRetry}
            className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-100 text-sm font-bold transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        )}
      </div>
    </div>
  );
};
