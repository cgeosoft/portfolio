import { Holdings, Fundamentals, AssetType, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Value-weighted Piotroski F-score and the share of value in strong names (7+). */
export function metric_run(ptr: i32, len: i32): i32 {
  const holdings = new Holdings(ptr, len);
  const fundamentals = new Fundamentals(ptr, len);
  let covered: f64 = 0;
  let weighted: f64 = 0;
  let strong: f64 = 0;
  for (let i = 0; i < holdings.count; i++) {
    const h = holdings.at(i);
    const value = h.currentValue;
    if (value <= 0 || h.assetType == AssetType.Cash) continue;
    const f = fundamentals.find(h.symbol);
    if (f) {
      const score = f.piotroski;
      if (!isNaN(score)) {
        covered += value;
        weighted += value * score;
        if (score >= 7) strong += value;
      }
    }
  }
  if (covered <= 0) {
    return new Result().value(0, Format.Number).text("No scores for your holdings").neutral().finish();
  }
  const score = weighted / covered;
  const result = new Result()
    .value(score, Format.Number)
    .text("of 9, ")
    .amount((strong / covered) * 100, Format.Percent, Sign.Never)
    .text(" in strong names");
  if (score >= 7) return result.positive().finish();
  if (score < 4) return result.negative().finish();
  return result.neutral().finish();
}
