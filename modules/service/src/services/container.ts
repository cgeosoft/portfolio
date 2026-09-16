/** The long-lived services, built once in main.ts and shared by the routes. */
import { YahooFinanceService } from "./yahoo-finance";
import { FinnhubService } from "./finnhub";
import { MarketDataCoordinator } from "./market-data";
import { LlmService } from "./llm";
import { PortfolioService } from "./portfolio";
import { PortfolioReportService } from "./portfolio-report";
import { PortfolioChatService } from "./portfolio-chat";
import { MetricsService } from "./metrics/index";

export interface AppServices {
  yahoo: YahooFinanceService;
  finnhub: FinnhubService;
  marketData: MarketDataCoordinator;
  llm: LlmService;
  portfolioService: PortfolioService;
  reportService: PortfolioReportService;
  chatService: PortfolioChatService;
  metricsService: MetricsService;
}

export function createServices(): AppServices {
  const yahoo = new YahooFinanceService();
  const finnhub = new FinnhubService();
  const marketData = new MarketDataCoordinator(yahoo, finnhub);
  const llm = new LlmService();
  const portfolioService = new PortfolioService(marketData);
  const reportService = new PortfolioReportService(llm, portfolioService, finnhub, yahoo);
  const chatService = new PortfolioChatService(llm, portfolioService);
  const metricsService = new MetricsService(portfolioService);
  return { yahoo, finnhub, marketData, llm, portfolioService, reportService, chatService, metricsService };
}
