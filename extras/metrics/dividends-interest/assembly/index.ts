import { Summary, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Dividends plus interest, always shown as income. */
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.totalDividends + s.totalInterest, Format.Currency, Sign.Always)
    .text("Dividends ")
    .amount(s.totalDividends, Format.Currency)
    .text(" | Interest ")
    .amount(s.totalInterest, Format.Currency)
    .positive()
    .finish();
}
