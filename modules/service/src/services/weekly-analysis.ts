/**
 * Weekly analysis (Settings, Notifications, Weekly Report): once a week at the set day and
 * local time the assistant writes the weekly report of each portfolio, the
 * same report as Reports, Generate. The report is stored with the others;
 * every notification channel that is set up (Gotify, ntfy) gets a short
 * summary of it.
 *
 * The report prompt is the one of the Reports tab, with its market context
 * (benchmark, macro, exposure, income and the events of the week ahead; see
 * ai-context.ts). The push summary also gets a few facts: the week against
 * the benchmark, the 10-year yield move, the events of the next 7 days and
 * exposure warnings. The notification summary carries percentages and
 * tickers only, never money amounts. A week the
 * service was not running at the set time catches up on a start within
 * CATCH_UP_MS of it.
 */
import { loadConfig, updateConfig } from "../config";
import { appLogger } from "../logger";
import * as portfolioRepo from "../db/portfolio.repo";
import type { LlmMessage, LlmService } from "./llm";
import { assertNoLedgerAmounts, toPromptSafe } from "./llm-privacy";
import type { PortfolioService } from "./portfolio";
import { getIsoWeekKey, type PortfolioReportService } from "./portfolio-report";
import { channelNames, configuredChannels, notifyAll } from "./notify";
import { localDate } from "./daily-brief";
import { collectWeeklyFacts, type AiContextDeps, type WeeklyFacts } from "./ai-context";
import { plainStyle, withLanguageInstruction } from "./output-language";
import { t } from "../i18n";
import type { AutomationStatus, RunAutomationResponse } from "portfolio-shared/api-types";
import type { FinancialPortfolioData, PortfolioItem, PortfolioReport } from "portfolio-shared/portfolio";
import type { AnalysisService } from "./analysis/run";

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

/** The summary without the assistant: the percentages of the report metrics and the weekly facts. */
export function fallbackSummary(report: PortfolioReport, facts?: WeeklyFacts): string {
  const m = report.metrics;
  const lines = [`**${t("service.weeklyAnalysis.fallback.heading", { period: report.period })}**`];
  const weekly = m.weeklyGainLossPercent ?? m.periodGainLossPercent;
  if (weekly !== undefined) lines.push(`- ${t("service.weeklyAnalysis.fallback.weekReturn", { change: signedPct(weekly) })}`);
  if (m.topWinner) lines.push(`- ${t("service.weeklyAnalysis.fallback.topGainer", { symbol: m.topWinner.symbol, change: signedPct(m.topWinner.changePercent) })}`);
  if (m.topLoser) lines.push(`- ${t("service.weeklyAnalysis.fallback.topDecliner", { symbol: m.topLoser.symbol, change: signedPct(m.topLoser.changePercent) })}`);
  if (facts) lines.push(...facts.lines);
  lines.push("", `_${t("service.weeklyAnalysis.openReports")}_`);
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
    /** For the weekly facts of the push summary; without it the summary uses the report alone. */
    private readonly aiContext?: AiContextDeps,
    /** Guided Analysis, the default weekly mode; without it the long report runs. */
    private readonly analysis?: AnalysisService,
  ) {}

  /**
   * A Guided Analysis run for the schedule, when the mode asks for it and the
   * model can run one. Null means the long report runs instead.
   */
  private async guidedRun(portfolioId: string, baseCurrency: string, errors: string[]): Promise<{ summary: string; actions: string[] } | null> {
    if (!this.analysis || loadConfig().weeklyAnalysisMode !== "graph") return null;
    const capability = await this.analysis.capability();
    if (capability.reason) return null;
    try {
      const started = await this.analysis.start(portfolioId, { baseCurrency, trigger: "schedule" });
      await this.analysis.waitFor(started.id);
      const res = this.analysis.get(started.id);
      if (res.run.status !== "completed") {
        if (res.run.error) errors.push(`Guided Analysis: ${res.run.error}`);
        return null;
      }
      return { summary: res.run.summary ?? "", actions: (res.suggestions ?? []).filter((s) => s.status === "active").map((s) => s.title) };
    } catch (err) {
      errors.push(`Guided Analysis: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

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
    // Each portfolio's own errors go to the status. An unexpected one lands here; log its type only (CLAUDE.md rule 3).
    await this.run("schedule").catch((err) => appLogger.logStep("error", "weekly", "run", `Weekly analysis failed (${err instanceof Error ? err.name : typeof err})`));
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
          const baseCurrency = row.baseCurrency || cfg.baseCurrency || "EUR";
          const guided = await this.guidedRun(row.id, baseCurrency, errors);
          if (guided) {
            written++;
            if (channels.length > 0) {
              // Sections 1 and 4 of the short report: where the portfolio stands and the suggested actions.
              const lines = [`**${t("service.weeklyAnalysis.guidedHeading")}**`, guided.summary || t("service.analysis.noFindingsSummary")];
              if (guided.actions.length) lines.push("", ...guided.actions.slice(0, 5).map((a) => `- ${a}`));
              lines.push("", `_${t("service.weeklyAnalysis.openAnalysis")}_`);
              const sent = await notifyAll({ title: t("service.weeklyAnalysis.notificationTitle", { portfolio: row.name }), message: lines.join("\n") }, channels);
              if (sent.ok) delivered++;
              errors.push(...sent.errors);
            }
            continue;
          }
          const portfolioData = await this.portfolioService.getPortfolioData(row.id, baseCurrency, true);
          const report = await this.reportService.generateReport(portfolio, { weekKey, portfolioData });
          written++;
          if (report.isFallback && report.error) errors.push(`Assistant: ${report.error}`);

          if (channels.length > 0) {
            const facts = this.aiContext
              ? await collectWeeklyFacts(this.aiContext, row.id, { from: report.weekStartDate, to: report.weekEndDate }, baseCurrency).catch(() => undefined)
              : undefined;
            const summary = report.isFallback ? fallbackSummary(report, facts) : await this.summarize(report, portfolioData, errors, facts);
            const sent = await notifyAll({ title: t("service.weeklyAnalysis.notificationTitle", { portfolio: row.name }), message: summary }, channels);
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
        ? `Wrote ${written} weekly analysis(es) to the Analysis tab. Set up a phone app under Settings, Notifications to receive a summary as a push notification.`
        : `Wrote ${written} weekly analysis(es) and delivered ${delivered} summary(ies) through ${channelNames(channels)}.`;
    this.last = { at: now.toISOString(), trigger, success, message, errors: unique };
    timer.end(success ? "success" : "warning", `Weekly analysis: ${written} written, ${delivered} delivered, ${unique.length} problem(s)`);
    return { success, portfolios: written, delivered, message, error: unique[0] };
  }

  /** A phone-sized summary of the report, without money amounts. */
  private async summarize(report: PortfolioReport, data: FinancialPortfolioData, errors: string[], facts?: WeeklyFacts): Promise<string> {
    const extra = facts && facts.lines.length > 0 ? `\n\n=== FACTS FOR THE WEEK AHEAD ===\n${facts.lines.join("\n")}` : "";
    const language = loadConfig().language;
    try {
      const messages: LlmMessage[] = [
        {
          role: "system",
          content: toPromptSafe(
            withLanguageInstruction(
              `Summarize the weekly portfolio analysis below for a push notification on a phone.
Use ${plainStyle(language)}. Do not use long dashes. Do not use emojis.
Use only facts from the analysis. Never write money amounts, balances or position values; percentages and tickers are allowed. Do not give buy or sell advice.
Output Markdown only, at most 100 words: one bold first line with the return of the week, then 3 short bullet points with the main findings.
When facts for the week ahead are given, use one of the bullet points for the result against the benchmark or the most important upcoming event.`,
              language,
            ),
          ),
        },
        { role: "user", content: toPromptSafe(`${report.content}${extra}`) },
      ];
      // The report is model output, but it goes back to a model: the same gate as every other prompt.
      assertNoLedgerAmounts(messages, data, "weekly summary");
      const text = await this.llm.chat(messages, this.llm.resolve());
      if (text.trim()) return `${text.trim()}\n\n_${t("service.weeklyAnalysis.openReports")}_`;
    } catch (err) {
      errors.push(`Assistant summary: ${err instanceof Error ? err.message : String(err)}`);
    }
    return fallbackSummary(report);
  }
}
