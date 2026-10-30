/** Portfolio colour: palette and fallbacks for missing, invalid and shared colours. */
import { describe, expect, it } from "bun:test";
import { PORTFOLIO_COLORS, portfolioColor } from "./portfolioColor";

describe("portfolioColor", () => {
  it("falls back to the brand colour without a portfolio", () => {
    expect(portfolioColor(null)).toBe("#dd3c73");
    expect(portfolioColor(undefined)).toBe("#dd3c73");
  });

  it("lower-cases a valid colour", () => {
    expect(portfolioColor({ color: "#ABCDEF" })).toBe("#abcdef");
  });

  it("falls back on invalid colours", () => {
    expect(portfolioColor({ color: "#abc" })).toBe("#dd3c73");
    expect(portfolioColor({ color: "#abc", isShared: true })).toBe("#64748b");
    expect(portfolioColor({ color: "red" })).toBe("#dd3c73");
    expect(portfolioColor({ color: " #abcdef" })).toBe("#dd3c73");
    expect(portfolioColor({ isShared: true })).toBe("#64748b");
  });

  it("offers twelve distinct hex colours", () => {
    expect(PORTFOLIO_COLORS.length).toBe(12);
    expect(PORTFOLIO_COLORS[0]).toBe("#dd3c73");
    expect(PORTFOLIO_COLORS.at(-1)).toBe("#64748b");
    for (const c of PORTFOLIO_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(PORTFOLIO_COLORS).size).toBe(PORTFOLIO_COLORS.length);
  });
});
