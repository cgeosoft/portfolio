export function fmtCurrency(amount: number | undefined, currency = "EUR", hideValues = false): string {
  if (amount === undefined || isNaN(amount)) return currency === "USD" ? "$0.00" : currency === "GBP" ? "£0.00" : currency === "CHF" ? "Fr 0.00" : "€0.00";
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "CHF" ? "Fr " : "€";
  if (hideValues) {
    return `${symbol}••••`;
  }
  return `${symbol}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatMoney(val: number | undefined, currency = "EUR", maxDecimals = 2, hideValues = false): string {
  if (hideValues) return fmtCurrency(val, currency, true);
  if (val === undefined || isNaN(val)) return `€0.00`;
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "CHF" ? "Fr " : "€";
  const minDecimals = Math.min(2, maxDecimals);
  return `${symbol}${val.toLocaleString("en-US", { minimumFractionDigits: minDecimals, maximumFractionDigits: maxDecimals })}`;
}

export function fmtPercent(percent: number | undefined): string {
  if (percent === undefined || isNaN(percent)) return "0.00%";
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

export function getDeltaColorClass(val: number | undefined): string {
  if (val === undefined || isNaN(val) || Math.abs(val) < 0.001) return "text-slate-400";
  return val > 0 ? "text-[#A7E2C0]" : "text-[#DD3C73]";
}

export function getAssetTypeBadgeClass(assetType: string): string {
  switch (assetType) {
    case "Stock":
      return "bg-[#243C8F]/20 text-[#7392fa] border-[#243C8F]/40";
    case "ETF":
    case "Fund":
      return "bg-[#341B83]/25 text-[#ab97f7] border-[#341B83]/50";
    case "Crypto":
      return "bg-[#DD3C73]/15 text-[#DD3C73] border-[#DD3C73]/30";
    case "Cash":
      return "bg-[#A7E2C0]/15 text-[#A7E2C0] border-[#A7E2C0]/30";
    case "Private":
    case "Other":
      return "bg-[#E3EACD]/15 text-[#E3EACD] border-[#E3EACD]/30";
    default:
      return "bg-slate-500/10 text-slate-400 border-slate-500/20";
  }
}

export function getRsiZone(rsi?: number): { label: string; color: string; bgClass: string; textClass: string; borderClass: string } {
  if (rsi === undefined || isNaN(rsi)) {
    return { label: "N/A", color: "text-slate-500", bgClass: "bg-slate-500/10", textClass: "text-slate-400", borderClass: "border-slate-500/20" };
  }
  if (rsi >= 70) {
    return { label: "OVERBOUGHT", color: "text-[#DD3C73]", bgClass: "bg-[#DD3C73]/10", textClass: "text-[#DD3C73]", borderClass: "border-[#DD3C73]/20" };
  }
  if (rsi <= 30) {
    return { label: "OVERSOLD", color: "text-[#A7E2C0]", bgClass: "bg-[#A7E2C0]/10", textClass: "text-[#A7E2C0]", borderClass: "border-[#A7E2C0]/20" };
  }
  return { label: "NEUTRAL", color: "text-[#E3EACD]", bgClass: "bg-[#E3EACD]/10", textClass: "text-[#E3EACD]", borderClass: "border-[#E3EACD]/20" };
}

export function cleanThinkTags(text: string | undefined, isReport = false): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Remove all complete <think>...</think> blocks
  cleaned = cleaned.replace(/<think\b[^>]*>[\s\S]*?<\/think\b[^>]*>/gi, "");

  // 2. If an orphaned closing </think> tag exists, everything up to and including </think> is thinking content
  if (/<\/think\b[^>]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/^[\s\S]*?<\/think\b[^>]*>\s*/i, "");
  }

  // 3. If an unclosed <think> tag remains:
  if (/<think\b[^>]*>/i.test(cleaned)) {
    const match = cleaned.match(/<think\b[^>]*>[\s\S]*?(?=(?:^|\n)(?:#+|1\.\s+\*\*))/i);
    if (match) {
      cleaned = cleaned.replace(/<think\b[^>]*>[\s\S]*?(?=(?:^|\n)(?:#+|1\.\s+\*\*))/i, "");
    } else {
      cleaned = cleaned.replace(/<think\b[^>]*>/gi, "");
    }
  }

  // 4. Remove any remaining isolated <think> or </think> tags
  cleaned = cleaned.replace(/<\/?think\b[^>]*>/gi, "");

  cleaned = cleaned.trim();

  // 5. If leading garbage/CJK artifact exists before the first header "#" or "1." in reports, strip it
  if (isReport && !cleaned.startsWith("#") && !cleaned.startsWith("1.")) {
    const headerIdx = cleaned.search(/(?:^|\n)(?:#+|1\.\s+\*\*)/);
    if (headerIdx > 0) {
      const prefix = cleaned.slice(0, headerIdx).trim();
      if (prefix.length < 100 && !prefix.includes("\n\n")) {
        cleaned = cleaned.slice(headerIdx).trim();
      }
    }
  }

  return cleaned.trim();
}

/** Format ISO timestamp to relative time string ("x ago") */
export function formatTimeAgo(isoString?: string | null): string {
  if (!isoString) return "never";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0 || isNaN(diffMs)) return "just now";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears}y ago`;
}

/**
 * Mask financial values in unstructured text and markdown for privacy mode.
 * Preserves percentages, dates, and technical indicators.
 */
export function maskFinancialValues(text: string | undefined): string {
  if (!text) return "";
  let result = text;
  // 1. Preceding currency symbols: $1,234.56, €50,000, +$100, -$50.20, £50k, € 100
  result = result.replace(/([+$−-]?\s*[$€£¥])\s*[\d,]+(?:\.\d+)?(?:\s*[kKmMbBtT]\b)?/g, "$1••••");
  // 2. Trailing currency symbols: 1234.56 €, 500 $
  result = result.replace(/([+$−-]?\s*)[\d,]+(?:\.\d+)?\s*([$€£¥])/g, "$1•••• $2");
  // 3. Preceding currency code and amounts: EUR12,345.67, USD 50,000, EUR: 1,800, Val: EUR1800
  result = result.replace(/\b(USD|EUR|GBP|CHF|CAD|AUD|JPY)\s*([:=]?)\s*[+$−-]?\s*[\d,]+(?:\.\d+)?(?:\s*[kKmMbBtT]\b)?/g, "$1$2 ••••");
  // 4. Amounts followed by currency code: 150.00 USD, 1,200 EUR
  result = result.replace(/([+$−-]?\s*)[\d,]+(?:\.\d+)?\s*(USD|EUR|GBP|CHF|CAD|AUD|JPY)\b/g, "$1•••• $2");
  // 5. Swiss Franc: Fr 1,200.50 or Fr. 500
  result = result.replace(/\b(Fr\.?)\s*[+$−-]?\s*[\d,]+(?:\.\d+)?/g, "$1 ••••");
  // 6. Price expressions: @ 150.25, @ $150
  result = result.replace(/(@\s*(?:[$€£¥]|(?:USD|EUR|GBP|CHF)\s*)?)\s*[\d,]+(?:\.\d+)?/g, "$1••••");
  // 7. Valuation and balance phrases: e.g. "portfolio value of 15000"
  result = result.replace(/\b(valuation|balance|cost basis|market value|portfolio value)\s*(?:of|is|stands at)?\s*[:=]?\s*([+$−-]?)\s*[\d,]+(?:\.\d+)?/gi, "$1 $2••••");
  return result;
}

/**
 * Reload the application page.
 */
export function reloadPage(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}




