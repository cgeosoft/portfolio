/**
 * The suggestions and the summary of the last finished analysis, for the side
 * of the Analysis home.
 */
import { useEffect, useState, type ReactNode } from "react";
import { FileText, Lightbulb } from "lucide-react";
import type { GetAnalysisRunResponse } from "portfolio-shared/api-types";
import type { PortfolioSuggestion } from "portfolio-shared/suggestions";
import { api } from "../../api";
import { t } from "../../i18n";
import { showToast } from "../common/Toaster";
import { formatTimeAgo } from "../portfolio/utils";
import { Suggestions } from "./RunStages";

function SideCard({ icon: Icon, title, count = 0, onShowAll, children }: { icon: typeof FileText; title: string; count?: number; onShowAll?: () => void; children: ReactNode }) {
  return (
    <section className="cx-card p-4 space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-bold uppercase tracking-widest text-slate-100 min-w-0">
          <Icon className="w-4 h-4 text-[#DD3C73] shrink-0" />
          <span className="truncate">{title}</span>
        </h3>
        {count > 0 && (
          <button type="button" onClick={onShowAll} className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-accent-500 hover:underline cursor-pointer">
            {t("analysis.actions.showAll", { count })}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

interface LastAnalysisProps {
  /** The last finished run; undefined when there is none yet. */
  runId?: string;
  suggestionsCount: number;
  onOpenRun: (id: string) => void;
  onWhy: (s: PortfolioSuggestion) => void;
  onOpenSuggestions: () => void;
}

export function LastAnalysis({ runId, suggestionsCount, onOpenRun, onWhy, onOpenSuggestions }: LastAnalysisProps) {
  const [loaded, setLoaded] = useState<GetAnalysisRunResponse | null>(null);

  useEffect(() => {
    if (!runId) return;
    let current = true;
    api
      .getAnalysisRun(runId)
      .then((res) => {
        if (current) setLoaded(res);
      })
      .catch((e: unknown) => {
        if (current) showToast(e instanceof Error ? e.message : String(e), "error");
      });
    return () => {
      current = false;
    };
  }, [runId]);

  const detail = loaded?.run.id === runId ? loaded : null;
  const suggestions = detail?.suggestions ?? [];
  const run = detail?.run;

  return (
    <>
      <SideCard icon={Lightbulb} title={t("analysis.sections.suggestions")} count={suggestionsCount} onShowAll={onOpenSuggestions}>
        {detail && suggestions.length === 0 && <p className="text-slate-500">{t("analysis.actions.none")}</p>}
        <Suggestions suggestions={suggestions} onWhy={onWhy} />
      </SideCard>
      {(run || !runId) && (
        <SideCard icon={FileText} title={run ? t("analysis.actions.lastRun", { time: formatTimeAgo(run.endedAt ?? run.startedAt) }) : t("analysis.actions.noRun")}>
          {run?.summary && (
            <button type="button" onClick={() => onOpenRun(run.id)} className="w-full text-left font-sans text-slate-300 leading-relaxed whitespace-pre-line hover:text-slate-100 cursor-pointer">
              {run.summary}
            </button>
          )}
        </SideCard>
      )}
    </>
  );
}
