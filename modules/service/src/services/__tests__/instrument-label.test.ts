/** instrumentLabel: ticker with the name in brackets, unless the name adds nothing. */
import { describe, it, expect } from "bun:test";
import { instrumentLabel } from "../instrument-label";

describe("instrumentLabel", () => {
  it("adds a distinct, trimmed name in brackets", () => {
    expect(instrumentLabel("AAPL", "Apple")).toBe("AAPL (Apple)");
    expect(instrumentLabel("VWCE.DE", " Vanguard ")).toBe("VWCE.DE (Vanguard)");
  });

  it("returns the bare ticker when the name is missing, blank or the ticker itself", () => {
    expect(instrumentLabel("AAPL", "aapl")).toBe("AAPL");
    expect(instrumentLabel("AAPL", "  ")).toBe("AAPL");
    expect(instrumentLabel("AAPL", null)).toBe("AAPL");
  });
});
