import { Summary, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Profit or loss locked in by sells, colored by its sign. */
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.realizedPnL, Format.Currency, Sign.Always)
    .text("Closed position result")
    .auto()
    .finish();
}
