import { Moon, Palette, Sun, Type } from "lucide-react";
import type { AppTheme } from "portfolio-shared/api-types";
import { Select } from "../common/Select";
import { SectionHeader, SettingItem, SettingsFields } from "./SettingsFields";

// Text size presets map onto the interface zoom level.
const TEXT_SIZES: { value: number; label: string }[] = [
  { value: 0.9, label: "Small (90%)" },
  { value: 1, label: "Default (100%)" },
  { value: 1.1, label: "Large (110%)" },
  { value: 1.25, label: "Larger (125%)" },
  { value: 1.5, label: "Largest (150%)" },
];

interface AppearanceSectionProps {
  theme: AppTheme;
  onChangeTheme: (theme: AppTheme) => void;
  /** Interface zoom (CSS zoom on the root), shared with Ctrl +/- and the View menu. */
  zoomLevel: number;
  onChangeZoom?: (zoom: number) => void;
}

/** Settings → Appearance: theme, text size and the catalog settings of the section. */
export function AppearanceSection({ theme, onChangeTheme, zoomLevel, onChangeZoom }: AppearanceSectionProps) {
  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-6">
      <SectionHeader icon={Palette} title="Appearance" description="How Portfolio looks on this device." />

      <div className="divide-y divide-slate-800/80 -mt-2">
        <SettingItem icon={theme === "light" ? Sun : Moon} title="Theme" description="Dark or light colours, or follow the setting of your computer.">
          <Select
            value={theme}
            onChange={(e) => onChangeTheme(e.target.value as AppTheme)}
            selectSize="lg"
            icon={theme === "light" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            aria-label="Theme"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">Same as my computer</option>
          </Select>
        </SettingItem>

        <SettingItem icon={Type} title="Text size" description="Make all text and buttons larger or smaller. Ctrl + and Ctrl - also work, Ctrl 0 resets.">
          <Select
            value={String(zoomLevel)}
            onChange={(e) => onChangeZoom?.(Number(e.target.value))}
            selectSize="lg"
            icon={<Type className="w-4 h-4" />}
            aria-label="Text size"
          >
            {!TEXT_SIZES.some((size) => size.value === zoomLevel) && <option value={String(zoomLevel)}>Custom ({Math.round(zoomLevel * 100)}%)</option>}
            {TEXT_SIZES.map((size) => (
              <option key={size.value} value={String(size.value)}>
                {size.label}
              </option>
            ))}
          </Select>
        </SettingItem>

        <SettingsFields section="appearance" />
      </div>
    </div>
  );
}
