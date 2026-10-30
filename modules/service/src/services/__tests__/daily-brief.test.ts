/** Daily brief: prompt content and privacy, the numbers-only fallback, schedule edges and the run flow. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, setSystemTime } from "bun:test";
import { buildDailyBriefPrompt, fallbackBrief, isBriefDue, nextBriefRun, localDate, DailyBriefService } from "../daily-brief.js";
import * as portfolioRepo from "../../db/portfolio.repo.js";
import * as conversationRepo from "../../db/conversation.repo.js";
import { loadConfig, updateConfig } from "../../config.js";
import type { LlmService } from "../llm.js";
import type { PortfolioService } from "../portfolio.js";
import type { AiContextDeps } from "../ai-context.js";
import type { FinancialPortfolioData, PortfolioItem } from "portfolio-shared/portfolio";

const rawData = {
  summary: {
    dayGainLossPercent: 1.234,
    totalGainLossPercent: -5,
    cashWeightPercent: 15,
    bestPerformer: { symbol: "NVDA", changePercent: 3.5 },
    worstPerformer: { symbol: "AAPL", changePercent: -2.25 },
    totalValue: 98765.43,
    totalPortfolioValue: 98765.43,
    cashBalance: 13579.24,
    dayGainLossDollar: 2468.13,
  },
  holdings: [
    { symbol: "NVDA", name: "NVIDIA Corp", assetType: "Stock", shares: 10, dayChangePercent: 3.5, weightPercent: 40, currentValue: 55555.55 },
    { symbol: "AAPL", name: "Apple Inc", assetType: "Stock", shares: 777, dayChangePercent: -2.25, weightPercent: 20, currentValue: 44444.44 },
    { symbol: "SPY", name: "SPY", assetType: "ETF", shares: 3, dayChangePercent: 0.4, weightPercent: 25 },
    { symbol: "FLAT", name: "Flat Co", assetType: "Stock", shares: 1, dayChangePercent: 0, weightPercent: 0.5 },
    { symbol: "MSFT", name: "Microsoft", assetType: "Stock", shares: 0, dayChangePercent: 9, weightPercent: 0 },
    { symbol: "CASH", name: "Cash", assetType: "Cash", shares: 1, dayChangePercent: 0, weightPercent: 15 },
  ],
  transactions: [
    { type: "BUY", symbol: "NVDA", name: "NVIDIA Corp", date: "2026-10-26T10:00:00Z", amount: 123456.78, shares: 777 },
    { type: "BUY", symbol: "NVDA", name: "NVIDIA Corp", date: "2026-10-27T09:00:00Z", amount: 123456.78, shares: 777 },
    { type: "SELL", symbol: "MSFT", date: "2026-10-28", amount: 99.5 },
    { type: "DEPOSIT", date: "2026-10-28T08:00:00Z", amount: 5000 },
    { type: "BUY", symbol: "AAPL", date: "2026-10-29T08:00:00Z" },
  ],
};
const data = rawData as unknown as FinancialPortfolioData;
const emptyData = { summary: {}, holdings: [], transactions: [] } as unknown as FinancialPortfolioData;

const ctx = {
  portfolio: { id: "p1", name: "Growth" } as PortfolioItem,
  data,
  since: "2026-10-27",
  today: "2026-10-29",
  news: ["- NVDA (NVIDIA Corp): Chip demand rises [finnhub]"],
};

const MONEY = ["98765", "13579", "2468", "55555", "44444", "123456", "777", "5000", "99.5"];

beforeAll(() => updateConfig({ language: "en" }));

describe("buildDailyBriefPrompt", () => {
  it("returns a system and a user message", () => {
    const msgs = buildDailyBriefPrompt(ctx);
    expect(msgs.length).toBe(2);
    expect(msgs.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("starts with the date and the holding count", () => {
    const user = buildDailyBriefPrompt(ctx)[1]!.content;
    expect(user.startsWith("Today is 2026-10-29. Write the daily brief.\n\n=== PORTFOLIO ===\nName: Growth\nHoldings: 4\n")).toBe(true);
  });

  it("states returns and performers as percentages", () => {
    const user = buildDailyBriefPrompt(ctx)[1]!.content;
    for (const line of [
      "Last session return of the whole portfolio: +1.23%",
      "Lifetime unrealized return: -5.00%",
      "Cash weight: 15.00%",
      "Best performer of the session: NVDA (NVIDIA Corp) +3.50%",
      "Worst performer of the session: AAPL (Apple Inc) -2.25%",
    ]) {
      expect(user).toContain(line);
    }
  });

  it("lists gainers and decliners", () => {
    const user = buildDailyBriefPrompt(ctx)[1]!.content;
    expect(user).toContain(
      "=== GAINERS OF THE LAST SESSION ===\n- NVDA (NVIDIA Corp): +3.50% on the day, weight 40.00%\n- SPY: +0.40% on the day, weight 25.00%",
    );
    expect(user).toContain("=== DECLINERS OF THE LAST SESSION ===\n- AAPL (Apple Inc): -2.25% on the day, weight 20.00%");
    expect(user).not.toContain("FLAT");
  });

  it("lists transactions since the last brief, without amounts", () => {
    const user = buildDailyBriefPrompt(ctx)[1]!.content;
    expect(user).toContain("=== TRANSACTIONS SINCE 2026-10-27 ===\n- 2026-10-27 [BUY] NVDA (NVIDIA Corp)\n- 2026-10-28 [SELL] MSFT\n- 2026-10-28 [DEPOSIT]");
  });

  it("adds news and no events section without events", () => {
    const user = buildDailyBriefPrompt(ctx)[1]!.content;
    expect(user).toContain("=== NEWS OF THE LARGEST MOVERS ===\n- NVDA (NVIDIA Corp): Chip demand rises [finnhub]");
    expect(user).not.toContain("=== EVENTS");
  });

  it("ends with the events section when given", () => {
    const user = buildDailyBriefPrompt({ ...ctx, events: "- 2026-10-30 AAPL (Apple Inc): earnings report" })[1]!.content;
    expect(user.endsWith("\n\n=== EVENTS OF HELD SYMBOLS TODAY AND TOMORROW ===\n- 2026-10-30 AAPL (Apple Inc): earnings report")).toBe(true);
  });

  it("never contains money amounts", () => {
    for (const m of buildDailyBriefPrompt(ctx)) {
      for (const s of MONEY) expect(m.content).not.toContain(s);
    }
  });

  it("uses Simplified English rules in English", () => {
    const system = buildDailyBriefPrompt(ctx)[0]!.content;
    expect(system).toContain("Use ASD-STE100 Simplified English.");
    expect(system).not.toContain("Write your whole answer in");
    expect(system).toContain("at most 120 words");
    expect(system).toContain("Do not give buy or sell advice.");
  });

  it("asks for the configured output language", () => {
    const system = buildDailyBriefPrompt({ ...ctx, language: "de" })[0]!.content;
    expect(system).toContain("Use short, simple sentences.");
    expect(
      system.endsWith(
        "\n\nWrite your whole answer in German, headings included. Keep tickers, ISINs, currency codes, numbers and product names unchanged.",
      ),
    ).toBe(true);
  });

  it("handles empty data", () => {
    const missing = { summary: {} } as unknown as FinancialPortfolioData;
    for (const d of [emptyData, missing]) {
      const user = buildDailyBriefPrompt({ ...ctx, data: d, news: [] })[1]!.content;
      expect(user).toContain("Holdings: 0");
      expect(user).toContain("Last session return of the whole portfolio: +0.00%");
      expect(user).toContain("Best performer of the session: none");
      expect(user).toContain("=== GAINERS OF THE LAST SESSION ===\nNone.");
      expect(user).toContain("=== DECLINERS OF THE LAST SESSION ===\nNone.");
      expect(user).toContain("=== TRANSACTIONS SINCE 2026-10-27 ===\nNone.");
      expect(user).toContain("No news available.");
    }
  });
});

describe("fallbackBrief", () => {
  it("shows the numbers only", () => {
    expect(fallbackBrief(ctx)).toBe(
      [
        "**Session return +1.23%**",
        "- Top gainer: NVDA (NVIDIA Corp) +3.50%",
        "- Top decliner: AAPL (Apple Inc) -2.25%",
        "- 3 transactions since 2026-10-27",
        "",
        "_The assistant was not available, so this brief shows the numbers only._",
      ].join("\n"),
    );
  });

  it("uses the singular for one transaction", () => {
    const one = { ...rawData, transactions: [rawData.transactions[1]] } as unknown as FinancialPortfolioData;
    expect(fallbackBrief({ ...ctx, data: one })).toContain("- 1 transaction since 2026-10-27");
  });

  it("adds at most three event lines", () => {
    const events = ["- e1", "- e2", "- e3", "- e4", "- e5"].join("\n");
    const text = fallbackBrief({ ...ctx, events });
    const lines = text.split("\n");
    const tx = lines.indexOf("- 3 transactions since 2026-10-27");
    expect(lines.slice(tx + 1, tx + 4)).toEqual(["- e1", "- e2", "- e3"]);
    expect(lines[tx + 4]).toBe("");
    expect(text).not.toContain("- e4");
    expect(text).not.toContain("- e5");
  });

  it("handles empty data", () => {
    expect(fallbackBrief({ ...ctx, data: emptyData, news: [] })).toBe(
      "**Session return +0.00%**\n\n_The assistant was not available, so this brief shows the numbers only._",
    );
  });

  it("never contains money amounts", () => {
    const text = fallbackBrief(ctx);
    for (const s of MONEY) expect(text).not.toContain(s);
  });
});

describe("schedule edges", () => {
  const base = { dailyBriefEnabled: true, dailyBriefTime: "08:00", dailyBriefDays: "weekdays" as string, dailyBriefLastRun: undefined as string | undefined };

  it("runs on Sunday when set to daily", () => {
    const next = new Date(nextBriefRun({ ...base, dailyBriefDays: "daily", dailyBriefLastRun: "2026-10-31" }, new Date("2026-10-31T09:00:00"))!);
    expect(localDate(next)).toBe("2026-11-01");
    expect(next.getHours()).toBe(8);
  });

  it("finds today's slot before the set time", () => {
    expect(nextBriefRun({ ...base, dailyBriefLastRun: "2026-10-29" }, new Date("2026-10-30T07:00:00"))).toBe(new Date("2026-10-30T08:00:00").toISOString());
  });

  it("is due at the last minute of the day", () => {
    expect(isBriefDue({ ...base, dailyBriefTime: "23:59" }, new Date("2026-10-29T23:59:00"))).toBe(true);
    expect(isBriefDue({ ...base, dailyBriefTime: "23:59" }, new Date("2026-10-29T23:58:00"))).toBe(false);
  });

  it("returns now when due", () => {
    const now = new Date("2026-10-29T09:00:00");
    expect(nextBriefRun(base, now)).toBe(now.toISOString());
  });

  it("formats the local date", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("DailyBriefService.run", () => {
  const KEYS = ["dailyBriefPortfolioId", "dailyBriefLastRun", "gotifyUrl", "gotifyToken", "ntfyTopic", "language"] as const;
  let saved: Record<string, unknown> = {};
  let portfolioId = "";
  const convId = () => `brief_${portfolioId}_2026-10-29`;
  const originalFetch = globalThis.fetch;
  let fetchCalls: { url: string; init: RequestInit }[] = [];

  const captured: { role: string; content: string }[][] = [];
  let reply: () => Promise<string> = async () => "**Up 1.23%**\n- NVDA led";
  const llm = {
    chat: async (m: { role: string; content: string }[]) => {
      captured.push(m);
      return reply();
    },
    resolve: () => ({ provider: "openai-compatible", name: "OpenAI-compatible", model: "m", apiKey: "", baseUrl: "http://127.0.0.1:1", temperature: 0.3 }),
  } as unknown as LlmService;
  let portfolioData: () => Promise<FinancialPortfolioData> = async () => data;
  const portfolioService = {
    fetchLiveQuotes: async () => new Map(),
    getPortfolioData: async () => portfolioData(),
    saveDailySnapshot: () => {},
  } as unknown as PortfolioService;
  const aiContext = {
    fmp: { isConfigured: () => false },
    finnhub: { isConfigured: () => false },
    income: {
      getUpcomingEvents: async () => ({
        portfolioId: "x",
        baseCurrency: "EUR",
        days: 2,
        from: "2026-10-29",
        to: "2026-10-31",
        sources: [],
        events: [{ date: "2026-10-30", kind: "earnings", symbol: "AAPL", name: "Apple Inc", source: "fmp" }],
      }),
    },
  } as unknown as AiContextDeps;

  const newService = () => new DailyBriefService(llm, portfolioService, aiContext);
  const stored = () => {
    const conv = conversationRepo.findById(convId(), portfolioId);
    return conv ? (JSON.parse(conv.messages) as { role: string; content: string }[]) : null;
  };
  const stubFetch = (status = 200) => {
    fetchCalls = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init: init ?? {} });
      return status === 200 ? new Response("{}", { status }) : new Response("x", { status });
    }) as unknown as typeof fetch;
  };
  const withGotify = async (fn: () => Promise<void>) => {
    updateConfig({ gotifyUrl: "https://gotify.example.com", gotifyToken: "t" });
    try {
      await fn();
    } finally {
      updateConfig({ gotifyUrl: "", gotifyToken: "" });
    }
  };

  beforeAll(() => {
    const cfg = loadConfig() as unknown as Record<string, unknown>;
    saved = Object.fromEntries(KEYS.map((k) => [k, cfg[k]]));
    portfolioId = portfolioRepo.create({ name: "Growth", baseCurrency: "EUR" }).id;
    updateConfig({ dailyBriefPortfolioId: portfolioId, dailyBriefLastRun: "2026-10-27", gotifyUrl: "", gotifyToken: "", ntfyTopic: "", language: "en" });
  });

  afterAll(() => {
    conversationRepo.deleteById(convId(), portfolioId);
    portfolioRepo.deleteById(portfolioId);
    updateConfig(saved as Parameters<typeof updateConfig>[0]);
  });

  beforeEach(() => {
    setSystemTime(new Date("2026-10-29T09:00:00"));
    captured.length = 0;
    reply = async () => "**Up 1.23%**\n- NVDA led";
    portfolioData = async () => data;
    updateConfig({ dailyBriefLastRun: "2026-10-27" });
    conversationRepo.deleteById(convId(), portfolioId);
    stubFetch();
  });

  afterEach(() => {
    setSystemTime();
    globalThis.fetch = originalFetch;
  });

  it("writes the brief to the assistant without a channel", async () => {
    const res = await newService().run("manual");
    expect(res).toEqual({
      success: true,
      portfolios: 1,
      delivered: 0,
      message: "Wrote 1 brief(s) to the assistant. Set up a phone app under Settings, Notifications to receive them as push notifications.",
      error: undefined,
    });
    const conv = conversationRepo.findById(convId(), portfolioId);
    expect(conv).not.toBeNull();
    expect(conv!.title).toBe("Daily brief 2026-10-29");
    expect(JSON.parse(conv!.messages)).toEqual([
      { role: "user", content: "Daily brief for 2026-10-29: what happened in the last trading session?" },
      { role: "assistant", content: "**Up 1.23%**\n- NVDA led" },
    ]);
    const user = captured[0]![1]!.content;
    expect(user).toContain("=== TRANSACTIONS SINCE 2026-10-27 ===");
    expect(user).toContain("=== EVENTS OF HELD SYMBOLS TODAY AND TOMORROW ===");
    expect(user).toContain("AAPL (Apple Inc): earnings report");
    expect(loadConfig().dailyBriefLastRun).toBe("2026-10-27");
  });

  it("looks back at most seven days, and one day without a last run", async () => {
    updateConfig({ dailyBriefLastRun: "2026-09-01" });
    await newService().run("manual");
    expect(captured[0]![1]!.content).toContain("=== TRANSACTIONS SINCE 2026-10-22 ===");
    updateConfig({ dailyBriefLastRun: undefined });
    await newService().run("manual");
    expect(captured[1]![1]!.content).toContain("=== TRANSACTIONS SINCE 2026-10-28 ===");
  });

  it("stores the fallback when the model fails", async () => {
    reply = async () => {
      throw new Error("model down");
    };
    const res = await newService().run("manual");
    expect(res.error).toBe("Assistant: model down");
    expect(res.portfolios).toBe(1);
    const content = stored()![1]!.content;
    expect(content.startsWith("**Session return +1.23%**")).toBe(true);
    // The run passes the same events text to the prompt and to the fallback.
    const marker = "=== EVENTS OF HELD SYMBOLS TODAY AND TOMORROW ===\n";
    const user = captured[0]![1]!.content;
    const events = user.includes(marker) ? user.slice(user.indexOf(marker) + marker.length) : undefined;
    const expected = fallbackBrief({ portfolio: { id: portfolioId, name: "Growth" } as PortfolioItem, data, since: "2026-10-27", today: "2026-10-29", news: [], events });
    expect(content).toBe(expected);
  });

  it("stores the fallback for an empty reply", async () => {
    reply = async () => "   ";
    const res = await newService().run("manual");
    expect(res.error).toBe("Assistant: The assistant returned an empty reply");
    expect(stored()![1]!.content.startsWith("**Session return +1.23%**")).toBe(true);
  });

  it("pushes the brief through Gotify", async () => {
    await withGotify(async () => {
      const res = await newService().run("manual");
      expect(res.delivered).toBe(1);
      expect(res.message).toBe("Wrote 1 brief(s) and delivered 1 through Gotify.");
      const body = JSON.parse(String(fetchCalls[0]!.init.body));
      expect(body.title).toBe("Growth: daily brief");
      expect(body.message).toBe("**Up 1.23%**\n- NVDA led");
    });
  });

  it("never pushes money amounts in the fallback", async () => {
    reply = async () => {
      throw new Error("model down");
    };
    await withGotify(async () => {
      await newService().run("manual");
      const message = String(JSON.parse(String(fetchCalls[0]!.init.body)).message);
      for (const s of ["98765", "13579", "55555", "777", "123456"]) expect(message).not.toContain(s);
    });
  });

  it("reports a rejected push and still writes the brief", async () => {
    stubFetch(500);
    await withGotify(async () => {
      const res = await newService().run("manual");
      expect(res.success).toBe(false);
      expect(res.delivered).toBe(0);
      expect(res.error).toBe("The Gotify server rejected the message (HTTP 500).");
      expect(stored()).not.toBeNull();
    });
  });

  it("marks the day on a scheduled run", async () => {
    const privateData = {
      ...rawData,
      holdings: rawData.holdings.map((h) => (h.assetType === "Cash" ? h : { ...h, isPrivate: true })),
    } as unknown as FinancialPortfolioData;
    portfolioData = async () => privateData;
    const res = await newService().run("schedule");
    expect(res.portfolios).toBe(1);
    expect(loadConfig().dailyBriefLastRun).toBe("2026-10-29");
  });

  it("reports a failing portfolio by name", async () => {
    portfolioData = async () => {
      throw new Error("no data");
    };
    const res = await newService().run("manual");
    expect(res).toMatchObject({ success: false, portfolios: 0, error: "Growth: no data" });
  });

  it("refuses an overlapping run", async () => {
    const svc = newService();
    const a = svc.run("manual");
    const b = await svc.run("manual");
    expect(b).toEqual({ success: false, error: "A daily brief is already running.", portfolios: 0, delivered: 0 });
    await a;
  });
});
