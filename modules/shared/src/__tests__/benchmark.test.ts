/** relativePerformance edge cases: sorting, invalid closes, rebasing, cash flows and wipe-outs. */
import { describe, expect, it } from "bun:test";
import { relativePerformance, type BenchmarkClose, type BenchmarkValuePoint } from "../benchmark";

const p = (date: string, totalValue: number, totalCost: number): BenchmarkValuePoint => ({ date: `2026-01-${date}`, totalValue, totalCost });
const c = (date: string, close: number): BenchmarkClose => ({ date: `2026-01-${date}`, close });
const finite = (r: ReturnType<typeof relativePerformance>) => r.every((x) => Number.isFinite(x.portfolio) && Number.isFinite(x.benchmark));

describe("relativePerformance", () => {
  it("returns nothing for empty inputs", () => {
    expect(relativePerformance([], [c("01", 10)])).toEqual([]);
    expect(relativePerformance([p("02", 100, 100)], [])).toEqual([]);
  });

  it("returns nothing when every close is invalid", () => {
    expect(relativePerformance([p("02", 100, 100)], [c("01", 0), c("02", NaN)])).toEqual([]);
  });

  it("sorts inputs without mutating them", () => {
    const points = [p("03", 120, 100), p("02", 100, 100)];
    const closes = [c("03", 12), c("01", 10)];
    const r = relativePerformance(points, closes);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ date: "2026-01-02", portfolio: 0, benchmark: 0 });
    expect(r[1]!.date).toBe("2026-01-03");
    expect(r[1]!.portfolio).toBeCloseTo(20, 6);
    expect(r[1]!.benchmark).toBeCloseTo(20, 6);
    expect(points[0]!.date).toBe("2026-01-03");
    expect(closes[0]!.date).toBe("2026-01-03");
    expect(finite(r)).toBe(true);
  });

  it("skips a leading zero value", () => {
    const r = relativePerformance([p("02", 0, 0), p("03", 100, 100), p("04", 110, 100)], [c("01", 10)]);
    expect(r).toHaveLength(2);
    expect(r[0]!.date).toBe("2026-01-03");
    expect(r[1]!.portfolio).toBeCloseTo(10, 6);
    expect(r[1]!.benchmark).toBe(0);
    expect(finite(r)).toBe(true);
  });

  it("rebases at fromDate", () => {
    const r = relativePerformance([p("02", 100, 100), p("03", 150, 100), p("04", 165, 100)], [c("01", 10), c("04", 11)], "2026-01-03");
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ date: "2026-01-03", portfolio: 0, benchmark: 0 });
    expect(r[1]!.date).toBe("2026-01-04");
    expect(r[1]!.portfolio).toBeCloseTo(10, 6);
    expect(r[1]!.benchmark).toBeCloseTo(10, 6);
    expect(finite(r)).toBe(true);
  });

  it("does not count a sale as a loss", () => {
    const r = relativePerformance([p("02", 200, 100), p("03", 100, 50), p("04", 110, 50)], [c("01", 10)]);
    expect(r.map((x) => x.portfolio).slice(0, 2)).toEqual([0, 0]);
    expect(r[2]!.portfolio).toBeCloseTo(10, 6);
    expect(finite(r)).toBe(true);
  });

  it("handles a full exit and re-entry", () => {
    const r = relativePerformance([p("02", 100, 100), p("03", 0, 0), p("04", 50, 50), p("05", 60, 50)], [c("01", 10)]);
    expect(r).toHaveLength(4);
    expect(r.map((x) => x.portfolio).slice(0, 3)).toEqual([0, 0, 0]);
    expect(r[3]!.portfolio).toBeCloseTo(20, 6);
    expect(finite(r)).toBe(true);
  });

  it("ignores a wipe-out step", () => {
    const r = relativePerformance([p("02", 100, 100), p("03", -100, 100)], [c("01", 10)]);
    expect(r.map((x) => x.portfolio)).toEqual([0, 0]);
    expect(finite(r)).toBe(true);
  });
});
