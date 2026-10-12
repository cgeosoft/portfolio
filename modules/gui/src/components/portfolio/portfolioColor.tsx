import { Check } from "lucide-react";
import type { PortfolioItem } from "portfolio-shared/portfolio";

// The colour of a portfolio dot: the Portfolios page, its modals and the status bar picker. The service
// stores the chosen colour as `#rrggbb` in the `color` column of `portfolios`; null means the default.

/** The swatches of the colour field, in display order. */
export const PORTFOLIO_COLORS = [
  "#dd3c73", // the app accent, the default
  "#6366f1", // indigo
  "#a855f7", // purple
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#22c55e", // green
  "#84cc16", // lime
  "#eab308", // yellow
  "#f59e0b", // amber
  "#f97316", // orange
  "#f43f5e", // rose
  "#64748b", // slate, the shared default
];

const OWN_DEFAULT = "#dd3c73";
const SHARED_DEFAULT = "#64748b";

/** The colour to draw for `portfolio`: its own, else the default of its kind. */
export function portfolioColor(portfolio?: Pick<PortfolioItem, "color" | "isShared"> | null): string {
  if (portfolio?.color && /^#[0-9a-f]{6}$/i.test(portfolio.color)) return portfolio.color.toLowerCase();
  return portfolio?.isShared ? SHARED_DEFAULT : OWN_DEFAULT;
}

/** The round dot of a portfolio, sized by `className` (default `w-2 h-2`). */
export function PortfolioDot({ portfolio, color, className = "w-2 h-2" }: { portfolio?: PortfolioItem | null; color?: string; className?: string }) {
  const fill = color ?? portfolioColor(portfolio);
  return <span aria-hidden="true" className={`inline-block rounded-full shrink-0 ${className}`} style={{ backgroundColor: fill, boxShadow: `0 0 6px ${fill}80` }} />;
}

/** The colour field of the New and Edit modals: the preset swatches and a custom colour. */
export function PortfolioColorField({ color, onChange, disabled }: { color: string; onChange: (color: string) => void; disabled?: boolean }) {
  const custom = !PORTFOLIO_COLORS.includes(color);
  return (
    <div className="space-y-2">
      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Colour</span>
      <div className="flex flex-wrap items-center gap-2">
        {PORTFOLIO_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            disabled={disabled}
            onClick={() => onChange(swatch)}
            className={`h-7 w-7 rounded-full inline-flex items-center justify-center transition-transform cursor-pointer hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
              color === swatch ? "ring-2 ring-white/80 ring-offset-2 ring-offset-slate-900" : ""
            }`}
            style={{ backgroundColor: swatch }}
            aria-label={`Colour ${swatch}`}
            aria-pressed={color === swatch}
          >
            {color === swatch && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
          </button>
        ))}
        <label
          className={`relative h-7 px-2.5 rounded-full inline-flex items-center gap-1.5 border text-[10px] uppercase tracking-wider font-bold cursor-pointer transition-colors ${
            custom ? "border-white/70 text-slate-100" : "border-slate-700 text-slate-400 hover:text-slate-200"
          }`}
          title="Pick any colour"
        >
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: custom ? color : "transparent", border: custom ? "none" : "1px dashed currentColor" }} />
          Custom
          <input
            type="color"
            value={color}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            disabled={disabled}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
}
