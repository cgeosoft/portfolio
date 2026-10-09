import { useEffect, useMemo, useRef, useState } from "react";
import {
  CategoryScale,
  Chart,
  type ChartConfiguration,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import type { PortfolioHistoricalPoint } from "portfolio-shared/portfolio";
import type { AppTheme, BenchmarkPoint } from "portfolio-shared/api-types";
import { BENCHMARK_OPTIONS, DEFAULT_BENCHMARK_SYMBOL } from "portfolio-shared/config-types";
import { relativePerformance } from "portfolio-shared/benchmark";
import { api } from "../../api";
import { Select } from "../common/Select";
import { fmtCurrency, fmtPercent } from "./utils";
import { TrendingUp } from "lucide-react";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Tooltip, Filler);

interface PortfolioChartCardProps {
  chartHistory: PortfolioHistoricalPoint[];
  currency?: string;
  hideValues?: boolean;
  theme?: AppTheme;
}

type Timeframe = "1m" | "3m" | "6m" | "1y" | "all";

const VALID_TIMEFRAMES: readonly Timeframe[] = ["1m", "3m", "6m", "1y", "all"] as const;

const NO_BENCHMARK = "none";

/** First date of a timeframe, "YYYY-MM-DD"; null for "all". */
function timeframeCutoff(range: Timeframe): string | null {
  if (range === "all") return null;
  const days = range === "1m" ? 30 : range === "3m" ? 90 : range === "6m" ? 180 : 365;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;
}

/** The benchmark history range that covers a timeframe. */
function benchmarkRange(range: Timeframe, firstDate: string | undefined): string {
  if (range === "1m") return "1mo";
  if (range === "3m") return "3mo";
  if (range === "6m") return "6mo";
  if (range === "1y" || !firstDate) return "1y";
  const years = (Date.now() - Date.parse(`${firstDate}T00:00:00Z`)) / (365.25 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(years) || years <= 1) return "1y";
  if (years <= 2) return "2y";
  if (years <= 5) return "5y";
  if (years <= 10) return "10y";
  return "max";
}

function benchmarkName(symbol: string): string {
  return BENCHMARK_OPTIONS.find((o) => o.symbol === symbol)?.label ?? symbol;
}

export function PortfolioChartCard({
  chartHistory,
  currency = "EUR",
  hideValues = false,
  theme,
}: PortfolioChartCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  // The timeframe lives in the settings (`chartRange`): localStorage does not
  // survive a restart, since the service picks a new port and origin each time.
  const [range, setRange] = useState<Timeframe>("1y");

  const handleSelectRange = (r: Timeframe) => {
    setRange(r);
    api.saveConfig({ chartRange: r }).catch((err) => console.warn("Could not save the chart range:", err));
  };

  // Benchmark overlay: the choice lives in the settings (`benchmarkSymbol`).
  const [benchmark, setBenchmark] = useState<string>(NO_BENCHMARK);
  const [benchmarkPoints, setBenchmarkPoints] = useState<BenchmarkPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getConfig()
      .then((cfg) => {
        if (cancelled) return;
        setBenchmark(cfg.benchmarkSymbol || DEFAULT_BENCHMARK_SYMBOL);
        if ((VALID_TIMEFRAMES as readonly string[]).includes(cfg.chartRange)) setRange(cfg.chartRange as Timeframe);
      })
      .catch(() => {
        if (!cancelled) setBenchmark(DEFAULT_BENCHMARK_SYMBOL);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectBenchmark = (symbol: string) => {
    setBenchmark(symbol);
    setBenchmarkPoints(null);
    api.saveConfig({ benchmarkSymbol: symbol }).catch((err) => console.warn("Could not save the benchmark choice:", err));
  };

  const firstDate = chartHistory[0]?.date;
  const historyRange = benchmarkRange(range, firstDate);

  useEffect(() => {
    if (benchmark === NO_BENCHMARK) {
      setBenchmarkPoints(null);
      return;
    }
    let cancelled = false;
    api
      .getBenchmarkHistory(benchmark, historyRange)
      .then((res) => {
        if (!cancelled) setBenchmarkPoints(res.points);
      })
      .catch(() => {
        if (!cancelled) setBenchmarkPoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [benchmark, historyRange]);

  const filtered = useMemo(() => {
    if (!chartHistory || chartHistory.length === 0) return [];
    const cutoff = timeframeCutoff(range);
    const inRange = cutoff ? chartHistory.filter((pt) => pt.date >= cutoff) : chartHistory;
    return inRange.length > 0 ? inRange : chartHistory;
  }, [chartHistory, range]);

  // Portfolio (time-weighted) and benchmark, both in percent from the first common date.
  const relative = useMemo(() => {
    if (benchmark === NO_BENCHMARK || !benchmarkPoints || benchmarkPoints.length === 0 || filtered.length === 0) return null;
    const series = relativePerformance(filtered, benchmarkPoints);
    if (series.length < 2) return null;
    const byDate = new Map(series.map((p) => [p.date, p]));
    const last = series[series.length - 1]!;
    return { byDate, portfolio: last.portfolio, benchmark: last.benchmark, label: benchmarkName(benchmark) };
  }, [benchmark, benchmarkPoints, filtered]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    if (filtered.length === 0) return;

    const labels = filtered.map((pt) =>
      new Date(pt.date + "T12:00:00Z").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    );

    const totalWithCash = filtered.map((pt) => pt.totalPortfolioValue ?? (pt.totalValue + (pt.cashBalance ?? 0)));
    const values = filtered.map((pt) => pt.totalValue);
    const costs = filtered.map((pt) => pt.totalCost);
    const pctChange = filtered.map((pt) =>
      pt.totalCost > 0 ? ((pt.totalValue - pt.totalCost) / pt.totalCost) * 100 : 0
    );

    const isLight = theme === "light" || (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
    const totalColor = isLight ? "#047857" : "#A7E2C0"; // mint for total value with cash, deeper on white
    const accentColor = "#DD3C73"; // vibrant rose/magenta accent for invested value
    const costBasisColor = isLight ? "#94a3b8" : "#64748b"; // slate for cost basis
    const returnColor = isLight ? "#1d4ed8" : "#6d8bf7"; // royal blue tint for return %
    const benchmarkColor = isLight ? "#b45309" : "#E3EACD"; // cream on dark, amber on white
    const textMuted = isLight ? "#64748b" : "#94a3b8";
    const textColor = isLight ? "#0f172a" : "#f1f5f9";
    const bgWidget = isLight ? "#ffffff" : "#090d16";
    const border = isLight ? "#e2e8f0" : "#1e293b";
    const gridColor = isLight ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.05)";

    const zeroLinePlugin = {
      id: "zeroLineY1",
      afterDraw(chart: Chart) {
        const y1Scale = chart.scales["y1"];
        if (!y1Scale) return;
        const yPixel = y1Scale.getPixelForValue(0);
        if (yPixel < y1Scale.top || yPixel > y1Scale.bottom) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = returnColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.45;
        ctx.moveTo(chart.chartArea.left, yPixel);
        ctx.lineTo(chart.chartArea.right, yPixel);
        ctx.stroke();
        ctx.restore();
      },
    };

    const config: ChartConfiguration = {
      type: "line",
      plugins: [zeroLinePlugin as any],
      data: {
        labels: labels.length > 0 ? labels : ["Today"],
        datasets: [
          {
            label: "Total Value (inc. Cash)",
            data: totalWithCash,
            borderColor: totalColor,
            backgroundColor: "transparent",
            borderWidth: 2,
            borderDash: [5, 4],
            pointRadius: filtered.length > 60 ? 0 : 2,
            pointHoverRadius: 5,
            tension: 0,
            fill: false,
            yAxisID: "y",
            order: 1,
          },
          {
            label: "Invested Value",
            data: values,
            borderColor: accentColor,
            backgroundColor: "rgba(221, 60, 115, 0.12)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0,
            fill: true,
            yAxisID: "y",
            order: 3,
          },
          {
            label: "Total Cost Basis",
            data: costs,
            borderColor: costBasisColor,
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointRadius: 0,
            pointHoverRadius: 0,
            tension: 0,
            fill: false,
            yAxisID: "y",
            order: 2,
          },
          ...(relative
            ? [
                {
                  label: "Portfolio (time-weighted) %",
                  data: filtered.map((pt) => relative.byDate.get(pt.date)?.portfolio ?? null),
                  borderColor: returnColor,
                  backgroundColor: "transparent",
                  borderWidth: 1.5,
                  pointRadius: 0,
                  pointHoverRadius: 4,
                  tension: 0,
                  fill: false,
                  spanGaps: true,
                  yAxisID: "y1",
                  order: 0,
                },
                {
                  label: `${relative.label} %`,
                  data: filtered.map((pt) => relative.byDate.get(pt.date)?.benchmark ?? null),
                  borderColor: benchmarkColor,
                  backgroundColor: "transparent",
                  borderWidth: 1.5,
                  borderDash: [2, 3],
                  pointRadius: 0,
                  pointHoverRadius: 4,
                  tension: 0,
                  fill: false,
                  spanGaps: true,
                  yAxisID: "y1",
                  order: 0,
                },
              ]
            : [
                {
                  label: "Return %",
                  data: pctChange,
                  borderColor: returnColor,
                  backgroundColor: "transparent",
                  borderWidth: 1.5,
                  pointRadius: 0,
                  pointHoverRadius: 4,
                  tension: 0,
                  fill: false,
                  yAxisID: "y1",
                  order: 0,
                },
              ]),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: bgWidget,
            borderColor: border,
            borderWidth: 1,
            titleColor: textColor,
            bodyColor: textMuted,
            padding: 10,
            callbacks: {
              label: (item) => {
                const val = Number(item.raw);
                if (item.dataset.yAxisID === "y1") {
                  return ` ${item.dataset.label}: ${fmtPercent(val)}`;
                }
                return ` ${item.dataset.label}: ${fmtCurrency(val, currency, hideValues)}`;
              },
            },
            titleFont: { family: "monospace", size: 11 },
            bodyFont: { family: "monospace", size: 11 },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: {
              color: textMuted,
              font: { size: 9, family: "monospace" },
              maxRotation: 0,
              maxTicksLimit: 8,
            },
            border: { display: false },
          },
          y: {
            position: "left",
            grid: { color: gridColor },
            ticks: {
              color: textMuted,
              font: { size: 9, family: "monospace" },
              callback: (val) => fmtCurrency(val as number, currency, hideValues),
            },
            border: { display: false },
          },
          y1: {
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: {
              color: returnColor,
              font: { size: 9, family: "monospace" },
              callback: (val) => fmtPercent(val as number),
            },
            border: { display: false },
          },
        },
      },
    };

    chartRef.current = new Chart(canvas, config);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [filtered, relative, currency, hideValues, theme]);

  return (
    <div className="cx-card p-4 sm:p-5 font-mono h-full flex flex-col justify-between w-full max-w-full min-w-0 overflow-hidden">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 min-w-0">
              <TrendingUp className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="truncate">Portfolio Performance History</span>
            </div>
            {relative ? (
              <p
                className="text-[11px] text-slate-500 font-mono mt-0.5 truncate"
                title="Time-weighted return of the holdings against the benchmark over the selected range. Buys and sells do not count as gains or losses."
              >
                Portfolio {fmtPercent(relative.portfolio)} vs {relative.label} {fmtPercent(relative.benchmark)} (
                <span className={relative.portfolio - relative.benchmark >= 0 ? "text-mint" : "text-rose-400"}>
                  {relative.portfolio - relative.benchmark >= 0 ? "+" : ""}
                  {(relative.portfolio - relative.benchmark).toFixed(2)} pp
                </span>
                )
              </p>
            ) : (
              <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate" title="Historical portfolio value vs. invested basis & return %">
                Historical portfolio value vs. invested basis & return %
              </p>
            )}
          </div>

          <div className="hidden lg:flex items-center gap-3 text-[10px] text-slate-400 ml-2 pl-3 border-l border-slate-800">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 border-t border-dashed border-mint inline-block" />
              <span>Total inc. Cash</span>
            </span>
            <span className="flex items-center gap-1">
              <span
                className="w-2.5 h-1.5 rounded-sm border border-[#DD3C73]/60 inline-block"
                style={{ background: "rgba(221, 60, 115, 0.25)" }}
              />
              <span>Invested</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 border-t border-dashed border-slate-400 inline-block" />
              <span>Cost Basis</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-1 rounded-sm bg-[#6d8bf7] inline-block" />
              <span>{relative ? "Portfolio %" : "Return %"}</span>
            </span>
            {relative && (
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-0.5 border-t border-dashed border-cream inline-block" />
                <span>{relative.label}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <Select
            value={benchmark}
            onChange={(e) => handleSelectBenchmark(e.target.value)}
            selectSize="sm"
            aria-label="Benchmark"
            title="Compare with a benchmark"
            wrapperClassName="min-w-[8.5rem]"
          >
            <option value={NO_BENCHMARK}>No benchmark</option>
            {BENCHMARK_OPTIONS.map((o) => (
              <option key={o.symbol} value={o.symbol}>
                vs {o.label}
              </option>
            ))}
          </Select>
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs font-mono justify-center">
            {VALID_TIMEFRAMES.map((r) => (
              <button
                key={r}
                onClick={() => handleSelectRange(r)}
                className={`px-2.5 py-1 rounded uppercase transition-all cursor-pointer ${
                  range === r
                    ? "bg-[#DD3C73]/20 text-[#DD3C73] border border-[#DD3C73]/30 font-bold"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-[280px] w-full flex-1">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

