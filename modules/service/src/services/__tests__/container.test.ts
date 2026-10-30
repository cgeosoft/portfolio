/**
 * Service wiring smoke test: createServices builds every service without network.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { createServices, type AppServices } from "../container";
import { YahooFinanceService } from "../yahoo-finance";
import { PortfolioService } from "../portfolio";
import { LlmService } from "../llm";
import { MetricsService } from "../metrics/index";

const created: AppServices[] = [];
function make(): AppServices {
  const s = createServices();
  created.push(s);
  return s;
}

afterAll(() => {
  for (const s of created) s.portfolioService.destroy();
});

describe("createServices", () => {
  it("returns the 17 services", () => {
    const services = make();
    expect(Object.keys(services).sort()).toEqual(
      [
        "yahoo",
        "finnhub",
        "fmp",
        "marketData",
        "llm",
        "portfolioService",
        "reportService",
        "chatService",
        "suggestionService",
        "metricsService",
        "dailyBrief",
        "weeklyAnalysis",
        "etfIntel",
        "exposure",
        "calendar",
        "income",
        "eventAlerts",
      ].sort(),
    );
    for (const value of Object.values(services)) {
      expect(value).toBeDefined();
      expect(value).not.toBeNull();
    }
  });

  it("builds the expected classes", () => {
    const services = make();
    expect(services.yahoo).toBeInstanceOf(YahooFinanceService);
    expect(services.portfolioService).toBeInstanceOf(PortfolioService);
    expect(services.llm).toBeInstanceOf(LlmService);
    expect(services.metricsService).toBeInstanceOf(MetricsService);
  });

  it("returns new instances on each call", () => {
    const a = make();
    const b = make();
    expect(a.llm).not.toBe(b.llm);
  });
});
