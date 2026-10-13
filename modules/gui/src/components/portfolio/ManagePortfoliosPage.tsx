import { useEffect, useState } from "react";
import type { PortfolioItem } from "portfolio-shared/portfolio";
import { AlertCircle, ArrowLeft, CheckCircle2, Plus, Search, TrendingUp } from "lucide-react";
import { rpc } from "../../rpc";
import { EditPortfolioModal } from "./EditPortfolioModal";
import { CreatePortfolioModal } from "./CreatePortfolioModal";
import { DeletePortfolioModal } from "./DeletePortfolioModal";
import { ExportPortfolioModal } from "./ExportPortfolioModal";
import { PortfolioCard, SECONDARY_BUTTON } from "./PortfolioCard";
import { portfolioColor } from "./portfolioColor";
import { t } from "../../i18n";

// The Portfolios page, laid out like the Organizations page of FintechCrafts Management: one level above
// the open portfolio, so `App.tsx` hides the menu bar, the header and the assistant while it shows, and
// Back (or Escape) returns to the page that was open. Route `#portfolios`; the Portfolio menu, the
// header picker and Manage in the status bar picker open it.
//
// A click on a card opens the edit modal (name, description, colour; Delete). Open makes a portfolio the
// active one and returns to the dashboard, Continue does the same for the active one. Export saves the
// archive of a portfolio. New portfolio adds an empty one with its own base currency.

interface ManagePortfoliosPageProps {
  portfolios: PortfolioItem[];
  activePortfolio: PortfolioItem | null;
  onSelectPortfolio: (id: string) => void;
  onPortfolioCreated: (newPortfolio: PortfolioItem) => void;
  onPortfolioUpdated: (updated: PortfolioItem) => void;
  onPortfolioDeleted: (id: string) => void;
  /** Returns to the page that was open before. */
  onBack: () => void;
  /** Opens the dashboard of the active portfolio. */
  onOpenDashboard: () => void;
}

type Status = { ok: boolean; text: string } | null;

export function ManagePortfoliosPage({
  portfolios,
  activePortfolio,
  onSelectPortfolio,
  onPortfolioCreated,
  onPortfolioUpdated,
  onPortfolioDeleted,
  onBack,
  onOpenDashboard,
}: ManagePortfoliosPageProps) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PortfolioItem | null>(null);
  const [deleting, setDeleting] = useState<PortfolioItem | null>(null);
  const [exporting, setExporting] = useState<PortfolioItem | null>(null);
  const [status, setStatus] = useState<Status>(null);

  // Escape goes back, unless a modal of this page (or any other dialog) is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || creating || editing || deleting || exporting || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating, editing, deleting, exporting, onBack]);

  const term = search.trim().toLowerCase();
  const filtered = portfolios.filter(
    (p) =>
      !term ||
      p.name.toLowerCase().includes(term) ||
      (p.description || "").toLowerCase().includes(term) ||
      p.baseCurrency.toLowerCase().includes(term),
  );

  const open = (p: PortfolioItem) => {
    if (p.id !== activePortfolio?.id) onSelectPortfolio(p.id);
    onOpenDashboard();
  };

  const confirmDelete = async (p: PortfolioItem) => {
    setStatus(null);
    const data = await rpc.request.deletePortfolio({ portfolioId: p.id });
    if (!data.success) throw new Error(t("portfolios.page.deleteFailed"));
    onPortfolioDeleted(p.id);
    setStatus({ ok: true, text: t("portfolios.page.deleted", { name: p.name }) });
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-6 space-y-6 font-mono text-slate-100">
        <div className="space-y-4">
          <button type="button" onClick={onBack} className={SECONDARY_BUTTON} title={t("portfolios.page.backTitle", { key: "Escape" })}>
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("common.back")}
          </button>
          <div className="flex items-center justify-between gap-4 min-w-0">
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 min-w-0 text-sm font-bold uppercase tracking-wider text-slate-50 whitespace-nowrap">
                <TrendingUp className="w-4 h-4 shrink-0 text-accent-500" />
                <span className="truncate">{t("portfolios.page.title")}</span>
                <span className="text-slate-500 font-semibold shrink-0">{portfolios.length}</span>
              </h1>
              <p className="text-[11px] text-slate-500 whitespace-nowrap truncate">
                {t("portfolios.page.description")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {portfolios.length > 3 && (
                <div className="relative w-40 sm:w-48">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder={t("portfolios.page.searchPlaceholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full h-8 bg-slate-950/70 border border-slate-800 rounded-lg pl-8 pr-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-500/50 font-mono"
                  />
                </div>
              )}
              <button type="button" onClick={() => setCreating(true)} className={SECONDARY_BUTTON}>
                <Plus className="w-3.5 h-3.5" />
                {t("portfolios.page.newPortfolio")}
              </button>
            </div>
          </div>
        </div>

        {status && (
          <span className={`inline-flex items-start gap-1.5 text-[11px] ${status.ok ? "text-emerald-400" : "text-rose-400"}`}>
            {status.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />}
            <span>{status.text}</span>
          </span>
        )}

        {filtered.length === 0 ? (
          <p className="py-12 text-center text-slate-500 text-xs">
            {portfolios.length === 0 ? t("portfolios.page.empty") : t("portfolios.page.noMatch")}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 min-[1200px]:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <PortfolioCard
                key={p.id}
                portfolio={p}
                isActive={activePortfolio?.id === p.id}
                onOpen={open}
                onEdit={setEditing}
                onExport={setExporting}
              />
            ))}
          </div>
        )}
      </div>

      <CreatePortfolioModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        takenColors={portfolios.map(portfolioColor)}
        onPortfolioCreated={(created) => {
          onPortfolioCreated(created);
          setStatus({ ok: true, text: t("portfolios.page.created", { name: created.name }) });
        }}
      />

      <EditPortfolioModal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        portfolio={editing}
        onPortfolioUpdated={onPortfolioUpdated}
        onDelete={(p) => setDeleting(p)}
      />

      <DeletePortfolioModal
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        portfolio={deleting}
        isLastPortfolio={portfolios.length <= 1}
        onConfirmDelete={confirmDelete}
      />

      <ExportPortfolioModal isOpen={!!exporting} onClose={() => setExporting(null)} portfolio={exporting} />
    </div>
  );
}
