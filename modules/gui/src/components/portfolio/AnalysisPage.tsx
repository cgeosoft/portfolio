import { useState } from "react";
import { BarChart3, Coins, Globe2, Layers } from "lucide-react";
import type { AppTheme } from "portfolio-shared/api-types";
import { t } from "../../i18n";
import { SidebarEntry, type SidebarSection } from "../settings/SettingsPrimitives";
import { ExposureCard } from "./ExposureCard";
import { IncomeEventsCard } from "./IncomeEventsCard";
import { MarketsCard } from "./MarketsCard";

type AnalysisSectionId = "exposure" | "income" | "markets";

/** The pages of the Analysis sidebar, in the order they show. Labels are the card titles. */
const SECTIONS: (SidebarSection & { id: AnalysisSectionId })[] = [
  { id: "exposure", labelKey: "dashboard.exposure.title", icon: Layers },
  { id: "income", labelKey: "dashboard.income.title", icon: Coins },
  { id: "markets", labelKey: "dashboard.markets.title", icon: Globe2 },
];

const STORAGE_KEY = "portfolio_analysis_section";

function savedSection(): AnalysisSectionId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (SECTIONS.some((s) => s.id === saved)) return saved as AnalysisSectionId;
  } catch {
    // Storage blocked: open on the first page.
  }
  return SECTIONS[0]!.id;
}

interface AnalysisPageProps {
  portfolioId: string | null;
  currency: string;
  hideValues: boolean;
  theme?: AppTheme;
  /** Changes when the portfolio data reloads (`summary.lastUpdated`), so the open card reloads with it. */
  dataVersion?: string;
}

/** Exposure, income and events, and markets: one card at a time, picked from a sidebar like Settings. */
export function AnalysisPage({ portfolioId, currency, hideValues, theme, dataVersion }: AnalysisPageProps) {
  const [active, setActive] = useState<AnalysisSectionId>(savedSection);

  const select = (id: AnalysisSectionId) => {
    setActive(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start font-mono">
      <aside className="w-full lg:sticky lg:top-0">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-[#DD3C73]" />
          <span>{t("layout.tabs.analysis")}</span>
        </div>
        <nav className="space-y-1 mt-1" aria-label={t("layout.tabs.analysis")}>
          {SECTIONS.map((sec) => (
            <SidebarEntry key={sec.id} section={sec} isActive={active === sec.id} onSelect={() => select(sec.id)} />
          ))}
        </nav>
      </aside>

      <div className="min-w-0">
        {active === "exposure" && <ExposureCard portfolioId={portfolioId} currency={currency} hideValues={hideValues} dataVersion={dataVersion} />}
        {active === "income" && (
          <IncomeEventsCard portfolioId={portfolioId} currency={currency} hideValues={hideValues} theme={theme} refreshStamp={dataVersion} />
        )}
        {active === "markets" && <MarketsCard baseCurrency={currency} refreshStamp={dataVersion} />}
      </div>
    </div>
  );
}
