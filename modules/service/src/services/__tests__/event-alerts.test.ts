/** Event alerts: schedule, window, message text, sent-alert de-duplication and the run flow. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, setSystemTime } from "bun:test";
import { isAlertDue, nextAlertRun, alertWindowEnd, isAlertEvent, alertKey, formatAlertMessage, EventAlertsService } from "../event-alerts.js";
import * as sentAlerts from "../../db/sent-alerts.repo.js";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import { getDatabase } from "../../db/database.js";
import { loadConfig, updateConfig } from "../../config.js";
import type { IncomeService } from "../income.js";
import type { PortfolioEvent, PortfolioEventsResponse } from "portfolio-shared/api-types";

const ev = (p: Partial<PortfolioEvent>): PortfolioEvent => ({ date: "2026-10-30", kind: "earnings", symbol: "AAPL", name: "Apple Inc", source: "fmp", ...p }) as PortfolioEvent;
const at = (s: string) => new Date(s);
const clearSent = () => getDatabase().run("DELETE FROM kv_entries WHERE key LIKE 'sent-alert:%'");

describe("schedule", () => {
  const cfg = { eventAlertsEnabled: true, eventAlertsTime: "18:00" };

  it("is due from the set time on", () => {
    expect(isAlertDue(cfg, at("2026-10-29T17:59:00"))).toBe(false);
    expect(isAlertDue(cfg, at("2026-10-29T18:00:00"))).toBe(true);
    expect(isAlertDue(cfg, at("2026-10-29T23:59:00"))).toBe(true);
  });

  it("runs once a day", () => {
    expect(isAlertDue({ ...cfg, eventAlertsLastRun: "2026-10-29" }, at("2026-10-29T19:00:00"))).toBe(false);
    expect(isAlertDue({ ...cfg, eventAlertsLastRun: "2026-10-28" }, at("2026-10-29T19:00:00"))).toBe(true);
  });

  it("never runs while switched off", () => {
    const off = { ...cfg, eventAlertsEnabled: false };
    expect(isAlertDue(off, at("2026-10-29T19:00:00"))).toBe(false);
    expect(nextAlertRun(off, at("2026-10-29T19:00:00"))).toBeUndefined();
  });

  it("finds the slot later today", () => {
    const next = nextAlertRun(cfg, at("2026-10-29T17:00:00"));
    expect(new Date(next!).getTime()).toBe(at("2026-10-29T18:00:00").getTime());
  });

  it("moves to tomorrow after today's run", () => {
    const last = { ...cfg, eventAlertsLastRun: "2026-10-29" };
    expect(new Date(nextAlertRun(last, at("2026-10-29T19:00:00"))!).getTime()).toBe(at("2026-10-30T18:00:00").getTime());
    expect(new Date(nextAlertRun(last, at("2026-10-29T10:00:00"))!).getTime()).toBe(at("2026-10-30T18:00:00").getTime());
  });

  it("returns now when due", () => {
    const now = at("2026-10-29T19:00:00");
    expect(nextAlertRun(cfg, now)).toBe(now.toISOString());
  });
});

describe("alertWindowEnd", () => {
  it("reaches the next trading day", () => {
    expect(alertWindowEnd("2026-10-29")).toBe("2026-10-30");
    expect(alertWindowEnd("2026-10-30")).toBe("2026-11-02");
    expect(alertWindowEnd("2026-10-31")).toBe("2026-11-02");
    expect(alertWindowEnd("2026-11-01")).toBe("2026-11-02");
    expect(alertWindowEnd("2026-12-31")).toBe("2027-01-01");
    expect(alertWindowEnd("2026-02-27")).toBe("2026-03-02");
  });
});

describe("isAlertEvent / alertKey", () => {
  it("keeps confirmed ex-dividend dates and all earnings", () => {
    expect(isAlertEvent(ev({ kind: "exDividend" }))).toBe(true);
    expect(isAlertEvent(ev({ kind: "exDividend", estimated: true }))).toBe(false);
    expect(isAlertEvent(ev({ kind: "earnings" }))).toBe(true);
    expect(isAlertEvent(ev({ kind: "earnings", estimated: true }))).toBe(true);
    expect(isAlertEvent(ev({ kind: "dividendPayment" }))).toBe(false);
    expect(isAlertEvent(ev({ kind: "split" }))).toBe(false);
  });

  it("keys by kind, symbol and date", () => {
    expect(alertKey(ev({ kind: "earnings", symbol: "AAPL", date: "2026-10-30" }))).toBe("earnings:AAPL:2026-10-30");
  });
});

describe("formatAlertMessage", () => {
  beforeAll(() => updateConfig({ language: "en" }));

  const events = [
    ev({ symbol: "AAPL", time: "amc", date: "2026-10-30", epsEstimate: 1.23 }),
    ev({ kind: "exDividend", symbol: "KO", name: "Coca-Cola", date: "2026-10-30", amountPerShare: 0.51, currency: "USD", expectedIncome: 321.09 }),
    ev({ symbol: "MSFT", time: "bmo", date: "2026-11-02" }),
    ev({ symbol: "XYZ", date: "2026-11-02" }),
  ];

  it("lists tickers and dates", () => {
    expect(formatAlertMessage(events, "2026-11-02")).toBe(
      [
        "**Events of your holdings up to Mon 2026-11-02**",
        "- AAPL: earnings report Fri 2026-10-30, after the market closes",
        "- KO: ex-dividend date Fri 2026-10-30",
        "- MSFT: earnings report Mon 2026-11-02, before the market opens",
        "- XYZ: earnings report Mon 2026-11-02",
        "",
        "_Open Portfolio for the income and events overview._",
      ].join("\n"),
    );
  });

  it("leaves out amounts and company names", () => {
    const text = formatAlertMessage(events, "2026-11-02");
    for (const s of ["0.51", "321", "1.23", "Coca-Cola", "Apple"]) expect(text).not.toContain(s);
  });
});

describe("sent-alerts repo", () => {
  beforeEach(clearSent);
  afterEach(() => setSystemTime());

  it("finds nothing for no keys", () => {
    expect(sentAlerts.findSent([]).size).toBe(0);
  });

  it("finds marked keys and stores them with a prefix", () => {
    sentAlerts.markSent(["k1", "k2"], 60_000);
    expect(sentAlerts.findSent(["k1", "k2", "k3"])).toEqual(new Set(["k1", "k2"]));
    expect(getDatabase().query("SELECT key FROM kv_entries WHERE key = ?").get("sent-alert:k1")).not.toBeNull();
  });

  it("ignores expired keys", () => {
    sentAlerts.markSent(["old"], -1000);
    expect(sentAlerts.findSent(["old"]).size).toBe(0);
  });

  it("extends a key when marked again", () => {
    sentAlerts.markSent(["x"], -1000);
    sentAlerts.markSent(["x"], 60_000);
    expect(sentAlerts.findSent(["x"]).has("x")).toBe(true);
  });

  it("expires with the clock", () => {
    setSystemTime(new Date("2026-10-29T12:00:00"));
    sentAlerts.markSent(["t"], 60_000);
    setSystemTime(new Date("2026-10-29T12:02:00"));
    expect(sentAlerts.findSent(["t"]).size).toBe(0);
  });
});

describe("EventAlertsService.run", () => {
  const KEYS = ["eventAlertsPortfolioId", "eventAlertsLastRun", "gotifyUrl", "gotifyToken", "ntfyTopic", "language"] as const;
  let saved: Record<string, unknown> = {};
  let portfolioId = "";
  const originalFetch = globalThis.fetch;
  let fetchCalls: { url: string; init: RequestInit }[] = [];
  let fetchStatus = 200;

  let eventsFor: PortfolioEvent[] = [];
  let incomeError: Error | null = null;
  const calls: { id: string; days: number }[] = [];
  const income = {
    getUpcomingEvents: async (id: string, days: number): Promise<PortfolioEventsResponse> => {
      calls.push({ id, days });
      if (incomeError) throw incomeError;
      return { portfolioId: id, baseCurrency: "EUR", days, from: "2026-10-29", to: "2026-10-30", events: eventsFor, sources: ["fmp"] } as PortfolioEventsResponse;
    },
  } as unknown as IncomeService;

  const defaultEvents = () => [
    ev({ symbol: "AAPL", time: "amc", date: "2026-10-30" }),
    ev({ kind: "exDividend", symbol: "KO", date: "2026-10-30", amountPerShare: 0.51, expectedIncome: 321.09 }),
    ev({ kind: "exDividend", symbol: "PEP", date: "2026-10-30", estimated: true }),
    ev({ symbol: "MSFT", date: "2026-10-29" }),
    ev({ symbol: "NVDA", date: "2026-10-31" }),
    ev({ kind: "dividendPayment", symbol: "KO", date: "2026-10-30" }),
    ev({ symbol: "AAPL", time: "amc", date: "2026-10-30" }),
  ];
  const body = (i = 0) => JSON.parse(String(fetchCalls[i]!.init.body));

  beforeAll(() => {
    const cfg = loadConfig() as unknown as Record<string, unknown>;
    saved = Object.fromEntries(KEYS.map((k) => [k, cfg[k]]));
    portfolioId = portfolioRepo.create({ name: "Alerts Test", baseCurrency: "EUR" }).id;
    updateConfig({ eventAlertsPortfolioId: portfolioId, gotifyUrl: "https://gotify.example.com", gotifyToken: "tok", ntfyTopic: "", language: "en" });
  });

  afterAll(() => {
    updateConfig(saved as Parameters<typeof updateConfig>[0]);
    portfolioRepo.deleteById(portfolioId);
    setSystemTime();
  });

  beforeEach(() => {
    clearSent();
    setSystemTime(new Date("2026-10-29T19:00:00"));
    eventsFor = defaultEvents();
    incomeError = null;
    calls.length = 0;
    fetchCalls = [];
    fetchStatus = 200;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init: init ?? {} });
      return fetchStatus === 200 ? new Response("{}", { status: 200 }) : new Response("x", { status: fetchStatus });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setSystemTime();
  });

  it("sends the next day's confirmed events once", async () => {
    const svc = new EventAlertsService(income);
    const res = await svc.run("manual");
    expect(res).toEqual({ success: true, portfolios: 1, delivered: 1, message: "Sent 2 event(s) through Gotify.", error: undefined });
    expect(calls).toEqual([{ id: portfolioId, days: 1 }]);
    expect(fetchCalls.length).toBe(1);
    const b = body();
    expect(b.title).toBe("Portfolio: upcoming events");
    const text = String(b.message);
    const aapl = "- AAPL: earnings report Fri 2026-10-30, after the market closes";
    const ko = "- KO: ex-dividend date Fri 2026-10-30";
    expect(text).toContain(aapl);
    expect(text).toContain(ko);
    expect(text.indexOf(aapl)).toBeLessThan(text.indexOf(ko));
    expect(text.split(aapl).length - 1).toBe(1);
    for (const s of ["PEP", "MSFT", "NVDA", "0.51", "321"]) expect(text).not.toContain(s);
    expect(sentAlerts.findSent(["earnings:AAPL:2026-10-30", "exDividend:KO:2026-10-30"]).size).toBe(2);
  });

  it("does not send the same events twice", async () => {
    const svc = new EventAlertsService(income);
    await svc.run("manual");
    const res = await svc.run("manual");
    expect(res).toMatchObject({ success: true, portfolios: 1, delivered: 0, message: "Every ex-dividend date and earnings report of the next day was already sent." });
    expect(fetchCalls.length).toBe(1);
  });

  it("sends only a new event on a later run", async () => {
    const svc = new EventAlertsService(income);
    await svc.run("manual");
    eventsFor = [...defaultEvents(), ev({ symbol: "TSLA", date: "2026-10-30" })];
    const res = await svc.run("manual");
    expect(res.message).toBe("Sent 1 event(s) through Gotify.");
    expect(fetchCalls.length).toBe(2);
    const text = String(body(1).message);
    expect(text).toContain("TSLA");
    expect(text).not.toContain("AAPL");
    expect(text).not.toContain("KO");
  });

  it("retries a failed delivery on the next run", async () => {
    const svc = new EventAlertsService(income);
    fetchStatus = 500;
    const res = await svc.run("manual");
    expect(res).toMatchObject({
      success: false,
      delivered: 0,
      message: "The notification failed. The events will be sent on the next run.",
      error: "The Gotify server rejected the message (HTTP 500).",
    });
    expect(sentAlerts.findSent(["earnings:AAPL:2026-10-30", "exDividend:KO:2026-10-30"]).size).toBe(0);
    fetchStatus = 200;
    const again = await svc.run("manual");
    expect(again.delivered).toBe(1);
    expect(again.message).toBe("Sent 2 event(s) through Gotify.");
  });

  it("explains setup when no channel is configured", async () => {
    updateConfig({ gotifyUrl: "", gotifyToken: "" });
    try {
      const res = await new EventAlertsService(income).run("manual");
      expect(res).toMatchObject({
        success: true,
        delivered: 0,
        message: "Found 2 event(s). Set up a phone app under Settings, Notifications to receive them as push notifications.",
      });
      expect(fetchCalls.length).toBe(0);
      expect(sentAlerts.findSent(["earnings:AAPL:2026-10-30", "exDividend:KO:2026-10-30"]).size).toBe(0);
    } finally {
      updateConfig({ gotifyUrl: "https://gotify.example.com", gotifyToken: "tok" });
    }
  });

  it("reports when there are no events", async () => {
    eventsFor = [];
    const res = await new EventAlertsService(income).run("manual");
    expect(res.success).toBe(true);
    expect(res.message).toBe("No ex-dividend dates or earnings reports of held symbols on the next day.");
    expect(fetchCalls.length).toBe(0);
  });

  it("covers the weekend on Friday", async () => {
    setSystemTime(new Date("2026-10-30T19:00:00"));
    eventsFor = [ev({ symbol: "MSFT", date: "2026-11-02", time: "bmo" })];
    await new EventAlertsService(income).run("manual");
    expect(calls[0]!.days).toBe(3);
    const text = String(body().message);
    expect(text).toContain("- MSFT: earnings report Mon 2026-11-02, before the market opens");
    expect(text).toContain("**Events of your holdings up to Mon 2026-11-02**");
  });

  it("reports a failing portfolio by name", async () => {
    incomeError = new Error("boom");
    const res = await new EventAlertsService(income).run("manual");
    expect(res).toMatchObject({ success: false, portfolios: 0, delivered: 0, error: "Alerts Test: boom" });
  });

  it("marks the day only on a scheduled run", async () => {
    await new EventAlertsService(income).run("schedule");
    expect(loadConfig().eventAlertsLastRun).toBe("2026-10-29");
    clearSent();
    updateConfig({ eventAlertsLastRun: "2026-10-01" });
    await new EventAlertsService(income).run("manual");
    expect(loadConfig().eventAlertsLastRun).toBe("2026-10-01");
  });

  it("refuses an overlapping run", async () => {
    const svc = new EventAlertsService(income);
    const a = svc.run("manual");
    const b = await svc.run("manual");
    expect(b).toEqual({ success: false, error: "Event alerts are already running.", portfolios: 0, delivered: 0 });
    expect((await a).success).toBe(true);
  });

  it("reports the last result in the status", async () => {
    const svc = new EventAlertsService(income);
    const res = await svc.run("manual");
    const status = svc.status() as unknown as { lastResult: { trigger: string; message?: string }; channels: string[] };
    expect(status.lastResult.trigger).toBe("manual");
    expect(status.lastResult.message).toBe(res.message);
    expect(status.channels).toEqual(["gotify"]);
  });
});
