/**
 * Small repositories: manual prices, symbol map, installed metrics, sent alerts and market cache extras.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, setDataDirForTests } from "../../paths";
import { getDatabase, closeDatabase } from "../../db/database";
import { saveConfig, type DesktopConfig } from "../../config";
import * as portfolioRepo from "../../db/portfolio.repo";
import * as manualPriceRepo from "../../db/manual-price.repo";
import * as symbolMapRepo from "../../db/symbol-map.repo";
import * as installedMetrics from "../../db/installed-metrics.repo";
import * as sentAlerts from "../../db/sent-alerts.repo";
import * as marketCache from "../../db/market-cache.repo";
import { toJson } from "../../json-cache";

/** Points the service at an empty data dir; `restore()` goes back to the shared one. */
function useFreshDataDir(prefix = "portfolio-iso-"): { dir: string; restore: () => void } {
  const previous = DATA_DIR;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  setDataDirForTests(dir);
  closeDatabase();
  saveConfig({} as DesktopConfig);
  return {
    dir,
    restore: () => {
      closeDatabase();
      setDataDirForTests(previous);
      saveConfig({} as DesktopConfig);
    },
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const cacheKeys = () => (getDatabase().query("SELECT key FROM market_cache ORDER BY key").all() as { key: string }[]).map((r) => r.key);

let env: ReturnType<typeof useFreshDataDir>;
let P: string;
beforeAll(() => {
  env = useFreshDataDir();
  P = portfolioRepo.create({ name: "P" }).id;
});
afterAll(() => env.restore());

describe("manualPriceRepo", () => {
  it("uppercases symbol and currency on write and symbol on lookup", () => {
    const row = manualPriceRepo.upsert({ portfolioId: P, symbol: "pfund", price: 12.5, currency: "usd", setAt: "2026-01-15" });
    expect(row).toEqual({ portfolioId: P, symbol: "PFUND", price: 12.5, currency: "USD", setAt: "2026-01-15" });
    expect(manualPriceRepo.find(P, "Pfund")).toEqual(row);
  });

  it("a second upsert replaces the row", () => {
    manualPriceRepo.upsert({ portfolioId: P, symbol: "PFUND", price: 13, currency: "eur", setAt: "2026-02-01" });
    const rows = manualPriceRepo.findByPortfolio(P).filter((r) => r.symbol === "PFUND");
    expect(rows.length).toBe(1);
    expect(rows[0].price).toBe(13);
    expect(rows[0].currency).toBe("EUR");
    expect(rows[0].setAt).toBe("2026-02-01");
  });

  it("findByPortfolio sorts by symbol", () => {
    for (const s of ["zz", "aa", "mm"]) manualPriceRepo.upsert({ portfolioId: P, symbol: s, price: 1, currency: "EUR", setAt: "2026-01-01" });
    expect(manualPriceRepo.findByPortfolio(P).map((r) => r.symbol)).toEqual(["AA", "MM", "PFUND", "ZZ"]);
  });

  it("remove reports whether a row went", () => {
    expect(manualPriceRepo.remove(P, "aa")).toBe(true);
    expect(manualPriceRepo.remove(P, "aa")).toBe(false);
    expect(manualPriceRepo.find(P, "nothing")).toBeNull();
  });
});

describe("symbolMapRepo", () => {
  const ISIN = "US0378331005";

  it("uppercases isin and symbol", () => {
    symbolMapRepo.upsert({ isin: "us0378331005", symbol: "aapl", source: "auto" });
    const row = symbolMapRepo.findByIsin(ISIN)!;
    expect(row).toMatchObject({ isin: ISIN, symbol: "AAPL", name: null, source: "auto" });
    expect(row.updatedAt).toMatch(ISO);
  });

  it("source precedence: auto never replaces manual", () => {
    symbolMapRepo.upsert({ isin: ISIN, symbol: "AAPL2", source: "auto" });
    expect(symbolMapRepo.findByIsin(ISIN)).toMatchObject({ symbol: "AAPL2", source: "auto" });
    symbolMapRepo.upsert({ isin: ISIN, symbol: "AAPL3", source: "manual" });
    expect(symbolMapRepo.findByIsin(ISIN)).toMatchObject({ symbol: "AAPL3", source: "manual" });
    symbolMapRepo.upsert({ isin: ISIN, symbol: "AAPL4", source: "manual" });
    expect(symbolMapRepo.findByIsin(ISIN)).toMatchObject({ symbol: "AAPL4", source: "manual" });
    symbolMapRepo.upsert({ isin: ISIN, symbol: "AAPL5", source: "auto" });
    expect(symbolMapRepo.findByIsin(ISIN)).toMatchObject({ symbol: "AAPL4", source: "manual" });
  });

  it("findAll sorts by isin and remove is case-insensitive", () => {
    symbolMapRepo.upsert({ isin: "DE0007164600", symbol: "SAP.DE", source: "auto" });
    symbolMapRepo.upsert({ isin: "FR0000120271", symbol: "TTE.PA", source: "auto" });
    expect(symbolMapRepo.findAll().map((r) => r.isin)).toEqual(["DE0007164600", "FR0000120271", ISIN]);
    expect(symbolMapRepo.remove("us0378331005")).toBe(true);
    expect(symbolMapRepo.findByIsin(ISIN)).toBeNull();
  });
});

describe("installedMetrics", () => {
  const base = { id: "m1", version: "1.0.0", source: "url" as const, sourceUrl: "https://example.test/m1.wasm", sha256: "ab", manifestYaml: "id: m1", scopesGranted: '["prices"]', verified: 1 };

  it("upsert inserts then replaces", () => {
    const row = installedMetrics.upsert(base);
    expect(row).toMatchObject(base);
    expect(row.installedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const again = installedMetrics.upsert({ ...base, version: "1.1.0", verified: 0 });
    expect(again.version).toBe("1.1.0");
    expect(again.verified).toBe(0);
    expect(installedMetrics.findAll().filter((r) => r.id === "m1").length).toBe(1);
  });

  it("findAll orders by installedAt; remove reports whether a row went", () => {
    installedMetrics.upsert({ ...base, id: "m2", sourceUrl: null, source: "builtin" });
    const db = getDatabase();
    db.run("UPDATE installed_metrics SET installedAt = ? WHERE id = ?", ["2026-02-01 00:00:00", "m1"]);
    db.run("UPDATE installed_metrics SET installedAt = ? WHERE id = ?", ["2026-01-01 00:00:00", "m2"]);
    expect(installedMetrics.findAll().map((r) => r.id)).toEqual(["m2", "m1"]);
    expect(installedMetrics.remove("m1")).toBe(true);
    expect(installedMetrics.remove("m1")).toBe(false);
    expect(installedMetrics.findById("m1")).toBeNull();
  });
});

describe("sentAlerts", () => {
  it("empty input reads and writes nothing", () => {
    expect(sentAlerts.findSent([])).toEqual(new Set());
    const count = () => (getDatabase().query("SELECT COUNT(*) AS n FROM kv_entries WHERE key LIKE 'sent-alert:%'").get() as { n: number }).n;
    const before = count();
    expect(() => sentAlerts.markSent([], 1000)).not.toThrow();
    expect(count()).toBe(before);
  });

  it("marks keys as sent until they expire", () => {
    sentAlerts.markSent(["div:AAA:2026-01-02", "earn:BBB"], 60_000);
    expect(sentAlerts.findSent(["div:AAA:2026-01-02", "earn:BBB", "other"])).toEqual(new Set(["div:AAA:2026-01-02", "earn:BBB"]));
    const row = getDatabase().query("SELECT value FROM kv_entries WHERE key = ?").get("sent-alert:earn:BBB") as { value: string } | null;
    expect(row).not.toBeNull();
    expect(row!.value).toMatch(ISO);
  });

  it("an already expired mark does not count", () => {
    sentAlerts.markSent(["old"], -1000);
    expect(sentAlerts.findSent(["old"]).size).toBe(0);
  });

  it("a row without expiry counts as sent", () => {
    getDatabase().run("INSERT INTO kv_entries VALUES (?, ?, NULL)", ["sent-alert:forever", "x"]);
    expect(sentAlerts.findSent(["forever"])).toEqual(new Set(["forever"]));
  });
});

describe("marketCache extras", () => {
  it("returns null for a row that is not JSON", () => {
    getDatabase().run("INSERT INTO market_cache VALUES (?, ?, ?, ?)", ["bad:json", "not json", "2026-01-01T00:00:00.000Z", Date.now() + 60_000]);
    let got: unknown;
    expect(() => {
      got = marketCache.get("bad:json");
    }).not.toThrow();
    expect(got).toBeNull();
  });

  it("clearMarketData removes only market data keys", () => {
    getDatabase().run("DELETE FROM market_cache");
    for (const k of ["quote:A", "chart:A", "fx:EUR", "finnhub:x", "yahoo:x", "fmp:x", "portfolio:p1:EUR", "intel:x"]) marketCache.set(k, { v: 1 }, 60_000);
    expect(marketCache.clearMarketData()).toBe(6);
    expect(cacheKeys()).toEqual(["intel:x", "portfolio:p1:EUR"]);
  });

  it("deleteByPrefix matches the exact key and key-colon children only", () => {
    getDatabase().run("DELETE FROM market_cache");
    for (const k of ["portfolio:abc", "portfolio:abc:EUR", "portfolio:abd", "portfolio:ab"]) marketCache.set(k, { v: 1 }, 60_000);
    expect(marketCache.deleteByPrefix("portfolio:abc")).toBe(2);
    expect(cacheKeys()).toEqual(["portfolio:ab", "portfolio:abd"]);
    expect(marketCache.deleteByPrefix("")).toBe(0);
  });

  it("keepJson returns the stored JSON text untouched", () => {
    getDatabase().run("INSERT INTO market_cache VALUES (?, ?, ?, ?)", ["k:json", '{"a": 1}', "2026-01-01T00:00:00.000Z", Date.now() + 60_000]);
    const e = marketCache.get<{ a: number }>("k:json", { keepJson: true })!;
    expect(toJson(e.data)).toBe('{"a": 1}');
    expect(toJson(marketCache.get("k:json")!.data)).toBe('{"a":1}');
  });
});
