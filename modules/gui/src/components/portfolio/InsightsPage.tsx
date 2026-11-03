import { BarChart3, Coins, Globe2, Layers } from "lucide-react";
import type { AppTheme } from "portfolio-shared/api-types";
import { t } from "../../i18n";
import { SidebarEntry, type SidebarSection } from "../settings/SettingsPrimitives";
import { ExposureCard } from "./ExposureCard";
import { IncomeEventsCard } from "./IncomeEventsCard";
import { MarketsCard } from "./MarketsCard";

export type InsightsSectionId = "exposure" | "income" | "markets";

/** The pages of the Insights sidebar, in the order they show. Labels are the card titles. */
const SECTIONS: (SidebarSection & { id: InsightsSectionId })[] = [
  { id: "exposure", labelKey: "dashboard.exposure.title", icon: Layers },
  { id: "income", labelKey: "dashboard.income.title", icon: Coins },
  { id: "markets", labelKey: "dashboard.markets.title", icon: Globe2 },
];

const STORAGE_KEY = "portfolio_insights_section";
/** The key of the release before the tab was named Insights. */
const OLD_STORAGE_KEY = "portfolio_analysis_section";

/** The section a URL part names (`#insights/<id>`), or null. */
export function resolveInsightsSection(id: string | undefined): InsightsSectionId | null {
  return SECTIONS.some((s) => s.id === id) ? (id as InsightsSectionId) : null;
}

/** The section last opened on this device, else the first one. */
export function savedInsightsSection(): InsightsSectionId {
  try {
    const saved = resolveInsightsSection(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY) ?? undefined);
    if (saved) return saved;
  } catch {
    // Storage blocked: open on the first page.
  }
  return SECTIONS[0]!.id;
}

/** Remembers the open section for the next start. */
export function saveInsightsSection(id: InsightsSectionId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

interface InsightsPageProps {
  section: InsightsSectionId;
  onSectionChange: (id: InsightsSectionId) => void;
  portfolioId: string | null;
  currency: string;
  hideValues: boolean;
  theme?: AppTheme;
  /** Changes when the portfolio data reloads (`summary.lastUpdated`), so the open card reloads with it. */
  dataVersion?: string;
}

/**
 * Exposure, income and events, and markets: the data pages, no model
 * involved. One at a time, picked from a sidebar like Settings. Suggestions
 * moved to the Overview and the Analysis tab.
 */
export function InsightsPage({ section, onSectionChange, portfolioId, currency, hideValues, theme, dataVersion }: InsightsPageProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 font-mono items-start">
      <aside className="w-full lg:sticky lg:top-0">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>{t("layout.tabs.insights")}</span>
        </div>
        <nav className="space-y-1 mt-1" aria-label={t("layout.tabs.insights")}>
          {SECTIONS.map((sec) => (
            <SidebarEntry key={sec.id} section={sec} isActive={section === sec.id} onSelect={() => onSectionChange(sec.id)} />
          ))}
        </nav>
      </aside>

      <div className="min-w-0">
        {section === "exposure" && <ExposureCard portfolioId={portfolioId} currency={currency} hideValues={hideValues} dataVersion={dataVersion} />}
        {section === "income" && (
          <IncomeEventsCard portfolioId={portfolioId} currency={currency} hideValues={hideValues} theme={theme} refreshStamp={dataVersion} />
        )}
        {section === "markets" && <MarketsCard baseCurrency={currency} refreshStamp={dataVersion} />}
      </div>
    </div>
  );
}
