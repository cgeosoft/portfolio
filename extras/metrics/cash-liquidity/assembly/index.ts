import { Summary, Result, Format } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Uninvested cash and its share of the portfolio. */
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.cashBalance, Format.Currency)
    .amount(s.cashWeightPercent, Format.Percent)
    .text(" portfolio allocation")
    .finish();
}
