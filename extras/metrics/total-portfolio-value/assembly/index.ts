import { Summary, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Headline net worth, with the lifetime gain and its percentage as the sub-line. */
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.totalPortfolioValue, Format.Currency)
    .amount(s.totalGainSinceStartDollar, Format.Currency, Sign.Always)
    .text(" (")
    .amount(s.totalGainSinceStartPercent, Format.Percent)
    .text(")")
    .finish();
}
