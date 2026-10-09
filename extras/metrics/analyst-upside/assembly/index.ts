import { Holdings, Fundamentals, AssetType, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Value-weighted upside to the consensus price target. */
export function metric_run(ptr: i32, len: i32): i32 {
  const holdings = new Holdings(ptr, len);
  const fundamentals = new Fundamentals(ptr, len);
  let total: f64 = 0;
  let covered: f64 = 0;
  let weighted: f64 = 0;
  let names: i32 = 0;
  for (let i = 0; i < holdings.count; i++) {
    const h = holdings.at(i);
    const value = h.currentValue;
    if (value <= 0 || h.assetType == AssetType.Cash) continue;
    total += value;
    const f = fundamentals.find(h.symbol);
    if (f) {
      const upside = f.targetUpside;
      if (!isNaN(upside)) {
        covered += value;
        weighted += value * upside;
        names++;
      }
    }
  }
  if (covered <= 0) {
    return new Result().value(0, Format.Percent).text("No analyst targets for your holdings").neutral().finish();
  }
  return new Result()
    .value((weighted / covered) * 100, Format.Percent, Sign.Always)
    .text("To consensus targets, ")
    .amount(<f64>names, Format.Number)
    .text(names == 1 ? " stock" : " stocks")
    .auto()
    .finish();
}
