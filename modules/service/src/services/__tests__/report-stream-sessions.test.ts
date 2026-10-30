import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase } from "../../db/database.js";
import * as reportRepo from "../../db/report.repo.js";
import { EMPTY_REPORT_INTEL } from "../ai-context.js";
import { PortfolioReportService } from "../portfolio-report.js";
import type { LlmService } from "../llm.js";
import type { PortfolioService } from "../portfolio.js";

function session(id: string, createdAt: number, abortController: AbortController) {
  return { sessionId: id, portfolioId: "p1", abortController, status: "running", accumulatedText: "", lastWords: "", chunkCount: 0, createdAt };
}

describe("report stream sessions", () => {
  it("aborts a stale session's model call before it forgets the session", () => {
    const service = new PortfolioReportService({} as LlmService, {} as PortfolioService);
    const sessions = (service as unknown as { streamSessions: Map<string, unknown> }).streamSessions;
    const now = Date.now();
    const stale = new AbortController();
    const recent = new AbortController();
    sessions.set("stale", session("stale", now - 16 * 60 * 1000, stale));
    sessions.set("recent", session("recent", now - 60 * 1000, recent));

    expect(service.pruneStreamSessions(now)).toBe(1);
    expect(stale.signal.aborted).toBe(true);
    expect(recent.signal.aborted).toBe(false);
    expect(service.pollReportStream("stale").error).toBe("Session expired or not found");
    expect(service.pollReportStream("recent").status).toBe("running");
  });
});

const streamPortfolioId = "test-portfolio-stream-456";
const streamData = {
  summary: {
    totalValue: 0,
    totalCost: 0,
    totalGainLossDollar: 0,
    totalGainLossPercent: 0,
    dayGainLossDollar: 0,
    dayGainLossPercent: 0,
    cashBalance: 0,
    totalPortfolioValue: 0,
    stockWeightPercent: 60,
    etfWeightPercent: 30,
    cryptoWeightPercent: 0,
    cashWeightPercent: 10,
    baseCurrency: "EUR",
    lastUpdated: new Date().toISOString(),
  },
  holdings: [],
  chartHistory: [],
  individualCharts: {},
};

type ChatStream = (messages: unknown[], onChunk: (chunk: string) => void, opts: Record<string, unknown>) => Promise<string>;

function streamService(chatStream: ChatStream) {
  const llm = { chatStream } as unknown as LlmService;
  const portfolioService = { getPortfolioData: async () => streamData } as unknown as PortfolioService;
  return new PortfolioReportService(llm, portfolioService, async () => EMPTY_REPORT_INTEL);
}

async function until(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timeout");
    await Bun.sleep(5);
  }
}

function clearStreamRows(): void {
  const db = getDatabase();
  db.run("DELETE FROM reports WHERE portfolioId = ?", [streamPortfolioId]);
  db.run("DELETE FROM portfolios WHERE id = ?", [streamPortfolioId]);
}

describe("report stream lifecycle", () => {
  beforeEach(() => {
    clearStreamRows();
    getDatabase().run("INSERT INTO portfolios (id, name, baseCurrency) VALUES (?, ?, ?)", [streamPortfolioId, "Stream Test Portfolio", "EUR"]);
  });
  afterEach(clearStreamRows);

  it("streams a report to success and stores it", async () => {
    let seen: Record<string, unknown> = {};
    const service = streamService(async (_m, onChunk, opts) => {
      seen = opts;
      onChunk("<think>plan</think>");
      onChunk("# Report ");
      onChunk("body");
      return "# Report body";
    });
    const { sessionId } = await service.startReportStream({
      portfolioId: streamPortfolioId,
      provider: "openai-compatible",
      model: "m",
      apiKey: "k",
      weekKey: "2026-w44",
    });
    expect(typeof sessionId).toBe("string");
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    await until(() => service.pollReportStream(sessionId).status !== "running");
    const poll = service.pollReportStream(sessionId);
    expect(poll.status).toBe("success");
    expect(poll.chunkCount).toBe(3);
    expect(poll.lastWords).toBe("# Report body");
    expect(poll.report!.content).toBe("# Report body");
    expect(poll.report!.weekKey).toBe("2026-w44");
    expect(seen.isReport).toBe(true);
    expect(seen.apiKey).toBe("k");
    expect(seen.signal instanceof AbortSignal).toBe(true);
  });

  it("shows no last words while the model is still thinking", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const service = streamService(async (_m, onChunk) => {
      onChunk("<think>planning the");
      await gate;
      return "# Done";
    });
    const { sessionId } = await service.startReportStream({ portfolioId: streamPortfolioId, weekKey: "2026-w44" });
    try {
      await until(() => service.pollReportStream(sessionId).chunkCount === 1);
      const poll = service.pollReportStream(sessionId);
      expect(poll.status).toBe("running");
      expect(poll.lastWords).toBe("");
      expect(poll.chunkCount).toBe(1);
    } finally {
      release();
      await until(() => service.pollReportStream(sessionId).status !== "running");
    }
  });

  it("keeps the last 50 words", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const words = Array.from({ length: 60 }, (_, i) => `w${i + 1}`);
    const service = streamService(async (_m, onChunk) => {
      onChunk(words.join(" "));
      await gate;
      return words.join(" ");
    });
    const { sessionId } = await service.startReportStream({ portfolioId: streamPortfolioId, weekKey: "2026-w44" });
    try {
      await until(() => service.pollReportStream(sessionId).chunkCount === 1);
      expect(service.pollReportStream(sessionId).lastWords).toBe(words.slice(10).join(" "));
    } finally {
      release();
      await until(() => service.pollReportStream(sessionId).status !== "running");
    }
  });

  it("cancels a running stream and stores nothing", async () => {
    let captured: ((chunk: string) => void) | undefined;
    const service = streamService((_m, onChunk, opts) => {
      captured = onChunk;
      onChunk("partial");
      const signal = opts.signal as AbortSignal;
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const { sessionId } = await service.startReportStream({ portfolioId: streamPortfolioId, weekKey: "2026-w44" });
    await until(() => service.pollReportStream(sessionId).chunkCount === 1);
    expect(service.cancelReportStream(sessionId)).toEqual({ success: true });
    await until(() => service.pollReportStream(sessionId).status !== "running");
    expect(service.pollReportStream(sessionId).status).toBe("cancelled");
    captured!("more");
    expect(service.pollReportStream(sessionId).chunkCount).toBe(1);
    await Bun.sleep(20);
    expect(reportRepo.findById(`${streamPortfolioId}_2026-w44`)).toBeNull();
  });

  it("reports a failed model call", async () => {
    const service = streamService(async () => {
      throw new Error("boom");
    });
    const { sessionId } = await service.startReportStream({ portfolioId: streamPortfolioId, weekKey: "2026-w44" });
    await until(() => service.pollReportStream(sessionId).status !== "running");
    const poll = service.pollReportStream(sessionId);
    expect(poll.status).toBe("fail");
    expect(poll.error).toBe("boom");
  });

  it("fails for an unknown portfolio", async () => {
    const service = streamService(async () => "# Report");
    const { sessionId } = await service.startReportStream({ portfolioId: "no-such-portfolio", weekKey: "2026-w44" });
    await until(() => service.pollReportStream(sessionId).status !== "running");
    const poll = service.pollReportStream(sessionId);
    expect(poll.status).toBe("fail");
    expect(poll.error).toBe("Portfolio not found");
  });

  it("answers for an unknown session", () => {
    const service = streamService(async () => "");
    expect(service.cancelReportStream("nope")).toEqual({ success: false });
    expect(service.pollReportStream("nope")).toEqual({
      sessionId: "nope",
      status: "fail",
      lastWords: "",
      chunkCount: 0,
      error: "Session expired or not found",
    });
  });
});
