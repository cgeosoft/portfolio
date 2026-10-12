import { describe, it, expect, afterEach, mock } from "bun:test";
import { FmpService } from "../fmp.js";
import * as marketCache from "../../db/market-cache.repo.js";

/** An FMP client with a key of its own, so the stored settings stay untouched. */
class KeyedFmp extends FmpService {
  override getApiKey(overrideKey?: string): string {
    return overrideKey?.trim() || "test-fmp-key";
  }
}

describe("FmpService.getEodChart", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    marketCache.deleteByPrefix("fmp:/historical-price-eod/");
  });

  it("asks from the first of the month and drops the earlier bars", async () => {
    const asked: URL[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      asked.push(new URL(String(url)));
      return Response.json([
        { symbol: "ZZEOD", date: "2025-10-14", close: 3 },
        { symbol: "ZZEOD", date: "2025-10-13", close: 2 },
        { symbol: "ZZEOD", date: "2025-10-01", close: 1 },
      ]);
    }) as unknown as typeof fetch;

    const fmp = new KeyedFmp("http://fmp.test");
    const bars = await fmp.getEodChart("ZZEOD", { from: "2025-10-13" });
    expect(asked[0]!.searchParams.get("from")).toBe("2025-10-01");
    expect(bars?.map((b) => b.date)).toEqual(["2025-10-13", "2025-10-14"]);

    // Another day of the same month reads the same cache entry.
    const later = await fmp.getEodChart("ZZEOD", { from: "2025-10-14" });
    expect(asked.length).toBe(1);
    expect(later?.map((b) => b.date)).toEqual(["2025-10-14"]);
  });

  it("keeps the exact window when `to` is given", async () => {
    const asked: URL[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      asked.push(new URL(String(url)));
      return Response.json([{ symbol: "ZZEOD2", date: "2025-10-13", close: 2 }]);
    }) as unknown as typeof fetch;

    const bars = await new KeyedFmp("http://fmp.test").getEodChart("ZZEOD2", { from: "2025-10-13", to: "2025-10-20" });
    expect(asked[0]!.searchParams.get("from")).toBe("2025-10-13");
    expect(asked[0]!.searchParams.get("to")).toBe("2025-10-20");
    expect(bars?.map((b) => b.date)).toEqual(["2025-10-13"]);
  });
});
