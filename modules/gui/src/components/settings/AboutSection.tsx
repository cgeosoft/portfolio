import { useEffect, useState } from "react";
import { ExternalLink, Info, Keyboard, LifeBuoy, Power, RefreshCw } from "lucide-react";
import type { AppUpdateInfo, DesktopConfig } from "portfolio-shared/api-types";
import { rpc } from "../../rpc";
import { openExternal, WEBPAGE_EMAIL } from "../../environment";
import { getLocale, t } from "../../i18n";
import { CONFIG_CHANGED_EVENT, SectionHeader, SettingsFields } from "./SettingsFields";

// `desc` names the i18n key under settings.about.shortcuts, translated at render time.
const SHORTCUTS = [
  { key: "Ctrl + N", desc: "newPortfolio" },
  { key: "Ctrl + T", desc: "addTransaction" },
  { key: "Ctrl + I", desc: "importCsv" },
  { key: "Ctrl + E", desc: "exportPortfolio" },
  { key: "Ctrl + +", desc: "zoomIn" },
  { key: "Ctrl + -", desc: "zoomOut" },
  { key: "Ctrl + 0", desc: "resetZoom" },
  { key: "Ctrl + R", desc: "reload" },
  { key: "Ctrl + H", desc: "hideAmounts" },
  { key: "Ctrl + J", desc: "toggleAssistant" },
  { key: "Ctrl + Shift + L", desc: "toggleTheme" },
  { key: "Ctrl + ,", desc: "openSettings" },
  { key: "Ctrl + Q", desc: "quit" },
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
        title={t("settings.about.title")}
        description={t("settings.about.description")}
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
            <span>{t("settings.about.versionTitle")}</span>
          </div>
          {updateInfo?.lastChecked && (
            <span className="text-[10px] text-slate-500 font-mono">
              {t("settings.about.lastChecked", { time: new Date(updateInfo.lastChecked).toLocaleTimeString(getLocale()) })}
            </span>
          )}
        </div>

        <div className={panel}>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-200 font-semibold">
                {updateInfo?.hasUpdate
                  ? t("settings.about.newVersion", { version: updateInfo.latestVersion })
                  : !checksEnabled
                    ? t("settings.about.checksOff")
                    : t("settings.about.upToDate")}
              </span>
              {updateInfo?.hasUpdate && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-mint/15 text-mint border border-mint/30">
                  {t("settings.about.updateAvailable")}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">{t("settings.about.currentVersion", { version: appVersion })}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {updateInfo?.hasUpdate && updateInfo.releaseUrl && (
              <button
                type="button"
                onClick={() => openExternal(updateInfo.releaseUrl)}
                className="px-3 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c93567] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{t("settings.about.viewRelease")}</span>
              </button>
            )}
            <button
              type="button"
              disabled={isCheckingUpdates}
              onClick={handleCheckForUpdates}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdates ? "animate-spin text-[#DD3C73]" : ""}`} />
              <span>{isCheckingUpdates ? t("settings.about.checking") : t("settings.about.checkNow")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Startup, tray and update checks from the catalog */}
      <div className="space-y-1">
        <div className={blockTitle}>
          <Power className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>{t("settings.about.startingTitle")}</span>
        </div>
        <div className="divide-y divide-slate-800/80">
          <SettingsFields section="app" />
        </div>
      </div>

      {/* Support */}
      <div className="space-y-2.5">
        <div className={blockTitle}>
          <LifeBuoy className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>{t("settings.about.helpTitle")}</span>
        </div>
        <div className={panel}>
          <div>
            <span className="text-xs text-slate-200 font-semibold">{t("settings.about.helpQuestion")}</span>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t("settings.about.helpText", { email: WEBPAGE_EMAIL })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onReportIssue?.()}
            className="px-3 py-1.5 rounded-lg bg-[#DD3C73] hover:bg-[#c93567] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            <span>{t("settings.about.reportIssue")}</span>
          </button>
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div className="space-y-2.5">
        <div className={blockTitle}>
          <Keyboard className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>{t("settings.about.shortcutsTitle")}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {SHORTCUTS.map((sc) => (
            <div key={sc.key} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <span className="text-slate-300 text-[11px]">{t(`settings.about.shortcuts.${sc.desc}`)}</span>
              <kbd className="px-2 py-0.5 rounded-sm bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 shadow-xs">{sc.key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
