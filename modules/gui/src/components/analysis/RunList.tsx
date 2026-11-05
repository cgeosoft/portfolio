/** Every analysis of a portfolio as a table by month, for the Analysis home. */
import { CheckCircle2, ChevronRight, Loader2, XCircle } from "lucide-react";
import type { AnalysisRunListItem } from "portfolio-shared/api-types";
import { getLocale, t } from "../../i18n";
import { groupRunsByMonth } from "./analysis-stages";
import { phaseLabel } from "./shared";

function StatusIcon({ run }: { run: AnalysisRunListItem }) {
  if (run.status === "completed") return <CheckCircle2 className="w-3.5 h-3.5 text-mint shrink-0" />;
  if (run.status === "running") return <Loader2 className="w-3.5 h-3.5 text-accent-500 animate-spin shrink-0" />;
  return <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
}

function runDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const BADGE = "px-1.5 py-0.5 rounded-sm border border-cream/40 bg-cream/10 text-cream text-[10px] font-bold uppercase tracking-wider";
const COLUMNS = 6;

function RunRow({ run, onOpen }: { run: AnalysisRunListItem; onOpen: (id: string) => void }) {
  const running = run.status === "running";
  return (
    <tr onClick={() => onOpen(run.id)} className="hover:bg-slate-800/20 transition-colors cursor-pointer">
      <td className="py-2.5 px-3 align-top whitespace-nowrap">
        {/* The click reaches the row, so the keyboard opens the run too. */}
        <button type="button" className="font-bold text-slate-200 cursor-pointer">
          {runDate(run.startedAt)}
        </button>
      </td>
      <td className="py-2.5 px-3 align-top whitespace-nowrap">
        <span className={`inline-flex items-center gap-1.5 ${running ? "text-accent-500" : "text-slate-400"}`}>
          <StatusIcon run={run} />
          {running ? phaseLabel(run.phase) : t(`analysis.run.status.${run.status}`)}
        </span>
        {(run.briefChanged || run.stale) && (
          <span className="mt-1 flex flex-wrap gap-1">
            {run.briefChanged && <span className={BADGE}>{t("analysis.run.briefChanged")}</span>}
            {run.stale && <span className={BADGE}>{t("analysis.run.stale")}</span>}
          </span>
        )}
      </td>
      <td className="py-2.5 px-3 align-top whitespace-nowrap text-slate-400">{t(`analysis.history.trigger.${run.trigger === "schedule" ? "schedule" : "manual"}`)}</td>
      <td className="py-2.5 px-3 align-top text-right text-slate-300">{running ? "" : run.findingsCount}</td>
      <td className="py-2.5 px-3 align-top text-right text-slate-300">{running ? "" : run.suggestionsCount}</td>
      <td className="py-2.5 pr-3 align-top">
        <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
      </td>
    </tr>
  );
}

interface RunListProps {
  runs: readonly AnalysisRunListItem[];
  onOpen: (id: string) => void;
}

export function RunList({ runs, onOpen }: RunListProps) {
  return (
    <div className="cx-card flex-1 flex flex-col min-h-[240px] overflow-hidden">
      <div className="overflow-auto custom-scrollbar flex-1 min-h-0">
        <table className="w-full text-left text-xs font-mono border-collapse">
          <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 z-10">
            <tr className="text-[10px] uppercase tracking-wider text-slate-400">
              <th className="py-2.5 px-3">{t("analysis.history.columns.date")}</th>
              <th className="py-2.5 px-3">{t("analysis.history.columns.status")}</th>
              <th className="py-2.5 px-3">{t("analysis.history.columns.source")}</th>
              <th className="py-2.5 px-3 text-right">{t("analysis.history.columns.findings")}</th>
              <th className="py-2.5 px-3 text-right">{t("analysis.sections.suggestions")}</th>
              <th className="py-2.5 pr-3" />
            </tr>
          </thead>
          {runs.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={COLUMNS} className="py-8 px-3 text-center text-slate-500 text-xs">
                  {t("analysis.run.empty")}
                </td>
              </tr>
            </tbody>
          ) : (
            groupRunsByMonth(runs, getLocale()).map((month) => (
              <tbody key={month.key} className="divide-y divide-slate-800/40">
                <tr>
                  <th colSpan={COLUMNS} scope="colgroup" className="pt-3 pb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {month.label}
                  </th>
                </tr>
                {month.runs.map((run) => (
                  <RunRow key={run.id} run={run} onOpen={onOpen} />
                ))}
              </tbody>
            ))
          )}
        </table>
      </div>
    </div>
  );
}
