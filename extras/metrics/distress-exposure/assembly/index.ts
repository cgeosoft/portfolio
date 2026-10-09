import { Holdings, Fundamentals, AssetType, Result, Format, Sign } from "../../_sdk/portfolio";
export { metric_abi_version, metric_alloc } from "../../_sdk/portfolio";

/** Altman Z below this value is the distress zone. */
const DISTRESS_Z: f64 = 1.8;

/** Share of scored stock value in the Altman Z distress zone. */
export function metric_run(ptr: i32, len: i32): i32 {
  const holdings = new Holdings(ptr, len);
  const fundamentals = new Fundamentals(ptr, len);
  let covered: f64 = 0;
  let distressed: f64 = 0;
  let names: i32 = 0;
  for (let i = 0; i < holdings.count; i++) {
    const h = holdings.at(i);
    const value = h.currentValue;
    if (value <= 0 || h.assetType == AssetType.Cash) continue;
    const f = fundamentals.find(h.symbol);
    if (f) {
      const z = f.altmanZ;
      if (!isNaN(z)) {
        covered += value;
        if (z < DISTRESS_Z) {
          distressed += value;
          names++;
        }
      }
    }
  }
  if (covered <= 0) {
    return new Result().value(0, Format.Percent, Sign.Never).text("No scores for your holdings").neutral().finish();
  }
  const result = new Result()
    .value((distressed / covered) * 100, Format.Percent, Sign.Never)
    .amount(<f64>names, Format.Number)
    .text(names == 1 ? " stock below Altman Z 1.8" : " stocks below Altman Z 1.8");
  return names > 0 ? result.negative().finish() : result.positive().finish();
}
