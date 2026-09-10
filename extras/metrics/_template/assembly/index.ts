// Starter metric module. Rename the directory, edit manifest.yml, and replace
// the body of metric_run. The two re-exports below are required by the host.
import { Summary, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/**
 * Called by the host with the input payload. Read only the scopes your
 * manifest requests (Summary, Holdings, Transactions, History) and return a
 * Result. The host formats the numbers, applies the currency, and masks the
 * values in privacy mode.
 */
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  const netIncome = s.totalDividends + s.totalInterest - s.totalFees - s.totalTaxes;
  return new Result()
    .value(netIncome, Format.Currency, Sign.Always)
    .text("Income after fees and taxes")
    .auto()
    .finish();
}
