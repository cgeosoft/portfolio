import { useState, useEffect, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { rpc } from "../../rpc";
import type { PortfolioItem } from "portfolio-shared/portfolio";
import type { DesktopConfig, AppTheme } from "portfolio-shared/api-types";
import { AppearanceSection } from "./AppearanceSection";
import { SecuritySection } from "./AccessSection";
import { AssistantSection } from "./AssistantSection";
import { PhoneAppsSection } from "./PhoneAppsSection";
import { AutomationSection } from "./AutomationSection";
import { DataProvidersSection } from "./DataProvidersSection";
import { YourDataSection } from "./YourDataSection";
import { AboutSection } from "./AboutSection";
import { SidebarEntry } from "./SettingsPrimitives";
import {
  DEFAULT_SETTINGS_SECTION,
  NOTIFICATION_PAGES,
  SECTIONS,
  isNotificationPage,
  sectionOf,
  type NotificationPageId,
  type SettingsSection,
  type SettingsSectionId,
} from "./settings-nav";

export type { SettingsSection } from "./settings-nav";

interface SettingsPageProps {
  onBack: () => void;
  initialSection?: SettingsSection;
  /** Fires with the open page when the user moves between sections, so App can keep it in the URL. */
  onSectionChange?: (section: SettingsSection) => void;
  portfolios?: PortfolioItem[];
  theme?: AppTheme;
  onChangeTheme?: (theme: AppTheme) => void;
  /** Interface zoom (CSS zoom on the root), shared with Ctrl +/- and the View menu. */
  zoomLevel?: number;
  onChangeZoom?: (zoom: number) => void;
  /** Fires when the app lock is turned on or off under Privacy & Security. */
  onPinEnabledChange?: (enabled: boolean) => void;
  /** App & Help → Report an Issue: opens the support ticket form (the Help menu has the same item). */
  onReportIssue?: () => void;
  /** Settings → Dashboard Cards: the metrics page of the active portfolio, rendered by App with its state. */
  metrics?: ReactNode;
}

export function SettingsPage({
  initialSection = DEFAULT_SETTINGS_SECTION,
  onSectionChange,
  portfolios = [],
  theme,
  onChangeTheme,
  zoomLevel = 1,
  onChangeZoom,
  onPinEnabledChange,
  onReportIssue,
  metrics,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(sectionOf(initialSection));
  // The open page of the Notifications submenu.
  const [activeNotification, setActiveNotification] = useState<NotificationPageId>(
    isNotificationPage(initialSection) ? initialSection : NOTIFICATION_PAGES[0]!.id,
  );

  // The stored settings the hand-built pages edit; the catalog rows load their own.
  const [fullConfig, setFullConfig] = useState<DesktopConfig | null>(null);

  useEffect(() => {
    setActiveSection(sectionOf(initialSection));
    if (isNotificationPage(initialSection)) setActiveNotification(initialSection);
  }, [initialSection]);

  // The open page, down to the submenu, goes to App for the URL.
  const openPage: SettingsSection = activeSection === "notifications" ? activeNotification : activeSection;
  useEffect(() => {
    onSectionChange?.(openPage);
  }, [openPage, onSectionChange]);

  useEffect(() => {
    rpc.request.getConfig({}).then((config) => setFullConfig(config as DesktopConfig));
  }, []);

  const saveConfig = async (updates: Partial<DesktopConfig>): Promise<DesktopConfig> => {
    setFullConfig((prev) => (prev ? { ...prev, ...updates } : prev));
    return rpc.request.saveConfig(updates);
  };

  const handleUpdateConfig = (updates: Partial<DesktopConfig>) => {
    void saveConfig(updates);
  };

  const currentTheme: AppTheme = theme ?? (fullConfig?.theme as AppTheme) ?? "dark";

  const handleThemeChange = (newTheme: AppTheme) => {
    onChangeTheme?.(newTheme);
    void saveConfig({ theme: newTheme });
  };

  const openPhoneSetup = () => {
    setActiveSection("notifications");
    setActiveNotification("phone");
  };

  return (
    <div className="container max-w-screen-xl mx-auto w-full space-y-6 font-mono">
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
        <aside className="w-full lg:sticky lg:top-0">
          <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Settings className="w-3.5 h-3.5 text-[#DD3C73]" />
            <span>Settings</span>
          </div>

          <nav className="space-y-1 mt-1" aria-label="Settings sections">
            {SECTIONS.map((sec) => {
              const hasSubmenu = sec.id === "notifications";
              return (
                <SidebarEntry
                  key={sec.id}
                  section={sec}
                  isActive={activeSection === sec.id}
                  onSelect={() => setActiveSection(sec.id)}
                  items={hasSubmenu ? NOTIFICATION_PAGES : undefined}
                  activeItem={hasSubmenu ? activeNotification : undefined}
                  onSelectItem={(id) => {
                    setActiveSection(sec.id);
                    setActiveNotification(id as NotificationPageId);
                  }}
                />
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {activeSection === "appearance" && (
            <AppearanceSection theme={currentTheme} onChangeTheme={handleThemeChange} zoomLevel={zoomLevel} onChangeZoom={onChangeZoom} />
          )}

          {activeSection === "security" && <SecuritySection onPinEnabledChange={onPinEnabledChange} />}

          {activeSection === "metrics" && metrics}

          {activeSection === "assistant" && fullConfig && (
            <AssistantSection config={fullConfig} saveConfig={saveConfig} onConfigChange={setFullConfig} />
          )}

          {activeSection === "notifications" && fullConfig && activeNotification === "phone" && (
            <PhoneAppsSection config={fullConfig} onConfigChange={setFullConfig} />
          )}

          {activeSection === "notifications" && fullConfig && activeNotification !== "phone" && (
            <AutomationSection
              automation={activeNotification}
              config={fullConfig}
              onConfigChange={setFullConfig}
              portfolios={portfolios}
              onOpenPhoneSetup={openPhoneSetup}
            />
          )}

          {activeSection === "market-data" && fullConfig && <DataProvidersSection config={fullConfig} onUpdateConfig={handleUpdateConfig} />}

          {activeSection === "data" && <YourDataSection />}

          {activeSection === "about" && <AboutSection config={fullConfig} onReportIssue={onReportIssue} />}
        </div>
      </div>
    </div>
  );
}
