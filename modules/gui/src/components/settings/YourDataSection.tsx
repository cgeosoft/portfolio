import { useEffect, useState } from "react";
import { FolderOpen, HardDrive, Trash2 } from "lucide-react";
import { rpc } from "../../rpc";
import { BackupCard } from "./BackupCard";
import { SectionHeader } from "./SettingsFields";

const blockTitle = "text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5";
const row = "flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60";
const pathCode = "text-slate-200 text-[11px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800 break-all";

/** Settings → Your Data: backup, where the files live, and the stored market data. */
export function YourDataSection() {
  const [paths, setPaths] = useState<{ data: string; logs: string } | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheClearMessage, setCacheClearMessage] = useState<string | null>(null);

  useEffect(() => {
    rpc.request
      .getAppInfo({})
      .then((info) => {
        if (info?.paths) setPaths(info.paths);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!cacheClearMessage) return;
    const timer = setTimeout(() => setCacheClearMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [cacheClearMessage]);

  const handleClearCache = async () => {
    setIsClearingCache(true);
    setCacheClearMessage(null);
    try {
      const res = await rpc.request.clearMarketCache({});
      const count = res.clearedEntries ?? 0;
      setCacheClearMessage(`Removed ${count} stored market records. Fresh data loads on the next refresh.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCacheClearMessage(`Could not clear the stored market data: ${msg}`);
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-6">
      <SectionHeader icon={HardDrive} title="Your Data" description="Everything stays on this computer. Keep a copy somewhere safe." />

      <BackupCard />

      <div className="space-y-2.5">
        <div className={blockTitle}>
          <FolderOpen className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>Where your data is</span>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className={row}>
            <span className="text-slate-400 text-[11px]">Data file (portfolios, transactions, reports, settings):</span>
            <code className={pathCode}>{paths?.data || "…"}</code>
          </div>
          <div className={row}>
            <span className="text-slate-400 text-[11px]">Log folder (one file per day, for support):</span>
            <code className={pathCode}>{paths?.logs || "…"}</code>
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        <div className={blockTitle}>
          <Trash2 className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>Stored market data</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="min-w-0">
            <span className="text-xs text-slate-200 font-semibold">Prices look wrong or out of date?</span>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Portfolio keeps recent prices and exchange rates so it opens fast. Clearing them makes it fetch everything again. Your portfolios and
              transactions are not touched.
            </p>
            {cacheClearMessage && <p className="text-[11px] text-slate-300 mt-1.5">{cacheClearMessage}</p>}
          </div>
          <button
            type="button"
            disabled={isClearingCache}
            onClick={handleClearCache}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>{isClearingCache ? "Clearing..." : "Clear stored prices"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
