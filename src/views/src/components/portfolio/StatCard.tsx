import React from "react";
import { Info } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  subValue?: string;
  subValueClass?: string;
  icon?: React.ReactNode;
  hint?: string;
  onInfo?: () => void;
  infoAriaLabel?: string;
}

export function StatCard({
  title,
  value,
  subValue,
  subValueClass,
  icon,
  hint,
  onInfo,
  infoAriaLabel,
}: StatCardProps) {
  return (
    <div className="cx-card p-4 flex flex-col justify-between relative overflow-hidden group" title={hint}>
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 font-mono min-w-0">
          {icon && <span className="text-slate-400 shrink-0 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>}
          <span className="truncate">{title}</span>
        </div>
        {onInfo && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInfo();
            }}
            className="flex items-center justify-center w-6 h-6 rounded-md bg-slate-800/90 hover:bg-[#DD3C73]/20 text-slate-300 hover:text-[#DD3C73] border border-slate-700/80 hover:border-[#DD3C73]/50 transition-all cursor-pointer shrink-0 shadow-sm"
            title={`View calculation & explanation for ${title}`}
            aria-label={infoAriaLabel || `Explanation for ${title}`}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-lg sm:text-2xl font-bold font-mono tracking-tight text-slate-100 truncate">{value}</div>
        {subValue && (
          <div className={`text-[11px] sm:text-xs font-mono font-medium mt-1 truncate ${subValueClass || "text-slate-400"}`}>
            {subValue}
          </div>
        )}
      </div>
    </div>
  );
}

