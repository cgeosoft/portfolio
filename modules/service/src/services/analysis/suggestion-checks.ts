/**
 * Checks of Guided Analysis suggestions that do not depend on the model's
 * word: buys that break a constraint of the brief, and buys the sells and the
 * cash of the same answer cannot pay for.
 *
 * Only constraints with a fixed meaning can be checked here. ESG, tax wrapper
 * and free-text constraints stay with the model; so does "no single stocks"
 * for a symbol the portfolio does not hold, whose type the quote does not name.
 */
import type { FinancialPortfolioData, PortfolioBrief } from "portfolio-shared/portfolio";
import type { SuggestionProposal } from "../portfolio-suggestions.js";

/** Rounding room between the sells and the buys, in percentage points. */
const BALANCE_TOLERANCE_PP = 0.5;
/** Yahoo Finance writes crypto pairs as BTC-USD. */
const CRYPTO_PAIR = /^[A-Z0-9]{2,10}-(?:USD|USDT|USDC|EUR|GBP|JPY|CHF|AUD|CAD|BTC|ETH)$/;

const isBuy = (p: SuggestionProposal) => p.action === "increase" || p.action === "open";

function breaksBrief(p: SuggestionProposal, data: FinancialPortfolioData, brief: PortfolioBrief): boolean {
  const constraints = new Set(brief.constraints ?? []);
  const held = (data.holdings ?? []).find((h) => h.symbol.toUpperCase() === p.symbol.toUpperCase());
  const type = (held?.assetType ?? "").toLowerCase();
  if (constraints.has("no_crypto") && (type === "crypto" || CRYPTO_PAIR.test(p.symbol.toUpperCase()))) return true;
  return constraints.has("no_single_stocks") && (type === "stock" || type === "equity");
}

/** The proposals that pass, and how many did not. Sells always pass: they never add to a breach or need funding. */
export function checkProposals(proposals: readonly SuggestionProposal[], data: FinancialPortfolioData, brief: PortfolioBrief): { proposals: SuggestionProposal[]; dropped: number } {
  const allowed = proposals.filter((p) => !isBuy(p) || !breaksBrief(p, data, brief));
  const sold = allowed.filter((p) => !isBuy(p)).reduce((sum, p) => sum + (p.currentWeight - p.targetWeight), 0);
  let budget = sold + Math.max(0, data.summary?.cashWeightPercent ?? 0) + BALANCE_TOLERANCE_PP;
  const refused = new Set<SuggestionProposal>();
  // The most important buys are paid for first.
  for (const p of allowed.filter(isBuy).sort((a, b) => a.priority - b.priority)) {
    const cost = p.targetWeight - p.currentWeight;
    if (cost > budget) refused.add(p);
    else budget -= cost;
  }
  const kept = allowed.filter((p) => !refused.has(p));
  return { proposals: kept, dropped: proposals.length - kept.length };
}
