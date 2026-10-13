import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { BrandScreen } from "./BrandScreen";
import { PinInput, type PinInputHandle } from "./PinInput";

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
 * lock is on, or a retry card when the service cannot be reached. The Terms of
 * Use are accepted in the first step of the setup wizard.
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
  const subtitle = step === "pin" ? "" : authError || "The local service did not answer.";

  return (
    <BrandScreen>
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
            className="space-y-5"
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
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-accent-600 to-purple-600 text-white text-xs font-semibold shadow-lg shadow-accent-500/25 hover:from-accent-500 hover:to-purple-500 transition-all disabled:opacity-50 cursor-pointer active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Unlock</span>
                </>
              )}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={onRetry}
            className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-800 text-slate-100 text-sm font-bold transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        )}
      </div>
    </BrandScreen>
  );
};
