/**
 * Daily brief (Settings, Automation): once a day at the set local time the
 * assistant writes a short overview of the last trading session for each
 * portfolio, stores it as an assistant conversation (so the sidebar can
 * follow up on it) and pushes it to every notification channel that is set
 * up (Gotify, ntfy).
 *
 * The prompt carries percentages, weights, tickers and transaction types
 * only, never money amounts, like the assistant chat. A day the service was
 * not running at the set time catches up on its next start.
 *
 * Headlines of the largest movers come through the provider chain (FMP stock
 * news, then Finnhub company news); earnings, ex-dividend dates and splits
 * of held symbols today and tomorrow come from income.ts. The scheduled
 * brief skips a portfolio when none of its markets traded since the last
 * brief and none trades today (weekends, holidays). "Send now" always runs.
 */
import { loadConfig, updateConfig } from "../config";
import { appLogger } from "../logger";
import * as portfolioRepo from "../db/portfolio.repo";
import * as conversationRepo from "../db/conversation.repo";
import type { LlmService, LlmMessage } from "./llm";
import type { PortfolioService } from "./portfolio";
import { formatEventsForPrompt, type AiContextDeps } from "./ai-context";
import { getCompanyNews } from "./intel/company";
import { exchangeForSymbol, isTradingDay } from "./intel/market-hours";
import { channelNames, configuredChannels, notifyAll } from "./notify";
import type { AutomationStatus, RunAutomationResponse } from "portfolio-shared/api-types";
import type { FinancialPortfolioData, PortfolioItem } from "portfolio-shared/portfolio";

const CHECK_INTERVAL_MS = 60_000;
/** Transactions older than this are not "since the last brief", even after a long break. */
const MAX_LOOKBACK_DAYS = 7;
const MOVERS_PER_SIDE = 5;
const NEWS_SYMBOLS = 3;
const NEWS_PER_SYMBOL = 2;

/** Local calendar date, YYYY-MM-DD. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

/**
 * Whether the scheduled brief is due at `now`: switched on, a run day, the
 * set time has passed, and no brief ran today yet.
 */
export function isBriefDue(
  cfg: { dailyBriefEnabled: boolean; dailyBriefTime: string; dailyBriefDays: string; dailyBriefLastRun?: string },
  now: Date,
): boolean {
  if (!cfg.dailyBriefEnabled) return false;
  if (cfg.dailyBriefLastRun === localDate(now)) return false;
  const day = now.getDay();
  if (cfg.dailyBriefDays === "weekdays" && (day === 0 || day === 6)) return false;
  const [h, m] = cfg.dailyBriefTime.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= (h ?? 8) * 60 + (m ?? 0);
}

/** The next time the schedule fires, as an ISO timestamp, or undefined while it is off. */
export function nextBriefRun(
  cfg: { dailyBriefEnabled: boolean; dailyBriefTime: string; dailyBriefDays: string; dailyBriefLastRun?: string },
  now: Date,
): string | undefined {
  if (!cfg.dailyBriefEnabled) return undefined;
  if (isBriefDue(cfg, now)) return now.toISOString();
  const [h, m] = cfg.dailyBriefTime.split(":").map(Number);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(h ?? 8, m ?? 0, 0, 0);
    if (candidate <= now) continue;
    const day = candidate.getDay();
    if (cfg.dailyBriefDays === "weekdays" && (day === 0 || day === 6)) continue;
    if (cfg.dailyBriefLastRun === localDate(candidate)) continue;
    return candidate.toISOString();
  }
  return undefined;
}

const pct = (value = 0) => `${value.toFixed(2)}%`;
const signedPct = (value = 0) => `${value >= 0 ? "+" : ""}${pct(value)}`;

interface BriefContext {
  portfolio: PortfolioItem;
  data: FinancialPortfolioData;
  since: string;
  today: string;
  news: string[];
  /** Earnings, ex-dividend dates and splits of held symbols today and tomorrow, as prompt lines. */
  events?: string;
}

/** The holdings of the last session, largest gains first and largest losses last. */
function movers(data: FinancialPortfolioData) {
  const held = (data.holdings ?? []).filter((h) => h.assetType !== "Cash" && h.shares > 0);
  const sorted = [...held].sort((a, b) => (b.dayChangePercent ?? 0) - (a.dayChangePercent ?? 0));
  const up = sorted.filter((h) => (h.dayChangePercent ?? 0) > 0).slice(0, MOVERS_PER_SIDE);
  const down = sorted.filter((h) => (h.dayChangePercent ?? 0) < 0).slice(-MOVERS_PER_SIDE).reverse();
  return { up, down, count: held.length };
}

/** Transactions dated from `since` up to yesterday: type, quantity and ticker, no amounts. */
function recentTransactions(data: FinancialPortfolioData, since: string, today: string): string[] {
  return (data.transactions ?? [])
    .filter((tx) => tx.date && tx.date.slice(0, 10) >= since && tx.date.slice(0, 10) < today)
    .map((tx) => `- ${tx.date.slice(0, 10)} [${tx.type}] ${tx.shares ? `${tx.shares} ` : ""}${tx.symbol || ""}`.trim());
}

export function buildDailyBriefPrompt(ctx: BriefContext): LlmMessage[] {
  const { portfolio, data, since, today, news, events } = ctx;
  const s = data.summary;
  const { up, down, count } = movers(data);
  const line = (h: (typeof up)[number]) => `- ${h.symbol} (${h.name}): ${signedPct(h.dayChangePercent)} on the day, weight ${pct(h.weightPercent)}`;
  const txs = recentTransactions(data, since, today);

  const context = `=== PORTFOLIO ===
Name: ${portfolio.name}
Holdings: ${count}
Last session return of the whole portfolio: ${signedPct(s?.dayGainLossPercent)}
Lifetime unrealized return: ${signedPct(s?.totalGainLossPercent)}
Cash weight: ${pct(s?.cashWeightPercent)}
Best performer of the session: ${s?.bestPerformer ? `${s.bestPerformer.symbol} ${signedPct(s.bestPerformer.changePercent)}` : "none"}
Worst performer of the session: ${s?.worstPerformer ? `${s.worstPerformer.symbol} ${signedPct(s.worstPerformer.changePercent)}` : "none"}

=== GAINERS OF THE LAST SESSION ===
${up.map(line).join("\n") || "None."}

=== DECLINERS OF THE LAST SESSION ===
${down.map(line).join("\n") || "None."}

=== TRANSACTIONS SINCE ${since} ===
${txs.join("\n") || "None."}

=== NEWS OF THE LARGEST MOVERS ===
${news.join("\n") || "No news available."}${events ? `\n\n=== EVENTS OF HELD SYMBOLS TODAY AND TOMORROW ===\n${events}` : ""}`;

  return [
    {
      role: "system",
      content: `You are the portfolio assistant. Write the user's daily brief: a quick overview of what happened in their portfolio during the last trading session.
Use ASD-STE100 Simplified English. Do not use long dashes. Do not use emojis.
Use only the data given. Never invent prices, amounts, news or events. Do not give buy or sell advice.
Output Markdown only, at most 120 words:
- One bold first line with the portfolio return of the session.
- Then 2 to 4 short bullet points: the largest moves and their weight, a news item that explains a move when one is given, and any transactions.
- End with one short line on anything to watch, based only on the data. Name the earnings reports and ex-dividend dates of today and tomorrow when they are given.`,
    },
    { role: "user", content: `Today is ${today}. Write the daily brief.\n\n${context}` },
  ];
}

/** The brief without the assistant: the numbers of the session as a short list. */
export function fallbackBrief(ctx: BriefContext): string {
  const { data, since, today } = ctx;
  const { up, down } = movers(data);
  const lines = [`**Session return ${signedPct(data.summary?.dayGainLossPercent)}**`];
  if (up[0]) lines.push(`- Top gainer: ${up[0].symbol} ${signedPct(up[0].dayChangePercent)}`);
  if (down[0]) lines.push(`- Top decliner: ${down[0].symbol} ${signedPct(down[0].dayChangePercent)}`);
  const txs = recentTransactions(data, since, today).length;
  if (txs > 0) lines.push(`- ${txs} transaction${txs === 1 ? "" : "s"} since ${since}`);
  if (ctx.events) lines.push(...ctx.events.split("\n").slice(0, 3));
  lines.push("", "_The assistant was not available, so this brief shows the numbers only._");
  return lines.join("\n");
}

export class DailyBriefService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private last: AutomationStatus["lastResult"];

  constructor(
    private readonly llm: LlmService,
    private readonly portfolioService: PortfolioService,
    private readonly aiContext: AiContextDeps,
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
      lastRun: cfg.dailyBriefLastRun,
      nextRun: nextBriefRun(cfg, new Date()),
      channels: configuredChannels(),
      lastResult: this.last,
    };
  }

  private async tick(): Promise<void> {
    if (this.running || !isBriefDue(loadConfig(), new Date())) return;
    await this.run("schedule").catch((err) => appLogger.logStep("error", "brief", "run", `Daily brief failed: ${err instanceof Error ? err.message : err}`));
  }

  /** Writes and sends the brief now. The Automation card's "Send now" button and the schedule both land here. */
  public async run(trigger: "schedule" | "manual"): Promise<RunAutomationResponse> {
    if (this.running) return { success: false, error: "A daily brief is already running.", portfolios: 0, delivered: 0 };
    this.running = true;
    const now = new Date();
    const today = localDate(now);
    const cfg = loadConfig();
    // The schedule marks the day first, so a failure does not retry every minute.
    // "Send now" leaves the mark alone, so the scheduled brief still runs today.
    if (trigger === "schedule") updateConfig({ dailyBriefLastRun: today });
    const yesterday = addDays(today, -1);
    const floor = addDays(today, -MAX_LOOKBACK_DAYS);
    const previous = cfg.dailyBriefLastRun && cfg.dailyBriefLastRun < today ? cfg.dailyBriefLastRun : yesterday;
    const since = previous < floor ? floor : previous;

    const portfolios = portfolioRepo.findAll().filter((p) => !cfg.dailyBriefPortfolioId || p.id === cfg.dailyBriefPortfolioId);
    const channels = configuredChannels();
    const errors: string[] = [];
    let delivered = 0;
    let written = 0;
    let skipped = 0;
    const timer = appLogger.startTimer("brief", "run", `Writing the daily brief (${trigger}) for ${portfolios.length} portfolio(s)`);

    try {
      for (const row of portfolios) {
        const portfolio: PortfolioItem = { id: row.id, name: row.name, description: row.description, baseCurrency: row.baseCurrency };
        try {
          const data = await this.portfolioService.getPortfolioData(row.id, row.baseCurrency || cfg.baseCurrency || "EUR", true);
          this.portfolioService.saveDailySnapshot(row.id, data);
          if (trigger === "schedule" && !(await this.hadSession(data, since, today))) {
            skipped++;
            continue;
          }
          const [news, events] = await Promise.all([this.news(data, since), this.events(row.id, today)]);
          const ctx: BriefContext = { portfolio, data, since, today, news, events };

          let content: string;
          try {
            content = (await this.llm.chat(buildDailyBriefPrompt(ctx), this.llm.resolve())).trim();
            if (!content) throw new Error("The assistant returned an empty reply");
          } catch (err) {
            errors.push(`Assistant: ${err instanceof Error ? err.message : String(err)}`);
            content = fallbackBrief(ctx);
          }

          conversationRepo.upsert({
            id: `brief_${row.id}_${today}`,
            portfolioId: row.id,
            title: `Daily brief ${today}`,
            messages: JSON.stringify([
              { role: "user", content: `Daily brief for ${today}: what happened in the last trading session?` },
              { role: "assistant", content },
            ]),
          });
          written++;

          if (channels.length > 0) {
            const sent = await notifyAll({ title: `${row.name}: daily brief`, message: content }, channels);
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
    const allSkipped = skipped > 0 && written === 0 && unique.length === 0;
    const success = allSkipped || (written > 0 && delivered === (channels.length > 0 ? written : 0));
    const skippedNote = skipped > 0 ? ` Skipped ${skipped} portfolio(s): no held market traded since the last brief.` : "";
    const message =
      channels.length === 0
        ? `Wrote ${written} brief(s) to the assistant. Set up Gotify or ntfy under Integrations to receive them as push notifications.${skippedNote}`
        : `Wrote ${written} brief(s) and delivered ${delivered} through ${channelNames(channels)}.${skippedNote}`;
    this.last = { at: now.toISOString(), trigger, success, message, errors: unique };
    timer.end(success ? "success" : "warning", `Daily brief: ${written} written, ${delivered} delivered, ${skipped} skipped, ${unique.length} problem(s)`);
    return { success, portfolios: written, delivered, message, error: unique[0] };
  }

  /**
   * Whether any market of the held symbols traded from `since` to today
   * (exchange-local dates). Crypto trades every day. True when no holding
   * maps to a known market, so nothing is skipped by mistake.
   */
  private async hadSession(data: FinancialPortfolioData, since: string, today: string): Promise<boolean> {
    const codes = new Set<string>();
    for (const h of data.holdings ?? []) {
      if (h.isPrivate || h.assetType === "Cash" || !(h.shares > 0)) continue;
      const code = exchangeForSymbol(h.symbol, h.assetType);
      if (code) codes.add(code === "NASDAQ" || code === "AMEX" ? "NYSE" : code);
    }
    if (codes.size === 0) return true;
    try {
      for (let day = since; day <= today; day = addDays(day, 1)) {
        for (const code of codes) if (await isTradingDay(code, day, this.aiContext.fmp)) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Headlines of the largest movers since the last brief, through the
   * provider chain: FMP stock news, then Finnhub company news. Empty without
   * a news provider.
   */
  private async news(data: FinancialPortfolioData, since: string): Promise<string[]> {
    const top = (data.holdings ?? [])
      .filter((h) => (h.assetType === "Stock" || h.assetType === "ETF") && !h.isPrivate)
      .sort((a, b) => Math.abs(b.dayChangePercent ?? 0) - Math.abs(a.dayChangePercent ?? 0))
      .slice(0, NEWS_SYMBOLS);
    const sinceUnix = Math.floor(new Date(`${since}T00:00:00`).getTime() / 1000);
    const lists = await Promise.all(
      top.map(async (h) => {
        try {
          const res = await getCompanyNews(this.aiContext, h.symbol);
          const items = (res?.data ?? []).filter((n) => !n.datetime || n.datetime >= sinceUnix).slice(0, NEWS_PER_SYMBOL);
          return items.map((n) => `- ${h.symbol}: ${n.title}${res ? ` [${res.source}]` : ""}`);
        } catch {
          return []; // News is optional.
        }
      }),
    );
    return lists.flat();
  }

  /** Earnings, ex-dividend dates and splits of held symbols today and tomorrow, or undefined when none. */
  private async events(portfolioId: string, today: string): Promise<string | undefined> {
    try {
      const res = await this.aiContext.income.getUpcomingEvents(portfolioId, 2);
      return formatEventsForPrompt(res, { kinds: ["earnings", "exDividend", "split"], maxLines: 8, from: today, to: addDays(today, 1) }) || undefined;
    } catch {
      return undefined; // Events are optional.
    }
  }
}
