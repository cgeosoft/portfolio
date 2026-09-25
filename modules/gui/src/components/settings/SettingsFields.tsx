import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
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
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-60 self-end sm:self-center ${
        checked ? "bg-[#DD3C73]" : "bg-slate-800"
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

function SettingRow({ setting, onSave }: { setting: SettingView; onSave: (key: string, value: SettingView["value"]) => void }) {
  if (setting.kind === "toggle") {
    const checked = setting.value === true;
    return (
      <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0 pr-2">
          <div className="text-xs font-bold text-slate-200 uppercase tracking-wider">{setting.label}</div>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{setting.description}</p>
        </div>
        <Toggle checked={checked} onChange={() => onSave(setting.key, !checked)} label={setting.label} />
      </div>
    );
  }

  if (setting.kind === "choice") {
    return (
      <div className="space-y-2 pt-4 border-t border-slate-800/80">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{setting.label}</div>
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
                    ? "border-[#DD3C73]/50 bg-[#DD3C73]/15 text-[#DD3C73]"
                    : "border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">{setting.description}</p>
      </div>
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
