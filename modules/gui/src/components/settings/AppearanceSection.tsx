import { useState } from "react";
import { Languages, Moon, Palette, Sun, Type } from "lucide-react";
import type { AppTheme } from "portfolio-shared/api-types";
import { api } from "../../api";
import { getLanguage, switchLanguage, t } from "../../i18n";
import { LanguageSelect, LanguageTierNote } from "../common/LanguageSelect";
import { Select } from "../common/Select";
import { SectionHeader, SettingItem, SettingsFields } from "./SettingsFields";

// Text size presets map onto the interface zoom level.
const TEXT_SIZES: { value: number; key: string }[] = [
  { value: 0.9, key: "small" },
  { value: 1, key: "default" },
  { value: 1.1, key: "large" },
  { value: 1.25, key: "larger" },
  { value: 1.5, key: "largest" },
];

interface AppearanceSectionProps {
  theme: AppTheme;
  onChangeTheme: (theme: AppTheme) => void;
  /** Interface zoom (CSS zoom on the root), shared with Ctrl +/- and the View menu. */
  zoomLevel: number;
  onChangeZoom?: (zoom: number) => void;
}

/** Settings → Appearance: language, theme, text size and the catalog settings of the section. */
export function AppearanceSection({ theme, onChangeTheme, zoomLevel, onChangeZoom }: AppearanceSectionProps) {
  const [language, setLanguage] = useState(getLanguage());
  const [switching, setSwitching] = useState(false);

  // The language is baked in at load: save it for the service (reports, notifications), then reload.
  const handleLanguage = async (code: string) => {
    setLanguage(code);
    setSwitching(true);
    try {
      await api.saveConfig({ language: code });
    } catch {
      // The interface still switches; the service keeps its previous language.
    }
    switchLanguage(code);
  };

  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-6">
      <SectionHeader icon={Palette} title={t("settings.appearance.title")} description={t("settings.appearance.description")} />

      <div className="divide-y divide-slate-800/80 -mt-2">
        <SettingItem icon={Languages} title={t("language.label")} description={t("language.description")}>
          <div className="flex flex-col gap-2 sm:max-w-sm">
            <LanguageSelect value={language} onChange={(code) => void handleLanguage(code)} disabled={switching} />
            <LanguageTierNote code={language} />
          </div>
        </SettingItem>

        <SettingItem icon={theme === "light" ? Sun : Moon} title={t("settings.appearance.theme")} description={t("settings.appearance.themeDescription")}>
          <Select
            value={theme}
            onChange={(e) => onChangeTheme(e.target.value as AppTheme)}
            selectSize="lg"
            icon={theme === "light" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            aria-label={t("settings.appearance.theme")}
          >
            <option value="dark">{t("settings.appearance.themeDark")}</option>
            <option value="light">{t("settings.appearance.themeLight")}</option>
            <option value="system">{t("settings.appearance.themeSystem")}</option>
          </Select>
        </SettingItem>

        <SettingItem icon={Type} title={t("settings.appearance.textSize")} description={t("settings.appearance.textSizeDescription")}>
          <Select
            value={String(zoomLevel)}
            onChange={(e) => onChangeZoom?.(Number(e.target.value))}
            selectSize="lg"
            icon={<Type className="w-4 h-4" />}
            aria-label={t("settings.appearance.textSize")}
          >
            {!TEXT_SIZES.some((size) => size.value === zoomLevel) && (
              <option value={String(zoomLevel)}>{t("settings.appearance.textSizes.custom", { percent: Math.round(zoomLevel * 100) })}</option>
            )}
            {TEXT_SIZES.map((size) => (
              <option key={size.value} value={String(size.value)}>
                {t(`settings.appearance.textSizes.${size.key}`, { percent: Math.round(size.value * 100) })}
              </option>
            ))}
          </Select>
        </SettingItem>

        <SettingsFields section="appearance" />
      </div>
    </div>
  );
}
