/**
 * The brief of a portfolio at the top of Guided Analysis: the prose and the
 * structured fields, with Edit and, when an AI provider answered, the
 * wizard. Loads the brief itself and reloads when one is saved anywhere.
 */
import { useCallback, useEffect, useState } from "react";
import { Pencil, Target, Wand2 } from "lucide-react";
import type { PortfolioBrief } from "portfolio-shared/portfolio";
import { isBriefEmpty } from "portfolio-shared/brief";
import { api } from "../../api";
import { formatTimeAgo } from "../portfolio/utils";
import { t } from "../../i18n";
import { BRIEF_SAVED_EVENT } from "./shared";
import { briefLines } from "./BriefFields";
import { BriefEditorModal } from "./BriefEditorModal";
import { BriefWizardModal } from "./BriefWizardModal";

const BUTTON =
  "h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-800 bg-slate-950 text-xs font-bold text-slate-300 hover:bg-slate-900 hover:border-slate-700 hover:text-slate-50 transition-colors cursor-pointer uppercase tracking-wider";

const ICON_BUTTON = "w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 transition-colors cursor-pointer";

/** The brief of a portfolio, kept current across views. */
export function usePortfolioBrief(portfolioId: string | null | undefined): { brief: PortfolioBrief | null; updatedAt: string | null; loading: boolean; reload: () => Promise<void> } {
  const [state, setState] = useState<{ brief: PortfolioBrief | null; updatedAt: string | null; loading: boolean }>({ brief: null, updatedAt: null, loading: true });
  const reload = useCallback(async () => {
    if (!portfolioId) return;
    try {
      const res = await api.getPortfolioBrief(portfolioId);
      setState({ brief: res.brief, updatedAt: res.briefUpdatedAt ?? null, loading: false });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [portfolioId]);
  useEffect(() => {
    setState({ brief: null, updatedAt: null, loading: true });
    void reload();
    const onSaved = (e: Event) => {
      if ((e as CustomEvent<string>).detail === portfolioId) void reload();
    };
    window.addEventListener(BRIEF_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(BRIEF_SAVED_EVENT, onSaved);
  }, [portfolioId, reload]);
  return { ...state, reload };
}

interface BriefCardProps {
  portfolioId: string;
  portfolioName?: string;
  /** The wizard is offered only when the AI setup answered. */
  aiReady: boolean;
  /** The narrow form for the Analysis sidebar. */
  compact?: boolean;
}

export function BriefCard({ portfolioId, portfolioName, aiReady, compact = false }: BriefCardProps) {
  const { brief, updatedAt, loading } = usePortfolioBrief(portfolioId);
  const [editorOpen, setEditorOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const empty = isBriefEmpty(brief);
  const lines = brief ? briefLines(brief) : [];

  const modals = (
    <>
      <BriefEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        portfolioId={portfolioId}
        portfolioName={portfolioName}
        brief={brief}
        onStartWizard={
          aiReady
            ? () => {
                setEditorOpen(false);
                setWizardOpen(true);
              }
            : undefined
        }
      />
      <BriefWizardModal isOpen={wizardOpen} onClose={() => setWizardOpen(false)} portfolioId={portfolioId} brief={brief} />
    </>
  );

  if (compact) {
    const wizardLabel = empty ? t("analysis.brief.startWizard") : t("analysis.brief.rerunWizard");
    const editLabel = empty ? t("analysis.brief.write") : t("analysis.brief.edit");
    return (
      <div className="cx-card p-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-100 min-w-0">
            <Target className="w-3.5 h-3.5 text-[#DD3C73] shrink-0" />
            <span className="truncate">{t("analysis.brief.title")}</span>
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {aiReady && (
              <button type="button" onClick={() => setWizardOpen(true)} title={wizardLabel} aria-label={wizardLabel} className={ICON_BUTTON}>
                <Wand2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button type="button" onClick={() => setEditorOpen(true)} title={editLabel} aria-label={editLabel} className={ICON_BUTTON}>
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {!loading && empty && <p className="mt-1 text-[11px] text-slate-500">{t("analysis.brief.emptySubtitle")}</p>}
        {!empty && brief?.prose && (
          <p className="mt-2 text-xs text-slate-300 leading-relaxed font-sans line-clamp-4" title={brief.prose}>
            {brief.prose}
          </p>
        )}
        {!empty && !brief?.prose && lines.length > 0 && (
          <dl className="mt-2 space-y-1 text-[11px]">
            {lines.slice(0, 3).map((l) => (
              <div key={l.label} className="flex gap-2 min-w-0">
                <dt className="text-slate-500 shrink-0">{l.label}</dt>
                <dd className="text-slate-200 min-w-0 truncate" title={l.value}>
                  {l.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {modals}
      </div>
    );
  }

  return (
    <div className="cx-card p-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-100">
            <Target className="w-4 h-4 text-[#DD3C73] shrink-0" />
            {t("analysis.brief.title")}
          </h3>
          <p className="pl-6 text-[11px] text-slate-500 mt-0.5">
            {empty ? t("analysis.brief.emptySubtitle") : updatedAt ? t("analysis.brief.updated", { time: formatTimeAgo(updatedAt) }) : t("analysis.brief.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {aiReady && (
            <button type="button" onClick={() => setWizardOpen(true)} className={BUTTON}>
              <Wand2 className="w-3.5 h-3.5" />
              {empty ? t("analysis.brief.startWizard") : t("analysis.brief.rerunWizard")}
            </button>
          )}
          <button type="button" onClick={() => setEditorOpen(true)} className={BUTTON}>
            <Pencil className="w-3.5 h-3.5" />
            {empty ? t("analysis.brief.write") : t("analysis.brief.edit")}
          </button>
        </div>
      </div>

      {!loading && empty && <p className="mt-3 text-xs text-slate-400 leading-relaxed max-w-2xl">{aiReady ? t("analysis.brief.emptyWithAi") : t("analysis.brief.emptyWithoutAi")}</p>}

      {!empty && brief && (
        <div className="mt-3 space-y-3">
          {brief.prose && <p className="text-sm text-slate-200 leading-relaxed font-sans whitespace-pre-line">{brief.prose}</p>}
          {lines.length > 0 && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {lines.map((l) => (
                <div key={l.label} className="flex gap-2 min-w-0">
                  <dt className="text-slate-500 shrink-0">{l.label}</dt>
                  <dd className="text-slate-200 min-w-0 truncate" title={l.value}>
                    {l.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {modals}
    </div>
  );
}
