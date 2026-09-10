import { Summary, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Session change of the open positions, colored by its sign. */
export function metric_run(ptr: i32, len: i32): i32 {
  const s = new Summary(ptr, len);
  return new Result()
    .value(s.dayGainLossDollar, Format.Currency, Sign.Always)
    .amount(s.dayGainLossPercent, Format.Percent)
    .text(" today")
    .auto()
    .finish();
}
