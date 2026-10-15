import { BarChart3, Coins, Globe2, Layers, Lightbulb } from "lucide-react";
import type { AppTheme, GetSuggestionsResponse } from "portfolio-shared/api-types";
import type { FinancialPortfolioData } from "portfolio-shared/portfolio";
import { t } from "../../i18n";
import { SidebarEntry, type SidebarSection } from "../settings/SettingsPrimitives";
import { ExposureCard } from "./ExposureCard";
import { IncomeEventsCard } from "./IncomeEventsCard";
import { MarketsCard } from "./MarketsCard";
import { SuggestionsPage } from "./SuggestionsPage";

export type AnalysisSectionId = "exposure" | "income" | "markets" | "suggestions";

/** The pages of the Analysis sidebar, in the order they show. Labels are the card titles. */
const SECTIONS: (SidebarSection & { id: AnalysisSectionId })[] = [
  { id: "exposure", labelKey: "dashboard.exposure.title", icon: Layers },
  { id: "income", labelKey: "dashboard.income.title", icon: Coins },
  { id: "markets", labelKey: "dashboard.markets.title", icon: Globe2 },
  { id: "suggestions", labelKey: "layout.tabs.suggestions", icon: Lightbulb },
];

const STORAGE_KEY = "portfolio_analysis_section";

/** The section a URL part names (`#analysis/<id>`), or null. */
export function resolveAnalysisSection(id: string | undefined): AnalysisSectionId | null {
  return SECTIONS.some((s) => s.id === id) ? (id as AnalysisSectionId) : null;
}

/** The section last opened on this device, else the first one. */
export function savedAnalysisSection(): AnalysisSectionId {
  try {
    const saved = resolveAnalysisSection(localStorage.getItem(STORAGE_KEY) ?? undefined);
    if (saved) return saved;
  } catch {
    // Storage blocked: open on the first page.
  }
  return SECTIONS[0]!.id;
}

/** Remembers the open section for the next start. */
export function saveAnalysisSection(id: AnalysisSectionId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

interface AnalysisPageProps {
  section: AnalysisSectionId;
  onSectionChange: (id: AnalysisSectionId) => void;
  portfolioId: string | null;
  portfolioData: FinancialPortfolioData | null;
  currency: string;
  hideValues: boolean;
  theme?: AppTheme;
  /** Changes when the portfolio data reloads (`summary.lastUpdated`), so the open card reloads with it. */
  dataVersion?: string;
  /** Open suggestions, shown next to the Suggestions entry. */
  suggestionsCount?: number;
  /** Receives every loaded or changed suggestions result, so the header badge follows the page. */
  onSuggestionsChange?: (data: GetSuggestionsResponse) => void;
}

/** Exposure, income and events, markets and suggestions: one at a time, picked from a sidebar like Settings. */
export function AnalysisPage({
  section,
  onSectionChange,
  portfolioId,
  portfolioData,
  currency,
  hideValues,
  theme,
  dataVersion,
  suggestionsCount = 0,
  onSuggestionsChange,
}: AnalysisPageProps) {
  // Suggestions fills the height and scrolls its own list; the cards scroll with the page.
  const fill = section === "suggestions";

  return (
    <div
      className={`grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 font-mono ${
        fill ? "flex-1 min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]" : "items-start"
      }`}
    >
      <aside className="w-full lg:sticky lg:top-0">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>{t("layout.tabs.analysis")}</span>
        </div>
        <nav className="space-y-1 mt-1" aria-label={t("layout.tabs.analysis")}>
          {SECTIONS.map((sec) => (
            <SidebarEntry
              key={sec.id}
              section={sec}
              isActive={section === sec.id}
              onSelect={() => onSectionChange(sec.id)}
              badge={sec.id === "suggestions" && suggestionsCount > 0 ? suggestionsCount : undefined}
            />
          ))}
        </nav>
      </aside>

      <div className={`min-w-0 ${fill ? "min-h-0 flex flex-col" : ""}`}>
        {section === "exposure" && <ExposureCard portfolioId={portfolioId} currency={currency} hideValues={hideValues} dataVersion={dataVersion} />}
        {section === "income" && (
          <IncomeEventsCard portfolioId={portfolioId} currency={currency} hideValues={hideValues} theme={theme} refreshStamp={dataVersion} />
        )}
        {section === "markets" && <MarketsCard baseCurrency={currency} refreshStamp={dataVersion} />}
        {section === "suggestions" && (
          <SuggestionsPage
            portfolioId={portfolioId}
            portfolioData={portfolioData}
            currency={currency}
            hideValues={hideValues}
            onDataChange={onSuggestionsChange}
          />
        )}
      </div>
    </div>
  );
}
