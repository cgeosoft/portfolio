import { useState, useEffect, type ReactNode } from "react";
import {
  Shield,
  Sparkles,
  Lock,
  BarChart3,
  Bot,
  Activity,
  ArrowRight,
  Check,
  Zap,
  ScrollText,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Languages,
} from "lucide-react";
import { api } from "../../api";
import { rpc } from "../../rpc";
import { applyLanguageNow, getLanguage, switchLanguage, systemLanguage, t } from "../../i18n";
import { BrandScreen } from "./BrandScreen";
import { LanguagePicker, LanguageTierNote } from "./LanguageSelect";
import { WebsitePage } from "./WebsitePage";
import { APP_NAME } from "../../environment";

/** 1 language, 2 welcome and Terms of Use, 3 demo portfolio, 4 telemetry. */
export type SetupStep = 1 | 2 | 3 | 4;

const STEP_COUNT = 4;

/** The first step after the Terms of Use, where the app reopens the wizard once they are accepted. */
export const SETUP_STEP_AFTER_TERMS: SetupStep = 3;

interface SetupWizardPageProps {
  isOpen: boolean;
  /** Step shown on open: `SETUP_STEP_AFTER_TERMS` right after step 2 accepted the Terms of Use. */
  startStep?: SetupStep;
  /** First run: the Terms of Use are not accepted yet. Step 2 asks for them and the wizard cannot be closed. */
  termsPending?: boolean;
  /** Records the acceptance. The app then reopens the wizard at `SETUP_STEP_AFTER_TERMS`, or opens the dashboard when setup is complete. */
  onAcceptTerms?: () => Promise<unknown>;
  /** Base URL of the website that hosts the Terms of Use. */
  webpageUrl?: string;
  onComplete: () => void;
  onClose: () => void;
}

/**
 * Every step sits in the same grid cell, so the card always has the height of the
 * tallest step. The other steps stay laid out but hidden and inert.
 */
function StepPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <section inert={!active} className={`[grid-area:1/1] space-y-4 ${active ? "" : "invisible"}`}>
      {children}
    </section>
  );
}

/** Line points of the sample value chart in `DemoPreview`: a year that ends higher. */
const DEMO_LINE = [
  [12, 90], [37, 82], [62, 86], [86, 72], [111, 76], [136, 62], [161, 66], [186, 50], [210, 54], [235, 38], [260, 28],
] as const;

/** Allocation ring of `DemoPreview`: dash length and offset on a circle of r=34 (circumference 213.6). */
const DEMO_RING = [
  { label: "stocks", stroke: "stroke-accent", fill: "fill-accent", dash: 135.9, offset: 0 },
  { label: "etfs", stroke: "stroke-plum-bright", fill: "fill-plum-bright", dash: 63.2, offset: -138.9 },
  { label: "crypto", stroke: "stroke-cyan-400", fill: "fill-cyan-400", dash: 5.5, offset: -205.1 },
] as const;

/** Illustration on the demo step: a rising value line and the stock, ETF and crypto mix. */
function DemoPreview() {
  const line = DEMO_LINE.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const [endX, endY] = DEMO_LINE[DEMO_LINE.length - 1];
  return (
    <div className="rounded-xl bg-card border border-line overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 480 112" className="w-full h-auto block">
        <defs>
          <linearGradient id="setup-demo-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "rgb(var(--accent-rgb))", stopOpacity: 0.35 }} />
            <stop offset="100%" style={{ stopColor: "rgb(var(--accent-rgb))", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {[32, 60, 88].map((y) => (
          <line key={y} x1="12" x2="260" y1={y} y2={y} className="stroke-line" strokeDasharray="3 4" />
        ))}
        <path d={`${line} L${endX} 100 L12 100 Z`} fill="url(#setup-demo-area)" />
        <path d={line} fill="none" className="stroke-accent" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={endX} cy={endY} r="4" className="fill-accent" />
        <circle cx={endX} cy={endY} r="8" className="fill-accent/20" />

        <g transform="rotate(-90 318 56)">
          <circle cx="318" cy="56" r="34" fill="none" className="stroke-slate-800" strokeWidth="12" />
          {DEMO_RING.map((seg) => (
            <circle
              key={seg.label}
              cx="318"
              cy="56"
              r="34"
              fill="none"
              className={seg.stroke}
              strokeWidth="12"
              strokeDasharray={`${seg.dash} 213.6`}
              strokeDashoffset={seg.offset}
            />
          ))}
        </g>

        {DEMO_RING.map((seg, i) => (
          <g key={seg.label} transform={`translate(376 ${38 + i * 18})`}>
            <rect width="8" height="8" rx="2" y="-7" className={seg.fill} />
            <text x="14" className="fill-slate-400 font-mono" fontSize="10">
              {t(`setup.demo.chart.${seg.label}`)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function SetupWizardPage({
  isOpen,
  startStep = 1,
  termsPending = false,
  onAcceptTerms,
  webpageUrl,
  onComplete,
  onClose,
}: SetupWizardPageProps) {
  const [step, setStep] = useState<SetupStep>(startStep);
  const [termsChecked, setTermsChecked] = useState(false);
  const [populateDemo, setPopulateDemo] = useState(true);
  const [enableTelemetry, setEnableTelemetry] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The full Terms of Use, shown in place of the card so the app behind stays covered. */
  const [showTerms, setShowTerms] = useState(false);
  const [language, setLanguage] = useState(getLanguage);
  const [detectedLanguage] = useState(systemLanguage);
  /** The language the app behind the wizard rendered in; a change means a reload when the wizard ends. */
  const [mountedLanguage] = useState(getLanguage);

  /**
   * Applies the language at once: the next steps render in it, no reload. The
   * state changes only after the texts load; setting it before would make this
   * second, equal update a no-op and the wizard would keep the old texts.
   */
  const handleLanguage = async (code: string) => {
    await applyLanguageNow(code);
    setLanguage(getLanguage());
  };

  /** Saves the language for the service (reports, notifications); reloads when the app behind still shows the old one. */
  const commitLanguage = async () => {
    try {
      await api.saveConfig({ language: getLanguage() });
    } catch {
      // The interface keeps the language; the service keeps its previous one until Settings saves it.
    }
    if (getLanguage() !== mountedLanguage) switchLanguage(getLanguage());
  };

  /** Closing a reopened wizard after a language change saves and applies it. */
  const handleClose = () => {
    if (getLanguage() !== mountedLanguage) void commitLanguage();
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      setStep(startStep);
      setTermsChecked(false);
      setError(null);
      setShowTerms(false);
    }
  }, [isOpen, startStep]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isSubmitting) return;
      if (showTerms) setShowTerms(false);
      else if (!termsPending) handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!isOpen) return null;

  if (showTerms) {
    return (
      <div className="fixed inset-0 z-[70] bg-[var(--app-bg)] text-[var(--text-main)] flex flex-col p-2 sm:p-3">
        <main className="flex-1 w-full container max-w-screen-2xl mx-auto px-2 sm:px-6 lg:px-8 pt-2 pb-6 sm:pb-8 flex flex-col min-h-0 overflow-y-auto custom-scrollbar">
          <WebsitePage page="terms" onBack={() => setShowTerms(false)} webpageUrl={webpageUrl} />
        </main>
      </div>
    );
  }

  const termsAccepted = !termsPending || termsChecked;

  const handleContinue = async () => {
    if (step === 2 && termsPending) {
      if (!onAcceptTerms) return;
      setError(null);
      setIsSubmitting(true);
      try {
        await onAcceptTerms();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("setup.welcome.acceptFailed"));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    setStep((s) => (s + 1) as SetupStep);
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    try {
      await rpc.request.completeSetup({
        populateDemo,
        enableTelemetry,
      });
      await commitLanguage();
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
    <BrandScreen>
      <div className="relative z-10 bg-widget border border-line rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden font-mono text-slate-100 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-line bg-card/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#DD3C73]/10 text-[#DD3C73] border border-[#DD3C73]/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-wide">{t("setup.title")}</h2>
              <p className="text-xs text-slate-400">{t("setup.stepOf", { step, total: STEP_COUNT })}</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-all ${
                  step === s ? "w-6 bg-[#DD3C73]" : step > s ? "bg-mint" : "bg-slate-700"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Steps */}
        <div className="p-6 grid grid-cols-1">
          <StepPanel active={step === 1}>
            <div className="flex items-start gap-3">
              <Languages className="w-5 h-5 text-accent mt-1 shrink-0" />
              <div>
                <h3 className="text-lg font-bold text-slate-100 mb-1">{t("setup.language.title")}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{t("setup.language.description")}</p>
              </div>
            </div>

            <LanguagePicker value={language} onChange={(code) => void handleLanguage(code)} detected={detectedLanguage} disabled={isSubmitting} />

            <div className="p-3 rounded-xl bg-card border border-line">
              <LanguageTierNote code={language} />
            </div>
          </StepPanel>

          <StepPanel active={step === 2}>
            <div>
              <h3 className="text-lg font-bold text-slate-100 mb-1">{t("setup.welcome.title", { app: APP_NAME })}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{t("setup.welcome.subtitle")}</p>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-card border border-line">
                <Lock className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-bold text-slate-200">{t("setup.welcome.privateTitle")}</div>
                  <div className="text-[11px] text-slate-400">{t("setup.welcome.privateText")}</div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-card border border-line">
                <BarChart3 className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-bold text-slate-200">{t("setup.welcome.pricesTitle")}</div>
                  <div className="text-[11px] text-slate-400">{t("setup.welcome.pricesText")}</div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-card border border-line">
                <Bot className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-bold text-slate-200">{t("setup.welcome.assistantTitle")}</div>
                  <div className="text-[11px] text-slate-400">{t("setup.welcome.assistantText")}</div>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-card border border-line space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-accent-400 flex items-center gap-1.5">
                  <ScrollText className="w-3.5 h-3.5" />
                  {t("setup.welcome.termsHighlights")}
                </span>
                <button
                  type="button"
                  onClick={() => setShowTerms(true)}
                  className="text-xs text-accent-400 hover:text-accent-300 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <span>{t("setup.welcome.readTerms")}</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <div className="text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                <p>• {t("setup.welcome.termsPrices")}</p>
                <p>• {t("setup.welcome.termsAdvice")}</p>
                <p>• {t("setup.welcome.termsFigures")}</p>
              </div>
            </div>

            <label
              className={`flex items-start gap-3 p-3 rounded-xl border border-line select-none ${
                termsPending ? "bg-card/50 cursor-pointer hover:bg-card transition-colors" : "bg-card/30"
              }`}
            >
              <input
                type="checkbox"
                checked={termsAccepted}
                // Not disabled once accepted: a disabled checkbox is drawn grey, not in the accent.
                disabled={isSubmitting}
                onChange={(e) => {
                  if (!termsPending) return;
                  setTermsChecked(e.target.checked);
                  setError(null);
                }}
                className={`mt-0.5 w-4 h-4 shrink-0 accent-accent ${termsPending ? "cursor-pointer" : "cursor-default"}`}
              />
              <span className="text-xs text-slate-300 leading-snug">
                {t("setup.welcome.agreeBefore") && `${t("setup.welcome.agreeBefore")} `}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowTerms(true);
                  }}
                  className="text-accent-400 hover:text-accent-300 underline font-semibold cursor-pointer"
                >
                  {t("setup.welcome.termsLink", { app: APP_NAME })}
                </button>
                {t("setup.welcome.agreeAfter")}
              </span>
            </label>

            {error && (
              <div className="flex items-center gap-2 p-3 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </StepPanel>

          <StepPanel active={step === 3}>
            <DemoPreview />

            <div>
              <h3 className="text-lg font-bold text-slate-100 mb-1">{t("setup.demo.title")}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{t("setup.demo.description")}</p>
            </div>

            <ul className="space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
              {[t("setup.demo.history"), t("setup.demo.holdings"), t("setup.demo.prices"), t("setup.demo.ownPortfolio", { name: "Demo Portfolio" })].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-mint shrink-0 mt-0.5" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="p-4 rounded-xl bg-card border border-line space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Zap className="w-4 h-4 text-[#DD3C73]" />
                  <span className="text-xs font-bold text-slate-200">{t("setup.demo.toggle")}</span>
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
                  <span className="sr-only">{t("setup.demo.toggle")}</span>
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      populateDemo ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              {/* Both hints share one cell, so switching does not change the card height */}
              <div className="grid text-[11px] text-slate-400 leading-relaxed">
                <p className={`[grid-area:1/1] ${populateDemo ? "" : "invisible"}`}>
                  {t("setup.demo.hintOn")}
                </p>
                <p className={`[grid-area:1/1] ${populateDemo ? "invisible" : ""}`}>
                  {t("setup.demo.hintOff")}
                </p>
              </div>
            </div>
          </StepPanel>

          <StepPanel active={step === 4}>
            <div>
              <h3 className="text-lg font-bold text-slate-100 mb-1">{t("setup.telemetry.title")}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{t("setup.telemetry.description", { app: APP_NAME })}</p>
            </div>

            <div className="p-4 rounded-xl bg-card border border-line space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Activity className="w-4 h-4 text-mint" />
                  <span className="text-xs font-bold text-slate-200">{t("setup.telemetry.toggle")}</span>
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
                  <span className="sr-only">{t("setup.telemetry.toggle")}</span>
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      enableTelemetry ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {t("setup.telemetry.posthog")}
              </p>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-emerald-300">
              <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                <strong>{t("setup.telemetry.guaranteeTitle")}</strong> {t("setup.telemetry.guaranteeText")}
              </p>
            </div>
          </StepPanel>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 border-t border-line bg-card/30 flex items-center justify-between gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as SetupStep)}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              {t("common.back")}
            </button>
          ) : termsPending ? (
            <span />
          ) : (
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              {t("common.close")}
            </button>
          )}

          {step < STEP_COUNT ? (
            <button
              type="button"
              onClick={handleContinue}
              disabled={isSubmitting || (step === 2 && !termsAccepted)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#DD3C73] hover:bg-[#c93264] text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>{step === 2 && termsPending ? t("setup.acceptContinue") : t("common.continue")}</span>
              {!isSubmitting && <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#DD3C73] hover:bg-[#c93264] text-xs font-bold text-white transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? t("setup.finishing") : t("setup.start", { app: APP_NAME })}</span>
            </button>
          )}
        </div>
      </div>
    </BrandScreen>
  );
}
