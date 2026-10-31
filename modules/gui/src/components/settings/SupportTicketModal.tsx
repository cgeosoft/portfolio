import { useEffect, useState } from "react";
import { X, LifeBuoy, Mail, ShieldCheck, CheckCircle2, AlertCircle, FolderOpen, Copy, Check } from "lucide-react";
import { rpc } from "../../rpc";
import { api } from "../../api";
import { t } from "../../i18n";
import { downloadBlob, openExternal, WEBPAGE_EMAIL } from "../../environment";

interface SupportTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TicketStatus {
  type: "success" | "error";
  text: string;
  zipPath?: string;
}

/**
 * Help → Report an Issue... and Settings → App & Help → Report an Issue: the
 * support ticket form. The service builds the mail and, when asked, the
 * anonymised diagnostics zip; the mail opens in the default email
 * application and the user attaches the archive by hand.
 */
export function SupportTicketModal({ isOpen, onClose }: SupportTicketModalProps) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [includeLogs, setIncludeLogs] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<TicketStatus | null>(null);
  const [copiedZipPath, setCopiedZipPath] = useState(false);
  const [isLocalClient, setIsLocalClient] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStatus(null);
    setIsSubmitting(false);
    setCopiedZipPath(false);
    rpc.request
      .getAppInfo({})
      .then((info) => setIsLocalClient(Boolean(info?.isLocalClient)))
      .catch(() => {});
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleOpenSupportTicket = async () => {
    setIsSubmitting(true);
    setStatus(null);
    try {
      const res = await rpc.request.openSupportTicket({
        subject: subject.trim() || undefined,
        message: message.trim() || undefined,
        includeLogs,
      });
      if (!res.success) throw new Error(res.error || t("settings.support.prepareFailed"));
      // Remote client: the diagnostics come as a browser download.
      if (includeLogs && !res.zipPath) {
        try {
          const blob = await fetch(api.diagnosticsUrl(), { credentials: "include" }).then((r) => r.blob());
          downloadBlob(res.zipFileName || "portfolio-support-logs.zip", blob);
        } catch {
          // The mail still opens without the archive.
        }
      }
      const mailto = `mailto:${encodeURIComponent(res.recipient)}?subject=${encodeURIComponent(res.subject)}&body=${encodeURIComponent(res.body)}`;
      openExternal(mailto);
      setStatus({
        type: "success",
        text: res.zipPath
          ? t("settings.support.openedSaved")
          : includeLogs
            ? t("settings.support.openedDownloaded")
            : t("settings.support.opened"),
        zipPath: res.zipPath,
      });
    } catch (err: unknown) {
      setStatus({ type: "error", text: err instanceof Error ? err.message : t("settings.support.unexpected") });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevealZipFile = async (path: string) => {
    try {
      await api.revealFile(path);
    } catch {
      // Not available for remote clients.
    }
  };

  const handleCopyZipPath = (path: string) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(path);
      setCopiedZipPath(true);
      setTimeout(() => setCopiedZipPath(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-ticket-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-4 shrink-0">
          <div className="min-w-0">
            <div id="support-ticket-title" className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-wider">
              <LifeBuoy className="w-4 h-4 text-[#DD3C73]" />
              <span>{t("settings.support.title")}</span>
            </div>
            <p className="pl-6 text-[11px] text-slate-400 mt-1">{t("settings.support.description", { email: WEBPAGE_EMAIL })}</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 shrink-0" title={t("common.close")}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {/* Anonymization Guarantee Notice */}
          <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-emerald-300 text-xs flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1 leading-relaxed">
              <div className="font-bold text-emerald-200">{t("settings.support.guaranteeTitle")}</div>
              <p className="text-[11px] text-emerald-300/90 leading-relaxed">{t("settings.support.guaranteeText")}</p>
            </div>
          </div>

          {/* Recipient */}
          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-[#DD3C73]" />
              <span>{t("settings.support.recipient")}</span>
            </label>
            <input type="text" readOnly value={WEBPAGE_EMAIL} className="w-full bg-slate-950/90 border border-slate-800/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-300 font-mono focus:outline-hidden cursor-default select-all" />
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <label htmlFor="ticket-subject" className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              {t("settings.support.subject")}
            </label>
            <input
              id="ticket-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("settings.support.subjectPlaceholder")}
              autoFocus
              className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden transition-colors font-mono"
            />
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <label htmlFor="ticket-message" className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              {t("settings.support.message")}
            </label>
            <textarea
              id="ticket-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("settings.support.messagePlaceholder")}
              className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-[#DD3C73] rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden transition-colors font-mono resize-none"
            />
          </div>

          {/* Checkbox for 24h logs */}
          <div className="flex items-start gap-3 pt-1">
            <input
              type="checkbox"
              id="ticket-include-logs"
              checked={includeLogs}
              onChange={(e) => setIncludeLogs(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded-sm border-slate-700 bg-slate-950 text-[#DD3C73] focus:ring-[#DD3C73]/40 cursor-pointer accent-[#DD3C73]"
            />
            <label htmlFor="ticket-include-logs" className="cursor-pointer select-none space-y-0.5">
              <div className="text-xs font-semibold text-slate-200">{t("settings.support.includeLogs")}</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{t("settings.support.includeLogsHint")}</p>
            </label>
          </div>

          {/* Status / Alert Banner */}
          {status && (
            <div className={`p-3 text-xs rounded-xl flex flex-col gap-2 ${status.type === "success" ? "text-emerald-300 bg-emerald-950/40 border border-emerald-800/50" : "text-rose-300 bg-rose-950/40 border border-rose-800/50"}`}>
              <div className="flex items-center gap-2">
                {status.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                <span>{status.text}</span>
              </div>

              {status.zipPath && (
                <div className="pt-2 border-t border-emerald-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <code className="text-[10px] text-emerald-200 bg-slate-950/70 px-2 py-1 rounded-sm border border-emerald-800/40 truncate max-w-md">{status.zipPath}</code>
                  <div className="flex items-center gap-2 shrink-0">
                    {isLocalClient && (
                      <button
                        type="button"
                        onClick={() => handleRevealZipFile(status.zipPath!)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-900/60 hover:bg-emerald-800 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                        title={t("settings.support.openFolderTitle")}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>{t("settings.support.openFolder")}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCopyZipPath(status.zipPath!)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors cursor-pointer"
                      title={t("settings.support.copyPathTitle")}
                    >
                      {copiedZipPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedZipPath ? t("common.copied") : t("settings.support.copyPath")}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800/80 px-5 py-4 shrink-0 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleOpenSupportTicket}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#DD3C73] hover:bg-[#DD3C73]/90 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shadow-lg shadow-[#DD3C73]/20"
          >
            <LifeBuoy className={`w-3.5 h-3.5 ${isSubmitting ? "animate-spin" : ""}`} />
            <span>{isSubmitting ? t("settings.support.preparing") : t("settings.support.submit")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
