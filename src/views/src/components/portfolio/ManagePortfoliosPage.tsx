import { rpc } from "../../rpc";
import { useState } from "react";
import type { PortfolioItem } from "../../types/portfolio";
import {
  BriefcaseBusiness,
  Plus,
  Edit3,
  Share2,
  Trash2,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Download,
  Shield,
  Search,
} from "lucide-react";
import { EditPortfolioModal } from "./EditPortfolioModal";
import { CreatePortfolioModal } from "./CreatePortfolioModal";
import { DeletePortfolioModal } from "./DeletePortfolioModal";
import { ExportPortfolioModal } from "./ExportPortfolioModal";

interface ManagePortfoliosPageProps {
  portfolios: PortfolioItem[];
  activePortfolio: PortfolioItem | null;
  onSelectPortfolio?: (id: string) => void;
  onPortfolioCreated: (newPortfolio: PortfolioItem) => void;
  onPortfolioUpdated: (updated: PortfolioItem) => void;
  onPortfolioDeleted: (id: string) => void;
  onBack?: () => void;
  }

export function ManagePortfoliosPage({
  portfolios,
  activePortfolio,
  onSelectPortfolio: _onSelectPortfolio,
  onPortfolioCreated,
  onPortfolioUpdated,
  onPortfolioDeleted,
}: ManagePortfoliosPageProps) {
  const [search, setSearch] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingPortfolio, setEditingPortfolio] = useState<PortfolioItem | null>(null);
    const [deletingPortfolio, setDeletingPortfolio] = useState<PortfolioItem | null>(null);
  const [exportingPortfolio, setExportingPortfolio] = useState<PortfolioItem | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const filtered = (portfolios || []).filter((p) => {
    const term = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      (p.description || "").toLowerCase().includes(term) ||
      p.baseCurrency.toLowerCase().includes(term)
    );
  });

  const handleConfirmDelete = async (p: PortfolioItem) => {
    setStatusMsg(null);

    const data = await rpc.request.deletePortfolio({ portfolioId: p.id });
    if (!data.success) {
      throw new Error("Failed to delete portfolio");
    }

    onPortfolioDeleted(p.id);
    setStatusMsg({
      type: "success",
      text: `Portfolio "${p.name}" and all associated data were successfully removed.`,
    });
    setTimeout(() => setStatusMsg(null), 3500);
  };

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 w-full max-w-full space-y-4 font-mono">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/80">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-100 uppercase tracking-widest min-w-0">
            <BriefcaseBusiness className="w-4 h-4 text-[#DD3C73] shrink-0" />
            <span>Portfolios ({portfolios.length})</span>
          </div>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">
            Configure financial ledgers, access permissions, and export data archives
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {portfolios.length > 3 && (
            <div className="relative w-40 sm:w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search portfolios..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#DD3C73]/50 font-mono"
              />
            </div>
          )}

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[#DD3C73]/40 bg-[#DD3C73]/15 text-xs font-bold text-[#DD3C73] hover:bg-[#DD3C73]/25 transition-all cursor-pointer uppercase tracking-wider shadow-lg shadow-[#DD3C73]/10 font-mono"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Portfolio</span>
          </button>
        </div>
      </div>

      {/* Status Alert Banner */}
      {statusMsg && (
        <div
          className={`p-3 text-xs rounded-xl flex items-center gap-2 ${
            statusMsg.type === "success"
              ? "text-emerald-400 bg-emerald-950/40 border border-emerald-800/50"
              : "text-rose-400 bg-rose-950/40 border border-rose-800/50"
          }`}
        >
          {statusMsg.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Main Table Box */}
      <div className="cx-card overflow-hidden">
        <div className="overflow-x-auto w-full custom-scrollbar">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider bg-slate-950/50">
                <th className="py-3 px-4 font-semibold">Portfolio & Strategy</th>
                <th className="py-3 px-4 font-semibold">Currency</th>
                
                <th className="py-3 px-4 font-semibold">Created</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500 font-mono text-xs">
                    {portfolios.length === 0
                      ? "No portfolios created yet. Click 'New Portfolio' to establish your first ledger."
                      : "No portfolios match your search query."}
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const isActive = activePortfolio?.id === p.id;
                  const createdFormatted = p.createdAt
                    ? new Date(p.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : "—";

                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-800/25 transition-colors group ${
                        isActive ? "bg-slate-900/40" : ""
                      }`}
                    >
                      {/* Column 1: Portfolio Name & Description */}
                      <td className="py-3.5 px-4 min-w-[220px]">
                        <div className="flex items-start gap-2.5">
                          {/* Active glowing indicator */}
                          <div className="pt-1 shrink-0">
                            {isActive ? (
                              <div
                                className="w-2 h-2 rounded-full bg-[#DD3C73] ring-4 ring-[#DD3C73]/20 shadow-sm shadow-[#DD3C73]"
                                title="Active Portfolio"
                              />
                            ) : (
                              <div className="w-2 h-2 rounded-full bg-slate-700 opacity-60" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-100 text-xs sm:text-sm truncate" title={p.name}>
                                {p.name}
                              </span>
                              {isActive && (
                                <span className="text-[9px] uppercase tracking-wider font-bold text-[#DD3C73] bg-[#DD3C73]/10 border border-[#DD3C73]/30 px-1.5 py-0.2 rounded">
                                  Active
                                </span>
                              )}
                            </div>
                            {p.description ? (
                              <p className="text-[11px] text-slate-400 truncate mt-0.5 max-w-md" title={p.description}>
                                {p.description}
                              </p>
                            ) : (
                              <p className="text-[11px] text-slate-600 italic mt-0.5">No description</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Currency */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-mono text-xs font-semibold text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          {p.baseCurrency}
                        </span>
                      </td>

                      
                      

                      {/* Column 4: Created Date */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-400 text-xs">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <Calendar className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>{createdFormatted}</span>
                        </div>
                      </td>

                      {/* Column 5: Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {/* Export Button with white text */}
                          <button
                            onClick={() => setExportingPortfolio(p)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-700/70 bg-slate-800/80 hover:bg-slate-700 hover:border-slate-600 text-xs font-semibold text-white transition-all cursor-pointer shadow-sm mr-1"
                            title={`Export ${p.name} transactions & reports as ZIP`}
                          >
                            <Download className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Export</span>
                          </button>

                          {/* Edit Button */}
                          <button
                            onClick={() => setEditingPortfolio(p)}
                            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-[#DD3C73] transition-colors cursor-pointer"
                            title="Edit portfolio name and details"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          
                          

                          {/* Delete Button */}
                          <button
                            onClick={() => setDeletingPortfolio(p)}
                            className="p-1.5 rounded-lg hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                            title="Delete portfolio"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      <CreatePortfolioModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onPortfolioCreated={(newP) => {
          onPortfolioCreated(newP);
          setStatusMsg({ type: "success", text: `Portfolio "${newP.name}" created successfully.` });
          setTimeout(() => setStatusMsg(null), 3000);
        }}
      />

      <EditPortfolioModal
        isOpen={!!editingPortfolio}
        onClose={() => setEditingPortfolio(null)}
        portfolio={editingPortfolio}
        onPortfolioUpdated={(updated) => {
          onPortfolioUpdated(updated);
          setStatusMsg({ type: "success", text: `Portfolio "${updated.name}" updated successfully.` });
          setTimeout(() => setStatusMsg(null), 3000);
        }}
        onDelete={(p) => setDeletingPortfolio(p)}
      />

      

      <DeletePortfolioModal
        isOpen={!!deletingPortfolio}
        onClose={() => setDeletingPortfolio(null)}
        portfolio={deletingPortfolio}
        isLastPortfolio={portfolios.length <= 1}
        onConfirmDelete={handleConfirmDelete}
      />

      <ExportPortfolioModal
        isOpen={!!exportingPortfolio}
        onClose={() => setExportingPortfolio(null)}
        portfolio={exportingPortfolio}
      />
    </div>
  );
}
