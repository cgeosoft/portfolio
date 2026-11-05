/** ISO week keys of stored reports. */
import { describe, it, expect } from "bun:test";
import { getIsoWeekKey } from "../portfolio-report";

describe("getIsoWeekKey", () => {
  it("numbers weeks by ISO 8601 across year ends", () => {
    expect(getIsoWeekKey(new Date(2026, 9, 3))).toBe("2026-w40");
    expect(getIsoWeekKey(new Date(2027, 0, 3))).toBe("2026-w53");
  });
});
