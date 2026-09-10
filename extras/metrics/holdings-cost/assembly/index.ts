import { Summary, Result, Format } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Cost basis of the open positions, with their market value as the sub-line. */
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.totalCost, Format.Currency)
    .text("Market value ")
    .amount(s.totalValue, Format.Currency)
    .finish();
}
