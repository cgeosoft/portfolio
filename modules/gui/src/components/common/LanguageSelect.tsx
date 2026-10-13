import { useState } from "react";
import { Check, ChevronDown, Languages } from "lucide-react";
import { LANGUAGES, LLM_FAMILY_LABELS, findLanguage, type LanguageInfo } from "portfolio-shared/i18n";
import { t } from "../../i18n";
import { Select } from "./Select";

interface LanguageSelectProps {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}

/** Picker of the interface language, each entry with its AI support tier. */
export function LanguageSelect({ value, onChange, disabled }: LanguageSelectProps) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} selectSize="lg" icon={<Languages className="w-4 h-4" />} aria-label={t("language.label")} disabled={disabled}>
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.nativeName === lang.name ? lang.nativeName : `${lang.nativeName} (${lang.name})`} · {t("language.tierShort", { tier: lang.tier })}
        </option>
      ))}
    </Select>
  );
}

/** How well the AI providers write reports in a language: the tier and the model families that support it. */
export function LanguageTierNote({ code }: { code: string }) {
  const lang = findLanguage(code);
  if (!lang) return null;
  const tone = lang.tier === 1 ? "text-emerald-400" : lang.tier === 2 ? "text-sky-400" : lang.tier === 3 ? "text-amber-400" : "text-rose-400";
  return (
    <p className="text-xs text-slate-400 leading-relaxed">
      <span className={`font-semibold ${tone}`}>{t("language.tierShort", { tier: lang.tier })}</span> {t(`language.tier${lang.tier}`)}{" "}
      {t("language.supportedBy", { models: lang.llms.map((id) => LLM_FAMILY_LABELS[id]).join(", ") })}
    </p>
  );
}

interface LanguagePickerProps {
  value: string;
  onChange: (code: string) => void;
  /** The language matched from the system, marked in the list. */
  detected?: string;
  disabled?: boolean;
}

/**
 * Language grid of the setup wizard: the tier 1 languages first, the others by
 * tier behind "Show more". The current and the detected language always show.
 */
export function LanguagePicker({ value, onChange, detected, disabled }: LanguagePickerProps) {
  const pinned = new Set([value, detected].filter(Boolean));
  const [expanded, setExpanded] = useState(() => LANGUAGES.some((l) => l.tier > 1 && l.code === value));
  const primary = LANGUAGES.filter((l) => l.tier === 1 || (!expanded && pinned.has(l.code)));
  const more = LANGUAGES.filter((l) => !primary.includes(l));

  const option = (lang: LanguageInfo) => {
    const selected = lang.code === value;
    return (
      <button
        key={lang.code}
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={() => onChange(lang.code)}
        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer disabled:opacity-50 ${
          selected ? "border-accent bg-accent/10 text-slate-100" : "border-line bg-card hover:bg-card/60 text-slate-300"
        }`}
      >
        <span className="min-w-0">
          <span className="block text-xs font-bold truncate" lang={lang.code} dir={lang.rtl ? "rtl" : undefined}>
            {lang.nativeName}
          </span>
          <span className="block text-[10px] text-slate-500 truncate">
            {lang.code === detected ? t("language.detected", { name: lang.name }) : lang.name}
          </span>
        </span>
        {selected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
      </button>
    );
  };

  return (
    <div className="space-y-3" role="radiogroup" aria-label={t("language.label")}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{primary.map(option)}</div>
      {expanded ? (
        ([2, 3, 4] as const).map((tier) => {
          const group = more.filter((l) => l.tier === tier);
          if (!group.length) return null;
          return (
            <div key={tier} className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {t("language.tierShort", { tier })} · {t(`language.tier${tier}`)}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{group.map(option)}</div>
            </div>
          );
        })
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 text-xs font-semibold text-accent-400 hover:text-accent-300 hover:underline cursor-pointer"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          {t("language.showMore", { count: more.length })}
        </button>
      )}
    </div>
  );
}
