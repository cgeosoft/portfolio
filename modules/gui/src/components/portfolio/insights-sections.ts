/**
 * The pages of the Insights tab and where the open one is saved. Kept apart from
 * `InsightsPage.tsx`, so App reads them without loading the code of the tab.
 */

export type InsightsSectionId = "exposure" | "income" | "markets";

/** The pages in the order the sidebar shows them. */
export const INSIGHTS_SECTION_IDS: readonly InsightsSectionId[] = ["exposure", "income", "markets"];

const STORAGE_KEY = "portfolio_insights_section";
/** The key of the release before the tab was named Insights. */
const OLD_STORAGE_KEY = "portfolio_analysis_section";

/** The section a URL part names (`#insights/<id>`), or null. */
export function resolveInsightsSection(id: string | undefined): InsightsSectionId | null {
  return INSIGHTS_SECTION_IDS.some((s) => s === id) ? (id as InsightsSectionId) : null;
}

/** The section last opened on this device, else the first one. */
export function savedInsightsSection(): InsightsSectionId {
  try {
    const saved = resolveInsightsSection(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY) ?? undefined);
    if (saved) return saved;
  } catch {
    // Storage blocked: open on the first page.
  }
  return INSIGHTS_SECTION_IDS[0]!;
}

/** Remembers the open section for the next start. */
export function saveInsightsSection(id: InsightsSectionId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}
