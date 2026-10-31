import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Languages, Search } from "lucide-react";
import { LANGUAGES, LLM_FAMILY_LABELS, findLanguage, type LanguageInfo, type LanguageTier } from "portfolio-shared/i18n";
import { t } from "../../i18n";
import { Select } from "./Select";

interface LanguageSelectProps {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}

/** Picker of the interface language: English first, then the rest by native name. */
export function LanguageSelect({ value, onChange, disabled }: LanguageSelectProps) {
  const english = LANGUAGES.filter((lang) => lang.code === "en");
  const others = LANGUAGES.filter((lang) => lang.code !== "en").sort((a, b) => a.nativeName.localeCompare(b.nativeName));
  const option = (lang: LanguageInfo) => (
    <option key={lang.code} value={lang.code}>
      {lang.nativeName === lang.name ? lang.nativeName : `${lang.nativeName} (${lang.name})`}
    </option>
  );
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} selectSize="lg" icon={<Languages className="w-4 h-4" />} aria-label={t("language.label")} disabled={disabled}>
      {english.map(option)}
      <hr />
      {others.map(option)}
    </Select>
  );
}

/** Text colour of each AI support tier. */
const TIER_TEXT: Record<LanguageTier, string> = {
  1: "text-emerald-400",
  2: "text-sky-400",
  3: "text-amber-400",
  4: "text-rose-400",
};

/** Badge colours of each AI support tier in the picker rows. */
const TIER_BADGE: Record<LanguageTier, string> = {
  1: "text-emerald-400 bg-emerald-400/10 border-emerald-400/25",
  2: "text-sky-400 bg-sky-400/10 border-sky-400/25",
  3: "text-amber-400 bg-amber-400/10 border-amber-400/25",
  4: "text-rose-400 bg-rose-400/10 border-rose-400/25",
};

/** How well the AI providers write reports in a language: the tier and the model families that support it. */
export function LanguageTierNote({ code }: { code: string }) {
  const lang = findLanguage(code);
  if (!lang) return null;
  return (
    <p className="text-xs text-slate-400 leading-relaxed">
      <span className={`font-semibold ${TIER_TEXT[lang.tier]}`}>{t("language.tierShort", { tier: lang.tier })}</span> {t(`language.tier${lang.tier}`)}{" "}
      {t("language.supportedBy", { models: lang.llms.map((id) => LLM_FAMILY_LABELS[id]).join(", ") })}
    </p>
  );
}

/** Lower case without accents, so "francais" finds "Français". */
function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function matchesQuery(lang: LanguageInfo, query: string): boolean {
  return [lang.code, lang.name, lang.nativeName].some((field) => foldText(field).includes(query));
}

interface LanguagePickerProps {
  value: string;
  onChange: (code: string) => void;
  /** The language matched from the system, marked in the list. */
  detected?: string;
  disabled?: boolean;
}

/**
 * Language list of the setup wizard: one full-width row per language in a box
 * that scrolls on its own, grouped under a header per tier. Tier 1 shows first,
 * the others behind "Show more". The current and the detected language always show.
 * The search above the list matches the code, the English and the native name
 * in every tier.
 */
export function LanguagePicker({ value, onChange, detected, disabled }: LanguagePickerProps) {
  const pinned = new Set([value, detected].filter(Boolean));
  const [expanded, setExpanded] = useState(() => LANGUAGES.some((l) => l.tier > 1 && l.code === value));
  const [query, setQuery] = useState("");
  const search = foldText(query.trim());
  const visible = search
    ? LANGUAGES.filter((l) => matchesQuery(l, search))
    : LANGUAGES.filter((l) => expanded || l.tier === 1 || pinned.has(l.code));
  const hiddenCount = LANGUAGES.length - visible.length;
  const listRef = useRef<HTMLDivElement>(null);

  // Opens with the current language in view; scrolls the box only, not the page.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (list && row) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
  }, []);

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
        className={`w-full flex items-center gap-3 pl-3 pr-4 py-2.5 border-l-2 text-left transition-colors cursor-pointer disabled:opacity-50 ${
          selected ? "border-accent bg-accent/10" : "border-transparent hover:bg-slate-800/40"
        }`}
      >
        <span
          className={`w-9 shrink-0 py-1 rounded-md border text-center text-[10px] font-bold uppercase tracking-wider ${
            selected ? "border-accent/40 bg-accent/15 text-accent-300" : "border-line bg-widget text-slate-400"
          }`}
        >
          {lang.code}
        </span>
        <span className="flex-1 min-w-0">
          <span
            className={`block font-sans text-sm font-semibold truncate ${selected ? "text-slate-50" : "text-slate-200"}`}
            lang={lang.code}
            dir={lang.rtl ? "rtl" : undefined}
          >
            {lang.nativeName}
          </span>
          <span className="block text-[11px] text-slate-500 truncate">
            {lang.code === detected ? t("language.detected", { name: lang.name }) : lang.name}
          </span>
        </span>
        <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${TIER_BADGE[lang.tier]}`}>
          {t("language.tierShort", { tier: lang.tier })}
        </span>
        <span
          className={`w-4 h-4 shrink-0 rounded-full border flex items-center justify-center ${
            selected ? "border-accent bg-accent text-white" : "border-slate-600"
          }`}
        >
          {selected && <Check className="w-3 h-3" strokeWidth={3} />}
        </span>
      </button>
    );
  };

  return (
    <div className="rounded-xl border border-line bg-card overflow-hidden">
      <label className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-widget focus-within:bg-slate-800/40 transition-colors">
        <Search className="w-4 h-4 text-slate-500 shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears the search first; the wizard's own Escape handler sees it only on an empty field.
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
          placeholder={t("language.search")}
          aria-label={t("language.search")}
          disabled={disabled}
          className="flex-1 min-w-0 bg-transparent font-sans text-sm text-slate-100 placeholder:text-slate-500 outline-hidden"
        />
      </label>
      <div ref={listRef} role="radiogroup" aria-label={t("language.label")} className="relative h-72 overflow-y-auto custom-scrollbar">
        {([1, 2, 3, 4] as const).map((tier) => {
          const group = visible.filter((l) => l.tier === tier);
          if (!group.length) return null;
          return (
            <div key={tier} className="border-t border-line first:border-t-0">
              <div
                className="sticky top-0 z-10 px-4 py-2 bg-widget border-b border-line text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate"
                title={t(`language.tier${tier}`)}
              >
                <span className={TIER_TEXT[tier]}>{t("language.tierShort", { tier })}</span> · <span className="normal-case tracking-normal font-medium">{t(`language.tier${tier}`)}</span>
              </div>
              <div className="divide-y divide-line/60">{group.map(option)}</div>
            </div>
          );
        })}
        {search && !visible.length && <p className="px-4 py-6 text-center text-xs text-slate-500">{t("language.noMatch")}</p>}
        {!search && !expanded && hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-3 border-t border-line text-xs font-semibold text-accent-400 hover:text-accent-300 hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            {t("language.showMore", { count: hiddenCount })}
          </button>
        )}
      </div>
    </div>
  );
}
