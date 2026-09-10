import { useState, useEffect, useCallback } from "react";
import { X, HelpCircle, ShieldCheck, Mail, Check, HeartHandshake } from "lucide-react";
import { rpc } from "../../rpc";
import { WEBPAGE_EMAIL } from "../../environment";

export interface SponsorInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Developer contact address, resolved from WEBPAGE_EMAIL by the bun process. */
  devEmail?: string;
}

export function SponsorInfoModal({ isOpen, onClose, devEmail }: SponsorInfoModalProps) {
  const [copied, setCopied] = useState(false);
  const contactEmail = devEmail && devEmail.trim().length > 0 ? devEmail.trim() : WEBPAGE_EMAIL;

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

  const handleCopyEmail = useCallback(async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(contactEmail);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Best-effort clipboard copy
    }
  }, [contactEmail]);

  const handleSendEmail = useCallback(async () => {
    const mailtoUrl = `mailto:${contactEmail}?subject=Portfolio%20Desktop%20Sponsorship%20Inquiry`;
    let opened = false;
    try {
      // openExternalUrl only permits http(s), so a mailto: hand-off reports failure
      // rather than throwing; fall back to the webview in that case too.
      const result = await rpc.request.openExternalUrl({ url: mailtoUrl });
      opened = Boolean(result?.success);
    } catch {
      opened = false;
    }
    if (!opened && typeof window !== "undefined") {
      window.open(mailtoUrl, "_blank");
    }
  }, [contactEmail]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-[#111726] border border-[#DD3C73]/60 rounded-2xl shadow-2xl p-6 text-slate-100 font-mono flex flex-col space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sponsor-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#DD3C73]/15 border border-[#DD3C73]/40 flex items-center justify-center shrink-0">
              <HelpCircle className="w-5 h-5 text-[#DD3C73]" />
            </div>
            <div>
              <h2 id="sponsor-info-title" className="text-base font-bold tracking-wide text-slate-100">
                Sponsor Content
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Keeping Development Active</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800/60 transition-colors focus:outline-none cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Informational Blocks */}
        <div className="space-y-3 text-xs leading-relaxed text-slate-300">
          <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex items-start gap-2.5">
            <HeartHandshake className="w-4 h-4 text-[#DD3C73] shrink-0 mt-0.5" />
            <p>
              This box shows partner content. Sponsorships fund independent maintenance, live market quotes, and updates to keep development active.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#A7E2C0] shrink-0 mt-0.5" />
            <p>
              Your personal investment numbers, balances, and holdings are 100% private. No financial data is ever shared with sponsors or third parties.
            </p>
          </div>

          {/* Dev email contact section */}
          <div className="p-3.5 rounded-xl bg-[#151d30] border border-[#DD3C73]/30 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#DD3C73] uppercase tracking-wider">
              <Mail className="w-3.5 h-3.5" />
              <span>Offer a Sponsorship</span>
            </div>
            <p className="text-slate-300 text-[11px]">
              Want to showcase your platform or financial service? You can reach out directly to the developer email:
            </p>
            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800">
              <code className="text-[#A7E2C0] text-[11px] select-all truncate">{contactEmail}</code>
              <button
                type="button"
                onClick={handleCopyEmail}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-[#A7E2C0]" />
                    <span className="text-[#A7E2C0]">Copied</span>
                  </>
                ) : (
                  <span>Copy</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleSendEmail}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#DD3C73] hover:text-white bg-[#DD3C73]/10 hover:bg-[#DD3C73]/20 border border-[#DD3C73]/30 rounded-lg font-semibold transition-colors cursor-pointer"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Contact via Email</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
