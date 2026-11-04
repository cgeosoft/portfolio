/**
 * The portfolio brief as a plain form: every structured field plus the
 * prose. Works without an AI provider. Before saving, the text is checked
 * for money amounts; the user is asked to say it in percent instead.
 */
import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, Target, Wand2, X } from "lucide-react";
import { BRIEF_WIZARD_QUESTIONS } from "portfolio-shared/brief";
import type { PortfolioBrief } from "portfolio-shared/portfolio";
import { api } from "../../api";
import { t } from "../../i18n";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../portfolio/PortfolioCard";
import { BRIEF_SAVED_EVENT } from "./shared";
import { BriefFieldEditor, LABEL_CLASS, briefDraftTexts } from "./BriefFields";

interface BriefEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  portfolioId: string;
  portfolioName?: string;
  brief: PortfolioBrief | null;
  /** Opens the wizard instead; absent without an AI provider. */
  onStartWizard?: () => void;
  onSaved?: (brief: PortfolioBrief | null) => void;
}

/** Saves a brief after the amount check. Returns the amounts found, or null when it saved. */
export async function saveBrief(portfolioId: string, brief: PortfolioBrief): Promise<{ amounts: string[] } | { saved: PortfolioBrief | null }> {
  const scan = await api.scanAmounts(briefDraftTexts(brief));
  if (scan.hasAmounts) return { amounts: scan.matches };
  const res = await api.savePortfolioBrief(portfolioId, brief);
  window.dispatchEvent(new CustomEvent<string>(BRIEF_SAVED_EVENT, { detail: portfolioId }));
  return { saved: res.brief };
}

export function BriefEditorModal({ isOpen, onClose, portfolioId, portfolioName, brief, onStartWizard, onSaved }: BriefEditorModalProps) {
  const [draft, setDraft] = useState<PortfolioBrief>(brief ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDraft(brief ?? {});
      setError(null);
    }
  }, [isOpen, brief]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await saveBrief(portfolioId, draft);
      if ("amounts" in res) {
        setError(t("analysis.brief.amountsFound", { amounts: res.amounts.join(", ") }));
        return;
      }
      onSaved?.(res.saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 animate-in fade-in duration-200 font-mono">
      <div role="dialog" aria-modal="true" aria-labelledby="brief-editor-title" className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border bg-accent-500/10 text-accent-400 border-accent-500/20">
              <Target className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 id="brief-editor-title" className="font-bold text-slate-100 text-lg truncate">
                {t("analysis.brief.editTitle")}
              </h3>
              <p className="text-xs text-slate-400 truncate">{portfolioName ? t("analysis.brief.editSubtitleNamed", { portfolio: portfolioName }) : t("analysis.brief.editSubtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors cursor-pointer hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-5 text-sm text-slate-300">
          <p className="text-xs text-slate-400 leading-relaxed">{t("analysis.brief.intro")}</p>
          {onStartWizard && (
            <button type="button" onClick={onStartWizard} className={`${SECONDARY_BUTTON} self-start`}>
              <Wand2 className="w-3.5 h-3.5" />
              {t("analysis.brief.useWizard")}
            </button>
          )}

          <div className="space-y-2">
            <div className={LABEL_CLASS}>{t("analysis.brief.fields.prose")}</div>
            <BriefFieldEditor field="prose" brief={draft} onChange={setDraft} disabled={saving} />
          </div>

          {BRIEF_WIZARD_QUESTIONS.map((q) => (
            <div key={q.id} className="space-y-2">
              <div className={LABEL_CLASS}>{t(`analysis.brief.fields.${q.id}`)}</div>
              <BriefFieldEditor field={q.id} brief={draft} onChange={setDraft} disabled={saving} />
            </div>
          ))}

          <p className="text-[11px] text-slate-500">{t("analysis.brief.privacy")}</p>

          {error && (
            <span className="inline-flex items-start gap-1.5 text-[11px] text-rose-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span className="whitespace-pre-line">{error}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-800 shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className={`${SECONDARY_BUTTON} ml-auto`}>
            {t("common.cancel")}
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} className={PRIMARY_BUTTON}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
