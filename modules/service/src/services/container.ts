/** The long-lived services, built once in main.ts and shared by the routes. */
import { YahooFinanceService } from "./yahoo-finance";
import { FinnhubService } from "./finnhub";
import { FmpService } from "./fmp";
import { MarketDataCoordinator } from "./market-data";
import { LlmService } from "./llm";
import { PortfolioService } from "./portfolio";
import { PortfolioReportService } from "./portfolio-report";
import { PortfolioChatService } from "./portfolio-chat";
import { MetricsService } from "./metrics/index";
import { DailyBriefService } from "./daily-brief";
import { WeeklyAnalysisService } from "./weekly-analysis";
import { EtfIntelService } from "./intel/etf";
import { ExposureService } from "./exposure";
import { CalendarService } from "./intel/calendar";
import { IncomeService } from "./income";
import { EventAlertsService } from "./event-alerts";

export interface AppServices {
  yahoo: YahooFinanceService;
  finnhub: FinnhubService;
  /** Financial Modeling Prep client. Without a key every call returns null or empty data (`isConfigured()`). */
  fmp: FmpService;
  marketData: MarketDataCoordinator;
  llm: LlmService;
  portfolioService: PortfolioService;
  reportService: PortfolioReportService;
  chatService: PortfolioChatService;
  metricsService: MetricsService;
  dailyBrief: DailyBriefService;
  weeklyAnalysis: WeeklyAnalysisService;
  /** ETF and fund look-through, stock sector and country (intel/etf.ts). */
  etfIntel: EtfIntelService;
  /** Portfolio exposure after look-through (exposure.ts). */
  exposure: ExposureService;
  /** Dividends, splits and earnings per symbol (intel/calendar.ts). */
  calendar: CalendarService;
  /** Dividend income, yields, split hints and upcoming events of a portfolio (income.ts). */
  income: IncomeService;
  /** Daily push of the next day's ex-dividend dates and earnings reports (event-alerts.ts). */
  eventAlerts: EventAlertsService;
}

export function createServices(): AppServices {
  const yahoo = new YahooFinanceService();
  const finnhub = new FinnhubService();
  const fmp = new FmpService();
  const marketData = new MarketDataCoordinator(yahoo, finnhub, fmp);
  const llm = new LlmService();
  const portfolioService = new PortfolioService(marketData);
  const etfIntel = new EtfIntelService(fmp, yahoo, finnhub);
  const exposure = new ExposureService(portfolioService, etfIntel);
  const calendar = new CalendarService(fmp, yahoo, finnhub);
  const income = new IncomeService(portfolioService, marketData, calendar);
  const eventAlerts = new EventAlertsService(income);
  // Market context of the AI features (ai-context.ts). The exposure service registers itself above.
  const aiContext = { fmp, finnhub, yahoo, marketData, portfolioService, income };
  const reportService = new PortfolioReportService(llm, portfolioService, aiContext);
  const chatService = new PortfolioChatService(llm, portfolioService, aiContext);
  const metricsService = new MetricsService(portfolioService, fmp);
  const dailyBrief = new DailyBriefService(llm, portfolioService, aiContext);
  const weeklyAnalysis = new WeeklyAnalysisService(llm, portfolioService, reportService, aiContext);
  return { yahoo, finnhub, fmp, marketData, llm, portfolioService, reportService, chatService, metricsService, dailyBrief, weeklyAnalysis, etfIntel, exposure, calendar, income, eventAlerts };
}
