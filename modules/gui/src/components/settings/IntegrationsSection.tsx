import { useState, type ReactNode } from "react";
import { BellRing, Gauge, Loader2, Megaphone, Send, type LucideIcon } from "lucide-react";
import type { DesktopConfig, SendNotificationResponse } from "portfolio-shared/api-types";
import { DEFAULT_NTFY_URL, SECRET_MASK } from "portfolio-shared/config-types";
import { api } from "../../api";
import { SectionHeader } from "./SettingsFields";
import { ChoiceButton, StatusLine, TextField, type SidebarSection, type StatusResult } from "./SettingsPrimitives";

export type IntegrationId = "gotify" | "ntfy";

/** The cards of the Integrations section, listed as its submenu in the Preferences sidebar. */
export const INTEGRATIONS: (SidebarSection & { id: IntegrationId })[] = [
  { id: "gotify", label: "Gotify", icon: BellRing },
  { id: "ntfy", label: "ntfy", icon: Megaphone },
];

/** Gotify priorities: the Android app stays silent below 4 and pops up from 8. */
const GOTIFY_PRIORITIES = [
  { value: 2, label: "Low" },
  { value: 5, label: "Normal" },
  { value: 8, label: "High" },
];

/** ntfy priorities: 1 and 2 stay silent, 3 is the default, 4 and 5 pop up. */
const NTFY_PRIORITIES = [
  { value: 2, label: "Low" },
  { value: 3, label: "Default" },
  { value: 4, label: "High" },
  { value: 5, label: "Urgent" },
];

interface SectionProps {
  config: DesktopConfig;
  onConfigChange: (config: DesktopConfig) => void;
}

/** Save and test state of an integration card, with the footer that shows it. */
function useIntegrationCard(onConfigChange: (config: DesktopConfig) => void, name: string) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<StatusResult | null>(null);

  const save = async (updates: Partial<DesktopConfig>, label: string) => {
    setSaving(true);
    setResult(null);
    try {
      onConfigChange(await api.saveConfig(updates));
      setResult({ ok: true, message: `Saved ${label}.` });
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
          ? { ok: true, message: `${name} accepted the test message${res.latencyMs !== undefined ? ` in ${res.latencyMs} ms` : ""}. Check your ${name} app.` }
          : { ok: false, message: res.error ?? "The test message failed." },
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
function IntegrationCard({
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
            {ready ? "Connected" : "Not set up"}
          </span>
        }
      />

      {children}

      <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-800/80 min-h-[2rem]">
        <button
          type="button"
          onClick={onTest}
          disabled={testing || !ready}
          title={ready ? "Send a test message" : missing}
          className="h-8 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-500" /> : <Send className="w-3.5 h-3.5 text-accent-500" />}
          Send test message
        </button>
        {saving ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
          </span>
        ) : result ? (
          <StatusLine result={result} />
        ) : (
          <span className="text-[11px] text-slate-500">Changes save when you leave a field or press Enter.</span>
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
  presets: { value: number; label: string }[];
  value: number;
  disabled: boolean;
  onSelect: (value: number) => void;
  description: string;
}) {
  const options = presets.some((p) => p.value === value) ? presets : [...presets, { value, label: String(value) }].sort((a, b) => a.value - b.value);
  return (
    <div className="space-y-2 pt-4 border-t border-slate-800/80">
      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
        <Gauge className="w-3.5 h-3.5" />
        Priority
      </span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((p) => (
          <ChoiceButton key={p.value} active={p.value === value} disabled={disabled} onClick={() => p.value !== value && onSelect(p.value)}>
            {p.label} ({p.value})
          </ChoiceButton>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">{description}</p>
    </div>
  );
}

/** Push notifications to the user's own Gotify server: URL, application token, priority and a test message. */
function GotifyCard({ config, onConfigChange }: SectionProps) {
  const card = useIntegrationCard(onConfigChange, "Gotify");
  const tokenSet = config.gotifyToken === SECRET_MASK;
  const ready = Boolean(config.gotifyUrl && tokenSet);

  return (
    <IntegrationCard
      icon={BellRing}
      title="Gotify"
      description="Push notifications to your own Gotify server, such as the daily brief of the assistant."
      ready={ready}
      missing="Set the server URL and token first"
      saving={card.saving}
      testing={card.testing}
      result={card.result}
      onTest={() => card.test(() => api.testGotify({}))}
    >
      <TextField
        id="gotifyUrl"
        label="Server URL"
        first
        value={config.gotifyUrl}
        placeholder="https://gotify.example.com"
        description="The address of your Gotify server, as you open it in the browser."
        onCommit={(value) => card.save({ gotifyUrl: value.replace(/\/+$/, "") }, "the server URL")}
      />

      <TextField
        id="gotifyToken"
        label="Application token"
        secret
        isSet={tokenSet}
        value=""
        placeholder="Token of a Gotify application"
        description="In Gotify, open Apps, create an application named Portfolio and copy its token. The token stays in the local database and is never shown again."
        onCommit={(value) => card.save({ gotifyToken: value }, value ? "the application token" : "the removal of the token")}
      />

      <PriorityField
        label="Gotify priority"
        presets={GOTIFY_PRIORITIES}
        value={config.gotifyPriority}
        disabled={card.saving}
        onSelect={(value) => card.save({ gotifyPriority: value }, "the priority")}
        description="The Gotify Android app shows Low without a sound, Normal as a regular notification and High as a pop-up."
      />
    </IntegrationCard>
  );
}

/** A topic that is hard to guess, for the public server where the topic name is the only protection. */
function randomTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `portfolio-${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16)}`;
}

/** Push notifications through ntfy (ntfy.sh or a self-hosted server): URL, topic, optional token, priority and a test message. */
function NtfyCard({ config, onConfigChange }: SectionProps) {
  const card = useIntegrationCard(onConfigChange, "ntfy");
  const tokenSet = config.ntfyToken === SECRET_MASK;
  const ready = Boolean(config.ntfyTopic);
  const isPublic = config.ntfyUrl.replace(/\/+$/, "") === DEFAULT_NTFY_URL;

  return (
    <IntegrationCard
      icon={Megaphone}
      title="ntfy"
      description="Push notifications through ntfy.sh or your own ntfy server, such as the daily brief of the assistant."
      ready={ready}
      missing="Set the topic first"
      saving={card.saving}
      testing={card.testing}
      result={card.result}
      onTest={() => card.test(() => api.testNtfy({}))}
    >
      <TextField
        id="ntfyUrl"
        label="Server URL"
        first
        value={config.ntfyUrl}
        placeholder={DEFAULT_NTFY_URL}
        description={`${DEFAULT_NTFY_URL} is the free public server. Put the address of your own server here if you host one.`}
        onCommit={(value) => card.save({ ntfyUrl: value.replace(/\/+$/, "") || DEFAULT_NTFY_URL }, "the server URL")}
      />

      <div className="space-y-2">
        <TextField
          id="ntfyTopic"
          label="Topic"
          value={config.ntfyTopic}
          placeholder="portfolio-..."
          description={
            isPublic
              ? "On ntfy.sh anyone who knows the topic can read its messages, so use a long name nobody can guess. Subscribe to the same topic in the ntfy app."
              : "Letters, digits, - and _. Subscribe to the same topic in the ntfy app."
          }
          onCommit={(value) => card.save({ ntfyTopic: value }, value ? "the topic" : "the removal of the topic")}
        />
        {!config.ntfyTopic && (
          <button
            type="button"
            onClick={() => card.save({ ntfyTopic: randomTopic() }, "a random topic")}
            disabled={card.saving}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-lg border border-slate-800 bg-slate-950/60 text-[11px] font-bold text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors cursor-pointer disabled:opacity-60"
          >
            Make a random topic
          </button>
        )}
      </div>

      <TextField
        id="ntfyToken"
        label="Access token (optional)"
        secret
        isSet={tokenSet}
        value=""
        placeholder="tk_..."
        description="Only for a protected topic or a server that requires login. Create it in the ntfy web app under Account, Access tokens."
        onCommit={(value) => card.save({ ntfyToken: value }, value ? "the access token" : "the removal of the token")}
      />

      <PriorityField
        label="ntfy priority"
        presets={NTFY_PRIORITIES}
        value={config.ntfyPriority}
        disabled={card.saving}
        onSelect={(value) => card.save({ ntfyPriority: value }, "the priority")}
        description="Low arrives without a sound, Default as a regular notification, High and Urgent as a pop-up with a longer vibration."
      />
    </IntegrationCard>
  );
}

/** The Integrations section: one card per integration of the submenu. */
export function IntegrationsSection({ integration, ...props }: SectionProps & { integration: IntegrationId }) {
  switch (integration) {
    case "gotify":
      return <GotifyCard {...props} />;
    case "ntfy":
      return <NtfyCard {...props} />;
  }
}
