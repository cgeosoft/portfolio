import { Holdings, Fundamentals, AssetType, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Weighted harmonic mean of the trailing P/E of profitable holdings. */
export function metric_run(ptr: i32, len: i32): i32 {
  const holdings = new Holdings(ptr, len);
  const fundamentals = new Fundamentals(ptr, len);
  let total: f64 = 0;
  let covered: f64 = 0;
  let earnings: f64 = 0;
  for (let i = 0; i < holdings.count; i++) {
    const h = holdings.at(i);
    const value = h.currentValue;
    if (value <= 0 || h.assetType == AssetType.Cash) continue;
    total += value;
    const f = fundamentals.find(h.symbol);
    if (f) {
      const pe = f.peRatio;
      if (!isNaN(pe) && pe > 0) {
        covered += value;
        earnings += value / pe;
      }
    }
  }
  if (earnings <= 0) {
    return new Result().value(0, Format.Number).text("No P/E data for your holdings").neutral().finish();
  }
  const pe = covered / earnings;
  return new Result()
    .value(pe, Format.Number)
    .text("Earnings yield ")
    .amount((earnings / covered) * 100, Format.Percent, Sign.Never)
    .text(", ")
    .amount(Math.round((covered / total) * 100), Format.Number)
    .text("% covered")
    .neutral()
    .finish();
}
