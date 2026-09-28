import { ChevronRight, type LucideIcon } from "lucide-react";

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
