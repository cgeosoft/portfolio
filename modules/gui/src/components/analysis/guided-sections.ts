/**
 * The pages of the Analysis tab and where the open one is saved. Kept apart from
 * `AnalysisTab.tsx`, so App reads them without loading the code of the tab.
 */

export type GuidedSectionId = "runs" | "suggestions";

const STORAGE_KEY = "portfolio_guided_section";

/** Overview, Graph, History and Reports were pages before; each now lives in an analysis. */
const OLD_SECTIONS = new Set(["overview", "graph", "history", "reports"]);

export function resolveGuidedSection(id: string | undefined): GuidedSectionId | null {
  if (id === "runs" || (id && OLD_SECTIONS.has(id))) return "runs";
  return id === "suggestions" ? id : null;
}

export function savedGuidedSection(): GuidedSectionId {
  try {
    return resolveGuidedSection(localStorage.getItem(STORAGE_KEY) ?? undefined) ?? "runs";
  } catch {
    return "runs";
  }
}

export function saveGuidedSection(id: GuidedSectionId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/** Pages that fill the height and scroll inside. */
export const GUIDED_FILL_SECTIONS: ReadonlySet<GuidedSectionId> = new Set(["runs", "suggestions"]);
