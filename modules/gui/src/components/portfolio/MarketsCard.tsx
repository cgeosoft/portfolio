import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Globe2, RefreshCw } from "lucide-react";
import type { EconomicEvent, EconomicIndicatorReading, MacroSnapshot, SectorPerformanceRow, YieldCurveSnapshot } from "portfolio-shared/api-types";
import { DATA_PROVIDER_LABELS, type DataProviderId } from "portfolio-shared/config-types";
import { api } from "../../api";
import { fmtPercent, getDeltaColorClass } from "./utils";

interface MarketsCardProps {
  /** Picks the calendar currencies and the risk premium country. */
  baseCurrency?: string;
}

const MAX_EVENTS = 8;

function rate(n: number, digits = 2): string {
  return `${n.toFixed(digits)}%`;
}

function providerName(source: DataProviderId | "default" | null | undefined): string {
  if (!source) return "";
  if (source === "default") return "built-in default";
  return DATA_PROVIDER_LABELS[source] ?? source;
}

function eventTime(date: string): string {
  const d = new Date(`${date.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function indicatorValue(item: EconomicIndicatorReading): string {
  if (item.unit === "%") return rate(item.value);
  if (item.unit === "bn USD") return `${(item.value / 1000).toFixed(2)} tn USD`;
  return item.value.toFixed(1);
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="bg-card border border-line rounded-lg p-3 min-w-0 flex flex-col">
      <div className="flex items-baseline justify-between gap-2 mb-2 min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 truncate">{title}</div>
        {note && <div className="text-[10px] text-slate-500 truncate shrink-0">{note}</div>}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-xs text-slate-500 py-6 text-center">{text}</div>;
}

function YieldCurvePanel({ curve, riskFree }: { curve: YieldCurveSnapshot | null; riskFree: MacroSnapshot["riskFreeRate"] }) {
  if (!curve || curve.points.length === 0) {
    return (
      <Panel title="US Treasury yields">
        <Empty text="No yield data" />
      </Panel>
    );
  }
  const pts = curve.points;
  const min = Math.min(...pts.map((p) => p.yield));
  const max = Math.max(...pts.map((p) => p.yield));
  const span = Math.max(0.25, max - min);
  const w = 240;
  const h = 70;
  const x = (i: number) => (pts.length === 1 ? w / 2 : 6 + (i / (pts.length - 1)) * (w - 12));
  const y = (v: number) => 8 + (1 - (v - min) / span) * (h - 16);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.yield).toFixed(1)}`).join(" ");

  const find = (tenor: string) => pts.find((p) => p.tenor === tenor)?.yield;
  const long = find("year10");
  const short = find("year2") ?? find("month3");
  const spread = long !== undefined && short !== undefined ? long - short : undefined;
  const shortLabel = find("year2") !== undefined ? "2Y" : "3M";

  return (
    <Panel title="US Treasury yields" note={curve.date}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[70px] text-royal-bright" role="img" aria-label="Yield curve">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={p.tenor} cx={x(i)} cy={y(p.yield)} r={2} fill="currentColor">
            <title>{`${p.label}: ${rate(p.yield)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="grid grid-cols-4 gap-1 mt-1 text-center">
        {["month3", "year2", "year10", "year30"].map((t) => {
          const p = pts.find((pt) => pt.tenor === t);
          if (!p) return <div key={t} />;
          return (
            <div key={t} className="min-w-0">
              <div className="text-[10px] text-slate-500">{p.label}</div>
              <div className="font-mono text-xs text-slate-200">{rate(p.yield)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 pt-2 border-t border-line text-[10px] text-slate-400 font-mono flex flex-wrap gap-x-3 gap-y-0.5">
        {spread !== undefined && (
          <span className={spread < 0 ? "text-accent-bright" : ""} title={`10Y minus ${shortLabel}`}>
            10Y-{shortLabel} {spread >= 0 ? "+" : ""}
            {spread.toFixed(2)} pp{spread < 0 ? " (inverted)" : ""}
          </span>
        )}
        <span title={`Source: ${providerName(riskFree.source)}`}>Risk-free {rate(riskFree.rate * 100)}</span>
      </div>
    </Panel>
  );
}

function SectorsPanel({ sectors }: { sectors: MacroSnapshot["sectors"] }) {
  if (!sectors || sectors.items.length === 0) {
    return (
      <Panel title="Sectors today">
        <Empty text="No sector data" />
      </Panel>
    );
  }
  const maxAbs = Math.max(0.5, ...sectors.items.map((s) => Math.abs(s.changePercent)));
  const viaEtf = sectors.items.some((s) => s.etf);
  return (
    <Panel title="Sectors today" note={viaEtf ? "via sector ETFs" : sectors.date}>
      <ul className="space-y-1">
        {sectors.items.map((s: SectorPerformanceRow) => {
          const width = (Math.abs(s.changePercent) / maxAbs) * 50;
          const positive = s.changePercent >= 0;
          return (
            <li key={s.sector} className="grid grid-cols-[minmax(0,1fr)_96px_52px] items-center gap-2 text-[11px]">
              <span className="truncate text-slate-300" title={s.etf ? `${s.sector} (${s.etf})` : s.sector}>
                {s.sector}
                {s.pe !== undefined && <span className="text-slate-500 font-mono"> P/E {s.pe.toFixed(1)}</span>}
              </span>
              <span className="relative h-1.5 rounded-full bg-widget overflow-hidden">
                <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
                <span
                  className={`absolute inset-y-0 rounded-full ${positive ? "bg-mint" : "bg-rose-400"}`}
                  style={positive ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
                />
              </span>
              <span className={`font-mono text-right ${getDeltaColorClass(s.changePercent)}`}>{fmtPercent(s.changePercent)}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function CalendarPanel({ calendar }: { calendar: MacroSnapshot["calendar"] }) {
  const events: EconomicEvent[] = calendar?.events.slice(0, MAX_EVENTS) ?? [];
  return (
    <Panel title="Next economic releases" note={calendar ? "7 days" : undefined}>
      {!calendar ? (
        <Empty text="Needs a Financial Modeling Prep key" />
      ) : events.length === 0 ? (
        <Empty text="No major releases in the next 7 days" />
      ) : (
        <ul className="space-y-1.5">
          {events.map((e) => (
            <li key={`${e.date}:${e.currency}:${e.event}`} className="flex items-start gap-2 text-[11px] min-w-0">
              <span
                className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${e.impact === "High" ? "bg-accent-500" : "bg-cream"}`}
                title={`${e.impact} impact`}
              />
              <span className="font-mono text-slate-500 shrink-0 w-[92px] truncate">{eventTime(e.date)}</span>
              <span className="font-mono text-slate-400 shrink-0 w-8">{e.currency}</span>
              <span className="text-slate-300 truncate min-w-0" title={e.event}>
                {e.event}
                {e.estimate !== null && e.estimate !== undefined && (
                  <span className="text-slate-500 font-mono">
                    {" "}
                    est {e.estimate}
                    {e.unit ?? ""}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Macro context: Treasury yields, sector moves and the next economic releases. */
export function MarketsCard({ baseCurrency }: MarketsCardProps) {
  const [data, setData] = useState<MacroSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean, isCancelled: () => boolean = () => false) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.getMacroSnapshot(baseCurrency, refresh);
        if (!isCancelled()) setData(result);
      } catch (err) {
        if (!isCancelled()) setError(err instanceof Error ? err.message : "Could not load market data");
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [baseCurrency],
  );

  useEffect(() => {
    let cancelled = false;
    void load(false, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const sources = data
    ? Array.from(
        new Set(
          [data.yieldCurve?.source, data.sectors?.source, data.sectors?.peSource, data.calendar?.source, data.indicators?.source, data.riskPremium?.source].filter(
            (s): s is DataProviderId => Boolean(s),
          ),
        ),
      )
        .map((s) => providerName(s))
        .join(", ")
    : "";

  return (
    <div className="cx-card p-4 sm:p-5 font-mono w-full max-w-full min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 mb-4 min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 min-w-0">
            <Globe2 className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">Markets</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate">Rates, sectors and the economic calendar</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="p-1.5 rounded-md border border-line text-slate-400 hover:text-slate-200 disabled:opacity-50 shrink-0"
          title="Refresh market data"
          aria-label="Refresh market data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && !data ? (
        <div className="text-xs text-accent-bright text-center py-10">{error}</div>
      ) : !data ? (
        <div className="text-xs text-slate-500 text-center py-10">{loading ? "Loading market data..." : "No market data"}</div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <YieldCurvePanel curve={data.yieldCurve} riskFree={data.riskFreeRate} />
            <SectorsPanel sectors={data.sectors} />
            <CalendarPanel calendar={data.calendar} />
          </div>

          {(data.indicators || data.riskPremium) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
              {data.indicators?.items.map((i) => (
                <span key={i.id} title={`${i.name}, ${i.date}${i.previous !== undefined ? `; previous ${i.previous}` : ""}`}>
                  <span className="text-slate-500">US {i.name}</span> <span className="text-slate-200">{indicatorValue(i)}</span>
                </span>
              ))}
              {data.riskPremium?.items.map((r) => (
                <span key={r.country} title="Total equity risk premium">
                  <span className="text-slate-500">ERP {r.country}</span> <span className="text-slate-200">{rate(r.totalEquityRiskPremium)}</span>
                </span>
              ))}
            </div>
          )}

          {sources && <div className="text-[10px] text-slate-500">Data: {sources}</div>}
        </div>
      )}
    </div>
  );
}
