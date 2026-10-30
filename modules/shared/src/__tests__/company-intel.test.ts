/** Score descriptions at their band edges, analyst consensus bands and the intel part lists. */
import { describe, expect, it } from "bun:test";
import { COMPANY_INTEL_PARTS, FUND_INTEL_PARTS, consensusFromCounts, describeAltmanZ, describePiotroski } from "../company-intel";

const cc = (a: number[]) => consensusFromCounts({ strongBuy: a[0]!, buy: a[1]!, hold: a[2]!, sell: a[3]!, strongSell: a[4]! });

describe("describePiotroski", () => {
  it("bands at 4 and 7", () => {
    expect(describePiotroski(3)).toMatchObject({ label: "Weak", tone: "bad" });
    expect(describePiotroski(4)).toMatchObject({ label: "Average", tone: "neutral" });
    expect(describePiotroski(6).label).toBe("Average");
    expect(describePiotroski(7)).toMatchObject({ label: "Strong", tone: "good" });
  });

  it("explains the score", () => {
    expect(describePiotroski(0).explanation).toBe("Only 0 of 9 checks on profit, debt and efficiency pass. Fundamentals are weakening.");
    expect(describePiotroski(9).explanation).toBe("9 of 9 checks on profit, debt and efficiency pass. Fundamentals are improving.");
    expect(describePiotroski(4).explanation).toBe("4 of 9 checks on profit, debt and efficiency pass. Mixed fundamentals.");
  });
});

describe("describeAltmanZ", () => {
  it("bands at 1.8 and 3", () => {
    expect(describeAltmanZ(1.79).label).toBe("Distress zone");
    expect(describeAltmanZ(1.8).label).toBe("Grey zone");
    expect(describeAltmanZ(2.99).label).toBe("Grey zone");
    expect(describeAltmanZ(3)).toEqual({
      label: "Safe zone",
      tone: "good",
      explanation: "Above 3: low risk of financial distress in the next two years.",
    });
    expect(describeAltmanZ(-1)).toMatchObject({ label: "Distress zone", tone: "bad" });
  });
});

describe("consensusFromCounts", () => {
  it("maps the weighted mean to bands, edges inclusive", () => {
    expect(cc([1, 0, 0, 0, 0])).toBe("Strong Buy");
    expect(cc([1, 1, 0, 0, 0])).toBe("Strong Buy");
    expect(cc([0, 1, 0, 0, 0])).toBe("Buy");
    expect(cc([1, 0, 1, 0, 0])).toBe("Buy");
    expect(cc([0, 0, 1, 0, 0])).toBe("Hold");
    expect(cc([0, 0, 1, 1, 0])).toBe("Hold");
    expect(cc([0, 0, 0, 1, 0])).toBe("Sell");
    expect(cc([0, 0, 0, 1, 1])).toBe("Sell");
    expect(cc([0, 0, 0, 0, 1])).toBe("Strong Sell");
  });

  it("returns undefined for a non-positive total", () => {
    expect(cc([0, 0, 0, 0, 0])).toBeUndefined();
    expect(cc([-1, 0, 0, 0, 0])).toBeUndefined();
  });
});

describe("intel parts", () => {
  it("lists company and fund parts", () => {
    expect([...COMPANY_INTEL_PARTS]).toEqual([
      "profile",
      "analyst",
      "estimates",
      "scores",
      "dcf",
      "metrics",
      "insider",
      "press",
      "news",
      "peers",
      "transcript",
    ]);
    expect([...FUND_INTEL_PARTS]).toEqual(["profile", "news"]);
    for (const p of FUND_INTEL_PARTS) expect(COMPANY_INTEL_PARTS).toContain(p);
    expect(new Set(COMPANY_INTEL_PARTS).size).toBe(COMPANY_INTEL_PARTS.length);
    expect(new Set(FUND_INTEL_PARTS).size).toBe(FUND_INTEL_PARTS.length);
  });
});
