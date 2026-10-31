import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BellRing, Briefcase, CalendarClock, CalendarDays, CalendarRange, Clock, History, Loader2, Newspaper, Play, ShieldCheck, type LucideIcon } from "lucide-react";
import type { AutomationStatus, DailyBriefDays, DesktopConfig, NotificationChannel, RunAutomationResponse } from "portfolio-shared/api-types";
import type { PortfolioItem } from "portfolio-shared/portfolio";
import { api } from "../../api";
import { getLocale, t } from "../../i18n";
import { Select } from "../common/Select";
import { SectionHeader, SettingItem, Toggle } from "./SettingsFields";
import { ChoiceButton, StatusLine, type StatusResult } from "./SettingsPrimitives";
import type { AutomationId } from "./settings-nav";

const DAILY_OPTIONS: { value: DailyBriefDays; key: string }[] = [
  { value: "weekdays", key: "weekdays" },
  { value: "daily", key: "daily" },
];

/** Monday first, with the JavaScript day numbers the service stores; `key` names the label under settings.automation.weekdays. */
const WEEKDAY_OPTIONS = [
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
  { value: 0, key: "sun" },
];

/** How often a card refreshes the status while it is open, so a scheduled run shows up. */
const STATUS_POLL_MS = 30_000;

type ConfigKey<T> = { [K in keyof DesktopConfig]-?: DesktopConfig[K] extends T ? K : never }[keyof DesktopConfig];

/**
 * What differs between the automations; the card draws the rest the same way.
 * The texts live in en.yml under `settings.automation.<messages>`: title,
 * blurb, toggleTitle, toggleDescription, timeDescription,
 * portfolioDescription, privacy, runningText and the status sentences.
 */
interface AutomationDefinition {
  icon: LucideIcon;
  /** i18n group of the texts: `settings.automation.<messages>.*`. */
  messages: string;
  enabledKey: ConfigKey<boolean>;
  timeKey: ConfigKey<string>;
  portfolioKey: ConfigKey<string>;
  loadStatus: () => Promise<AutomationStatus>;
  run: () => Promise<RunAutomationResponse>;
  /** The row that picks the days; none for an automation that runs every day. */
  days?: (config: DesktopConfig, save: (updates: Partial<DesktopConfig>) => void, saving: boolean) => ReactNode;
}

const DEFINITIONS: Record<AutomationId, AutomationDefinition> = {
  "daily-brief": {
    icon: Newspaper,
    messages: "dailyBrief",
    enabledKey: "dailyBriefEnabled",
    timeKey: "dailyBriefTime",
    portfolioKey: "dailyBriefPortfolioId",
    loadStatus: api.getDailyBriefStatus,
    run: api.runDailyBrief,
    days: (config, save, saving) => (
      <SettingItem icon={CalendarDays} title={t("settings.automation.days")} description={t("settings.automation.daysDescription")}>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("settings.automation.days")}>
          {DAILY_OPTIONS.map((option) => (
            <ChoiceButton
              key={option.value}
              active={config.dailyBriefDays === option.value}
              disabled={saving}
              onClick={() => config.dailyBriefDays !== option.value && save({ dailyBriefDays: option.value })}
            >
              {t(`settings.automation.dailyOptions.${option.key}`)}
            </ChoiceButton>
          ))}
        </div>
      </SettingItem>
    ),
  },
  "weekly-analysis": {
    icon: CalendarRange,
    messages: "weeklyReport",
    enabledKey: "weeklyAnalysisEnabled",
    timeKey: "weeklyAnalysisTime",
    portfolioKey: "weeklyAnalysisPortfolioId",
    loadStatus: api.getWeeklyAnalysisStatus,
    run: api.runWeeklyAnalysis,
    days: (config, save, saving) => (
      <SettingItem icon={CalendarDays} title={t("settings.automation.weekday")} description={t("settings.automation.weekdayDescription")}>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("settings.automation.weekday")}>
          {WEEKDAY_OPTIONS.map((option) => (
            <ChoiceButton
              key={option.value}
              active={config.weeklyAnalysisDay === option.value}
              disabled={saving}
              onClick={() => config.weeklyAnalysisDay !== option.value && save({ weeklyAnalysisDay: option.value })}
            >
              {t(`settings.automation.weekdays.${option.key}`)}
            </ChoiceButton>
          ))}
        </div>
      </SettingItem>
    ),
  },
  "event-alerts": {
    icon: CalendarClock,
    messages: "eventAlerts",
    enabledKey: "eventAlertsEnabled",
    timeKey: "eventAlertsTime",
    portfolioKey: "eventAlertsPortfolioId",
    loadStatus: api.getEventAlertsStatus,
    run: api.runEventAlerts,
  },
};

interface SectionProps {
  config: DesktopConfig;
  onConfigChange: (config: DesktopConfig) => void;
  portfolios: PortfolioItem[];
  /** Opens Settings, Notifications, Phone Apps. */
  onOpenPhoneSetup: () => void;
}

const CHANNEL_NAMES: Record<NotificationChannel, string> = { gotify: "Gotify", ntfy: "ntfy" };

/** The text `settings.automation.<messages>.<name>` of an automation. */
const msg = (def: AutomationDefinition, name: string, params?: Record<string, string | number>) => t(`settings.automation.${def.messages}.${name}`, params);

/** The Delivery text for the set-up channels. */
function deliveryText(def: AutomationDefinition, channels: NotificationChannel[]): string {
  if (channels.length === 0) return msg(def, "noChannel");
  const names = new Intl.ListFormat(getLocale(), { type: "conjunction" }).format(channels.map((c) => CHANNEL_NAMES[c]));
  return msg(def, "delivered", { channels: names });
}

const formatWhen = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(getLocale(), { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/** One scheduled assistant task: switch, schedule, portfolios, delivery through the notification channels and the last run. */
function AutomationCard({ def, config, onConfigChange, portfolios, onOpenPhoneSetup }: SectionProps & { def: AutomationDefinition }) {
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
      setResult({ ok: res.success, message: res.success ? (res.message ?? t("settings.automation.done")) : (res.error ?? res.message ?? msg(def, "failed")) });
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
        title={msg(def, "title")}
        description={msg(def, "blurb")}
        actions={
          <span
            className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
              enabled ? "bg-accent-500/15 text-accent-500 border-accent-500/30" : "bg-slate-800/60 text-slate-400 border-slate-700"
            }`}
          >
            {enabled ? t("settings.automation.scheduled") : t("settings.automation.off")}
          </span>
        }
      />

      <div className="divide-y divide-slate-800/80">
        <SettingItem
          icon={def.icon}
          title={msg(def, "toggleTitle")}
          description={msg(def, "toggleDescription")}
          control={<Toggle checked={enabled} disabled={saving} onChange={() => save({ [def.enabledKey]: !enabled })} label={msg(def, "toggleTitle")} />}
        />

        <SettingItem
          icon={Clock}
          title={t("settings.automation.timeOfDay")}
          description={`${msg(def, "timeDescription")}${enabled && status?.nextRun ? ` ${msg(def, "nextRun", { when: formatWhen(status.nextRun) })}` : ""}`}
          control={
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              onBlur={commitTime}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              disabled={saving}
              aria-label={t("settings.automation.timeOfDay")}
              className="h-9 w-28 shrink-0 bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-accent-500 rounded-lg px-2.5 text-xs text-slate-100 focus:outline-hidden transition-colors font-mono"
            />
          }
        />

        {def.days?.(config, save, saving)}

        <SettingItem icon={Briefcase} title={t("settings.automation.portfolios")} description={msg(def, "portfolioDescription")}>
          <Select
            value={portfolioKnown ? portfolioId : ""}
            onChange={(e) => save({ [def.portfolioKey]: e.target.value })}
            disabled={saving}
            selectSize="lg"
            icon={<Briefcase className="w-4 h-4" />}
            aria-label={msg(def, "portfoliosLabel")}
          >
            <option value="">{t("settings.automation.allPortfolios")}</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </SettingItem>

        <SettingItem
          icon={BellRing}
          title={t("settings.automation.delivery")}
          description={status ? deliveryText(def, channels) : t("settings.automation.checkingChannels")}
          control={
            <button
              type="button"
              onClick={onOpenPhoneSetup}
              className="h-8 shrink-0 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-800 bg-slate-950/60 text-[11px] font-bold text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5 text-accent-500" />
              {channels.length > 0 ? t("settings.nav.phone") : t("settings.automation.setUp")}
            </button>
          }
        />

        <SettingItem icon={ShieldCheck} title={t("settings.automation.privacy")} description={msg(def, "privacy")} />

        <SettingItem
          icon={History}
          title={msg(def, "lastTitle")}
          description={
            last
              ? t(last.trigger === "schedule" ? "settings.automation.lastRunScheduled" : "settings.automation.lastRunManual", {
                  when: formatWhen(last.at),
                  message: last.message,
                })
              : status?.lastRun
                ? msg(def, "lastScheduled", { date: status.lastRun })
                : msg(def, "noneYet")
          }
          control={
            <button
              type="button"
              onClick={runNow}
              disabled={busy || portfolios.length === 0}
              title={msg(def, "runTitle")}
              className="h-8 shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-500" /> : <Play className="w-3.5 h-3.5 text-accent-500" />}
              {t("settings.automation.runNow")}
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

      <div className="flex items-center gap-3 pt-4 border-t border-slate-800/80 min-h-8">
        {saving ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.saving")}
          </span>
        ) : sending ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {msg(def, "runningText")}
          </span>
        ) : result ? (
          <StatusLine result={result} />
        ) : (
          <span className="text-[11px] text-slate-500">{t("settings.automation.savesRightAway")}</span>
        )}
      </div>
    </div>
  );
}

/** A Notifications page for one automation of the submenu. */
export function AutomationSection({ automation, ...props }: SectionProps & { automation: AutomationId }) {
  return <AutomationCard key={automation} def={DEFINITIONS[automation]} {...props} />;
}
