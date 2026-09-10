import { Summary, Result, Format } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Lifetime tax deducted at the source. */
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.totalTaxes, Format.Currency)
    .text("Lifetime tax deductions")
    .neutral()
    .finish();
}
