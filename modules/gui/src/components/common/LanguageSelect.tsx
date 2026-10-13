import { Languages } from "lucide-react";
import { LANGUAGES, LLM_FAMILY_LABELS, findLanguage } from "portfolio-shared/i18n";
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
