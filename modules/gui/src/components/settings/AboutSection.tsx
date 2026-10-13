import { useEffect, useState } from "react";
import { ExternalLink, Info, Keyboard, LifeBuoy, Power, RefreshCw } from "lucide-react";
import type { AppUpdateInfo, DesktopConfig } from "portfolio-shared/api-types";
import { rpc } from "../../rpc";
import { openExternal, WEBPAGE_EMAIL } from "../../environment";
import { CONFIG_CHANGED_EVENT, SectionHeader, SettingsFields } from "./SettingsFields";

const SHORTCUTS = [
  { key: "Ctrl + N", desc: "Create New Portfolio" },
  { key: "Ctrl + T", desc: "Add Transaction" },
  { key: "Ctrl + I", desc: "Import CSV Data" },
  { key: "Ctrl + E", desc: "Export Active Portfolio" },
  { key: "Ctrl + +", desc: "Zoom In" },
  { key: "Ctrl + -", desc: "Zoom Out" },
  { key: "Ctrl + 0", desc: "Reset Zoom" },
  { key: "Ctrl + R", desc: "Reload Page" },
  { key: "Ctrl + H", desc: "Hide or Show Amounts" },
  { key: "Ctrl + J", desc: "Open or Close the Assistant" },
  { key: "Ctrl + Shift + L", desc: "Switch Light / Dark Theme" },
  { key: "Ctrl + ,", desc: "Open Settings" },
  { key: "Ctrl + Q", desc: "Quit Application" },
];

const blockTitle = "text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5";
const panel = "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800";

interface AboutSectionProps {
  config: DesktopConfig | null;
  /** Opens the support ticket form (the Help menu has the same item). */
  onReportIssue?: () => void;
}

/** Settings → App & Help: version and updates, how the app starts, support and keyboard shortcuts. */
export function AboutSection({ config, onReportIssue }: AboutSectionProps) {
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [checksEnabled, setChecksEnabled] = useState(config?.checkForUpdates !== false);

  useEffect(() => setChecksEnabled(config?.checkForUpdates !== false), [config?.checkForUpdates]);

  // The Check for updates switch below saves through the catalog, which announces the change.
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Partial<DesktopConfig>>).detail;
      if (detail && typeof detail.checkForUpdates === "boolean") setChecksEnabled(detail.checkForUpdates);
    };
    window.addEventListener(CONFIG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONFIG_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    rpc.request
      .getAppInfo({})
      .then((info) => {
        if (info?.version) setAppVersion(info.version);
      })
      .catch(() => {});
    rpc.request
      .getUpdateInfo({})
      .then((res: AppUpdateInfo | null) => {
        if (res) setUpdateInfo(res);
      })
      .catch(() => {});
  }, []);

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdates(true);
    try {
      setUpdateInfo(await rpc.request.checkForUpdates({ force: true }));
    } catch (err) {
      console.warn("Manual update check failed:", err);
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-6">
      <SectionHeader
        icon={Info}
        title="App & Help"
        description="Version, updates, how Portfolio starts, and where to get help."
        actions={
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#DD3C73]/15 text-[#DD3C73] border border-[#DD3C73]/30">
            v{appVersion}
          </span>
        }
      />

      {/* Version and updates */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className={blockTitle}>
            <RefreshCw className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>Version and updates</span>
          </div>
          {updateInfo?.lastChecked && (
            <span className="text-[10px] text-slate-500 font-mono">Last checked: {new Date(updateInfo.lastChecked).toLocaleTimeString()}</span>
          )}
        </div>

        <div className={panel}>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-200 font-semibold">
                {updateInfo?.hasUpdate
                  ? `New version available: v${updateInfo.latestVersion}`
                  : !checksEnabled
                    ? "Automatic update checks are off"
                    : "Portfolio is up to date"}
              </span>
              {updateInfo?.hasUpdate && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-mint/15 text-mint border border-mint/30">
                  Update Available
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Current version: v{appVersion}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {updateInfo?.hasUpdate && updateInfo.releaseUrl && (
              <button
                type="button"
                onClick={() => openExternal(updateInfo.releaseUrl)}
                className="px-3 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c93567] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>View Release</span>
              </button>
            )}
            <button
              type="button"
              disabled={isCheckingUpdates}
              onClick={handleCheckForUpdates}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdates ? "animate-spin text-[#DD3C73]" : ""}`} />
              <span>{isCheckingUpdates ? "Checking..." : "Check Now"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Startup, tray and update checks from the catalog */}
      <div className="space-y-1">
        <div className={blockTitle}>
          <Power className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>Starting and closing</span>
        </div>
        <div className="divide-y divide-slate-800/80">
          <SettingsFields section="app" />
        </div>
      </div>

      {/* Support */}
      <div className="space-y-2.5">
        <div className={blockTitle}>
          <LifeBuoy className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>Help</span>
        </div>
        <div className={panel}>
          <div>
            <span className="text-xs text-slate-200 font-semibold">Something is not working or you have an idea?</span>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Write to {WEBPAGE_EMAIL}. Your version is filled in, and you can attach an anonymous app log of the last day.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onReportIssue?.()}
            className="px-3 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c93567] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            <span>Report an Issue</span>
          </button>
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div className="space-y-2.5">
        <div className={blockTitle}>
          <Keyboard className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>Keyboard shortcuts</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {SHORTCUTS.map((sc) => (
            <div key={sc.key} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <span className="text-slate-300 text-[11px]">{sc.desc}</span>
              <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 shadow-sm">{sc.key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
