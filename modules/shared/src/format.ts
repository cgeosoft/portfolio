/** Number formatting shared by the GUI and the metric sandbox tests. */

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

