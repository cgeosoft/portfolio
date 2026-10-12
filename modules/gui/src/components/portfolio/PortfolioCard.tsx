import type { KeyboardEvent } from "react";
import { Download, LogIn, Pencil } from "lucide-react";
import type { PortfolioItem } from "portfolio-shared/portfolio";
import { PortfolioDot, portfolioColor } from "./portfolioColor";

// One portfolio on the Portfolios page, drawn like the organization cards of FintechCrafts
// Management: a click on the card opens the edit modal, Open makes it the active portfolio and returns
// to the dashboard (Continue for the active one), Export saves its archive.

function Badge({ tone, children }: { tone: "accent" | "slate"; children: string }) {
  const tones = {
    accent: "bg-accent-500/15 text-accent-300 border-accent-500/30",
    slate: "bg-slate-800/80 text-slate-400 border-slate-700",
  };
  return <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${tones[tone]}`}>{children}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 truncate">{label}</div>
      <div className="text-sm text-slate-100 font-semibold truncate">{value}</div>
    </div>
  );
}

/** The button look of the cards and the portfolio modals: grey frame, one height. */
export const SECONDARY_BUTTON =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-semibold whitespace-nowrap text-slate-200 transition-colors cursor-pointer hover:border-slate-600 hover:bg-slate-700 hover:text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50 disabled:cursor-not-allowed disabled:opacity-50";

/** The confirming action of a modal: the accent fill. */
export const PRIMARY_BUTTON =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-accent-600 bg-accent-600 px-3 text-xs font-semibold whitespace-nowrap text-white transition-colors cursor-pointer hover:border-accent-500 hover:bg-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50 disabled:cursor-not-allowed disabled:opacity-50";

export function formatCreated(createdAt?: string): string {
  if (!createdAt) return "-";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface PortfolioCardProps {
  portfolio: PortfolioItem;
  isActive: boolean;
  onOpen: (portfolio: PortfolioItem) => void;
  onEdit: (portfolio: PortfolioItem) => void;
  onExport: (portfolio: PortfolioItem) => void;
}

export function PortfolioCard({ portfolio, isActive, onOpen, onEdit, onExport }: PortfolioCardProps) {
  const color = portfolioColor(portfolio);
  const edit = () => onEdit(portfolio);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    edit();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={edit}
      onKeyDown={onKeyDown}
      title={`Edit ${portfolio.name}`}
      className={`group relative cx-card overflow-hidden p-4 flex flex-col gap-3.5 cursor-pointer transition-colors hover:border-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${
        isActive ? "ring-1 ring-accent-500/50" : ""
      }`}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: color }} />
      <div className="flex items-center gap-2.5 min-w-0">
        <PortfolioDot color={color} className="w-2.5 h-2.5" />
        <span className="text-sm font-bold text-slate-50 whitespace-nowrap truncate">{portfolio.name}</span>
        {portfolio.isShared && <Badge tone="slate">shared</Badge>}
        {isActive && <Badge tone="accent">open</Badge>}
        <Pencil className="w-3.5 h-3.5 ml-auto shrink-0 text-slate-600 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
      </div>
      {portfolio.description && <p className="text-xs text-slate-400 leading-snug whitespace-nowrap truncate -mt-1.5" title={portfolio.description}>{portfolio.description}</p>}
      <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-950/50 border border-slate-800/80 px-3 py-2">
        <Stat label="Currency" value={portfolio.baseCurrency} />
        <Stat label="Type" value={portfolio.isShared ? "Shared" : "Own"} />
        <Stat label="Created" value={formatCreated(portfolio.createdAt)} />
      </div>
      <div className="flex items-center gap-2 mt-auto">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(portfolio);
          }}
          className={SECONDARY_BUTTON}
        >
          <LogIn className="w-3.5 h-3.5" />
          {isActive ? "Continue" : "Open"}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExport(portfolio);
          }}
          className={SECONDARY_BUTTON}
          title={`Export ${portfolio.name} transactions and reports as ZIP`}
        >
          <Download className="w-3.5 h-3.5" />
          Export
        </button>
      </div>
    </div>
  );
}
