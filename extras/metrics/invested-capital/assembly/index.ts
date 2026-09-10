import { Summary, Result, Format } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Net deposits: the principal the owner moved into the portfolio. */
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.totalCashInjected, Format.Currency)
    .text("Net deposits since inception")
    .finish();
}
