/**
 * The brief wizard: the fixed questions one per screen, then at most two
 * follow-ups from the model where the answers conflict with the allocation,
 * then a prose draft the user edits before saving. Only shown when an AI
 * provider answered; the structured fields come from the answers, not from
 * the model.
 */
import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Wand2, X } from "lucide-react";
import { BRIEF_WIZARD_QUESTIONS } from "portfolio-shared/brief";
import type { BriefWizardFollowupResponse } from "portfolio-shared/api-types";
import type { PortfolioBrief } from "portfolio-shared/portfolio";
import { api } from "../../api";
import { t } from "../../i18n";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../portfolio/PortfolioCard";
import { BriefFieldEditor, INPUT_CLASS, LABEL_CLASS, briefDraftTexts, briefLines } from "./BriefFields";
import { saveBrief } from "./BriefEditorModal";

interface BriefWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  portfolioId: string;
  brief: PortfolioBrief | null;
  onSaved?: (brief: PortfolioBrief | null) => void;
}

type Followup = BriefWizardFollowupResponse["followups"][number];

/** The draft as the answers the service reads (portfolio-brief.ts, briefFromAnswers). */
function answersOf(brief: PortfolioBrief): Record<string, unknown> {
  return {
    purpose: { text: brief.purpose },
    horizon: { text: brief.horizon },
    riskTolerance: { score: brief.riskTolerance?.score, maxDropPercent: brief.riskTolerance?.maxDropPercent },
    incomeNeed: { choice: brief.incomeNeed?.required === undefined ? undefined : brief.incomeNeed.required ? "yes" : "no", targetYieldPercent: brief.incomeNeed?.targetYieldPercent },
    cashFlowPattern: { text: brief.cashFlowPattern },
    targetBands: brief.targetBands ?? [],
    constraints: { choices: brief.constraints ?? [] },
    successInOwnWords: brief.successInOwnWords ?? "",
  };
}

export function BriefWizardModal({ isOpen, onClose, portfolioId, brief, onSaved }: BriefWizardModalProps) {
  const total = BRIEF_WIZARD_QUESTIONS.length;
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<PortfolioBrief>(brief ?? {});
  const [followups, setFollowups] = useState<Followup[] | null>(null);
  const [followupAnswers, setFollowupAnswers] = useState<Record<string, string>>({});
  const [prose, setProse] = useState("");
  const [stage, setStage] = useState<"questions" | "followups" | "draft">("questions");
  const [busy, setBusy] = useState<"followups" | "draft" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setDraft(brief ?? {});
    setFollowups(null);
    setFollowupAnswers({});
    setProse(brief?.prose ?? "");
    setStage("questions");
    setError(null);
  }, [isOpen, brief]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const question = BRIEF_WIZARD_QUESTIONS[step]!;

  const checkAmounts = async (texts: string[]): Promise<boolean> => {
    const scan = await api.scanAmounts(texts);
    if (scan.hasAmounts) {
      setError(t("analysis.brief.amountsFound", { amounts: scan.matches.join(", ") }));
      return false;
    }
    return true;
  };

  const makeDraft = async () => {
    setBusy("draft");
    setError(null);
    try {
      const fa = Object.fromEntries((followups ?? []).filter((f) => followupAnswers[f.id]?.trim()).map((f) => [f.id, { question: f.question, answer: followupAnswers[f.id]!.trim() }]));
      if (!(await checkAmounts(Object.values(fa).map((x) => x.answer)))) return;
      const res = await api.briefWizardDraft(portfolioId, { answers: answersOf(draft), followupAnswers: fa });
      setProse(res.prose || draft.prose || "");
      setStage("draft");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const finishQuestions = async () => {
    setBusy("followups");
    setError(null);
    try {
      if (!(await checkAmounts(briefDraftTexts(draft)))) return;
      const res = await api.briefWizardFollowups(portfolioId, answersOf(draft));
      setFollowups(res.followups);
      if (res.followups.length > 0) {
        setStage("followups");
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    } finally {
      setBusy(null);
    }
    await makeDraft();
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const res = await saveBrief(portfolioId, { ...draft, prose: prose.trim() || undefined });
      if ("amounts" in res) {
        setError(t("analysis.brief.amountsFound", { amounts: res.amounts.join(", ") }));
        return;
      }
      onSaved?.(res.saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const progress = stage === "questions" ? (step + 1) / (total + 1) : stage === "followups" ? total / (total + 1) : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 animate-in fade-in duration-200 font-mono">
      <div role="dialog" aria-modal="true" aria-labelledby="brief-wizard-title" className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border bg-accent-500/10 text-accent-400 border-accent-500/20">
              <Wand2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 id="brief-wizard-title" className="font-bold text-slate-100 text-lg truncate">
                {t("analysis.brief.wizardTitle")}
              </h3>
              <p className="text-xs text-slate-400">
                {stage === "questions"
                  ? t("analysis.brief.wizardStep", { step: step + 1, total })
                  : stage === "followups"
                    ? t("analysis.brief.followupsTitle")
                    : t("analysis.brief.draftTitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(busy)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors cursor-pointer hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="h-1 bg-slate-950 shrink-0">
          <div className="h-full bg-accent-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-4 text-sm text-slate-300 min-h-[260px]">
          {stage === "questions" && (
            <>
              <h4 className="text-base font-bold text-slate-100 font-sans">{t(`analysis.brief.questions.${question.id}`)}</h4>
              <p className="text-xs text-slate-400 -mt-2">{t(`analysis.brief.hints.${question.id}`)}</p>
              <BriefFieldEditor field={question.id} brief={draft} onChange={setDraft} disabled={Boolean(busy)} />
            </>
          )}

          {stage === "followups" && (
            <>
              <p className="text-xs text-slate-400">{t("analysis.brief.followupsIntro")}</p>
              {(followups ?? []).map((f) => (
                <div key={f.id} className="space-y-2">
                  <div className="text-sm font-bold text-slate-100 font-sans">{f.question}</div>
                  {f.options && (
                    <div className="flex flex-wrap gap-1.5">
                      {f.options.map((o) => (
                        <button
                          key={o}
                          type="button"
                          onClick={() => setFollowupAnswers((prev) => ({ ...prev, [f.id]: o }))}
                          aria-pressed={followupAnswers[f.id] === o}
                          className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                            followupAnswers[f.id] === o ? "border-accent-500/60 bg-accent-500/15 text-accent-300" : "border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700"
                          }`}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    className={INPUT_CLASS}
                    maxLength={300}
                    value={followupAnswers[f.id] ?? ""}
                    placeholder={t("analysis.brief.ownWords")}
                    onChange={(e) => setFollowupAnswers((prev) => ({ ...prev, [f.id]: e.target.value }))}
                  />
                </div>
              ))}
            </>
          )}

          {stage === "draft" && (
            <>
              <p className="text-xs text-slate-400">{t("analysis.brief.draftIntro")}</p>
              <textarea className={`${INPUT_CLASS} min-h-[140px] resize-y font-sans leading-relaxed`} maxLength={2000} value={prose} onChange={(e) => setProse(e.target.value)} />
              <div className="space-y-1">
                <div className={LABEL_CLASS}>{t("analysis.brief.structuredTitle")}</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {briefLines(draft).map((l) => (
                    <div key={l.label} className="contents">
                      <dt className="text-slate-500">{l.label}</dt>
                      <dd className="text-slate-200">{l.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </>
          )}

          {error && (
            <span className="inline-flex items-start gap-1.5 text-[11px] text-rose-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span className="whitespace-pre-line">{error}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-800 shrink-0">
          {stage === "questions" && step > 0 && (
            <button type="button" onClick={() => setStep((s) => s - 1)} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("analysis.brief.back")}
            </button>
          )}
          {stage === "followups" && (
            <button type="button" onClick={() => setStage("questions")} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("analysis.brief.back")}
            </button>
          )}
          {stage === "draft" && (
            <button type="button" onClick={() => setStage(followups && followups.length ? "followups" : "questions")} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("analysis.brief.back")}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {stage === "questions" && step < total - 1 && (
              <>
                <button type="button" onClick={() => setStep((s) => s + 1)} className={SECONDARY_BUTTON}>
                  {t("analysis.brief.skip")}
                </button>
                <button type="button" onClick={() => setStep((s) => s + 1)} className={PRIMARY_BUTTON}>
                  {t("analysis.brief.next")}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {stage === "questions" && step === total - 1 && (
              <button type="button" onClick={() => void finishQuestions()} disabled={Boolean(busy)} className={PRIMARY_BUTTON}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                {busy === "draft" ? t("analysis.brief.drafting") : busy === "followups" ? t("analysis.brief.checking") : t("analysis.brief.next")}
              </button>
            )}
            {stage === "followups" && (
              <button type="button" onClick={() => void makeDraft()} disabled={Boolean(busy)} className={PRIMARY_BUTTON}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                {busy ? t("analysis.brief.drafting") : t("analysis.brief.next")}
              </button>
            )}
            {stage === "draft" && (
              <button type="button" onClick={() => void save()} disabled={Boolean(busy)} className={PRIMARY_BUTTON}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {t("common.save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
