import { jsPDF } from "jspdf";
import type { PortfolioReport } from "../../types/portfolio";
import { fmtCurrency, fmtPercent, cleanThinkTags, maskFinancialValues } from "./utils";

export function getDefaultReportFilename(
  report: PortfolioReport,
  format: "markdown" | "pdf",
  portfolioName?: string
): string {
  const namePart = portfolioName
    ? portfolioName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "")
    : "portfolio";
  const dateKey = report.weekKey || report.period || new Date(report.createdAt).toISOString().split("T")[0];
  const cleanDateKey = String(dateKey).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  const ext = format === "markdown" ? "md" : "pdf";
  return `${namePart}-report-${cleanDateKey || "briefing"}.${ext}`;
}

export function generateReportMarkdown(
  report: PortfolioReport,
  portfolioName?: string,
  hideValues: boolean = false
): string {
  const frontmatter = [
    "---",
    portfolioName ? `portfolio: ${JSON.stringify(portfolioName)}` : null,
    `report_id: ${JSON.stringify(report.id)}`,
    `created_at: ${JSON.stringify(report.createdAt)}`,
    `period: ${JSON.stringify(report.period || "")}`,
    `week_start: ${JSON.stringify(report.weekStartDate || "")}`,
    `week_end: ${JSON.stringify(report.weekEndDate || "")}`,
    `model: ${JSON.stringify(report.model || "")}`,
    `provider: ${JSON.stringify(report.provider || "")}`,
    `status: ${JSON.stringify(report.status || "success")}`,
    report.metrics?.totalPortfolioValue !== undefined
      ? `portfolio_valuation: ${hideValues ? '"******"' : report.metrics.totalPortfolioValue}`
      : null,
    report.metrics?.baseCurrency ? `base_currency: ${JSON.stringify(report.metrics.baseCurrency)}` : null,
    report.metrics?.holdingsCount !== undefined ? `holdings_count: ${report.metrics.holdingsCount}` : null,
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const titleHeader = `# ${report.title || `Portfolio Tactical Briefing (${report.period || report.id})`}\n`;
  const summaryText = report.summary
    ? hideValues
      ? maskFinancialValues(report.summary)
      : report.summary
    : "";
  const summaryBlock = summaryText ? `> **Executive Summary:**\n> ${summaryText}\n\n` : "";

  const rawContent = cleanThinkTags(report.content || "");
  const finalContent = hideValues ? maskFinancialValues(rawContent) : rawContent;

  return `${frontmatter}${titleHeader}\n${summaryBlock}${finalContent}\n`;
}

export async function generateReportPdf(
  report: PortfolioReport,
  portfolioName?: string,
  hideValues: boolean = false
): Promise<Blob> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (requiredHeight: number) => {
    if (y + requiredHeight > pageHeight - margin - 10) {
      doc.addPage();
      y = margin;
    }
  };

  // Header Banner
  doc.setFillColor(21, 29, 48); // Dark card background (#151d30)
  doc.rect(margin, y, contentWidth, 24, "F");

  // Accent Line
  doc.setFillColor(221, 60, 115); // Cyber Pink (#DD3C73)
  doc.rect(margin, y, contentWidth, 1.5, "F");

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const title = report.title || "Weekly Tactical Portfolio Briefing";
  const truncatedTitle = doc.splitTextToSize(title, contentWidth - 10)[0] || title;
  doc.text(truncatedTitle, margin + 5, y + 9);

  // Subtitle
  doc.setTextColor(160, 174, 192);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const subtitle = [
    portfolioName ? `Portfolio: ${portfolioName}` : null,
    report.period ? `Period: ${report.period}` : null,
    report.model ? `Model: ${report.model}` : null,
    `Date: ${new Date(report.createdAt).toLocaleDateString()}`,
  ]
    .filter(Boolean)
    .join("  |  ");
  doc.text(subtitle, margin + 5, y + 17);

  y += 28;

  // Performance Metrics Grid (4 items)
  const baseCurrency = report.metrics?.baseCurrency || "EUR";
  const valStr = fmtCurrency(report.metrics?.totalPortfolioValue, baseCurrency, hideValues);
  const returnPercent = report.metrics?.periodGainLossPercent ?? report.metrics?.weeklyGainLossPercent ?? 0;
  const returnDollar = report.metrics?.periodGainLossDollar ?? report.metrics?.weeklyGainLossDollar;
  const returnStr = `${fmtPercent(returnPercent)} (${returnPercent >= 0 ? "+" : ""}${fmtCurrency(returnDollar, baseCurrency, hideValues)})`;
  const cashStr = fmtCurrency(report.metrics?.cashBalance, baseCurrency, hideValues);
  const holdingsStr = `${report.metrics?.holdingsCount ?? 0} Assets`;

  const metricCards = [
    { label: "PORTFOLIO VALUATION", value: valStr },
    { label: "PERIOD RETURN", value: returnStr },
    { label: "CASH LIQUIDITY", value: cashStr },
    { label: "POSITIONS TRACKED", value: holdingsStr },
  ];

  const colWidth = (contentWidth - 6) / 4;
  metricCards.forEach((card, index) => {
    const cardX = margin + index * (colWidth + 2);
    doc.setFillColor(245, 247, 250);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cardX, y, colWidth, 14, 1.5, 1.5, "FD");

    doc.setTextColor(113, 128, 150);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.text(card.label, cardX + 3, y + 4.5);

    doc.setTextColor(26, 32, 44);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    const splitVal = doc.splitTextToSize(card.value, colWidth - 6);
    doc.text(splitVal[0] || card.value, cardX + 3, y + 10.5);
  });

  y += 18;

  // Executive Summary Box
  const rawSummary = report.summary ? (hideValues ? maskFinancialValues(report.summary) : report.summary) : "";
  if (rawSummary) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    const summaryLines = doc.splitTextToSize(rawSummary, contentWidth - 8);
    const boxHeight = summaryLines.length * 4.2 + 8;

    ensureSpace(boxHeight);

    doc.setFillColor(254, 242, 246); // Light pink tint
    doc.setDrawColor(221, 60, 115);
    doc.roundedRect(margin, y, contentWidth, boxHeight, 1.5, 1.5, "FD");

    doc.setTextColor(221, 60, 115);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("EXECUTIVE SUMMARY", margin + 4, y + 5);

    doc.setTextColor(45, 55, 72);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(summaryLines, margin + 4, y + 9.5);

    y += boxHeight + 4;
  }

  // Markdown Body Processing
  const rawMarkdown = cleanThinkTags(report.content || "");
  const contentToRender = hideValues ? maskFinancialValues(rawMarkdown) : rawMarkdown;
  const lines = contentToRender.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();

    if (!trimmed) {
      y += 2.5;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      ensureSpace(8);
      y += 2;
      doc.setTextColor(45, 55, 72);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text(trimmed.replace(/^###\s+/, ""), margin, y);
      y += 5;
    } else if (trimmed.startsWith("## ")) {
      ensureSpace(10);
      y += 3;
      doc.setTextColor(221, 60, 115);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.text(trimmed.replace(/^##\s+/, ""), margin, y);
      y += 6;
    } else if (trimmed.startsWith("# ")) {
      ensureSpace(12);
      y += 4;
      doc.setTextColor(21, 29, 48);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(trimmed.replace(/^#\s+/, ""), margin, y);
      y += 7;
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      doc.setTextColor(51, 65, 85);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      const itemText = trimmed.replace(/^[-*]\s+/, "");
      const wrapped = doc.splitTextToSize(itemText, contentWidth - 6);
      ensureSpace(wrapped.length * 4 + 1);

      doc.setFillColor(221, 60, 115);
      doc.circle(margin + 2, y - 1, 0.7, "F");
      doc.text(wrapped, margin + 5, y);
      y += wrapped.length * 4 + 1.5;
    } else if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      // Table row: render as monospace clean text
      doc.setTextColor(71, 85, 105);
      doc.setFont("courier", "normal");
      doc.setFontSize(7.5);
      const cleanTableRow = trimmed.replace(/\|/g, "  ").trim();
      const wrapped = doc.splitTextToSize(cleanTableRow, contentWidth);
      ensureSpace(wrapped.length * 3.5);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 3.5;
    } else {
      // Standard paragraph
      doc.setTextColor(51, 65, 85);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      const cleanText = trimmed.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
      const wrapped = doc.splitTextToSize(cleanText, contentWidth);
      ensureSpace(wrapped.length * 4 + 1);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 4 + 2;
    }
  }

  // Page Numbers Footer
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(160, 174, 192);

    // Footer line
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 9, pageWidth - margin, pageHeight - 9);

    doc.text("Portfolio - Tactical Report", margin, pageHeight - 5.5);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin - 15, pageHeight - 5.5);
  }

  return doc.output("blob");
}
