import { Holdings, Fundamentals, AssetType, Result, Format } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Market-value-weighted beta of the holdings that have one. */
export function metric_run(ptr: i32, len: i32): i32 {
  const holdings = new Holdings(ptr, len);
  const fundamentals = new Fundamentals(ptr, len);
  let total: f64 = 0;
  let covered: f64 = 0;
  let weighted: f64 = 0;
  for (let i = 0; i < holdings.count; i++) {
    const h = holdings.at(i);
    const value = h.currentValue;
    if (value <= 0 || h.assetType == AssetType.Cash) continue;
    total += value;
    const f = fundamentals.find(h.symbol);
    if (f) {
      const beta = f.beta;
      if (!isNaN(beta)) {
        covered += value;
        weighted += value * beta;
      }
    }
  }
  if (covered <= 0) {
    return new Result().value(0, Format.Number).text("No beta data for your holdings").neutral().finish();
  }
  const beta = weighted / covered;
  return new Result()
    .value(beta, Format.Number)
    .text(beta >= 1.0 ? "More volatile than the market, " : "Calmer than the market, ")
    .amount(Math.round((covered / total) * 100), Format.Number)
    .text("% covered")
    .neutral()
    .finish();
}
