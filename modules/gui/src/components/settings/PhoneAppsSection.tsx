import { useState, type ReactNode } from "react";
import { BellRing, Gauge, Loader2, Megaphone, Send, Smartphone, type LucideIcon } from "lucide-react";
import type { DesktopConfig, SendNotificationResponse } from "portfolio-shared/api-types";
import { DEFAULT_NTFY_URL, SECRET_MASK } from "portfolio-shared/config-types";
import { api } from "../../api";
import { t } from "../../i18n";
import { SectionHeader } from "./SettingsFields";
import { ChoiceButton, StatusLine, TextField, type StatusResult } from "./SettingsPrimitives";

/** Gotify priorities: the Android app stays silent below 4 and pops up from 8. `key` names the label under settings.phone.priorities. */
const GOTIFY_PRIORITIES = [
  { value: 2, key: "low" },
  { value: 5, key: "normal" },
  { value: 8, key: "high" },
];

/** ntfy priorities: 1 and 2 stay silent, 3 is the default, 4 and 5 pop up. */
const NTFY_PRIORITIES = [
  { value: 2, key: "low" },
  { value: 3, key: "default" },
  { value: 4, key: "high" },
  { value: 5, key: "urgent" },
];

interface SectionProps {
  config: DesktopConfig;
  onConfigChange: (config: DesktopConfig) => void;
}

/** Save and test state of a phone app card, with the footer that shows it. */
function usePhoneAppCard(onConfigChange: (config: DesktopConfig) => void, name: string) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<StatusResult | null>(null);

  /** `saved` is the whole sentence shown on success ("Saved the topic."). */
  const save = async (updates: Partial<DesktopConfig>, saved: string) => {
    setSaving(true);
    setResult(null);
    try {
      onConfigChange(await api.saveConfig(updates));
      setResult({ ok: true, message: saved });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const test = async (send: () => Promise<SendNotificationResponse>) => {
    setTesting(true);
    setResult(null);
    try {
      const res = await send();
      setResult(
        res.success
          ? {
              ok: true,
              message:
                res.latencyMs !== undefined
                  ? t("settings.phone.testOkLatency", { name, ms: res.latencyMs })
                  : t("settings.phone.testOk", { name }),
            }
          : { ok: false, message: res.error ?? t("settings.phone.testFailed") },
      );
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return { saving, testing, result, save, test };
}

/** The card frame: header with the Connected badge, the fields, and the test button with the status line. */
function PhoneAppCard({
  icon,
  title,
  description,
  ready,
  missing,
  saving,
  testing,
  result,
  onTest,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  ready: boolean;
  /** Why the test button is off. */
  missing: string;
  saving: boolean;
  testing: boolean;
  result: StatusResult | null;
  onTest: () => void;
  children: ReactNode;
}) {
  return (
    <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-5">
      <SectionHeader
        icon={icon}
        title={title}
        description={description}
        actions={
          <span
            className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
              ready ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-slate-800/60 text-slate-400 border-slate-700"
            }`}
          >
            {ready ? t("settings.phone.connected") : t("settings.phone.notSetUp")}
          </span>
        }
      />

      {children}

      <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-800/80 min-h-[2rem]">
        <button
          type="button"
          onClick={onTest}
          disabled={testing || !ready}
          title={ready ? t("settings.phone.sendTestTitle") : missing}
          className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-500" /> : <Send className="w-3.5 h-3.5 text-accent-500" />}
          {t("settings.phone.sendTest")}
        </button>
        {saving ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.saving")}
          </span>
        ) : result ? (
          <StatusLine result={result} />
        ) : (
          <span className="text-[11px] text-slate-500">{t("settings.phone.savesOnBlur")}</span>
        )}
      </div>
    </div>
  );
}

/** The priority buttons of a channel; a stored value outside the presets stays selectable. */
function PriorityField({
  label,
  presets,
  value,
  disabled,
  onSelect,
  description,
}: {
  label: string;
  presets: { value: number; key?: string }[];
  value: number;
  disabled: boolean;
  onSelect: (value: number) => void;
  description: string;
}) {
  const options = presets.some((p) => p.value === value) ? presets : [...presets, { value }].sort((a, b) => a.value - b.value);
  return (
    <div className="space-y-2 pt-4 border-t border-slate-800/80">
      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
        <Gauge className="w-3.5 h-3.5" />
        {t("settings.phone.priority")}
      </span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((p) => (
          <ChoiceButton key={p.value} active={p.value === value} disabled={disabled} onClick={() => p.value !== value && onSelect(p.value)}>
            {p.key ? t(`settings.phone.priorities.${p.key}`) : String(p.value)} ({p.value})
          </ChoiceButton>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">{description}</p>
    </div>
  );
}

/** Push notifications to the user's own Gotify server: URL, application token, priority and a test message. */
function GotifyCard({ config, onConfigChange }: SectionProps) {
  const card = usePhoneAppCard(onConfigChange, "Gotify");
  const tokenSet = config.gotifyToken === SECRET_MASK;
  const ready = Boolean(config.gotifyUrl && tokenSet);

  return (
    <PhoneAppCard
      icon={BellRing}
      title="Gotify"
      description={t("settings.phone.gotify.description")}
      ready={ready}
      missing={t("settings.phone.gotify.missing")}
      saving={card.saving}
      testing={card.testing}
      result={card.result}
      onTest={() => card.test(() => api.testGotify({}))}
    >
      <TextField
        id="gotifyUrl"
        label={t("settings.phone.serverUrl")}
        first
        value={config.gotifyUrl}
        placeholder="https://gotify.example.com"
        description={t("settings.phone.gotify.urlDescription")}
        onCommit={(value) => card.save({ gotifyUrl: value.replace(/\/+$/, "") }, t("settings.phone.saved.serverUrl"))}
      />

      <TextField
        id="gotifyToken"
        label={t("settings.phone.gotify.token")}
        secret
        isSet={tokenSet}
        value=""
        placeholder={t("settings.phone.gotify.tokenPlaceholder")}
        description={t("settings.phone.gotify.tokenDescription")}
        onCommit={(value) => card.save({ gotifyToken: value }, value ? t("settings.phone.saved.appToken") : t("settings.phone.saved.tokenRemoved"))}
      />

      <PriorityField
        label={t("settings.phone.gotify.priority")}
        presets={GOTIFY_PRIORITIES}
        value={config.gotifyPriority}
        disabled={card.saving}
        onSelect={(value) => card.save({ gotifyPriority: value }, t("settings.phone.saved.priority"))}
        description={t("settings.phone.gotify.priorityDescription")}
      />
    </PhoneAppCard>
  );
}

/** A topic that is hard to guess, for the public server where the topic name is the only protection. */
function randomTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `portfolio-${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16)}`;
}

/** Push notifications through ntfy (ntfy.sh or a self-hosted server): URL, topic, optional token, priority and a test message. */
function NtfyCard({ config, onConfigChange }: SectionProps) {
  const card = usePhoneAppCard(onConfigChange, "ntfy");
  const tokenSet = config.ntfyToken === SECRET_MASK;
  const ready = Boolean(config.ntfyTopic);
  const isPublic = config.ntfyUrl.replace(/\/+$/, "") === DEFAULT_NTFY_URL;

  return (
    <PhoneAppCard
      icon={Megaphone}
      title="ntfy"
      description={t("settings.phone.ntfy.description")}
      ready={ready}
      missing={t("settings.phone.ntfy.missing")}
      saving={card.saving}
      testing={card.testing}
      result={card.result}
      onTest={() => card.test(() => api.testNtfy({}))}
    >
      <TextField
        id="ntfyUrl"
        label={t("settings.phone.serverUrl")}
        first
        value={config.ntfyUrl}
        placeholder={DEFAULT_NTFY_URL}
        description={t("settings.phone.ntfy.urlDescription", { url: DEFAULT_NTFY_URL })}
        onCommit={(value) => card.save({ ntfyUrl: value.replace(/\/+$/, "") || DEFAULT_NTFY_URL }, t("settings.phone.saved.serverUrl"))}
      />

      <div className="space-y-2">
        <TextField
          id="ntfyTopic"
          label={t("settings.phone.ntfy.topic")}
          value={config.ntfyTopic}
          placeholder="portfolio-..."
          description={
            isPublic
              ? t("settings.phone.ntfy.topicPublic")
              : t("settings.phone.ntfy.topicPrivate")
          }
          onCommit={(value) => card.save({ ntfyTopic: value }, value ? t("settings.phone.saved.topic") : t("settings.phone.saved.topicRemoved"))}
        />
        {!config.ntfyTopic && (
          <button
            type="button"
            onClick={() => card.save({ ntfyTopic: randomTopic() }, t("settings.phone.saved.randomTopic"))}
            disabled={card.saving}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-800 bg-slate-950/60 text-[11px] font-bold text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors cursor-pointer disabled:opacity-60"
          >
            {t("settings.phone.ntfy.randomTopic")}
          </button>
        )}
      </div>

      <TextField
        id="ntfyToken"
        label={t("settings.phone.ntfy.token")}
        secret
        isSet={tokenSet}
        value=""
        placeholder="tk_..."
        description={t("settings.phone.ntfy.tokenDescription")}
        onCommit={(value) => card.save({ ntfyToken: value }, value ? t("settings.phone.saved.accessToken") : t("settings.phone.saved.tokenRemoved"))}
      />

      <PriorityField
        label={t("settings.phone.ntfy.priority")}
        presets={NTFY_PRIORITIES}
        value={config.ntfyPriority}
        disabled={card.saving}
        onSelect={(value) => card.save({ ntfyPriority: value }, t("settings.phone.saved.priority"))}
        description={t("settings.phone.ntfy.priorityDescription")}
      />
    </PhoneAppCard>
  );
}

/**
 * Settings → Notifications → Phone Apps: the two push channels every
 * automation sends through, ntfy first as the one that needs no server.
 */
export function PhoneAppsSection(props: SectionProps) {
  return (
    <div className="space-y-6">
      <div className="cx-card p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4">
        <SectionHeader icon={Smartphone} title={t("settings.phone.title")} description={t("settings.phone.description")} />
        <p className="text-xs text-slate-400 leading-relaxed">{t("settings.phone.intro")}</p>
      </div>
      <NtfyCard {...props} />
      <GotifyCard {...props} />
    </div>
  );
}
