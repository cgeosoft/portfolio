/**
 * Event alerts (Settings, Automation): once a day at the set local time, a
 * push notification names the held symbols that go ex-dividend or report
 * earnings on the next day. On a Friday or Saturday the window runs to the
 * Monday, so a Monday event is not missed over the weekend.
 *
 * Only declared ex-dividend dates count, never projected ones. Each event is
 * sent once: its key (kind, symbol, date) is kept for 45 days in
 * `kv_entries` (db/sent-alerts.repo.ts), so a manual run or a catch-up run
 * does not repeat it. The notification carries tickers and dates only,
 * never quantities, balances or money amounts; log lines carry counts only.
 */
import { loadConfig, updateConfig } from "../config.js";
import { appLogger } from "../logger.js";
import * as portfolioRepo from "../db/portfolio.repo.js";
import * as sentAlerts from "../db/sent-alerts.repo.js";
import { addDaysIso, daysBetween, isoDay } from "./intel/calendar.js";
import type { IncomeService } from "./income.js";
import { channelNames, configuredChannels, notifyAll } from "./notify.js";
import type { AutomationStatus, PortfolioEvent, RunAutomationResponse } from "portfolio-shared/api-types";

const CHECK_INTERVAL_MS = 60_000;
const SENT_TTL_MS = 45 * 24 * 60 * 60 * 1000;

interface AlertSchedule {
  eventAlertsEnabled: boolean;
  eventAlertsTime: string;
  eventAlertsLastRun?: string;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 18) * 60 + (m ?? 0);
}

/** Whether the scheduled run is due: switched on, the set time passed today and no run today yet. */
export function isAlertDue(cfg: AlertSchedule, now: Date): boolean {
  if (!cfg.eventAlertsEnabled) return false;
  if (cfg.eventAlertsLastRun === isoDay(now)) return false;
  return now.getHours() * 60 + now.getMinutes() >= minutesOf(cfg.eventAlertsTime);
}

/** The next time the schedule fires, as an ISO timestamp, or undefined while it is off. */
export function nextAlertRun(cfg: AlertSchedule, now: Date): string | undefined {
  if (!cfg.eventAlertsEnabled) return undefined;
  if (isAlertDue(cfg, now)) return now.toISOString();
  const next = new Date(now);
  const minutes = minutesOf(cfg.eventAlertsTime);
  next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (next <= now || cfg.eventAlertsLastRun === isoDay(now)) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

/** The last day the alerts of `today` cover: tomorrow, or the Monday after a Friday or Saturday. */
export function alertWindowEnd(today: string): string {
  const day = new Date(`${today}T12:00:00`).getDay();
  if (day === 5) return addDaysIso(today, 3);
  if (day === 6) return addDaysIso(today, 2);
  return addDaysIso(today, 1);
}

/** Whether an event is worth a push: a declared ex-dividend date or an earnings report. */
export function isAlertEvent(e: PortfolioEvent): boolean {
  return (e.kind === "exDividend" && !e.estimated) || e.kind === "earnings";
}

export const alertKey = (e: PortfolioEvent) => `${e.kind}:${e.symbol}:${e.date}`;

function dayLabel(date: string): string {
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
  return `${weekday} ${date}`;
}

/** The notification text: one line per event, tickers and dates only. */
export function formatAlertMessage(events: PortfolioEvent[], through: string): string {
  const lines = [`**Events of your holdings up to ${dayLabel(through)}**`];
  for (const e of events) {
    if (e.kind === "exDividend") lines.push(`- ${e.symbol}: ex-dividend date ${dayLabel(e.date)}`);
    else {
      const time = e.time === "bmo" ? ", before the market opens" : e.time === "amc" ? ", after the market closes" : "";
      lines.push(`- ${e.symbol}: earnings report ${dayLabel(e.date)}${time}`);
    }
  }
  lines.push("", "_Open Portfolio for the income and events overview._");
  return lines.join("\n");
}

export class EventAlertsService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private last: AutomationStatus["lastResult"];

  constructor(private readonly income: IncomeService) {}

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
      lastRun: cfg.eventAlertsLastRun,
      nextRun: nextAlertRun(cfg, new Date()),
      channels: configuredChannels(),
      lastResult: this.last,
    };
  }

  private async tick(): Promise<void> {
    if (this.running || !isAlertDue(loadConfig(), new Date())) return;
    await this.run("schedule").catch((err) =>
      appLogger.logStep("error", "event_alerts", "run", `Event alerts failed (${err instanceof Error ? err.name : typeof err})`),
    );
  }

  /** Collects the next day's events of every chosen portfolio and pushes the ones not sent yet. */
  public async run(trigger: "schedule" | "manual"): Promise<RunAutomationResponse> {
    if (this.running) return { success: false, error: "Event alerts are already running.", portfolios: 0, delivered: 0 };
    this.running = true;
    const now = new Date();
    const cfg = loadConfig();
    // The schedule marks the day first, so a failure does not retry every minute.
    if (trigger === "schedule") updateConfig({ eventAlertsLastRun: isoDay(now) });

    const today = isoDay(now);
    const through = alertWindowEnd(today);
    const portfolios = portfolioRepo.findAll().filter((p) => !cfg.eventAlertsPortfolioId || p.id === cfg.eventAlertsPortfolioId);
    const channels = configuredChannels();
    const errors: string[] = [];
    const found = new Map<string, PortfolioEvent>();
    let scanned = 0;
    let delivered = 0;
    let message = "";
    const timer = appLogger.startTimer("event_alerts", "run", `Checking the next day's events (${trigger}) for ${portfolios.length} portfolio(s)`);

    try {
      for (const p of portfolios) {
        try {
          const res = await this.income.getUpcomingEvents(p.id, daysBetween(today, through));
          scanned++;
          for (const e of res.events) {
            if (e.date > today && e.date <= through && isAlertEvent(e)) found.set(alertKey(e), e);
          }
        } catch (err) {
          errors.push(`${p.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const sent = sentAlerts.findSent([...found.keys()]);
      const fresh = [...found.entries()].filter(([key]) => !sent.has(key));
      fresh.sort(([, a], [, b]) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

      if (fresh.length === 0) {
        message =
          found.size > 0
            ? "Every ex-dividend date and earnings report of the next day was already sent."
            : "No ex-dividend dates or earnings reports of held symbols on the next day.";
      } else if (channels.length === 0) {
        message = `Found ${fresh.length} event(s). Set up Gotify or ntfy under Integrations to receive them as push notifications.`;
      } else {
        const result = await notifyAll({ title: "Portfolio: upcoming events", message: formatAlertMessage(fresh.map(([, e]) => e), through) }, channels);
        errors.push(...result.errors);
        if (result.ok) {
          sentAlerts.markSent(fresh.map(([key]) => key), SENT_TTL_MS);
          delivered = 1;
          message = `Sent ${fresh.length} event(s) through ${channelNames(channels)}.`;
        } else {
          message = "The notification failed. The events will be sent on the next run.";
        }
      }
    } finally {
      this.running = false;
    }

    const unique = [...new Set(errors)];
    const success = unique.length === 0;
    this.last = { at: now.toISOString(), trigger, success, message, errors: unique };
    timer.end(success ? "success" : "warning", `Event alerts: ${found.size} event(s) found, ${delivered} notification(s) sent, ${unique.length} problem(s)`);
    return { success, portfolios: scanned, delivered, message, error: unique[0] };
  }
}
