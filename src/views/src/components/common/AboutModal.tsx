import { useEffect } from "react";
import { X, BriefcaseBusiness, ShieldCheck, Cpu, Keyboard, Sparkles } from "lucide-react";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenShortcuts?: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const shortcuts = [
    { key: "Ctrl + N", desc: "Create New Portfolio" },
    { key: "Ctrl + T", desc: "Add Transaction" },
    { key: "Ctrl + I", desc: "Import CSV Data" },
    { key: "Ctrl + E", desc: "Export Active Portfolio" },
    { key: "Ctrl + R", desc: "Refresh Market Quotes" },
    { key: "Ctrl + H", desc: "Toggle Privacy Mode (Mask Values)" },
    { key: "Ctrl + ,", desc: "Open Preferences / Settings" },
    { key: "Ctrl + Q", desc: "Quit Application" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-lg bg-[#111726] border border-[#1e293b] rounded-2xl shadow-2xl p-6 sm:p-7 text-slate-100 font-mono flex flex-col space-y-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#341B83] via-[#243C8F] to-[#DD3C73] p-[1.5px] shadow-lg shadow-[#DD3C73]/20 flex items-center justify-center shrink-0">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <BriefcaseBusiness className="w-5 h-5 text-[#DD3C73]" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="about-modal-title" className="text-base font-bold tracking-wide text-slate-100">
                  Portfolio Desktop
                </h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#DD3C73]/15 text-[#DD3C73] border border-[#DD3C73]/30">
                  v0.1.0
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Local-First Wealth & Asset Analytics</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800/60 transition-colors focus:outline-none"
            aria-label="Close About dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Runtime & Highlights */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center gap-2.5">
            <Cpu className="w-4 h-4 text-[#243C8F] shrink-0" />
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Engine</div>
              <div className="font-semibold text-slate-200">Electrobun &amp; Bun</div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#A7E2C0] shrink-0" />
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Privacy</div>
              <div className="font-semibold text-slate-200">100% Offline SQLite</div>
            </div>
          </div>
        </div>

        {/* Shortcuts Reference */}
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Keyboard className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>Keyboard Shortcuts</span>
          </div>
          <div className="max-h-48 overflow-y-auto pr-1 space-y-1 custom-scrollbar text-xs">
            {shortcuts.map((sc) => (
              <div
                key={sc.key}
                className="flex items-center justify-between p-2 rounded-lg bg-slate-900/40 border border-slate-800/60"
              >
                <span className="text-slate-300 text-[11px]">{sc.desc}</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 shadow-sm">
                  {sc.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#E3EACD]" />
            <span>Encrypted local storage</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
