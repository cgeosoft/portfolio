import { useCallback, useEffect, useState } from "react";
import { Bug, BarChart3, ExternalLink, ShieldCheck } from "lucide-react";
import { PRIVACY_NOTICE_URL } from "portfolio-shared/brand";
import { api } from "../../api";
import { APP_NAME, openExternal } from "../../environment";
import { t } from "../../i18n";
import { Toggle } from "../settings/SettingsFields";

export interface PrivacyPromptModalProps {
  isOpen: boolean;
  analyticsEnabled: boolean;
  onClose: () => void;
}

/** The one-time prompt for an install from before the two privacy options. Closing it keeps the values on screen. */
export function PrivacyPromptModal({ isOpen, analyticsEnabled, onClose }: PrivacyPromptModalProps) {
  const [analytics, setAnalytics] = useState(analyticsEnabled);
  const [errorReporting, setErrorReporting] = useState(false);

  useEffect(() => setAnalytics(analyticsEnabled), [analyticsEnabled]);

  const save = useCallback(() => {
    api.answerPrivacyPrompt({ analytics, errorReporting }).catch(() => {});
    onClose();
  }, [analytics, errorReporting, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") save();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, save]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div
        className="w-full max-w-md bg-widget border border-slate-800 rounded-2xl shadow-2xl p-6 text-slate-100 space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-prompt-title"
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-accent-500/10 text-accent-300 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 id="privacy-prompt-title" className="text-base font-bold text-slate-100">
              {t("setup.privacyPrompt.title")}
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed mt-1">{t("setup.privacyPrompt.description", { app: APP_NAME })}</p>
          </div>
        </div>

        <PromptOption icon={BarChart3} title={t("setup.telemetry.analyticsTitle")} text={t("setup.telemetry.analyticsText")} checked={analytics} onChange={() => setAnalytics((v) => !v)} />
        <PromptOption icon={Bug} title={t("setup.telemetry.errorsTitle")} text={t("setup.telemetry.errorsText")} checked={errorReporting} onChange={() => setErrorReporting((v) => !v)} />

        <p className="text-[11px] text-slate-400 leading-relaxed">{t("setup.telemetry.vendorText")}</p>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => openExternal(PRIVACY_NOTICE_URL)}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-accent-300 transition-colors cursor-pointer"
          >
            <span>{t("setup.telemetry.noticeLink")}</span>
            <ExternalLink className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={save}
            className="h-9 px-4 rounded-lg border border-slate-700 bg-slate-800 text-xs font-bold text-slate-100 hover:border-slate-600 transition-colors cursor-pointer"
          >
            {t("setup.privacyPrompt.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptOption({ icon: Icon, title, text, checked, onChange }: { icon: typeof Bug; title: string; text: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="p-3 rounded-xl bg-card border border-line space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Icon className="w-4 h-4 text-accent-300" />
          <span className="text-xs font-bold text-slate-200">{title}</span>
        </div>
        <Toggle checked={checked} onChange={onChange} label={title} />
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">{text}</p>
    </div>
  );
}
