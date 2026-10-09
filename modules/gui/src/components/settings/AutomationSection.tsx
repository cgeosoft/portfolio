import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BellRing, Briefcase, CalendarClock, CalendarDays, CalendarRange, Clock, History, Loader2, Newspaper, Play, ShieldCheck, type LucideIcon } from "lucide-react";
import type { AutomationStatus, DailyBriefDays, DesktopConfig, NotificationChannel, RunAutomationResponse } from "portfolio-shared/api-types";
import type { PortfolioItem } from "portfolio-shared/portfolio";
import { api } from "../../api";
import { Select } from "../common/Select";
import { SectionHeader, SettingItem, Toggle } from "./SettingsFields";
import { ChoiceButton, StatusLine, type SidebarSection, type StatusResult } from "./SettingsPrimitives";

export type AutomationId = "daily-brief" | "weekly-analysis" | "event-alerts";

/** The cards of the Automation section, listed as its submenu in the Preferences sidebar. */
export const AUTOMATIONS: (SidebarSection & { id: AutomationId })[] = [
  { id: "daily-brief", label: "Daily brief", icon: Newspaper },
  { id: "weekly-analysis", label: "Weekly analysis", icon: CalendarRange },
  { id: "event-alerts", label: "Event alerts", icon: CalendarClock },
];

const DAILY_OPTIONS: { value: DailyBriefDays; label: string }[] = [
  { value: "weekdays", label: "Mon to Fri" },
  { value: "daily", label: "Every day" },
];

/** Monday first, with the JavaScript day numbers the service stores. */
const WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/** How often a card refreshes the status while it is open, so a scheduled run shows up. */
const STATUS_POLL_MS = 30_000;

type ConfigKey<T> = { [K in keyof DesktopConfig]-?: DesktopConfig[K] extends T ? K : never }[keyof DesktopConfig];

/** What differs between the automations; the card draws the rest the same way. */
interface AutomationDefinition {
  icon: LucideIcon;
  title: string;
  blurb: string;
  toggleTitle: string;
  toggleDescription: string;
  enabledKey: ConfigKey<boolean>;
  timeKey: ConfigKey<string>;
  portfolioKey: ConfigKey<string>;
  timeDescription: string;
  portfolioDescription: string;
  /** What goes to the notification channels, after "Each ... goes to". */
  delivered: string;
  /** Where the result stays without a channel. */
  stored: string;
  privacy: string;
  /** "brief" or "analysis", for the status texts. */
  noun: string;
  runningText: string;
  loadStatus: () => Promise<AutomationStatus>;
  run: () => Promise<RunAutomationResponse>;
  /** The row that picks the days; none for an automation that runs every day. */
  days?: (config: DesktopConfig, save: (updates: Partial<DesktopConfig>) => void, saving: boolean) => ReactNode;
}

const DEFINITIONS: Record<AutomationId, AutomationDefinition> = {
  "daily-brief": {
    icon: Newspaper,
    title: "Daily Brief",
    blurb: "Each morning the assistant sums up the last trading session and sends it to your phone.",
    toggleTitle: "Send a daily brief",
    toggleDescription:
      "The assistant writes a short overview of each portfolio: the return of the session, the largest moves, news that explains them and new transactions. The brief also lands in the assistant sidebar, so you can ask follow-up questions.",
    enabledKey: "dailyBriefEnabled",
    timeKey: "dailyBriefTime",
    portfolioKey: "dailyBriefPortfolioId",
    timeDescription:
      "Local time of this computer. Portfolio must be running, in the window or the tray. If it was not running at that time, the brief goes out when it starts.",
    portfolioDescription: "One brief and one notification per portfolio.",
    delivered: "Each brief goes",
    stored: "The briefs still land in the assistant sidebar",
    privacy:
      "Percentages, weights, tickers and transaction types, as in the assistant chat. Never balances or money amounts. News headlines come from Finnhub when a Finnhub key is set.",
    noun: "brief",
    runningText: "Refreshing quotes and writing the brief...",
    loadStatus: api.getDailyBriefStatus,
    run: api.runDailyBrief,
    days: (config, save, saving) => (
      <SettingItem icon={CalendarDays} title="Days" description="On Monday to Friday, the Monday brief covers the Friday session.">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Days">
          {DAILY_OPTIONS.map((option) => (
            <ChoiceButton
              key={option.value}
              active={config.dailyBriefDays === option.value}
              disabled={saving}
              onClick={() => config.dailyBriefDays !== option.value && save({ dailyBriefDays: option.value })}
            >
              {option.label}
            </ChoiceButton>
          ))}
        </div>
      </SettingItem>
    ),
  },
  "weekly-analysis": {
    icon: CalendarRange,
    title: "Weekly Analysis",
    blurb: "Once a week the assistant writes the weekly report of each portfolio and sends you a summary.",
    toggleTitle: "Write a weekly analysis",
    toggleDescription:
      "The assistant writes the full weekly report, the same one as Reports, Generate: performance, allocation, risk, technical signals and the news of the week. It is stored under Reports; your notification apps get a short summary.",
    enabledKey: "weeklyAnalysisEnabled",
    timeKey: "weeklyAnalysisTime",
    portfolioKey: "weeklyAnalysisPortfolioId",
    timeDescription:
      "Local time of this computer. Portfolio must be running, in the window or the tray. If it was not running at that time, the analysis runs when it starts within two days.",
    portfolioDescription: "One report and one notification per portfolio.",
    delivered: "A short summary of each report goes",
    stored: "The reports are still stored under Reports",
    privacy:
      "The report sees what Reports, Generate sends to your LLM provider. The notification summary carries percentages and tickers only, never balances or money amounts.",
    noun: "analysis",
    runningText: "Refreshing quotes and writing the weekly report. This can take a few minutes...",
    loadStatus: api.getWeeklyAnalysisStatus,
    run: api.runWeeklyAnalysis,
    days: (config, save, saving) => (
      <SettingItem
        icon={CalendarDays}
        title="Day of the week"
        description="The report covers the week of the day before, so a run on Saturday or Sunday covers the week that just closed and a run on Monday the week before."
      >
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Day of the week">
          {WEEKDAY_OPTIONS.map((option) => (
            <ChoiceButton
              key={option.value}
              active={config.weeklyAnalysisDay === option.value}
              disabled={saving}
              onClick={() => config.weeklyAnalysisDay !== option.value && save({ weeklyAnalysisDay: option.value })}
            >
              {option.label}
            </ChoiceButton>
          ))}
        </div>
      </SettingItem>
    ),
  },
  "event-alerts": {
    icon: CalendarClock,
    title: "Event Alerts",
    blurb: "Each day a push notification names the holdings that go ex-dividend or report earnings on the next day.",
    toggleTitle: "Send event alerts",
    toggleDescription:
      "Covers declared ex-dividend dates and earnings reports of held stocks and funds. On Friday and Saturday the alert covers the days up to Monday. Each event goes out once, even after a manual run.",
    enabledKey: "eventAlertsEnabled",
    timeKey: "eventAlertsTime",
    portfolioKey: "eventAlertsPortfolioId",
    timeDescription:
      "Local time of this computer. Portfolio must be running, in the window or the tray. If it was not running at that time, the alert goes out when it starts.",
    portfolioDescription: "One notification lists the events of every chosen portfolio.",
    delivered: "Each alert goes",
    stored: "The dates still show in the Income & events card",
    privacy:
      "The alert names tickers and dates only. Never quantities, balances or money amounts. The dates come from FMP, Yahoo Finance or Finnhub, whichever has them.",
    noun: "alert",
    runningText: "Checking the dividend and earnings dates of the next day...",
    loadStatus: api.getEventAlertsStatus,
    run: api.runEventAlerts,
  },
};

interface SectionProps {
  config: DesktopConfig;
  onConfigChange: (config: DesktopConfig) => void;
  portfolios: PortfolioItem[];
  /** Opens Settings, Integrations. */
  onOpenIntegrations: () => void;
}

const CHANNEL_NAMES: Record<NotificationChannel, string> = { gotify: "Gotify", ntfy: "ntfy" };

/** The Delivery text for the set-up channels. */
function deliveryText(def: AutomationDefinition, channels: NotificationChannel[]): string {
  if (channels.length === 0) {
    return `No notification channel is set up. ${def.stored}, but no push notification goes out. Set up Gotify or ntfy under Integrations.`;
  }
  const names = channels.map((c) => CHANNEL_NAMES[c]).join(" and ");
  return `${def.delivered} to ${names} as a push notification.`;
}

const formatWhen = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/** One scheduled assistant task: switch, schedule, portfolios, delivery through the notification channels and the last run. */
function AutomationCard({ def, config, onConfigChange, portfolios, onOpenIntegrations }: SectionProps & { def: AutomationDefinition }) {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [result, setResult] = useState<StatusResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const storedTime = config[def.timeKey];
  const [time, setTime] = useState(storedTime);

  useEffect(() => setTime(storedTime), [storedTime]);

  const loadStatus = useCallback(() => {
    def.loadStatus().then(setStatus).catch(() => {});
  }, [def]);

  useEffect(() => {
    loadStatus();
    const timer = setInterval(loadStatus, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [loadStatus]);

  const save = async (updates: Partial<DesktopConfig>) => {
    setSaving(true);
    setResult(null);
    try {
      onConfigChange(await api.saveConfig(updates));
      loadStatus();
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setSending(true);
    setResult(null);
    try {
      const res = await def.run();
      setResult({ ok: res.success, message: res.success ? (res.message ?? "Done.") : (res.error ?? res.message ?? `The ${def.noun} failed.`) });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSending(false);
      loadStatus();
    }
  };

  const commitTime = () => {
    if (/^\d{2}:\d{2}$/.test(time) && time !== storedTime) save({ [def.timeKey]: time });
  };

  const enabled = config[def.enabledKey];
  const portfolioId = config[def.portfolioKey];
  const channels = status?.channels ?? [];
  const portfolioKnown = !portfolioId || portfolios.some((p) => p.id === portfolioId);
  const last = status?.lastResult;
  const busy = sending || Boolean(status?.running);

  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-5">
      <SectionHeader
        icon={def.icon}
        title={def.title}
        description={def.blurb}
        actions={
          <span
            className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
              enabled ? "bg-accent-500/15 text-accent-500 border-accent-500/30" : "bg-slate-800/60 text-slate-400 border-slate-700"
            }`}
          >
            {enabled ? "Scheduled" : "Off"}
          </span>
        }
      />

      <div className="divide-y divide-slate-800/80 -mt-2">
        <SettingItem
          icon={def.icon}
          title={def.toggleTitle}
          description={def.toggleDescription}
          control={<Toggle checked={enabled} disabled={saving} onChange={() => save({ [def.enabledKey]: !enabled })} label={def.toggleTitle} />}
        />

        <SettingItem
          icon={Clock}
          title="Time of day"
          description={`${def.timeDescription}${enabled && status?.nextRun ? ` Next ${def.noun} ${formatWhen(status.nextRun)}.` : ""}`}
          control={
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              onBlur={commitTime}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              disabled={saving}
              aria-label="Time of day"
              className="h-9 w-28 shrink-0 bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-accent-500 rounded-lg px-2.5 text-xs text-slate-100 focus:outline-none transition-colors font-mono"
            />
          }
        />

        {def.days?.(config, save, saving)}

        <SettingItem icon={Briefcase} title="Portfolios" description={def.portfolioDescription}>
          <Select
            value={portfolioKnown ? portfolioId : ""}
            onChange={(e) => save({ [def.portfolioKey]: e.target.value })}
            disabled={saving}
            selectSize="lg"
            icon={<Briefcase className="w-4 h-4" />}
            aria-label={`Portfolios of the ${def.noun}`}
          >
            <option value="">All portfolios</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </SettingItem>

        <SettingItem
          icon={BellRing}
          title="Delivery"
          description={status ? deliveryText(def, channels) : "Checking the notification channels..."}
          control={
            <button
              type="button"
              onClick={onOpenIntegrations}
              className="h-8 shrink-0 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-800 bg-slate-950/60 text-[11px] font-bold text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5 text-accent-500" />
              {channels.length > 0 ? "Integrations" : "Set up"}
            </button>
          }
        />

        <SettingItem icon={ShieldCheck} title="What the assistant sees" description={def.privacy} />

        <SettingItem
          icon={History}
          title={`Last ${def.noun}`}
          description={
            last
              ? `${formatWhen(last.at)} (${last.trigger === "schedule" ? "scheduled" : "run by hand"}). ${last.message}`
              : status?.lastRun
                ? `Last scheduled ${def.noun} on ${status.lastRun}.`
                : `No ${def.noun} yet.`
          }
          control={
            <button
              type="button"
              onClick={runNow}
              disabled={busy || portfolios.length === 0}
              title={`Write and send the ${def.noun} now. The scheduled ${def.noun} still runs.`}
              className="h-8 shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-500" /> : <Play className="w-3.5 h-3.5 text-accent-500" />}
              Run now
            </button>
          }
        >
          {last && last.errors.length > 0 && (
            <div className="space-y-1">
              {last.errors.map((error) => (
                <StatusLine key={error} result={{ ok: false, message: error }} />
              ))}
            </div>
          )}
        </SettingItem>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-slate-800/80 min-h-[2rem]">
        {saving ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
          </span>
        ) : sending ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {def.runningText}
          </span>
        ) : result ? (
          <StatusLine result={result} />
        ) : (
          <span className="text-[11px] text-slate-500">Changes save right away.</span>
        )}
      </div>
    </div>
  );
}

/** The Automation section: one card per automation of the submenu. */
export function AutomationSection({ automation, ...props }: SectionProps & { automation: AutomationId }) {
  return <AutomationCard key={automation} def={DEFINITIONS[automation]} {...props} />;
}
