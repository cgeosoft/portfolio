/**
 * Weekly analysis (Settings, Notifications, Weekly Report): once a week at the
 * set day and local time a Guided Analysis runs for each chosen portfolio, and
 * every notification channel that is set up (Gotify, ntfy) gets its summary
 * and suggested actions. A week the service was not running at the set time
 * catches up on a start within CATCH_UP_MS of it.
 */
import { loadConfig, updateConfig } from "../config";
import { appLogger } from "../logger";
import * as portfolioRepo from "../db/portfolio.repo";
import { channelNames, configuredChannels, notifyAll } from "./notify";
import { localDate } from "./daily-brief";
import { t } from "../i18n";
import type { AutomationStatus, RunAutomationResponse } from "portfolio-shared/api-types";
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

export class WeeklyAnalysisService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private last: AutomationStatus["lastResult"];

  constructor(private readonly analysis: AnalysisService) {}

  /** One Guided Analysis run for the schedule. Null means none finished; the reason goes to `errors`. */
  private async guidedRun(portfolioId: string, baseCurrency: string, errors: string[]): Promise<{ summary: string; actions: string[] } | null> {
    const capability = await this.analysis.capability();
    if (capability.reason) {
      errors.push(`Guided Analysis cannot run: ${capability.reason}`);
      return null;
    }
    try {
      const started = await this.analysis.start(portfolioId, { baseCurrency, trigger: "schedule" });
      await this.analysis.waitFor(started.id);
      const res = this.analysis.get(started.id);
      if (res.run.status !== "completed") {
        errors.push(`Guided Analysis: ${res.run.error ?? res.run.status}`);
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

  /** Runs Guided Analysis for every chosen portfolio and pushes a summary of each. */
  public async run(trigger: "schedule" | "manual"): Promise<RunAutomationResponse> {
    if (this.running) return { success: false, error: "A weekly analysis is already running.", portfolios: 0, delivered: 0 };
    this.running = true;
    const now = new Date();
    const cfg = loadConfig();
    // The schedule marks the day first, so a failure does not retry every minute.
    // "Run now" leaves the mark alone, so the scheduled analysis still runs.
    if (trigger === "schedule") updateConfig({ weeklyAnalysisLastRun: localDate(now) });

    const portfolios = portfolioRepo.findAll().filter((p) => !cfg.weeklyAnalysisPortfolioId || p.id === cfg.weeklyAnalysisPortfolioId);
    const channels = configuredChannels();
    const errors: string[] = [];
    let delivered = 0;
    let written = 0;
    const timer = appLogger.startTimer("weekly", "run", `Writing the weekly analysis (${trigger}) for ${portfolios.length} portfolio(s)`);

    try {
      for (const row of portfolios) {
        try {
          const guided = await this.guidedRun(row.id, row.baseCurrency || cfg.baseCurrency || "EUR", errors);
          if (!guided) continue;
          written++;
          if (channels.length === 0) continue;
          // Sections 1 and 4 of the short report: where the portfolio stands and the suggested actions.
          const lines = [`**${t("service.weeklyAnalysis.guidedHeading")}**`, guided.summary || t("service.analysis.noFindingsSummary")];
          if (guided.actions.length) lines.push("", ...guided.actions.slice(0, 5).map((a) => `- ${a}`));
          lines.push("", `_${t("service.weeklyAnalysis.openAnalysis")}_`);
          const sent = await notifyAll({ title: t("service.weeklyAnalysis.notificationTitle", { portfolio: row.name }), message: lines.join("\n") }, channels);
          if (sent.ok) delivered++;
          errors.push(...sent.errors);
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
}
