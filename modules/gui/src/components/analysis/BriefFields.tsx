/**
 * The fields of the portfolio brief, one editor per field. The brief editor
 * shows them all; the wizard shows one per screen. Values are option ids
 * (shared/brief.ts) or the user's own text; percentages only, never amounts.
 */
import { Plus, Trash2 } from "lucide-react";
import {
  BRIEF_ASSET_CLASSES,
  BRIEF_CASH_FLOWS,
  BRIEF_CONSTRAINTS,
  BRIEF_HORIZONS,
  BRIEF_PURPOSES,
  type BriefField,
} from "portfolio-shared/brief";
import type { PortfolioBrief, TargetBand } from "portfolio-shared/portfolio";
import { t } from "../../i18n";

export const INPUT_CLASS =
  "w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-accent-500 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden transition-colors font-mono";
export const LABEL_CLASS = "text-[10px] uppercase tracking-wider text-slate-400 font-semibold";
const SMALL_INPUT = "w-20 bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-accent-500 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-hidden font-mono";

/** The label of an option id; free text shows as it is. */
export function optionLabel(field: string, value: string): string {
  const key = `analysis.brief.options.${field}.${value}`;
  const label = t(key);
  return label === key ? value : label;
}

function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
        active ? "border-accent-500/60 bg-accent-500/15 text-accent-300" : "border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700 hover:text-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** A single choice from option ids, or the user's own words. */
function ChoiceField({ field, options, value, onChange, disabled }: { field: BriefField; options: readonly string[]; value?: string; onChange: (v: string | undefined) => void; disabled?: boolean }) {
  const custom = value && !options.includes(value) ? value : "";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Chip key={o} active={value === o} disabled={disabled} onClick={() => onChange(value === o ? undefined : o)}>
            {optionLabel(field, o)}
          </Chip>
        ))}
      </div>
      <input
        className={INPUT_CLASS}
        value={custom}
        maxLength={300}
        disabled={disabled}
        placeholder={t("analysis.brief.ownWords")}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </div>
  );
}

export interface BriefFieldEditorProps {
  field: BriefField | "prose";
  brief: PortfolioBrief;
  onChange: (next: PortfolioBrief) => void;
  disabled?: boolean;
}

/** The editor of one brief field. */
export function BriefFieldEditor({ field, brief, onChange, disabled }: BriefFieldEditorProps) {
  const set = (patch: Partial<PortfolioBrief>) => onChange({ ...brief, ...patch });

  switch (field) {
    case "purpose":
      return <ChoiceField field="purpose" options={BRIEF_PURPOSES} value={brief.purpose} disabled={disabled} onChange={(v) => set({ purpose: v })} />;
    case "horizon":
      return <ChoiceField field="horizon" options={BRIEF_HORIZONS} value={brief.horizon} disabled={disabled} onChange={(v) => set({ horizon: v })} />;
    case "cashFlowPattern":
      return (
        <div className="flex flex-wrap gap-1.5">
          {BRIEF_CASH_FLOWS.map((o) => (
            <Chip key={o} active={brief.cashFlowPattern === o} disabled={disabled} onClick={() => set({ cashFlowPattern: brief.cashFlowPattern === o ? undefined : o })}>
              {optionLabel("cashFlowPattern", o)}
            </Chip>
          ))}
        </div>
      );
    case "riskTolerance": {
      const risk = brief.riskTolerance ?? {};
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((score) => (
              <Chip key={score} active={risk.score === score} disabled={disabled} onClick={() => set({ riskTolerance: { ...risk, score: risk.score === score ? undefined : score } })}>
                {score} · {t(`analysis.brief.riskScore.${score}`)}
              </Chip>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            {t("analysis.brief.maxDrop")}
            <input
              className={SMALL_INPUT}
              inputMode="decimal"
              disabled={disabled}
              value={risk.maxDropPercent ?? ""}
              onChange={(e) => set({ riskTolerance: { ...risk, maxDropPercent: num(e.target.value) } })}
            />
            %
          </label>
        </div>
      );
    }
    case "incomeNeed": {
      const income = brief.incomeNeed ?? {};
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Chip active={income.required === true} disabled={disabled} onClick={() => set({ incomeNeed: { ...income, required: income.required === true ? undefined : true } })}>
              {t("analysis.brief.options.incomeNeed.yes")}
            </Chip>
            <Chip active={income.required === false} disabled={disabled} onClick={() => set({ incomeNeed: { ...income, required: income.required === false ? undefined : false } })}>
              {t("analysis.brief.options.incomeNeed.no")}
            </Chip>
          </div>
          {income.required && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              {t("analysis.brief.targetYield")}
              <input
                className={SMALL_INPUT}
                inputMode="decimal"
                disabled={disabled}
                value={income.targetYieldPercent ?? ""}
                onChange={(e) => set({ incomeNeed: { ...income, targetYieldPercent: num(e.target.value) } })}
              />
              %
            </label>
          )}
        </div>
      );
    }
    case "targetBands": {
      const bands = brief.targetBands ?? [];
      const update = (i: number, patch: Partial<TargetBand>) => set({ targetBands: bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
      return (
        <div className="space-y-2">
          {bands.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <select
                className={`${SMALL_INPUT} w-36`}
                value={b.assetClass}
                disabled={disabled}
                onChange={(e) => update(i, { assetClass: e.target.value })}
              >
                {[...new Set([...BRIEF_ASSET_CLASSES, b.assetClass])].map((c) => (
                  <option key={c} value={c}>
                    {optionLabel("assetClass", c)}
                  </option>
                ))}
              </select>
              <input className={SMALL_INPUT} inputMode="decimal" disabled={disabled} value={b.minPercent} onChange={(e) => update(i, { minPercent: num(e.target.value) ?? 0 })} />
              <span>{t("analysis.brief.bandTo")}</span>
              <input className={SMALL_INPUT} inputMode="decimal" disabled={disabled} value={b.maxPercent} onChange={(e) => update(i, { maxPercent: num(e.target.value) ?? 0 })} />
              <span>%</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => set({ targetBands: bands.filter((_, j) => j !== i) })}
                aria-label={t("common.delete")}
                className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-slate-800/40 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {bands.length < 8 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => set({ targetBands: [...bands, { assetClass: BRIEF_ASSET_CLASSES.find((c) => !bands.some((b) => b.assetClass === c)) ?? "misc", minPercent: 0, maxPercent: 100 }] })}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("analysis.brief.addBand")}
            </button>
          )}
        </div>
      );
    }
    case "constraints": {
      const list = brief.constraints ?? [];
      const custom = list.filter((c) => !(BRIEF_CONSTRAINTS as readonly string[]).includes(c));
      const toggle = (c: string) => set({ constraints: list.includes(c) ? list.filter((x) => x !== c) : [...list, c] });
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {BRIEF_CONSTRAINTS.map((c) => (
              <Chip key={c} active={list.includes(c)} disabled={disabled} onClick={() => toggle(c)}>
                {optionLabel("constraints", c)}
              </Chip>
            ))}
          </div>
          <input
            className={INPUT_CLASS}
            disabled={disabled}
            maxLength={300}
            placeholder={t("analysis.brief.constraintsOwn")}
            defaultValue={custom.join(", ")}
            onBlur={(e) => {
              const own = e.target.value.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
              set({ constraints: [...list.filter((c) => (BRIEF_CONSTRAINTS as readonly string[]).includes(c)), ...own] });
            }}
          />
        </div>
      );
    }
    case "successInOwnWords":
      return (
        <input
          className={INPUT_CLASS}
          maxLength={600}
          disabled={disabled}
          placeholder={t("analysis.brief.successPlaceholder")}
          value={brief.successInOwnWords ?? ""}
          onChange={(e) => set({ successInOwnWords: e.target.value || undefined })}
        />
      );
    case "prose":
      return (
        <textarea
          className={`${INPUT_CLASS} min-h-[120px] resize-y font-sans leading-relaxed`}
          maxLength={2000}
          disabled={disabled}
          placeholder={t("analysis.brief.prosePlaceholder")}
          value={brief.prose ?? ""}
          onChange={(e) => set({ prose: e.target.value || undefined })}
        />
      );
  }
}

/** Every free text of a brief draft, for the amount check before saving. */
export function briefDraftTexts(brief: PortfolioBrief): string[] {
  return [brief.purpose, brief.horizon, brief.cashFlowPattern, brief.successInOwnWords, brief.prose, ...(brief.constraints ?? []), ...(brief.targetBands ?? []).map((b) => b.assetClass)].filter(
    (x): x is string => Boolean(x),
  );
}

/** Short lines that describe a brief, for the brief card. */
export function briefLines(brief: PortfolioBrief): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (brief.purpose) out.push({ label: t("analysis.brief.fields.purpose"), value: optionLabel("purpose", brief.purpose) });
  if (brief.horizon) out.push({ label: t("analysis.brief.fields.horizon"), value: optionLabel("horizon", brief.horizon) });
  const risk = brief.riskTolerance;
  if (risk && (risk.score !== undefined || risk.maxDropPercent !== undefined)) {
    out.push({
      label: t("analysis.brief.fields.riskTolerance"),
      value: [risk.score !== undefined ? `${risk.score}/5 ${t(`analysis.brief.riskScore.${risk.score}`)}` : "", risk.maxDropPercent !== undefined ? t("analysis.brief.maxDropValue", { percent: risk.maxDropPercent }) : ""]
        .filter(Boolean)
        .join(", "),
    });
  }
  const income = brief.incomeNeed;
  if (income?.required !== undefined) {
    out.push({
      label: t("analysis.brief.fields.incomeNeed"),
      value: income.required ? `${t("analysis.brief.options.incomeNeed.yes")}${income.targetYieldPercent !== undefined ? `, ${income.targetYieldPercent}%` : ""}` : t("analysis.brief.options.incomeNeed.no"),
    });
  }
  if (brief.cashFlowPattern) out.push({ label: t("analysis.brief.fields.cashFlowPattern"), value: optionLabel("cashFlowPattern", brief.cashFlowPattern) });
  if (brief.targetBands?.length) {
    out.push({ label: t("analysis.brief.fields.targetBands"), value: brief.targetBands.map((b) => `${optionLabel("assetClass", b.assetClass)} ${b.minPercent}-${b.maxPercent}%`).join(", ") });
  }
  if (brief.constraints?.length) out.push({ label: t("analysis.brief.fields.constraints"), value: brief.constraints.map((c) => optionLabel("constraints", c)).join(", ") });
  if (brief.successInOwnWords) out.push({ label: t("analysis.brief.fields.successInOwnWords"), value: brief.successInOwnWords });
  return out;
}
