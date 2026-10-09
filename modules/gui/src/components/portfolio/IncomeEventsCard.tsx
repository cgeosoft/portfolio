import { useEffect, useRef, useState } from "react";
import { BarController, BarElement, CategoryScale, Chart, type ChartConfiguration, LinearScale, Tooltip } from "chart.js";
import { CalendarClock, Coins, Loader2, TriangleAlert } from "lucide-react";
import type { AppTheme, DataProviderId, PortfolioEvent, PortfolioEventsResponse, PortfolioIncomeSummary } from "portfolio-shared/api-types";
import { DATA_PROVIDER_LABELS } from "portfolio-shared/config-types";
import { api } from "../../api";
import { fmtCurrency } from "./utils";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

/** Days of upcoming events the card lists. */
const EVENT_DAYS = 30;

interface IncomeEventsCardProps {
  portfolioId: string | null;
  currency?: string;
  hideValues?: boolean;
  theme?: AppTheme;
  /** Changes when the portfolio data reloads, so the card reloads with it. */
  refreshStamp?: string;
}

const FREQUENCY_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Twice a year",
  annual: "Yearly",
  irregular: "Irregular",
};

const EVENT_LABELS: Record<PortfolioEvent["kind"], string> = {
  exDividend: "Ex-dividend",
  dividendPayment: "Payment",
  earnings: "Earnings",
  split: "Split",
};

const EVENT_BADGES: Record<PortfolioEvent["kind"], string> = {
  exDividend: "bg-accent-500/15 text-accent-500 border-accent-500/30",
  dividendPayment: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  earnings: "bg-slate-800/60 text-slate-300 border-slate-700",
  split: "bg-status-warning/10 text-status-warning border-status-warning/30",
};

const yieldText = (value: number | undefined) => (value === undefined ? "n/a" : `${value.toFixed(2)}%`);

const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" });

function perShare(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined) return "";
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${currency ?? ""}/share`.replace(" /share", "/share");
}

function sourceNote(sources: DataProviderId[]): string {
  const names = sources.map((s) => DATA_PROVIDER_LABELS[s] ?? s);
  return names.length > 0 ? `Data: ${names.join(", ")}.` : "No provider had dividend or earnings data for these holdings.";
}

function eventDetail(e: PortfolioEvent, currency: string, hideValues: boolean): string {
  switch (e.kind) {
    case "exDividend":
      return perShare(e.amountPerShare, e.currency);
    case "dividendPayment":
      return e.expectedIncome !== undefined ? `about ${fmtCurrency(e.expectedIncome, currency, hideValues)}` : perShare(e.amountPerShare, e.currency);
    case "earnings": {
      const parts = [typeof e.epsEstimate === "number" ? `EPS estimate ${e.epsEstimate}` : "", e.time === "bmo" ? "before the open" : e.time === "amc" ? "after the close" : ""];
      return parts.filter(Boolean).join(", ");
    }
    case "split":
      return `${e.numerator}-for-${e.denominator}`;
  }
}

/** Dividend income of the next 12 months, yields, upcoming dividend, earnings and split dates, and split hints. */
export function IncomeEventsCard({ portfolioId, currency = "EUR", hideValues = false, theme, refreshStamp }: IncomeEventsCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [income, setIncome] = useState<PortfolioIncomeSummary | null>(null);
  const [events, setEvents] = useState<PortfolioEventsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!portfolioId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([api.getPortfolioIncome(portfolioId), api.getPortfolioEvents(portfolioId, EVENT_DAYS)])
      .then(([incomeRes, eventsRes]) => {
        if (cancelled) return;
        setIncome(incomeRes);
        setEvents(eventsRes);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portfolioId, refreshStamp]);

  const baseCurrency = income?.baseCurrency ?? currency;
  const months = income?.projected12m.months ?? [];
  const hasIncome = months.some((m) => m.declared > 0 || m.estimated > 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    chartRef.current?.destroy();
    chartRef.current = null;
    if (!canvas || !hasIncome) return;

    const isLight = theme === "light" || (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
    const declaredColor = isLight ? "#047857" : "#A7E2C0";
    const estimatedColor = isLight ? "rgba(4, 120, 87, 0.3)" : "rgba(167, 226, 192, 0.3)";
    const textMuted = isLight ? "#64748b" : "#94a3b8";
    const textColor = isLight ? "#0f172a" : "#f1f5f9";
    const bgWidget = isLight ? "#ffffff" : "#090d16";
    const border = isLight ? "#e2e8f0" : "#1e293b";
    const gridColor = isLight ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.05)";

    const config: ChartConfiguration<"bar"> = {
      type: "bar",
      data: {
        labels: months.map((m) => monthLabel(m.month)),
        datasets: [
          { label: "Declared", data: months.map((m) => m.declared), backgroundColor: declaredColor, borderRadius: 3, stack: "income" },
          { label: "Estimated", data: months.map((m) => m.estimated), backgroundColor: estimatedColor, borderColor: declaredColor, borderWidth: 1, borderRadius: 3, stack: "income" },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: textMuted, font: { family: "monospace", size: 10 } } },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { color: textMuted, font: { family: "monospace", size: 10 }, callback: (v) => (hideValues ? "" : fmtCurrency(Number(v), baseCurrency)) },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: bgWidget,
            borderColor: border,
            borderWidth: 1,
            titleColor: textColor,
            bodyColor: textMuted,
            padding: 10,
            cornerRadius: 8,
            titleFont: { family: "monospace", size: 12, weight: "bold" },
            bodyFont: { family: "monospace", size: 11 },
            callbacks: {
              label: (item) => `${item.dataset.label}: ${fmtCurrency(Number(item.raw), baseCurrency, hideValues)}`,
            },
          },
        },
      },
    };
    chartRef.current = new Chart(canvas, config);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [months, hasIncome, baseCurrency, hideValues, theme]);

  if (!portfolioId) return null;

  const stats = [
    { label: "Expected, next 12 months", value: fmtCurrency(income?.projected12m.total ?? 0, baseCurrency, hideValues) },
    {
      label: "Received, last 12 months",
      value: income && income.received12m.count > 0 ? fmtCurrency(income.received12m.total, baseCurrency, hideValues) : "None recorded",
    },
    { label: "Yield on cost", value: yieldText(income?.yieldOnCostPercent) },
    { label: "Current yield", value: yieldText(income?.currentYieldPercent) },
  ];
  const sources = Array.from(new Set([...(income?.sources ?? []), ...(events?.sources ?? [])]));
  const anyEstimated = months.some((m) => m.estimated > 0) || (events?.events ?? []).some((e) => e.estimated);

  return (
    <div className="cx-card p-4 sm:p-5 font-mono w-full max-w-full min-w-0 overflow-hidden space-y-5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 min-w-0">
            <Coins className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">Income & events</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate">Dividends of the next 12 months and the dates of the next {EVENT_DAYS} days</p>
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-accent-500 shrink-0" aria-label="Loading" />}
      </div>

      {error && <p className="text-xs text-status-error">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 truncate">{s.label}</div>
            <div className="text-sm font-bold text-slate-100 mt-1 truncate">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 min-w-0">
          <div className="flex items-center gap-4 text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-mint" /> Declared
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm border border-mint bg-mint/30" /> Estimated
            </span>
          </div>
          <div className="h-[220px] w-full relative">
            {hasIncome ? (
              <canvas ref={canvasRef} />
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500 text-center px-4">
                {loading ? "Loading dividend data..." : "No dividends expected from the current holdings in the next 12 months."}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" /> Next {EVENT_DAYS} days
          </div>
          <ul className="space-y-1.5 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
            {(events?.events ?? []).map((e) => (
              <li key={`${e.kind}:${e.symbol}:${e.date}`} className="flex items-start gap-2 text-[11px] min-w-0">
                <span className="w-12 shrink-0 text-slate-400">{shortDate(e.date)}</span>
                <span className={`shrink-0 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${EVENT_BADGES[e.kind]}`}>{EVENT_LABELS[e.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-bold text-slate-100">{e.symbol}</span>
                  <span className="text-slate-500"> {eventDetail(e, baseCurrency, hideValues)}</span>
                  {e.estimated && <span className="text-slate-500 italic"> (estimated)</span>}
                </span>
              </li>
            ))}
            {events && events.events.length === 0 && <li className="text-xs text-slate-500">No dividend, earnings or split dates in the next {EVENT_DAYS} days.</li>}
          </ul>
        </div>
      </div>

      {income && income.holdings.length > 0 && (
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                <th className="py-1.5 pr-3 font-semibold">Symbol</th>
                <th className="py-1.5 pr-3 font-semibold">Frequency</th>
                <th className="py-1.5 pr-3 font-semibold">Next ex-date</th>
                <th className="py-1.5 pr-3 font-semibold text-right">Yield on cost</th>
                <th className="py-1.5 pr-3 font-semibold text-right">Current yield</th>
                <th className="py-1.5 font-semibold text-right">Next 12 months</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {income.holdings.map((h) => (
                <tr key={h.symbol} className="text-slate-300">
                  <td className="py-1.5 pr-3 font-bold text-slate-100" title={h.name}>
                    {h.symbol}
                  </td>
                  <td className="py-1.5 pr-3">{h.frequency ? FREQUENCY_LABELS[h.frequency] : "n/a"}</td>
                  <td className="py-1.5 pr-3">
                    {h.nextExDate ? shortDate(h.nextExDate) : "n/a"}
                    {h.estimated && <span className="text-slate-500 italic"> est.</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{yieldText(h.yieldOnCostPercent)}</td>
                  <td className="py-1.5 pr-3 text-right">{yieldText(h.currentYieldPercent)}</td>
                  <td className="py-1.5 text-right">{h.fxMissing ? "No FX rate" : fmtCurrency(h.projectedIncome12m, baseCurrency, hideValues)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {income && income.splitWarnings.length > 0 && (
        <div className="space-y-1.5">
          {income.splitWarnings.map((w) => (
            <div key={`${w.symbol}:${w.date}`} className="flex items-start gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[11px] text-status-warning">
              <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {(income || events) && (
        <p className="text-[10px] text-slate-500 leading-relaxed">
          {sourceNote(sources)} Income uses the current quantities and exchange rates.
          {anyEstimated ? " Estimated dividends repeat the last amount at the usual interval." : ""}
        </p>
      )}
    </div>
  );
}
