/**
 * How prompts and messages name an instrument: "VWCE.DE (Vanguard FTSE All-World UCITS ETF)".
 * The name lets the model write the instrument's name in its answer; the symbol keeps it exact.
 */
export function instrumentLabel(symbol: string, name?: string | null): string {
  const n = name?.trim();
  return n && n.toUpperCase() !== symbol.trim().toUpperCase() ? `${symbol} (${n})` : symbol;
}
