import { useEffect, useState } from "react";
import { FolderOpen, HardDriveDownload } from "lucide-react";
import { api, ApiError } from "../../api";
import { t } from "../../i18n";

/**
 * "Backup" block of Settings → Your Data. The desktop window asks the service for
 * a copy of the database (`POST /api/app/backup`), which lands in the
 * Downloads folder; a remote client is told to use the desktop window, the
 * copy holds the API keys.
 */
export function BackupCard() {
  const [isLocalClient, setIsLocalClient] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ filePath: string; fileName: string; sizeBytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAppInfo()
      .then((info) => setIsLocalClient(Boolean(info?.isLocalClient)))
      .catch(() => setIsLocalClient(false));
  }, []);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createBackup();
      setSaved({ filePath: res.filePath, fileName: res.fileName, sizeBytes: res.sizeBytes });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : t("settings.backup.failed"));
    } finally {
      setBusy(false);
    }
  };

  const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  return (
    <div className="space-y-2.5">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
        <HardDriveDownload className="w-3.5 h-3.5 text-[#DD3C73]" />
        <span>{t("settings.backup.title")}</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="min-w-0">
          <span className="text-xs text-slate-200 font-semibold">{t("settings.backup.heading")}</span>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {isLocalClient === false
              ? t("settings.backup.remoteHint")
              : t("settings.backup.hint")}
          </p>
          {saved && (
            <p className="text-[11px] text-slate-300 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t("settings.backup.saved", { file: saved.fileName, size: sizeLabel(saved.sizeBytes) })}</span>
              <button
                type="button"
                onClick={() => void api.revealFile(saved.filePath).catch(() => {})}
                className="inline-flex items-center gap-1 text-accent-400 hover:text-accent-300 font-semibold cursor-pointer"
              >
                <FolderOpen className="w-3 h-3" />
                <span>{t("settings.backup.showInFolder")}</span>
              </button>
            </p>
          )}
          {error && <p className="text-[11px] text-rose-400 mt-1.5">{error}</p>}
        </div>
        {isLocalClient !== false && (
          <button
            type="button"
            disabled={busy || isLocalClient === null}
            onClick={() => void run()}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
          >
            <HardDriveDownload className={`w-3.5 h-3.5 ${busy ? "animate-pulse text-[#DD3C73]" : ""}`} />
            <span>{busy ? t("common.saving") : t("settings.backup.backUpNow")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
