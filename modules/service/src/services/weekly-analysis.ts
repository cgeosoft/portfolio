/**
 * Weekly analysis (Settings, Automation): once a week at the set day and
 * local time the assistant writes the weekly report of each portfolio, the
 * same report as Reports, Generate. The report is stored with the others;
 * every notification channel that is set up (Gotify, ntfy) gets a short
 * summary of it.
 *
 * The report prompt is the one of the Reports tab. The notification summary
 * carries percentages and tickers only, never money amounts. A week the
 * service was not running at the set time catches up on a start within
 * CATCH_UP_MS of it.
 */
import { loadConfig, updateConfig } from "../config";
import { appLogger } from "../logger";
import * as portfolioRepo from "../db/portfolio.repo";
import type { LlmService } from "./llm";
import type { PortfolioService } from "./portfolio";
import { getIsoWeekKey, type PortfolioReportService } from "./portfolio-report";
import { channelNames, configuredChannels, notifyAll } from "./notify";
import { localDate } from "./daily-brief";
import type { AutomationStatus, RunAutomationResponse } from "portfolio-shared/api-types";
import type { PortfolioItem, PortfolioReport } from "portfolio-shared/portfolio";

const CHECK_INTERVAL_MS = 60_000;
/** How long after the set time a start still writes the missed analysis. */
const CATCH_UP_MS = 48 * 60 * 60 * 1000;

interface WeeklySchedule {
  weeklyAnalysisEnabled: boolean;
  weeklyAnalysisDay: number;
  weeklyAnalysisTime: string;
  weeklyAnalysisLastRun?: string;
}

/** The latest set day and time at or before `now`. */
export function lastSlot(cfg: WeeklySchedule, now: Date): Date {
  const [h, m] = cfg.weeklyAnalysisTime.split(":").map(Number);
  const slot = new Date(now);
  slot.setDate(now.getDate() - ((now.getDay() - cfg.weeklyAnalysisDay + 7) % 7));
  slot.setHours(h ?? 9, m ?? 0, 0, 0);
  if (slot > now) slot.setDate(slot.getDate() - 7);
  return slot;
}

/** Whether the scheduled analysis is due: switched on, the set time passed less than CATCH_UP_MS ago and it did not run since. */
export function isAnalysisDue(cfg: WeeklySchedule, now: Date): boolean {
  if (!cfg.weeklyAnalysisEnabled) return false;
  const slot = lastSlot(cfg, now);
  if (now.getTime() - slot.getTime() > CATCH_UP_MS) return false;
  return !cfg.weeklyAnalysisLastRun || cfg.weeklyAnalysisLastRun < localDate(slot);
}

/** The next time the schedule fires, as an ISO timestamp, or undefined while it is off. */
export function nextAnalysisRun(cfg: WeeklySchedule, now: Date): string | undefined {
  if (!cfg.weeklyAnalysisEnabled) return undefined;
  if (isAnalysisDue(cfg, now)) return now.toISOString();
  const next = lastSlot(cfg, now);
  next.setDate(next.getDate() + 7);
  return next.toISOString();
}

/**
 * The ISO week an analysis at `now` covers: the week of the day before, so a
 * Saturday or Sunday run covers the week that just closed and a Monday run
 * the week before.
 */
export function analysisWeekKey(now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return getIsoWeekKey(yesterday);
}

const signedPct = (value = 0) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

/** The summary without the assistant: the percentages of the report metrics. */
export function fallbackSummary(report: PortfolioReport): string {
  const m = report.metrics;
  const lines = [`**Weekly analysis ${report.period}**`];
  const weekly = m.weeklyGainLossPercent ?? m.periodGainLossPercent;
  if (weekly !== undefined) lines.push(`- Return of the week: ${signedPct(weekly)}`);
  if (m.topWinner) lines.push(`- Top gainer: ${m.topWinner.symbol} ${signedPct(m.topWinner.changePercent)}`);
  if (m.topLoser) lines.push(`- Top decliner: ${m.topLoser.symbol} ${signedPct(m.topLoser.changePercent)}`);
  lines.push("", "_Open Portfolio, Reports for the full analysis._");
  return lines.join("\n");
}

export class WeeklyAnalysisService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private last: AutomationStatus["lastResult"];

  constructor(
    private readonly llm: LlmService,
    private readonly portfolioService: PortfolioService,
    private readonly reportService: PortfolioReportService,
  ) {}

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public status(): AutomationStatus {
    const cfg = loadConfig();
    return {
      running: this.running,
      lastRun: cfg.weeklyAnalysisLastRun,
      nextRun: nextAnalysisRun(cfg, new Date()),
      channels: configuredChannels(),
      lastResult: this.last,
    };
  }

  private async tick(): Promise<void> {
    if (this.running || !isAnalysisDue(loadConfig(), new Date())) return;
    await this.run("schedule").catch((err) => appLogger.logStep("error", "weekly", "run", `Weekly analysis failed: ${err instanceof Error ? err.message : err}`));
  }

  /** Writes the weekly report of every chosen portfolio and pushes a summary of each. */
  public async run(trigger: "schedule" | "manual"): Promise<RunAutomationResponse> {
    if (this.running) return { success: false, error: "A weekly analysis is already running.", portfolios: 0, delivered: 0 };
    this.running = true;
    const now = new Date();
    const cfg = loadConfig();
    // The schedule marks the day first, so a failure does not retry every minute.
    // "Run now" leaves the mark alone, so the scheduled analysis still runs.
    if (trigger === "schedule") updateConfig({ weeklyAnalysisLastRun: localDate(now) });
    const weekKey = analysisWeekKey(now);

    const portfolios = portfolioRepo.findAll().filter((p) => !cfg.weeklyAnalysisPortfolioId || p.id === cfg.weeklyAnalysisPortfolioId);
    const channels = configuredChannels();
    const errors: string[] = [];
    let delivered = 0;
    let written = 0;
    const timer = appLogger.startTimer("weekly", "run", `Writing the weekly analysis (${trigger}) for ${portfolios.length} portfolio(s)`);

    try {
      for (const row of portfolios) {
        const portfolio: PortfolioItem = { id: row.id, name: row.name, description: row.description, baseCurrency: row.baseCurrency };
        try {
          const portfolioData = await this.portfolioService.getPortfolioData(row.id, row.baseCurrency || cfg.baseCurrency || "EUR", true);
          const report = await this.reportService.generateReport(portfolio, { weekKey, portfolioData });
          written++;
          if (report.isFallback && report.error) errors.push(`Assistant: ${report.error}`);

          if (channels.length > 0) {
            const summary = report.isFallback ? fallbackSummary(report) : await this.summarize(report, errors);
            const sent = await notifyAll({ title: `${row.name}: weekly analysis`, message: summary }, channels);
            if (sent.ok) delivered++;
            errors.push(...sent.errors);
          }
        } catch (err) {
          errors.push(`${row.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      this.running = false;
    }

    const unique = [...new Set(errors)];
    const success = written > 0 && delivered === (channels.length > 0 ? written : 0);
    const message =
      channels.length === 0
        ? `Wrote ${written} weekly report(s) to Reports. Set up Gotify or ntfy under Integrations to receive a summary as a push notification.`
        : `Wrote ${written} weekly report(s) and delivered ${delivered} summary(ies) through ${channelNames(channels)}.`;
    this.last = { at: now.toISOString(), trigger, success, message, errors: unique };
    timer.end(success ? "success" : "warning", `Weekly analysis: ${written} written, ${delivered} delivered, ${unique.length} problem(s)`);
    return { success, portfolios: written, delivered, message, error: unique[0] };
  }

  /** A phone-sized summary of the report, without money amounts. */
  private async summarize(report: PortfolioReport, errors: string[]): Promise<string> {
    try {
      const text = await this.llm.chat(
        [
          {
            role: "system",
            content: `Summarize the weekly portfolio analysis below for a push notification on a phone.
Use ASD-STE100 Simplified English. Do not use long dashes. Do not use emojis.
Use only facts from the analysis. Never write money amounts, balances or position values; percentages and tickers are allowed. Do not give buy or sell advice.
Output Markdown only, at most 100 words: one bold first line with the return of the week, then 3 short bullet points with the main findings.`,
          },
          { role: "user", content: report.content },
        ],
        this.llm.resolve(),
      );
      if (text.trim()) return `${text.trim()}\n\n_Open Portfolio, Reports for the full analysis._`;
    } catch (err) {
      errors.push(`Assistant summary: ${err instanceof Error ? err.message : String(err)}`);
    }
    return fallbackSummary(report);
  }
}
