import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowDownToLine, BarChart3, Download, Power, RefreshCw, Settings2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { SettingSection, SettingView } from "portfolio-shared/api-types";
import type { DesktopConfig } from "portfolio-shared/config-types";
import { api } from "../../api";

/** A switch. */
export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed ${
        checked ? "bg-accent-500" : "bg-slate-800"
      }`}
    >
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

/** Icons for the catalog settings, keyed by setting key. */
const SETTING_ICONS: Record<string, LucideIcon> = {
  marketQuotesInterval: RefreshCw,
  startWithBoot: Power,
  closeToTray: ArrowDownToLine,
  telemetryEnabled: BarChart3,
  checkForUpdates: Download,
};

/**
 * One settings row: accent icon tile, title and description, an optional
 * control on the right and optional content below the text.
 */
export function SettingItem({
  icon: Icon,
  title,
  description,
  control,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="py-4 last:pb-0 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="p-2 rounded-lg bg-accent-500/10 text-accent-300 shrink-0 mt-0.5">
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-sm font-bold text-slate-50">{title}</span>
            <span className="text-xs text-slate-400 leading-relaxed">{description}</span>
          </div>
        </div>
        {control}
      </div>
      {children && <div className="pl-12 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

/**
 * The header of a settings card: accent icon, title, a one-line description
 * and optional actions on the right. Fixed height so every page lines up.
 */
export function SectionHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="h-11 box-content flex items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-wider min-w-0">
          <Icon className="w-4 h-4 text-[#DD3C73] shrink-0" />
          <span className="truncate">{title}</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-1 truncate" title={description}>
          {description}
        </p>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

function SettingRow({ setting, onSave }: { setting: SettingView; onSave: (key: string, value: SettingView["value"]) => void }) {
  const icon = SETTING_ICONS[setting.key] ?? Settings2;

  if (setting.kind === "toggle") {
    const checked = setting.value === true;
    return (
      <SettingItem
        icon={icon}
        title={setting.label}
        description={setting.description}
        control={<Toggle checked={checked} onChange={() => onSave(setting.key, !checked)} label={setting.label} />}
      />
    );
  }

  if (setting.kind === "choice") {
    return (
      <SettingItem icon={icon} title={setting.label} description={setting.description}>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={setting.label}>
          {setting.options?.map((option) => {
            const active = option.value === setting.value;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => !active && onSave(setting.key, option.value)}
                className={`h-8 inline-flex items-center px-3 rounded-lg border text-[11px] font-bold font-mono whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? "border-accent-500/50 bg-accent-500/15 text-accent-500"
                    : "border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingItem>
    );
  }

  return null;
}

/**
 * The settings of one section, drawn from the service catalog
 * (`GET /api/settings`). A change saves through `PATCH /api/config`.
 */
export function SettingsFields({ section }: { section: SettingSection }) {
  const [settings, setSettings] = useState<SettingView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getSettings()
      .then((res) => setSettings(res.settings))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = async (key: string, value: SettingView["value"]) => {
    setError(null);
    setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, value, isSet: value !== "" } : s)) ?? prev);
    try {
      await api.saveConfig({ [key]: value } as Partial<DesktopConfig>);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      load();
    }
  };

  return (
    <>
      {settings?.filter((s) => s.section === section).map((setting) => <SettingRow key={setting.key} setting={setting} onSave={onSave} />)}
      {error && (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-rose-400">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </p>
      )}
    </>
  );
}
