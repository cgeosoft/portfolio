import { Summary, Result, Format } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Lifetime commissions and order fees. */
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.totalFees, Format.Currency)
    .text("Lifetime transaction costs")
    .neutral()
    .finish();
}
