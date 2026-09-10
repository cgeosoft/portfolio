import { useState, useEffect } from "react";
import {
  Shield,
  Sparkles,
  Database,
  BarChart3,
  Bot,
  Activity,
  ArrowRight,
  Check,
  Zap,
  X,
} from "lucide-react";
import { rpc } from "../../rpc";

interface SetupWizardModalProps {
  isOpen: boolean;
  onComplete: () => void;
  onClose: () => void;
}

export function SetupWizardModal({ isOpen, onComplete, onClose }: SetupWizardModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [populateDemo, setPopulateDemo] = useState(true);
  const [enableTelemetry, setEnableTelemetry] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleFinish = async () => {
    setIsSubmitting(true);
    try {
      await rpc.request.completeSetup({
        populateDemo,
        enableTelemetry,
      });
      onComplete();
    } catch (err) {
      console.error("Failed to complete setup:", err);
      // Even if an error happens, still dismiss so the user is not trapped
      onComplete();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[#111726] border border-[#1e293b] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden font-mono text-slate-100 flex flex-col">
        {/* Modal Header */}
        <div className="p-6 border-b border-[#1e293b] bg-[#151d30]/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#DD3C73]/10 text-[#DD3C73] border border-[#DD3C73]/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-wide">PORTFOLIO SETUP</h2>
              <p className="text-xs text-slate-400">Step {step} of 3</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex gap-1.5">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`w-2 h-2 rounded-full transition-all ${
                    step === s ? "w-6 bg-[#DD3C73]" : step > s ? "bg-[#A7E2C0]" : "bg-slate-700"
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
              aria-label="Close setup wizard"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Step Content */}
        <div className="p-6 space-y-5">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-slate-100 mb-1">Welcome to Portfolio</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  A high-performance, offline-first personal portfolio tracker built for Linux. Your financial
                  data never leaves your machine.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2.5 pt-2">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-[#151d30] border border-[#1e293b]">
                  <Database className="w-4 h-4 text-[#A7E2C0] mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-slate-200">Local SQLite Engine</div>
                    <div className="text-[11px] text-slate-400">All transactions, portfolios, and snapshots are stored locally.</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-[#151d30] border border-[#1e293b]">
                  <BarChart3 className="w-4 h-4 text-[#DD3C73] mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-slate-200">Live Yahoo Finance Quotes</div>
                    <div className="text-[11px] text-slate-400">Automatic multi-currency conversion, intraday prices, and historical charts.</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-[#151d30] border border-[#1e293b]">
                  <Bot className="w-4 h-4 text-[#E3EACD] mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-slate-200">AI Quantitative Analyst</div>
                    <div className="text-[11px] text-slate-400">Generate on-demand portfolio briefings using Ollama, Groq, OpenAI, or Anthropic.</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-slate-100 mb-1">Demo Portfolio</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Would you like to seed the app with a realistic demonstration portfolio?
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#151d30] border border-[#1e293b] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Zap className="w-4 h-4 text-[#DD3C73]" />
                    <span className="text-xs font-bold text-slate-200">Generate Demo Data</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={populateDemo}
                    onClick={() => setPopulateDemo((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      populateDemo ? "bg-[#DD3C73]" : "bg-slate-800"
                    }`}
                  >
                    <span className="sr-only">Generate Demo Data</span>
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        populateDemo ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Includes 100 simulated transactions spanning the past year across stocks (Apple, Microsoft, Nvidia),
                  ETFs (S&amp;P 500, All-World), and Bitcoin. You can delete or modify it anytime.
                </p>
              </div>

              <p className="text-[11px] text-slate-500 italic">
                If disabled, you will start with a blank portfolio ready for CSV imports from Trade Republic, Scalable, Interactive Brokers, or Degiro.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-slate-100 mb-1">Anonymous Analytics</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Help us improve Portfolio by sharing privacy-preserving telemetry.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#151d30] border border-[#1e293b] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Activity className="w-4 h-4 text-[#A7E2C0]" />
                    <span className="text-xs font-bold text-slate-200">Enable Anonymous Telemetry</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enableTelemetry}
                    onClick={() => setEnableTelemetry((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      enableTelemetry ? "bg-[#DD3C73]" : "bg-slate-800"
                    }`}
                  >
                    <span className="sr-only">Enable Anonymous Telemetry</span>
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        enableTelemetry ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  We use PostHog to record basic app events (e.g. app launched, CSV imported, report generated).
                  Identified by a random UUID.
                </p>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-emerald-300">
                <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  <strong>Strict Privacy Guarantee:</strong> No portfolio holdings, monetary values, transaction amounts,
                  broker names, or personal identities are ever transmitted. You can toggle this anytime in Settings.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-6 border-t border-[#1e293b] bg-[#151d30]/30 flex items-center justify-between gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as 1 | 2)}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              Close
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s + 1) as 2 | 3)}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#DD3C73] hover:bg-[#c93264] text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              <span>Continue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#A7E2C0] hover:bg-[#92d6b0] text-xs font-bold text-slate-900 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? "Finishing..." : "Start Using Portfolio"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
