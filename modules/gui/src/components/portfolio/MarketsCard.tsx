import { useEffect, useState, type ReactNode } from "react";
import { Building2, CalendarDays, Globe2, Landmark, Loader2, type LucideIcon } from "lucide-react";
import type { EconomicEvent, EconomicIndicatorReading, MacroSnapshot, SectorPerformanceRow, YieldCurveSnapshot } from "portfolio-shared/api-types";
import { DATA_PROVIDER_LABELS, type DataProviderId } from "portfolio-shared/config-types";
import { api } from "../../api";
import { fmtPercent, getDeltaColorClass } from "./utils";
import { getLocale, t } from "../../i18n";

interface MarketsCardProps {
  /** Picks the calendar currencies and the risk premium country. */
  baseCurrency?: string;
  /** Changes when the portfolio data reloads (the global refresh), so the page reloads with it. */
  refreshStamp?: string;
}

const MAX_EVENTS = 8;

/** Release impacts with a label under `dashboard.markets.impact`. */
const IMPACT_KEYS: Record<string, string> = { High: "high", Medium: "medium", Low: "low" };

function impactLabel(impact: string): string {
  const key = IMPACT_KEYS[impact];
  return key ? t(`dashboard.markets.impact.${key}`) : t("dashboard.markets.impact.generic", { impact });
}

function rate(n: number, digits = 2): string {
  return `${n.toFixed(digits)}%`;
}

function providerName(source: DataProviderId | "default" | null | undefined): string {
  if (!source) return "";
  if (source === "default") return t("dashboard.markets.builtInDefault");
  return DATA_PROVIDER_LABELS[source] ?? source;
}

function eventTime(date: string): string {
  const d = new Date(`${date.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleString(getLocale(), { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function indicatorValue(item: EconomicIndicatorReading): string {
  if (item.unit === "%") return rate(item.value);
  if (item.unit === "bn USD") return t("dashboard.markets.trillionUsd", { value: (item.value / 1000).toFixed(2) });
  return item.value.toFixed(1);
}

/** Icon, uppercase title and subtitle, the head of every card on the page. */
function CardHeading({ icon: Icon, title, subtitle, aside }: { icon: LucideIcon; title: string; subtitle: string; aside?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 min-w-0">
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 min-w-0">
          <Icon className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="truncate">{title}</span>
        </div>
        <p className="pl-[22px] text-[11px] text-slate-500 mt-0.5 truncate">{subtitle}</p>
      </div>
      {aside}
    </div>
  );
}

function Panel({ icon, title, subtitle, note, children }: { icon: LucideIcon; title: string; subtitle: string; note?: string; children: ReactNode }) {
  return (
    <section className="cx-card p-4 sm:p-5 min-w-0 space-y-4">
      <CardHeading icon={icon} title={title} subtitle={subtitle} aside={note && <div className="text-[10px] text-slate-500 truncate shrink-0 mt-0.5">{note}</div>} />
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-xs text-slate-500 py-6 text-center">{text}</div>;
}

function YieldCurvePanel({ curve, riskFree }: { curve: YieldCurveSnapshot | null; riskFree: MacroSnapshot["riskFreeRate"] }) {
  if (!curve || curve.points.length === 0) {
    return (
      <Panel icon={Landmark} title={t("dashboard.markets.treasuryYields")} subtitle={t("dashboard.markets.yieldsSubtitle")}>
        <Empty text={t("dashboard.markets.noYieldData")} />
      </Panel>
    );
  }
  const pts = curve.points;
  const min = Math.min(...pts.map((p) => p.yield));
  const max = Math.max(...pts.map((p) => p.yield));
  const span = Math.max(0.25, max - min);
  // Percent of the plot, so the curve stretches with the card; each point sits over its label column.
  const x = (i: number) => ((i + 0.5) / pts.length) * 100;
  const y = (v: number) => 10 + (1 - (v - min) / span) * 80;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.yield).toFixed(2)}`).join(" ");

  const find = (tenor: string) => pts.find((p) => p.tenor === tenor)?.yield;
  const long = find("year10");
  const short = find("year2") ?? find("month3");
  const spread = long !== undefined && short !== undefined ? long - short : undefined;
  const shortLabel = find("year2") !== undefined ? "2Y" : "3M";

  return (
    <Panel icon={Landmark} title={t("dashboard.markets.treasuryYields")} subtitle={t("dashboard.markets.yieldsSubtitle")} note={curve.date}>
      <div className="relative h-[140px] text-royal-bright">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" role="img" aria-label={t("dashboard.markets.yieldCurve")}>
          <path d={path} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {pts.map((p, i) => (
          <span
            key={p.tenor}
            className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full bg-current"
            style={{ left: `${x(i)}%`, top: `${y(p.yield)}%` }}
            title={`${p.label}: ${rate(p.yield)}`}
          />
        ))}
      </div>
      <div className="grid gap-1 mt-2 text-center" style={{ gridTemplateColumns: `repeat(${pts.length}, minmax(0, 1fr))` }}>
        {pts.map((p) => (
          <div key={p.tenor} className="min-w-0">
            <div className="text-[10px] text-slate-500 truncate">{p.label}</div>
            <div className="font-mono text-xs text-slate-200 truncate">{rate(p.yield)}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-line text-[10px] text-slate-400 font-mono flex flex-wrap gap-x-4 gap-y-0.5">
        {spread !== undefined && (
          <span className={spread < 0 ? "text-accent-bright" : ""} title={t("dashboard.markets.spreadHint", { short: shortLabel })}>
            {t(spread < 0 ? "dashboard.markets.spreadInverted" : "dashboard.markets.spread", {
              short: shortLabel,
              value: `${spread >= 0 ? "+" : ""}${spread.toFixed(2)}`,
            })}
          </span>
        )}
        <span title={t("dashboard.markets.source", { name: providerName(riskFree.source) })}>{t("dashboard.markets.riskFree", { rate: rate(riskFree.rate * 100) })}</span>
      </div>
    </Panel>
  );
}

function SectorsPanel({ sectors }: { sectors: MacroSnapshot["sectors"] }) {
  if (!sectors || sectors.items.length === 0) {
    return (
      <Panel icon={Building2} title={t("dashboard.markets.sectorsToday")} subtitle={t("dashboard.markets.sectorsSubtitle")}>
        <Empty text={t("dashboard.markets.noSectorData")} />
      </Panel>
    );
  }
  const maxAbs = Math.max(0.5, ...sectors.items.map((s) => Math.abs(s.changePercent)));
  const viaEtf = sectors.items.some((s) => s.etf);
  return (
    <Panel icon={Building2} title={t("dashboard.markets.sectorsToday")} subtitle={t("dashboard.markets.sectorsSubtitle")} note={viaEtf ? t("dashboard.markets.viaSectorEtfs") : sectors.date}>
      <ul className="space-y-1.5">
        {sectors.items.map((s: SectorPerformanceRow) => {
          const width = (Math.abs(s.changePercent) / maxAbs) * 50;
          const positive = s.changePercent >= 0;
          return (
            <li key={s.sector} className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_60px] sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)_72px] items-center gap-3 text-[11px]">
              <span className="truncate text-slate-300" title={s.etf ? `${s.sector} (${s.etf})` : s.sector}>
                {s.sector}
                {s.pe !== undefined && <span className="text-slate-500 font-mono"> {t("dashboard.markets.pe", { value: s.pe.toFixed(1) })}</span>}
              </span>
              <span className="relative h-2 rounded-full bg-widget overflow-hidden">
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
    <Panel icon={CalendarDays} title={t("dashboard.markets.nextReleases")} subtitle={t("dashboard.markets.releasesSubtitle")} note={calendar ? t("dashboard.markets.sevenDays") : undefined}>
      {!calendar ? (
        <Empty text={t("dashboard.markets.needsFmpKey")} />
      ) : events.length === 0 ? (
        <Empty text={t("dashboard.markets.noReleases")} />
      ) : (
        <ul className="divide-y divide-line">
          {events.map((e) => (
            <li
              key={`${e.date}:${e.currency}:${e.event}`}
              className="grid grid-cols-[110px_36px_minmax(0,1fr)_auto] sm:grid-cols-[150px_48px_96px_minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-[11px] min-w-0"
            >
              <span className="font-mono text-slate-500 truncate">{eventTime(e.date)}</span>
              <span className="font-mono text-slate-400">{e.currency}</span>
              <span className="hidden sm:flex items-center gap-1.5 text-slate-400 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${e.impact === "High" ? "bg-accent-500" : "bg-cream"}`} />
                <span className="truncate">{impactLabel(e.impact)}</span>
              </span>
              <span className="text-slate-300 truncate min-w-0" title={e.event}>
                {e.event}
              </span>
              <span className="text-slate-500 font-mono text-right whitespace-nowrap">
                {e.estimate !== null && e.estimate !== undefined ? t("dashboard.markets.estimate", { value: `${e.estimate}${e.unit ?? ""}` }) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The Markets page of Analysis: Treasury yields, sector moves and the next economic releases, each a full-width card. */
export function MarketsCard({ baseCurrency, refreshStamp }: MarketsCardProps) {
  const [data, setData] = useState<MacroSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The service keeps the snapshot for a few minutes, so a timed quote refresh does not hit the providers each time.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getMacroSnapshot(baseCurrency)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("dashboard.markets.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseCurrency, refreshStamp]);

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
    <div className="font-mono w-full max-w-full min-w-0 space-y-4">
      <section className="cx-card p-4 sm:p-5 min-w-0">
        <CardHeading
          icon={Globe2}
          title={t("dashboard.markets.title")}
          subtitle={t("dashboard.markets.subtitle")}
          aside={loading && <Loader2 className="w-4 h-4 animate-spin text-accent-500 shrink-0" aria-label={t("dashboard.markets.loading")} />}
        />
        {data && (data.indicators || data.riskPremium) && (
          <div className="mt-4 pt-3 border-t border-line flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400">
            {data.indicators?.items.map((i) => (
              <span
                key={i.id}
                title={
                  i.previous !== undefined
                    ? t("dashboard.markets.indicatorHintPrevious", { name: i.name, date: i.date, previous: i.previous })
                    : t("dashboard.markets.indicatorHint", { name: i.name, date: i.date })
                }
              >
                <span className="text-slate-500">{t("dashboard.markets.usIndicator", { name: i.name })}</span> <span className="text-slate-200">{indicatorValue(i)}</span>
              </span>
            ))}
            {data.riskPremium?.items.map((r) => (
              <span key={r.country} title={t("dashboard.markets.riskPremium")}>
                <span className="text-slate-500">{t("dashboard.markets.erp", { country: r.country })}</span> <span className="text-slate-200">{rate(r.totalEquityRiskPremium)}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {error && !data ? (
        <div className="cx-card p-4 text-xs text-accent-bright text-center py-10">{error}</div>
      ) : !data ? (
        <div className="cx-card p-4 text-xs text-slate-500 text-center py-10">{loading ? t("dashboard.markets.loading") : t("dashboard.markets.noData")}</div>
      ) : (
        <>
          <YieldCurvePanel curve={data.yieldCurve} riskFree={data.riskFreeRate} />
          <SectorsPanel sectors={data.sectors} />
          <CalendarPanel calendar={data.calendar} />

          {sources && <div className="px-1 text-[10px] text-slate-500">{t("dashboard.markets.sources", { sources })}</div>}
        </>
      )}
    </div>
  );
}
