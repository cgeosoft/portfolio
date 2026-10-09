import { Holdings, Fundamentals, AssetType, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Value-weighted trailing dividend yield and the yearly income it implies. */
export function metric_run(ptr: i32, len: i32): i32 {
  const holdings = new Holdings(ptr, len);
  const fundamentals = new Fundamentals(ptr, len);
  let total: f64 = 0;
  let covered: f64 = 0;
  let income: f64 = 0;
  for (let i = 0; i < holdings.count; i++) {
    const h = holdings.at(i);
    const value = h.currentValue;
    if (value <= 0 || h.assetType == AssetType.Cash) continue;
    total += value;
    const f = fundamentals.find(h.symbol);
    if (f && !f.isFund) {
      const dy = f.dividendYield;
      covered += value;
      if (!isNaN(dy) && dy > 0) income += value * dy;
    }
  }
  if (covered <= 0) {
    return new Result().value(0, Format.Percent, Sign.Never).text("No dividend data for your holdings").neutral().finish();
  }
  return new Result()
    .value((income / covered) * 100, Format.Percent, Sign.Never)
    .text("About ")
    .amount(income, Format.Currency)
    .text(" a year, ")
    .amount(Math.round((covered / total) * 100), Format.Number)
    .text("% covered")
    .neutral()
    .finish();
}
