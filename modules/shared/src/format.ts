/** Number formatting shared by the GUI and the metric sandbox tests. */

const numberFormats = new Map<string, Intl.NumberFormat>();

/**
 * One Intl.NumberFormat per locale and digit range. `toLocaleString(locale, options)`
 * builds a new formatter on every call, about 45 times the cost of formatting with a
 * cached one, which dominates tables with thousands of amounts.
 */
export function numberFormat(locale: string, minimumFractionDigits: number, maximumFractionDigits: number): Intl.NumberFormat {
  const key = `${locale}|${minimumFractionDigits}|${maximumFractionDigits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits });
    numberFormats.set(key, format);
  }
  return format;
}

export function fmtCurrency(amount: number | undefined, currency = "EUR", hideValues = false): string {
  if (amount === undefined || isNaN(amount)) return currency === "USD" ? "$0.00" : currency === "GBP" ? "£0.00" : currency === "CHF" ? "Fr 0.00" : "€0.00";
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "CHF" ? "Fr " : "€";
  if (hideValues) {
    return `${symbol}••••`;
  }
  return `${symbol}${numberFormat("en-US", 2, 2).format(amount)}`;
}

export function formatMoney(val: number | undefined, currency = "EUR", maxDecimals = 2, hideValues = false): string {
  if (hideValues) return fmtCurrency(val, currency, true);
  if (val === undefined || isNaN(val)) return `€0.00`;
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "CHF" ? "Fr " : "€";
  const minDecimals = Math.min(2, maxDecimals);
  return `${symbol}${numberFormat("en-US", minDecimals, maxDecimals).format(val)}`;
}

export function fmtPercent(percent: number | undefined): string {
  if (percent === undefined || isNaN(percent)) return "0.00%";
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

