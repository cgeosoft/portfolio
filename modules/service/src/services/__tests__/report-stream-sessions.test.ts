import { describe, it, expect } from "bun:test";
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
