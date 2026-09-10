import { X, Download } from "lucide-react";

export interface UpdatePopoverProps {
  isVisible: boolean;
  latestVersion: string;
  currentVersion: string;
  onShowChangelog: () => void;
  onDismiss: () => void;
}

export function UpdatePopover({
  isVisible,
  latestVersion,
  currentVersion,
  onShowChangelog,
  onDismiss,
}: UpdatePopoverProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm animate-popover-in">
      <div className="p-4 rounded-xl bg-[#111726] border border-[#DD3C73]/40 shadow-2xl shadow-[#DD3C73]/10 font-mono">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="w-8 h-8 rounded-lg bg-[#DD3C73]/15 border border-[#DD3C73]/30 flex items-center justify-center shrink-0 mt-0.5">
            <Download className="w-4 h-4 text-[#DD3C73]" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-100 leading-snug">
                Portfolio v{latestVersion} is available
              </h3>
              <button
                type="button"
                onClick={onDismiss}
                className="text-slate-500 hover:text-slate-300 p-0.5 rounded transition-colors shrink-0 cursor-pointer"
                aria-label="Dismiss update notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              You are running v{currentVersion}. A new version is ready.
            </p>

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={onShowChangelog}
                className="flex-1 px-3 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c93567] text-white text-[11px] font-bold transition-colors cursor-pointer"
              >
                What's New
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-[11px] transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}