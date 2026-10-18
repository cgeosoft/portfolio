import { useEffect, useRef } from "react";
import {
  ArcElement,
  Chart,
  type ChartConfiguration,
  DoughnutController,
  Tooltip,
} from "chart.js";
import type { PortfolioHolding, PortfolioSummary } from "portfolio-shared/portfolio";
import type { AppTheme } from "portfolio-shared/api-types";
import { fmtCurrency, fmtPercent } from "./utils";
import { hasCompanyIntel, openHolding } from "./holding-links";
import { PieChart } from "lucide-react";
import { t } from "../../i18n";

Chart.register(DoughnutController, ArcElement, Tooltip);

interface AllocationCardProps {
  summary: PortfolioSummary;
  holdings: PortfolioHolding[];
  currency?: string;
  hideValues?: boolean;
  theme?: AppTheme;
}

interface CategorySummary {
  name: string;
  type: string;
  value: number;
  weight: number;
  count: number;
  color: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  Stock: "#243C8F", // Royal Blue
  ETF: "#341B83", // Deep Indigo
  Crypto: "#DD3C73", // Rose / Pink
  Cash: "#A7E2C0", // Mint
  Other: "#E3EACD", // Pale Sage
};

const CATEGORY_PALETTES: Record<string, string[]> = {
  Stock: ["#243C8F", "#3b5fc7", "#597dec", "#7898f5", "#1b2e6e", "#324ca8", "#4e6bd4", "#6582e8"],
  ETF: ["#341B83", "#4e29c2", "#673be0", "#865ef5", "#24135e", "#41219e", "#5a32cc", "#7c55e8"],
  Crypto: ["#DD3C73", "#e65f8e", "#ee84aa", "#f5abc5", "#b32053", "#c72d65", "#da4b81", "#e8729c"],
  Cash: ["#A7E2C0", "#bdebd2", "#8ad9ab", "#6ecf97", "#55b87f", "#3fa56c"],
  Other: ["#E3EACD", "#edf2de", "#d5dfb8", "#c4d39e", "#b0c283", "#9cb16b"],
};

export function AllocationCard({
  summary,
  holdings,
  currency = "EUR",
  hideValues = false,
  theme,
}: AllocationCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const centerRef = useRef<{ label: string; total: string; count: string; textColor: string; textMuted: string } | null>(null);

  // Group holdings into categories
  const stockHoldings: PortfolioHolding[] = [];
  const etfHoldings: PortfolioHolding[] = [];
  const cryptoHoldings: PortfolioHolding[] = [];
  const otherHoldings: PortfolioHolding[] = [];
  const cashHoldings: PortfolioHolding[] = [];

  let cashValFromHoldings = 0;

  for (const h of holdings) {
    if (
      h.assetType === "Cash" ||
      h.symbol === "CASH" ||
      h.symbol?.toUpperCase() === "EUR" ||
      h.symbol?.toUpperCase() === "USD" ||
      h.name?.toLowerCase().includes("liquidity") ||
      h.name?.toLowerCase().includes("cash")
    ) {
      cashValFromHoldings += h.currentValue;
      cashHoldings.push(h);
    } else if (h.assetType === "Crypto" || h.symbol.includes("BTC")) {
      cryptoHoldings.push(h);
    } else if (h.assetType === "ETF" || h.assetType === "MutualFund") {
      etfHoldings.push(h);
    } else if (h.assetType === "Stock") {
      stockHoldings.push(h);
    } else {
      otherHoldings.push(h);
    }
  }

  // Fallback: If cash is not in holdings array but present in summary
  if (cashValFromHoldings === 0 && (summary.cashBalance ?? 0) > 0) {
    const cashVal = summary.cashBalance;
    cashHoldings.push({
      symbol: "CASH",
      name: t("dashboard.availableLiquidity", { currency }),
      assetType: "Cash",
      shares: cashVal,
      buyPrice: 1,
      currentPrice: 1,
      previousClose: 1,
      totalCost: cashVal,
      currentValue: cashVal,
      dayChangeDollar: 0,
      dayChangePercent: 0,
      totalGainLossDollar: 0,
      totalGainLossPercent: 0,
      weightPercent: summary.cashWeightPercent || 0,
      currency,
    });
  }

  const categoryGroups: { type: string; name: string; items: PortfolioHolding[] }[] = [
    { type: "Stock", name: t("dashboard.allocation.categories.stock"), items: stockHoldings },
    { type: "ETF", name: t("dashboard.allocation.categories.etf"), items: etfHoldings },
    { type: "Crypto", name: t("dashboard.allocation.categories.crypto"), items: cryptoHoldings },
    { type: "Other", name: t("dashboard.allocation.categories.otherPrivate"), items: otherHoldings },
    { type: "Cash", name: t("dashboard.allocation.categories.cash"), items: cashHoldings },
  ];

  // Calculate total portfolio value
  let calculatedTotal = 0;
  categoryGroups.forEach((g) => {
    g.items.forEach((h) => {
      calculatedTotal += h.currentValue;
    });
  });

  const totalVal = Math.max(
    1,
    calculatedTotal > 0
      ? calculatedTotal
      : (summary.totalPortfolioValue || summary.totalValue || 1)
  );

  // Prepare Inner Ring Data (Asset Allocation by Category)
  const innerCategories: CategorySummary[] = [];
  // Prepare Outer Ring Data (Granular Holding Weights)
  const outerHoldings: { holding: PortfolioHolding; color: string; categoryName: string }[] = [];

  categoryGroups.forEach((g) => {
    const catVal = g.items.reduce((acc, h) => acc + h.currentValue, 0);
    if (catVal > 0) {
      innerCategories.push({
        type: g.type,
        name: g.name,
        value: catVal,
        weight: (catVal / totalVal) * 100,
        count: g.items.length,
        color: CATEGORY_COLORS[g.type] || "#3b82f6",
      });

      const palette = CATEGORY_PALETTES[g.type] || CATEGORY_PALETTES.Stock!;
      g.items.forEach((h, idx) => {
        outerHoldings.push({
          holding: h,
          color: palette[idx % palette.length]!,
          categoryName: g.name,
        });
      });
    }
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (outerHoldings.length === 0 && innerCategories.length === 0)) {
      chartRef.current?.destroy();
      chartRef.current = null;
      return;
    }

    const isLight = theme === "light" || (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
    const bgWidget = isLight ? "#ffffff" : "#090d16";
    const border = isLight ? "#e2e8f0" : "#1e293b";
    const textColor = isLight ? "#0f172a" : "#f1f5f9";
    const textMuted = isLight ? "#64748b" : "#94a3b8";

    centerRef.current = { label: t("dashboard.allocation.centerLabel"), total: fmtCurrency(totalVal, currency, hideValues), count: t("dashboard.allocation.assetsCount", { count: outerHoldings.length }), textColor, textMuted };

    // Center text plugin to display portfolio value & asset count inside the donut.
    // It reads centerRef, so an updated chart draws the current values with the same plugin.
    const centerTextPlugin = {
      id: "dualDonutCenterText",
      beforeDraw(chart: Chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const cx = (chartArea.left + chartArea.right) / 2;
        const cy = (chartArea.top + chartArea.bottom) / 2;

        const center = centerRef.current;
        if (!center) return;

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Top label
        ctx.font = '600 9px monospace';
        ctx.fillStyle = center.textMuted;
        ctx.fillText(center.label, cx, cy - 13);

        // Middle Value
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = center.textColor;
        ctx.fillText(center.total, cx, cy + 2);

        // Bottom count
        ctx.font = '500 9px monospace';
        ctx.fillStyle = "#DD3C73";
        ctx.fillText(center.count, cx, cy + 17);

        ctx.restore();
      },
    };

    const config: ChartConfiguration<"doughnut"> = {
      type: "doughnut",
      plugins: [centerTextPlugin as any],
      data: {
        datasets: [
          {
            // Outer Ring: Individual Holdings / Weight
            label: t("dashboard.allocation.holdingsWeight"),
            data: outerHoldings.map((o) => o.holding.currentValue),
            backgroundColor: outerHoldings.map((o) => o.color),
            borderColor: bgWidget,
            borderWidth: 2,
            hoverBorderColor: "#f8fafc",
            hoverBorderWidth: 2,
            hoverOffset: 6,
            weight: 1.15,
          },
          {
            // Inner Ring: Asset Allocation by Category
            label: t("dashboard.allocation.assetAllocation"),
            data: innerCategories.map((c) => c.value),
            backgroundColor: innerCategories.map((c) => c.color),
            borderColor: bgWidget,
            borderWidth: 2,
            hoverBorderColor: "#f8fafc",
            hoverBorderWidth: 2,
            hoverOffset: 6,
            weight: 0.85,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "44%",
        animation: {
          duration: 600,
        },
        interaction: {
          mode: "nearest",
          intersect: true,
        },
        // A holding slice on the outer ring opens that holding's details.
        onHover: (event, elements) => {
          const el = elements[0];
          const h = el && el.datasetIndex === 0 ? outerHoldings[el.index]?.holding : undefined;
          const target = event.native?.target;
          if (target instanceof HTMLElement) target.style.cursor = h && hasCompanyIntel(h) ? "pointer" : "default";
        },
        onClick: (_event, elements) => {
          const el = elements[0];
          const h = el && el.datasetIndex === 0 ? outerHoldings[el.index]?.holding : undefined;
          if (h && hasCompanyIntel(h)) openHolding(h.symbol);
        },
        plugins: {
          legend: {
            display: false, // No ledger / legend as requested
          },
          tooltip: {
            backgroundColor: bgWidget,
            borderColor: border,
            borderWidth: 1,
            titleColor: textColor,
            bodyColor: textMuted,
            padding: 12,
            cornerRadius: 8,
            titleFont: { family: "monospace", size: 12, weight: "bold" },
            bodyFont: { family: "monospace", size: 11 },
            callbacks: {
              title: (items) => {
                if (!items.length) return "";
                const item = items[0]!;
                if (item.datasetIndex === 1) {
                  const cat = innerCategories[item.dataIndex];
                  return cat ? t("dashboard.allocation.assetClass", { name: cat.name.toUpperCase() }) : t("dashboard.allocation.assetAllocation");
                }
                const h = outerHoldings[item.dataIndex]?.holding;
                return h ? `${h.symbol} • ${h.name}` : t("dashboard.allocation.holdingWeight");
              },
              label: (item) => {
                const lines: string[] = [];
                const val = Number(item.raw);
                const weightPct = (val / totalVal) * 100;

                if (item.datasetIndex === 1) {
                  // Inner ring: Asset class allocation
                  const cat = innerCategories[item.dataIndex];
                  lines.push(t("dashboard.allocation.allocation", { value: fmtCurrency(val, currency, hideValues) }));
                  lines.push(t("dashboard.allocation.portfolioWeight", { weight: weightPct.toFixed(1) }));
                  if (cat) {
                    lines.push(t("dashboard.allocation.holdingsCount", { count: cat.count }));
                  }
                } else {
                  // Outer ring: Individual holding weight
                  const entry = outerHoldings[item.dataIndex];
                  const h = entry?.holding;
                  if (h) {
                    lines.push(t("dashboard.allocation.category", { name: entry.categoryName }));
                    lines.push(t("dashboard.allocation.currentValue", { value: fmtCurrency(val, currency, hideValues) }));
                    lines.push(t("dashboard.allocation.portfolioWeight", { weight: weightPct.toFixed(1) }));
                    if (h.shares > 0 && h.currentPrice > 0 && h.symbol !== "CASH") {
                      lines.push(
                        t("dashboard.allocation.holdings", {
                          shares: hideValues ? "••••" : h.shares.toLocaleString(),
                          price: fmtCurrency(h.currentPrice, currency, hideValues),
                        })
                      );
                    }
                    if (h.totalGainLossDollar !== 0 && h.symbol !== "CASH") {
                      const sign = h.totalGainLossDollar > 0 ? "+" : "";
                      lines.push(
                        t("dashboard.allocation.totalReturn", {
                          value: `${sign}${fmtCurrency(h.totalGainLossDollar, currency, hideValues)}`,
                          percent: fmtPercent(h.totalGainLossPercent),
                        })
                      );
                    }
                    if (h.dayChangePercent !== 0 && h.symbol !== "CASH") {
                      lines.push(t("dashboard.allocation.dayChange", { percent: fmtPercent(h.dayChangePercent) }));
                    }
                  }
                }
                return lines;
              },
            },
          },
        },
      },
    };

    // Update the existing chart in place: a refresh should not replay the opening animation.
    const chart = chartRef.current;
    if (chart && chart.canvas === canvas) {
      chart.data = config.data;
      chart.options = config.options as any;
      chart.update("none");
      return;
    }
    chart?.destroy();
    chartRef.current = new Chart(canvas, config as any);
  }, [holdings, summary, currency, hideValues, totalVal, theme]);

  useEffect(
    () => () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    },
    []
  );

  return (
    <div className="cx-card p-4 sm:p-5 flex flex-col justify-between font-mono h-full w-full max-w-full min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4 min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 min-w-0">
            <PieChart className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">{t("dashboard.allocation.title")}</span>
          </div>
          <p className="pl-[22px] text-[11px] text-slate-500 font-mono mt-0.5 truncate" title={t("dashboard.allocation.subtitle")}>
            {t("dashboard.allocation.subtitle")}
          </p>
        </div>
      </div>

      {/* Dual Donut Chart Canvas */}
      <div className="h-[280px] w-full flex-1 flex items-center justify-center relative">
        {outerHoldings.length === 0 && innerCategories.length === 0 ? (
          <div className="text-xs text-slate-500 text-center py-12">
            {t("dashboard.allocation.empty")}
          </div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
    </div>
  );
}
