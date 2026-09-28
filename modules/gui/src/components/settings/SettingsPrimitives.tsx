import { useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, Eye, EyeOff, type LucideIcon } from "lucide-react";

/** The outcome of a control that saves or tests: green for success, red for failure. */
export interface StatusResult {
  ok: boolean;
  message: string;
}

export function StatusLine({ result }: { result: StatusResult | null }) {
  if (!result) return null;
  return (
    <span className={`inline-flex items-start gap-1.5 text-[11px] ${result.ok ? "text-emerald-400" : "text-rose-400"}`}>
      {result.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />}
      <span>{result.message}</span>
    </span>
  );
}

/** One button of a choice group. */
export function ChoiceButton({
  active,
  onClick,
  disabled = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={`h-8 inline-flex items-center px-3 rounded-lg border text-[11px] font-bold font-mono whitespace-nowrap transition-colors cursor-pointer disabled:opacity-60 ${
        active ? "border-accent-500/50 bg-accent-500/15 text-accent-500" : "border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200 hover:border-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A labelled text field that saves itself when it loses focus or on Enter.
 * A secret comes back masked, so its field starts empty and shows whether a
 * value is stored; typing and clearing the field removes it.
 */
export function TextField({
  id,
  label,
  description,
  value,
  placeholder,
  secret = false,
  isSet = false,
  first = false,
  onCommit,
}: {
  id: string;
  label: string;
  description: ReactNode;
  value: string;
  placeholder?: string;
  secret?: boolean;
  isSet?: boolean;
  first?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [show, setShow] = useState(false);
  const shown = draft ?? (secret ? "" : value);

  const commit = () => {
    if (draft === undefined) return;
    setDraft(undefined);
    if (secret || draft.trim() !== value) onCommit(draft.trim());
  };

  return (
    <div className={`space-y-2 ${first ? "" : "pt-4 border-t border-slate-800/80"}`}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
          {label}
        </label>
        {secret && isSet && <span className="text-[10px] text-emerald-400/90 font-mono">stored</span>}
      </div>
      <div className="relative">
        <input
          id={id}
          type={secret && !show ? "password" : "text"}
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder={secret && isSet && draft === undefined ? "•••••••• (stored)" : placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-slate-950/90 border border-slate-800 hover:border-slate-700 focus:border-accent-500 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-slate-100 placeholder-slate-600 focus:outline-none transition-colors font-mono"
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            aria-label="Show or hide value"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">{description}</p>
      {secret && isSet && draft === undefined && (
        <p className="text-[10px] text-slate-500">A value is stored. Type a new one to replace it, or type and clear the field to remove it.</p>
      )}
    </div>
  );
}

export interface SidebarSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

/**
 * One entry of the Preferences sidebar. With `items` it has a submenu, open
 * while the section is active: the rows animate their height open and closed
 * (a `grid-template-rows` transition).
 */
export function SidebarEntry({
  section,
  isActive,
  onSelect,
  items,
  activeItem,
  onSelectItem,
}: {
  section: SidebarSection;
  isActive: boolean;
  onSelect: () => void;
  items?: SidebarSection[];
  activeItem?: string;
  onSelectItem?: (id: string) => void;
}) {
  const Icon = section.icon;
  const hasItems = Boolean(items && items.length > 0);
  return (
    <div>
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={hasItems ? isActive : undefined}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-mono transition-colors cursor-pointer ${
          isActive ? "bg-accent-500/15 text-accent-500 font-semibold" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
        }`}
      >
        <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-accent-500" : "text-slate-400"}`} />
        <span className="flex-1 min-w-0 truncate">{section.label}</span>
        {hasItems && (
          <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isActive ? "rotate-90 text-accent-500" : "text-slate-500"}`} />
        )}
      </button>
      {hasItems && (
        <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${isActive ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="overflow-hidden">
            <div className="ml-5 mt-1 mb-1 pl-2.5 border-l border-slate-800 space-y-0.5" role="group" aria-label={section.label}>
              {items!.map((item) => {
                const itemActive = isActive && item.id === activeItem;
                const ItemIcon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    tabIndex={isActive ? 0 : -1}
                    aria-current={itemActive ? "page" : undefined}
                    onClick={() => onSelectItem?.(item.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[11px] font-mono transition-colors cursor-pointer ${
                      itemActive ? "text-accent-500 font-semibold bg-accent-500/10" : "text-slate-500 hover:text-slate-200 hover:bg-slate-800/40"
                    }`}
                  >
                    <ItemIcon className={`w-3.5 h-3.5 shrink-0 ${itemActive ? "text-accent-500" : "text-slate-500"}`} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
