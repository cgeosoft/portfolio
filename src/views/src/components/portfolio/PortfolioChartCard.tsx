import { useEffect, useRef, useState } from "react";
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
import type { PortfolioHistoricalPoint } from "../../types/portfolio";
import { fmtCurrency, fmtPercent } from "./utils";
import { TrendingUp } from "lucide-react";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Tooltip, Filler);

interface PortfolioChartCardProps {
  chartHistory: PortfolioHistoricalPoint[];
  currency?: string;
  hideValues?: boolean;
}

type Timeframe = "1m" | "3m" | "6m" | "1y" | "all";

export function PortfolioChartCard({
  chartHistory,
  currency = "EUR",
  hideValues = false,
}: PortfolioChartCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [range, setRange] = useState<Timeframe>("1y");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    if (!chartHistory || chartHistory.length === 0) return;

    let filtered = [...chartHistory];
    const now = Date.now();
    if (range !== "all") {
      const days = range === "1m" ? 30 : range === "3m" ? 90 : range === "6m" ? 180 : 365;
      const cutoff = new Date(now - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;
      filtered = chartHistory.filter((pt) => pt.date >= cutoff);
    }

    if (filtered.length === 0) filtered = chartHistory;

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

    const totalColor = "#A7E2C0"; // mint green for total portfolio value with cash
    const accentColor = "#DD3C73"; // vibrant rose/magenta accent for invested value
    const costBasisColor = "#64748b"; // slate for cost basis
    const returnColor = "#6d8bf7"; // royal blue tint for return %
    const textMuted = "#94a3b8";
    const textColor = "#f1f5f9";
    const bgWidget = "#090d16";
    const border = "#1e293b";
    const gridColor = "rgba(255, 255, 255, 0.05)";

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
  }, [chartHistory, range, currency, hideValues]);

  return (
    <div className="cx-card p-4 sm:p-5 font-mono h-full flex flex-col justify-between w-full max-w-full min-w-0 overflow-hidden">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 min-w-0">
              <TrendingUp className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="truncate">Portfolio Performance History</span>
            </div>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate" title="Historical portfolio value vs. invested basis & return %">
              Historical portfolio value vs. invested basis & return %
            </p>
          </div>

          <div className="hidden lg:flex items-center gap-3 text-[10px] text-slate-400 ml-2 pl-3 border-l border-slate-800">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 border-t border-dashed border-[#A7E2C0] inline-block" />
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
              <span>Return %</span>
            </span>
          </div>
        </div>

        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs font-mono self-stretch sm:self-auto justify-center">
          {(["1m", "3m", "6m", "1y", "all"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
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

      <div className="h-[280px] w-full flex-1">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

