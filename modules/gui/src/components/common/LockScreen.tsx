import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { AppIcon } from "./AppIcon";
import { AmbientGlow } from "./AmbientGlow";
import { PinInput, type PinInputHandle } from "./PinInput";
import { APP_NAME, APP_VERSION } from "../../environment";

interface LockScreenProps {
  /** The account has a PIN and this client has no session yet. */
  locked: boolean;
  /** Signed in, but the Terms of Use are not accepted yet. */
  termsPending: boolean;
  /** Neither a session nor the automatic login could be established. */
  authError: string | null;
  onUnlock: (pin: string) => Promise<unknown>;
  onAcceptTerms: () => Promise<unknown>;
  onOpenTerms: () => void;
  onRetry: () => void;
}

/**
 * Full-screen gate shown before the workspace: the PIN prompt when the app
 * lock is on, the Terms of Use on first run, or a retry card when the service
 * cannot be reached.
 */
export const LockScreen: React.FC<LockScreenProps> = ({ locked, termsPending, authError, onUnlock, onAcceptTerms, onOpenTerms, onRetry }) => {
  const step: "pin" | "terms" | "error" = locked ? "pin" : termsPending ? "terms" : "error";
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsChecked, setTermsChecked] = useState(false);
  const pinRef = useRef<PinInputHandle | null>(null);

  useEffect(() => {
    setPin("");
    setError(null);
    setLoading(false);
    setTermsChecked(false);
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

  const handleAcceptTerms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termsChecked) {
      setError("Check the box to accept the Terms of Use.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onAcceptTerms();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept the Terms of Use.");
    } finally {
      setLoading(false);
    }
  };

  const title = step === "pin" ? "Enter your PIN" : step === "terms" ? `Welcome to ${APP_NAME}` : "Cannot reach the service";
  const subtitle =
    step === "pin"
      ? ""
      : step === "terms"
        ? "One step before you start: accept the Terms of Use."
        : authError || "The local service did not answer.";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas text-slate-100 overflow-y-auto px-4 sm:px-6 py-6 select-none">
      <AmbientGlow
        pulse
        drift
        glows={[
          // Brand accent (#DD3C73) with the purple it is paired with in the app's gradients.
          { x: "50%", y: "25%", radius: 420, rgb: "221, 60, 115", alpha: 0.22 },
          { x: "33%", y: "78%", radius: 330, rgb: "168, 85, 247", alpha: 0.18 },
          { x: "78%", y: "36%", radius: 300, rgb: "244, 63, 94", alpha: 0.12 },
        ]}
      />
      <div className="absolute inset-0 bg-[radial-gradient(rgb(var(--border-rgb))_1px,transparent_1px)] [background-size:32px_32px] opacity-25 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center mb-6 sm:mb-8">
        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-tr from-accent-500 via-purple-500 to-cyan-400 p-[1px] shadow-xl shadow-accent-500/20 mb-3">
          <div className="w-full h-full bg-slate-950 rounded-[15px] flex items-center justify-center">
            <AppIcon className="w-6 h-6 sm:w-7 sm:h-7 text-accent-400" />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight bg-gradient-to-r from-slate-50 via-slate-200 to-accent-bright bg-clip-text text-transparent">{APP_NAME}</h1>
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
        ) : step === "terms" ? (
          <form onSubmit={handleAcceptTerms} className="space-y-5">
            <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-accent-400 flex items-center gap-1.5">
                  <ScrollText className="w-3.5 h-3.5" />
                  Terms Highlights
                </span>
                <button
                  type="button"
                  onClick={onOpenTerms}
                  className="text-xs text-accent-400 hover:text-accent-300 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <span>Read Full Terms</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <div className="text-[11px] text-slate-300 space-y-2 max-h-32 overflow-y-auto pr-1 leading-relaxed custom-scrollbar">
                <p>• Everything stays on this computer: portfolios, transactions and settings live in a local database.</p>
                <p>• Quotes, news and FX come from Yahoo Finance and Finnhub and may be delayed or incomplete.</p>
                <p>• AI reports and chat answers are generated by language models you configure; they are not financial advice.</p>
                <p>• Broker imports and calculations are provided "as is"; verify figures before acting on them.</p>
              </div>
            </div>

            <label className="flex items-start gap-3 p-3 bg-slate-950/40 border border-slate-800/80 rounded-2xl cursor-pointer hover:bg-slate-950/70 transition-all select-none">
              <input
                type="checkbox"
                checked={termsChecked}
                onChange={(e) => {
                  setTermsChecked(e.target.checked);
                  setError(null);
                }}
                className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-900 text-accent-600 focus:ring-accent-500 focus:ring-offset-0 transition-colors"
              />
              <span className="text-xs text-slate-300 leading-snug">
                I have read and agree to the{" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenTerms();
                  }}
                  className="text-accent-400 hover:text-accent-300 underline font-semibold cursor-pointer"
                >
                  {APP_NAME} Terms of Use
                </button>
              </span>
            </label>

            <button
              type="submit"
              disabled={loading || !termsChecked}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-accent-600 to-purple-600 text-white text-xs font-semibold shadow-lg shadow-accent-500/25 hover:from-accent-500 hover:to-purple-500 transition-all disabled:opacity-50 cursor-pointer active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Accept & Enter {APP_NAME}</span>
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
    </div>
  );
};
