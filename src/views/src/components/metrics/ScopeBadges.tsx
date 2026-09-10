import { Database, Eye, History, LineChart, type LucideIcon } from "lucide-react";
import { METRIC_SCOPE_DESCRIPTIONS, type MetricScope } from "../../../../shared/metric-abi";

const SCOPE_ICONS: Record<MetricScope, LucideIcon> = {
  "portfolio.summary": Eye,
  "portfolio.holdings": Database,
  "portfolio.transactions": History,
  "portfolio.history": LineChart,
};

/** Scopes above the summary reveal individual positions or the ledger. */
const SENSITIVE: readonly MetricScope[] = ["portfolio.holdings", "portfolio.transactions"];

interface ScopeBadgesProps {
  scopes: readonly MetricScope[];
  size?: "xs" | "sm";
}

/** Chips naming the data a metric module receives. */
export function ScopeBadges({ scopes, size = "xs" }: ScopeBadgesProps) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {scopes.map((scope) => {
        const Icon = SCOPE_ICONS[scope];
        const meta = METRIC_SCOPE_DESCRIPTIONS[scope];
        const sensitive = SENSITIVE.includes(scope);
        return (
          <span
            key={scope}
            title={meta.grants}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 font-mono uppercase tracking-wider ${
              size === "xs" ? "h-5 text-[9px]" : "h-6 text-[10px]"
            } ${
              sensitive
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-slate-700 bg-slate-800/60 text-slate-400"
            }`}
          >
            <Icon className="w-2.5 h-2.5" />
            <span>{meta.label}</span>
          </span>
        );
      })}
    </div>
  );
}

interface ScopeConsentListProps {
  scopes: readonly MetricScope[];
}

/** The full-sentence consent list shown before an install. */
export function ScopeConsentList({ scopes }: ScopeConsentListProps) {
  return (
    <ul className="space-y-2">
      {scopes.map((scope) => {
        const Icon = SCOPE_ICONS[scope];
        const meta = METRIC_SCOPE_DESCRIPTIONS[scope];
        const sensitive = SENSITIVE.includes(scope);
        return (
          <li
            key={scope}
            className={`flex items-start gap-3 rounded-lg border p-3 ${
              sensitive ? "border-amber-500/40 bg-amber-500/5" : "border-slate-800 bg-slate-950/60"
            }`}
          >
            <div className={`mt-0.5 shrink-0 ${sensitive ? "text-amber-300" : "text-slate-400"}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-200">{meta.consent}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                <code className="text-slate-400">{scope}</code> · {meta.grants}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
