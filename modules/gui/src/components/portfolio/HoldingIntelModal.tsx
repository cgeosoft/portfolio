import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Building2, Target, Gauge, Scale, BarChart3, UserCheck, Newspaper, Users, Mic, ExternalLink, Loader2, RefreshCw, LineChart } from "lucide-react";
import type { PortfolioHolding } from "portfolio-shared/portfolio";
import { DATA_PROVIDER_LABELS, type DataProviderId } from "portfolio-shared/config-types";
import {
  describeAltmanZ,
  describePiotroski,
  type AnalystRecommendationCounts,
  type CompanyIntel,
  type CompanyIntelPart,
  type CompanyKeyMetrics,
  type CompanyNewsItem,
  type ScoreTone,
  type TranscriptSummary,
} from "portfolio-shared/company-intel";
import { api } from "../../api";
import { openExternal } from "../../environment";
import { fmtCurrency, fmtPercent } from "./utils";

interface HoldingIntelModalProps {
  holding: PortfolioHolding;
  onClose: () => void;
}

/** Parts only Financial Modeling Prep supplies. */
const FMP_ONLY: readonly CompanyIntelPart[] = ["estimates", "scores", "dcf", "press", "transcript"];

const TONE_CLASS: Record<ScoreTone, string> = {
  good: "text-mint border-mint/40 bg-mint/10",
  neutral: "text-cream border-cream/40 bg-cream/10",
  bad: "text-accent-bright border-accent/40 bg-accent/10",
};

/** Large company figures (market cap, revenue): 3.40T, 812.5M. */
function fmtCompact(value: number | undefined, currency?: string): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const scaled = abs >= 1e12 ? `${(value / 1e12).toFixed(2)}T` : abs >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : abs >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return currency ? `${scaled} ${currency}` : scaled;
}

function fmtRatio(value: number | undefined, digits = 2): string {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** A fraction (0.27) as a percent through the shared formatter. */
function fmtFraction(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "—" : fmtPercent(value * 100);
}

function fmtDay(unix: number): string {
  return unix > 0 ? new Date(unix * 1000).toISOString().slice(0, 10) : "";
}

function SourceTag({ source }: { source?: DataProviderId | null }) {
  if (!source) return null;
  return <span className="text-[10px] font-normal normal-case tracking-normal text-slate-500">Source: {DATA_PROVIDER_LABELS[source] ?? source}</span>;
}

function Section({ title, icon: Icon, source, children, className = "" }: { title: string; icon: typeof Target; source?: DataProviderId | null; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-950/30 p-3.5 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300 min-w-0">
          <Icon className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="truncate">{title}</span>
        </h3>
        <SourceTag source={source} />
      </div>
      {children}
    </section>
  );
}

function Unavailable({ part, intel }: { part: CompanyIntelPart; intel: CompanyIntel }) {
  let text = "Not available from your data providers.";
  if (intel.skipped.includes(part)) text = "Does not apply to ETFs and funds.";
  else if (FMP_ONLY.includes(part)) text = "Not available. This needs a Financial Modeling Prep key with access to this data.";
  return <p className="text-[11px] text-slate-500">{text}</p>;
}

function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 truncate">{label}</div>
      <div className="text-xs font-bold text-slate-100 truncate">{value}</div>
    </div>
  );
}

function ExternalLinkButton({ url, children }: { url?: string; children: ReactNode }) {
  if (!url) return <span>{children}</span>;
  return (
    <button type="button" onClick={() => openExternal(url)} className="text-left hover:text-accent-bright transition-colors cursor-pointer inline-flex items-start gap-1" title={url}>
      <span>{children}</span>
      <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 opacity-60" />
    </button>
  );
}

function NewsList({ items }: { items: CompanyNewsItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((n, i) => (
        <li key={`${n.datetime}-${i}`} className="text-xs">
          <div className="text-slate-200 leading-snug">
            <ExternalLinkButton url={n.url}>{n.title}</ExternalLinkButton>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">{[fmtDay(n.datetime), n.publisher].filter(Boolean).join(" · ")}</div>
        </li>
      ))}
    </ul>
  );
}

/** Low-to-high target range with markers for the current price and the consensus. */
function TargetRange({ low, high, price, consensus, currency }: { low: number; high: number; price?: number; consensus?: number; currency: string }) {
  const min = Math.min(low, price ?? low);
  const max = Math.max(high, price ?? high);
  const span = max - min || 1;
  const at = (v: number) => `${((v - min) / span) * 100}%`;
  return (
    <div className="pt-4 pb-1">
      <div className="relative h-2 rounded bg-slate-800 border border-slate-700">
        <div className="absolute inset-y-0 rounded bg-accent/30" style={{ left: at(low), width: `${((high - low) / span) * 100}%` }} />
        {consensus !== undefined && <div className="absolute -top-1 -bottom-1 w-0.5 bg-cream" style={{ left: at(consensus) }} title={`Consensus ${fmtCurrency(consensus, currency)}`} />}
        {price !== undefined && (
          <div className="absolute -top-3 -translate-x-1/2 flex flex-col items-center" style={{ left: at(price) }} title={`Price ${fmtCurrency(price, currency)}`}>
            <span className="text-[9px] text-mint leading-none">price</span>
            <span className="w-2 h-2 rotate-45 bg-mint mt-0.5" />
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-slate-500 mt-1">
        <span>Low {fmtCurrency(low, currency)}</span>
        <span>High {fmtCurrency(high, currency)}</span>
      </div>
    </div>
  );
}

function ScoreRow({ name, value, info }: { name: string; value: string; info: { label: string; tone: ScoreTone; explanation: string } }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-300">{name}</span>
        <span className="font-bold text-slate-100">{value}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TONE_CLASS[info.tone]}`}>{info.label}</span>
      </div>
      <p className="text-[11px] text-slate-500 mt-0.5 font-sans">{info.explanation}</p>
    </div>
  );
}

function RecommendationBar({ counts }: { counts: AnalystRecommendationCounts }) {
  const rows: Array<[string, number, string]> = [
    ["Strong buy", counts.strongBuy, "bg-mint"],
    ["Buy", counts.buy, "bg-mint/60"],
    ["Hold", counts.hold, "bg-cream/60"],
    ["Sell", counts.sell, "bg-accent/60"],
    ["Strong sell", counts.strongSell, "bg-accent"],
  ];
  const total = rows.reduce((sum, row) => sum + row[1], 0) || 1;
  return (
    <>
      <div className="flex h-2 rounded overflow-hidden border border-slate-700">
        {rows.map(([label, n, color]) => (n > 0 ? <div key={label} className={color} style={{ width: `${(n / total) * 100}%` }} title={`${label}: ${n}`} /> : null))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500 mt-1">
        {rows.map(([label, n]) => (
          <span key={label}>
            {label} {n}
          </span>
        ))}
      </div>
    </>
  );
}

function KeyRatios({ metrics: m, intel }: { metrics: CompanyKeyMetrics; intel: CompanyIntel }) {
  const all: Array<[string, string]> = [
    ["P/E", fmtRatio(m.peRatio, 1)],
    ["PEG", fmtRatio(m.pegRatio)],
    ["P/S", fmtRatio(m.priceToSales, 1)],
    ["P/B", fmtRatio(m.priceToBook, 1)],
    ["P/FCF", fmtRatio(m.priceToFreeCashFlow, 1)],
    ["EV/EBITDA", fmtRatio(m.evToEbitda, 1)],
    ["FCF yield", fmtFraction(m.freeCashFlowYield)],
    ["Dividend yield", fmtFraction(m.dividendYield)],
    ["Payout ratio", fmtFraction(m.payoutRatio)],
    ["Gross margin", fmtFraction(m.grossMargin)],
    ["Operating margin", fmtFraction(m.operatingMargin)],
    ["Net margin", fmtFraction(m.netMargin)],
    ["ROE", fmtFraction(m.returnOnEquity)],
    ["ROA", fmtFraction(m.returnOnAssets)],
    ["ROIC", fmtFraction(m.returnOnInvestedCapital)],
    ["Debt / equity", fmtRatio(m.debtToEquity)],
    ["Current ratio", fmtRatio(m.currentRatio)],
    ["Quick ratio", fmtRatio(m.quickRatio)],
    ["Interest cover", fmtRatio(m.interestCoverage, 1)],
    ["Revenue growth", fmtFraction(m.revenueGrowth)],
  ];
  const cells = all.filter(([, value]) => value !== "—");
  if (cells.length === 0) return <Unavailable part="metrics" intel={intel} />;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-2.5">
      {cells.map(([label, value]) => (
        <Stat key={label} label={label} value={value} />
      ))}
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ node: _n, ...props }) => <h4 className="text-[11px] font-bold uppercase tracking-wider text-accent-bright mt-3 mb-1" {...props} />,
  h2: ({ node: _n, ...props }) => <h4 className="text-[11px] font-bold uppercase tracking-wider text-accent-bright mt-3 mb-1" {...props} />,
  h3: ({ node: _n, ...props }) => <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-200 mt-2.5 mb-1" {...props} />,
  p: ({ node: _n, ...props }) => <p className="mb-2 text-slate-300 leading-relaxed text-xs" {...props} />,
  ul: ({ node: _n, ...props }) => <ul className="list-disc list-outside pl-4 mb-2 space-y-0.5 text-slate-300 text-xs" {...props} />,
  ol: ({ node: _n, ...props }) => <ol className="list-decimal list-outside pl-4 mb-2 space-y-0.5 text-slate-300 text-xs" {...props} />,
  li: ({ node: _n, ...props }) => <li className="text-slate-300 leading-relaxed" {...props} />,
  strong: ({ node: _n, ...props }) => <strong className="font-bold text-slate-100" {...props} />,
};

export function HoldingIntelModal({ holding, onClose }: HoldingIntelModalProps) {
  const titleId = useId();
  const [intel, setIntel] = useState<CompanyIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDescription, setShowDescription] = useState(false);
  const [summary, setSummary] = useState<TranscriptSummary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [transcriptBusy, setTranscriptBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getCompanyIntel(holding.symbol, undefined, holding.assetType)
      .then((data) => {
        if (!cancelled) setIntel(data);
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
  }, [holding.symbol, holding.assetType]);

  useEffect(() => load(), [load]);

  const summarize = async (force = false) => {
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      const res = await api.summarizeTranscript(holding.symbol, force);
      if (res.summary) setSummary(res.summary);
      else setSummaryError(res.error || "No summary is available.");
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : String(err));
    } finally {
      setSummaryBusy(false);
    }
  };

  const toggleTranscript = async () => {
    if (transcriptText !== null) {
      setTranscriptText(null);
      return;
    }
    setTranscriptBusy(true);
    try {
      const res = await api.getTranscript(holding.symbol);
      setTranscriptText(res.transcript?.text ?? "The transcript is not available.");
      if (res.summary && !summary) setSummary(res.summary);
    } catch (err) {
      setTranscriptText(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscriptBusy(false);
    }
  };

  const profile = intel?.profile?.data;
  const analyst = intel?.analyst?.data;
  const currency = profile?.currency || analyst?.currency || holding.nativeCurrency || holding.currency;
  const price = analyst?.currentPrice ?? intel?.dcf?.data.price ?? profile?.price;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4 overflow-y-auto font-mono" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        className="cx-card w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl shadow-2xl relative my-auto flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5 shrink-0 bg-slate-950/40">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent shrink-0 mt-0.5">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="text-sm font-bold text-slate-100 truncate">
                {holding.symbol}
                <span className="font-normal text-slate-400"> · {profile?.name || holding.name}</span>
              </h2>
              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                {[profile?.exchange, profile?.sector, profile?.industry, profile?.country].filter(Boolean).join(" · ") || holding.assetType}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={load} disabled={loading} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50" aria-label="Reload company data" title="Reload">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer" aria-label="Close company details">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto custom-scrollbar p-3 sm:p-4 space-y-3">
          {loading && !intel ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading company data...
            </div>
          ) : error ? (
            <div className="py-12 text-center text-xs text-accent-bright">Company data failed to load: {error}</div>
          ) : intel ? (
            <>
              {/* Profile */}
              <Section title="Profile" icon={Building2} source={intel.profile?.source}>
                {profile ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Stat label="Price" value={price !== undefined ? fmtCurrency(price, currency) : "—"} />
                      <Stat label="Market cap" value={fmtCompact(profile.marketCap, currency)} />
                      <Stat label="Beta" value={fmtRatio(profile.beta)} />
                      <Stat label="Employees" value={profile.employees ? profile.employees.toLocaleString("en-US") : "—"} />
                      {profile.ceo && <Stat label="CEO" value={profile.ceo} title={profile.ceo} />}
                      {profile.ipoDate && <Stat label="Listed since" value={profile.ipoDate} />}
                      {profile.website && <Stat label="Website" value={<ExternalLinkButton url={profile.website}>{profile.website.replace(/^https?:\/\//, "")}</ExternalLinkButton>} />}
                    </div>
                    {profile.description && (
                      <div className="text-[11px] text-slate-400 leading-relaxed font-sans">
                        <p className={showDescription ? "" : "line-clamp-3"}>{profile.description}</p>
                        <button type="button" onClick={() => setShowDescription((v) => !v)} className="text-accent-bright hover:underline mt-1 cursor-pointer font-mono">
                          {showDescription ? "Show less" : "Show more"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <Unavailable part="profile" intel={intel} />
                )}
              </Section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Analysts */}
                <Section title="Analyst consensus" icon={Target} source={intel.analyst?.source}>
                  {analyst ? (
                    <div className="space-y-3">
                      {analyst.priceTarget && (
                        <div>
                          <div className="grid grid-cols-3 gap-2">
                            <Stat label="Consensus target" value={analyst.priceTarget.consensus !== undefined ? fmtCurrency(analyst.priceTarget.consensus, currency) : "—"} />
                            <Stat label="Median target" value={analyst.priceTarget.median !== undefined ? fmtCurrency(analyst.priceTarget.median, currency) : "—"} />
                            <Stat
                              label="Upside to consensus"
                              value={
                                price && analyst.priceTarget.consensus ? (
                                  <span className={analyst.priceTarget.consensus >= price ? "text-mint" : "text-accent-bright"}>{fmtPercent((analyst.priceTarget.consensus / price - 1) * 100)}</span>
                                ) : (
                                  "—"
                                )
                              }
                            />
                          </div>
                          {analyst.priceTarget.low !== undefined && analyst.priceTarget.high !== undefined && (
                            <TargetRange low={analyst.priceTarget.low} high={analyst.priceTarget.high} price={price} consensus={analyst.priceTarget.consensus} currency={currency} />
                          )}
                          {analyst.priceTarget.lastQuarterCount !== undefined && (
                            <p className="text-[10px] text-slate-500 mt-1">
                              {analyst.priceTarget.lastQuarterCount} new targets in the last quarter, {analyst.priceTarget.lastYearCount ?? 0} in the last year.
                            </p>
                          )}
                        </div>
                      )}

                      {analyst.recommendations && (
                        <div>
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="text-slate-400">
                              Recommendation: <span className="font-bold text-slate-100">{analyst.recommendations.consensus ?? "—"}</span>
                            </span>
                            {analyst.recommendationsSource && <SourceTag source={analyst.recommendationsSource} />}
                          </div>
                          <RecommendationBar counts={analyst.recommendations} />
                        </div>
                      )}

                      {analyst.rating?.rating && (
                        <p className="text-[11px] text-slate-400">
                          FMP rating <span className="font-bold text-slate-100">{analyst.rating.rating}</span>
                          {analyst.rating.overallScore !== undefined && <> ({analyst.rating.overallScore} of 5, from DCF, returns, debt and valuation scores)</>}
                        </p>
                      )}

                      {analyst.grades.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Recent rating actions</div>
                          <ul className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                            {analyst.grades.map((g, i) => (
                              <li key={`${g.date}-${g.firm}-${i}`} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-slate-500 shrink-0">{g.date}</span>
                                <span className="text-slate-300 truncate flex-1">{g.firm}</span>
                                <span className={`shrink-0 ${g.action === "upgrade" ? "text-mint" : g.action === "downgrade" ? "text-accent-bright" : "text-slate-400"}`}>
                                  {g.previousGrade && g.previousGrade !== g.newGrade ? `${g.previousGrade} → ` : ""}
                                  {g.newGrade ?? g.action ?? ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Unavailable part="analyst" intel={intel} />
                  )}
                </Section>

                {/* Scores and DCF */}
                <div className="space-y-3 min-w-0">
                  <Section title="Financial health scores" icon={Gauge} source={intel.scores?.source}>
                    {intel.scores && (intel.scores.data.piotroski !== undefined || intel.scores.data.altmanZ !== undefined) ? (
                      <div className="space-y-2.5">
                        {intel.scores.data.piotroski !== undefined && <ScoreRow name="Piotroski F-score" value={`${intel.scores.data.piotroski} / 9`} info={describePiotroski(intel.scores.data.piotroski)} />}
                        {intel.scores.data.altmanZ !== undefined && <ScoreRow name="Altman Z-score" value={fmtRatio(intel.scores.data.altmanZ)} info={describeAltmanZ(intel.scores.data.altmanZ)} />}
                      </div>
                    ) : (
                      <Unavailable part="scores" intel={intel} />
                    )}
                  </Section>

                  <Section title="DCF value vs price" icon={Scale} source={intel.dcf?.source}>
                    {intel.dcf ? (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-3 gap-2">
                          <Stat label="DCF value" value={fmtCurrency(intel.dcf.data.dcfValue, intel.dcf.data.currency || currency)} />
                          <Stat label="Price" value={intel.dcf.data.price !== undefined ? fmtCurrency(intel.dcf.data.price, intel.dcf.data.currency || currency) : "—"} />
                          <Stat
                            label="Difference"
                            value={intel.dcf.data.upside !== undefined ? <span className={intel.dcf.data.upside >= 0 ? "text-mint" : "text-accent-bright"}>{fmtPercent(intel.dcf.data.upside * 100)}</span> : "—"}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 font-sans">
                          A discounted cash flow model values the company from its projected cash flows. Above the price suggests undervalued, below suggests overvalued. The model is sensitive to its growth and discount assumptions.
                        </p>
                      </div>
                    ) : (
                      <Unavailable part="dcf" intel={intel} />
                    )}
                  </Section>
                </div>
              </div>

              {/* Key ratios */}
              <Section title="Key ratios (trailing twelve months)" icon={BarChart3} source={intel.metrics?.source}>
                {intel.metrics ? <KeyRatios metrics={intel.metrics.data} intel={intel} /> : <Unavailable part="metrics" intel={intel} />}
              </Section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Estimates */}
                <Section title="Analyst estimates (annual)" icon={LineChart} source={intel.estimates?.source}>
                  {intel.estimates ? (
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                          <th className="py-1 font-normal">Fiscal year end</th>
                          <th className="py-1 font-normal text-right">EPS (range)</th>
                          <th className="py-1 font-normal text-right">Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {intel.estimates.data.periods.map((p) => (
                          <tr key={p.date}>
                            <td className="py-1 text-slate-400">{p.date}</td>
                            <td className="py-1 text-right text-slate-200">
                              {fmtRatio(p.epsAvg)}
                              {p.epsLow !== undefined && p.epsHigh !== undefined && <span className="text-slate-500"> ({fmtRatio(p.epsLow)} to {fmtRatio(p.epsHigh)})</span>}
                            </td>
                            <td className="py-1 text-right text-slate-200">{fmtCompact(p.revenueAvg)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <Unavailable part="estimates" intel={intel} />
                  )}
                </Section>

                {/* Insiders */}
                <Section title="Insider activity" icon={UserCheck} source={intel.insider?.source}>
                  {intel.insider ? (
                    <div className="space-y-2.5">
                      {intel.insider.data.statistics[0] && (
                        <p className="text-[11px] text-slate-400">
                          Q{intel.insider.data.statistics[0].quarter} {intel.insider.data.statistics[0].year}:{" "}
                          <span className="text-mint font-bold">{intel.insider.data.statistics[0].purchases} open-market purchases</span>,{" "}
                          <span className="text-accent-bright font-bold">{intel.insider.data.statistics[0].sales} sales</span>. Awards and option exercises are not counted as purchases.
                        </p>
                      )}
                      {intel.insider.data.trades.length > 0 && (
                        <ul className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                          {intel.insider.data.trades.map((t, i) => (
                            <li key={`${t.transactionDate}-${t.name}-${i}`} className="text-[11px] flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-slate-300 truncate">{t.url ? <ExternalLinkButton url={t.url}>{t.name}</ExternalLinkButton> : t.name}</div>
                                <div className="text-[10px] text-slate-500 truncate">{[t.transactionDate ?? t.filingDate, t.role, t.transactionType].filter(Boolean).join(" · ")}</div>
                              </div>
                              <div className={`shrink-0 text-right ${t.isPurchase ? "text-mint" : t.isSale ? "text-accent-bright" : "text-slate-400"}`}>
                                <div>
                                  {t.acquired ? "+" : "−"}
                                  {t.shares !== undefined ? t.shares.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"} sh
                                </div>
                                {t.value !== undefined && <div className="text-[10px] opacity-80">{fmtCompact(t.value, currency)}</div>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <Unavailable part="insider" intel={intel} />
                  )}
                </Section>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Section title="Press releases" icon={Newspaper} source={intel.press?.source}>
                  {intel.press ? <NewsList items={intel.press.data} /> : <Unavailable part="press" intel={intel} />}
                </Section>
                <Section title="News" icon={Newspaper} source={intel.news?.source}>
                  {intel.news ? <NewsList items={intel.news.data} /> : <Unavailable part="news" intel={intel} />}
                </Section>
              </div>

              {/* Peers */}
              <Section title="Peers" icon={Users} source={intel.peers?.source}>
                {intel.peers ? (
                  <div className="flex flex-wrap gap-1.5">
                    {intel.peers.data.map((p) => (
                      <span key={p.symbol} className="text-[11px] px-2 py-0.5 rounded border border-slate-700 bg-slate-900/60 text-slate-300" title={[p.name, p.marketCap ? `Market cap ${fmtCompact(p.marketCap)}` : ""].filter(Boolean).join(" · ")}>
                        <span className="font-bold text-slate-100">{p.symbol}</span>
                        {p.name && <span className="text-slate-500"> {p.name}</span>}
                      </span>
                    ))}
                  </div>
                ) : (
                  <Unavailable part="peers" intel={intel} />
                )}
              </Section>

              {/* Earnings call */}
              <Section title="Latest earnings call" icon={Mic} source={intel.transcript?.source}>
                {intel.transcript ? (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-400">
                        Q{intel.transcript.data.quarter} fiscal {intel.transcript.data.fiscalYear}
                        {intel.transcript.data.date ? `, held ${intel.transcript.data.date}` : ""}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={toggleTranscript}
                          disabled={transcriptBusy}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 hover:text-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {transcriptBusy ? "Loading..." : transcriptText !== null ? "Hide transcript" : "Read transcript"}
                        </button>
                        <button
                          type="button"
                          onClick={() => summarize(Boolean(summary))}
                          disabled={summaryBusy}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-accent/40 bg-accent/15 text-accent-bright hover:bg-accent/25 transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                        >
                          {summaryBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                          {summaryBusy ? "Summarizing..." : summary ? "Summarize again" : "Summarize latest earnings call"}
                        </button>
                      </div>
                    </div>
                    {summaryError && <p className="text-[11px] text-accent-bright">{summaryError}</p>}
                    {summary && (
                      <div className="rounded-lg border border-slate-800 bg-black/30 p-3">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {summary.summary}
                        </ReactMarkdown>
                        <p className="text-[10px] text-slate-500 mt-1">
                          Generated by your assistant model on {summary.generatedAt.slice(0, 10)}
                          {summary.cached ? " (saved copy)" : ""}
                          {summary.trimmed ? ". The transcript was shortened to fit the model." : "."} Check figures against the transcript.
                        </p>
                      </div>
                    )}
                    {transcriptText !== null && (
                      <pre className="max-h-72 overflow-y-auto custom-scrollbar whitespace-pre-wrap text-[11px] text-slate-400 leading-relaxed rounded-lg border border-slate-800 bg-black/30 p-3 font-sans select-text">{transcriptText}</pre>
                    )}
                  </div>
                ) : (
                  <Unavailable part="transcript" intel={intel} />
                )}
              </Section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
