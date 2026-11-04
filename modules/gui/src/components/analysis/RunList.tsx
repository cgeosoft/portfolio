/** Every analysis of a portfolio by month, for the Analysis sidebar. */
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { AnalysisRunListItem } from "portfolio-shared/api-types";
import { getLocale, t } from "../../i18n";
import { groupRunsByMonth } from "./analysis-stages";
import { phaseLabel } from "./shared";

function StatusIcon({ run }: { run: AnalysisRunListItem }) {
  if (run.status === "completed") return <CheckCircle2 className="w-3.5 h-3.5 text-mint shrink-0 mt-px" />;
  if (run.status === "running") return <Loader2 className="w-3.5 h-3.5 text-accent-500 animate-spin shrink-0 mt-px" />;
  return <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-px" />;
}

function runDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

interface RunListProps {
  runs: readonly AnalysisRunListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RunList({ runs, selectedId, onSelect }: RunListProps) {
  if (runs.length === 0) return <p className="px-3 text-[11px] text-slate-500">{t("analysis.history.empty")}</p>;
  return (
    <nav className="space-y-3" aria-label={t("layout.tabs.analysis")}>
      {groupRunsByMonth(runs, getLocale()).map((month) => (
        <section key={month.key}>
          <h4 className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{month.label}</h4>
          <ul className="space-y-0.5">
            {month.runs.map((run) => {
              const active = run.id === selectedId;
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(run.id)}
                    aria-current={active ? "true" : undefined}
                    title={run.summary}
                    className={`w-full flex items-start gap-2 px-3 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                      active ? "bg-accent-500/15 text-accent-500 font-semibold" : "text-slate-300 hover:text-slate-100 hover:bg-slate-800/40"
                    }`}
                  >
                    <StatusIcon run={run} />
                    <span className="min-w-0">
                      <span className="block truncate">{runDate(run.startedAt)}</span>
                      <span className="block truncate text-[11px] font-normal text-slate-500">
                        {run.status === "running" ? phaseLabel(run.phase) : `${t(`analysis.run.status.${run.status}`)}${run.trigger === "schedule" ? ` · ${t("analysis.history.trigger.schedule")}` : ""}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
