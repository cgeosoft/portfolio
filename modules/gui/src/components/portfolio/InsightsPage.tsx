import { BarChart3, Coins, Globe2, Layers } from "lucide-react";
import type { AppTheme } from "portfolio-shared/api-types";
import { t } from "../../i18n";
import { SidebarEntry, type SidebarSection } from "../settings/SettingsPrimitives";
import { ExposureCard } from "./ExposureCard";
import { IncomeEventsCard } from "./IncomeEventsCard";
import { MarketsCard } from "./MarketsCard";
import type { InsightsSectionId } from "./insights-sections";

export { resolveInsightsSection, saveInsightsSection, savedInsightsSection, type InsightsSectionId } from "./insights-sections";

/** The pages of the Insights sidebar, in the order they show. Labels are the card titles. */
const SECTIONS: (SidebarSection & { id: InsightsSectionId })[] = [
  { id: "exposure", labelKey: "dashboard.exposure.title", icon: Layers },
  { id: "income", labelKey: "dashboard.income.title", icon: Coins },
  { id: "markets", labelKey: "dashboard.markets.title", icon: Globe2 },
];

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
