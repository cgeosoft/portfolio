import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

export type SelectSize = "sm" | "md" | "lg";
export type SelectTone = "default" | "accent" | "muted";

/** Minimal event shape, so call sites keep reading `e.target.value`. */
export interface SelectChangeEvent {
  target: { value: string };
}

export interface SelectProps {
  value?: string | number;
  onChange?: (event: SelectChangeEvent) => void;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  /** Visual size: sm for toolbars and filters, md for form fields, lg for settings. */
  selectSize?: SelectSize;
  /** Colour treatment. Use accent for emphasised pickers. */
  tone?: SelectTone;
  /** Optional leading icon rendered inside the control. */
  icon?: ReactNode;
  /** Classes for the positioning wrapper, for example width or flex rules. */
  wrapperClassName?: string;
  /** Classes for the trigger button. */
  className?: string;
  /** `<option>` elements, exactly as a native select would take. */
  children?: ReactNode;
}

interface SelectOption {
  value: string;
  label: string;
  disabled: boolean;
}

const MENU_MARGIN = 6;
const MENU_MAX_HEIGHT = 272;

/** Flattens option children into plain text, so labels built from several
 *  expressions still read as one string. */
function toText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(toText).join("");
  }
  if (isValidElement(node)) {
    return toText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function readOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== "option") {
      return;
    }
    const props = child.props as {
      value?: string | number;
      disabled?: boolean;
      children?: ReactNode;
    };
    const label = toText(props.children);
    options.push({
      value: props.value === undefined ? label : String(props.value),
      label,
      disabled: Boolean(props.disabled),
    });
  });
  return options;
}

/**
 * Dropdown built as a custom listbox. The application renders in WebKitGTK,
 * which draws the popup of a native select as an unstyled GTK menu, so the
 * list is rendered as HTML instead and portalled to the body to escape the
 * overflow of modals and scrolling cards.
 */
export function Select({
  value,
  onChange,
  disabled = false,
  title,
  "aria-label": ariaLabel,
  selectSize = "md",
  tone = "default",
  icon,
  wrapperClassName = "",
  className = "",
  children,
}: SelectProps) {
  const options = useMemo(() => readOptions(children), [children]);
  const selectedValue = value === undefined ? "" : String(value);
  const selectedIndex = options.findIndex((o) => o.value === selectedValue);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: "bottom" | "top";
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef({ query: "", at: 0 });
  const listId = useId();

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - MENU_MARGIN;
    const above = rect.top - MENU_MARGIN;
    const openUp = below < Math.min(MENU_MAX_HEIGHT, 160) && above > below;
    const maxHeight = Math.min(MENU_MAX_HEIGHT, openUp ? above : below);

    // A list wider than its trigger would run off a screen edge, so near the
    // right it hangs from the right edge of the trigger instead of the left.
    const menuWidth = menuRef.current?.offsetWidth ?? rect.width;
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - MENU_MARGIN) {
      left = Math.max(MENU_MARGIN, rect.right - menuWidth);
    }

    setMenuStyle({
      top: openUp ? rect.top - MENU_MARGIN - maxHeight : rect.bottom + MENU_MARGIN,
      left,
      width: rect.width,
      maxHeight,
      placement: openUp ? "top" : "bottom",
    });
  }, []);

  const open = useCallback(() => {
    if (disabled || options.length === 0) {
      return;
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    position();
    setIsOpen(true);
  }, [disabled, options.length, position, selectedIndex]);

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) {
        return;
      }
      if (option.value !== selectedValue) {
        onChange?.({ target: { value: option.value } });
      }
      close();
    },
    [close, onChange, options, selectedValue],
  );

  /** Skips disabled entries when moving through the list. */
  const step = useCallback(
    (from: number, delta: number) => {
      if (options.length === 0) {
        return from;
      }
      let next = from;
      for (let i = 0; i < options.length; i += 1) {
        next = (next + delta + options.length) % options.length;
        if (!options[next]?.disabled) {
          return next;
        }
      }
      return from;
    },
    [options],
  );

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    position();
  }, [isOpen, position]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    // A scroll under an open list would leave it detached from its trigger.
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      position();
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", position);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", position);
    };
  }, [isOpen, position]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    menuRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }
    const key = event.key;

    if (!isOpen) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        open();
      }
      return;
    }

    switch (key) {
      case "Escape":
        event.preventDefault();
        close();
        return;
      case "Tab":
        setIsOpen(false);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        return;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => step(i, 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => step(i, -1));
        return;
      case "Home":
        event.preventDefault();
        setActiveIndex(step(options.length - 1, 1));
        return;
      case "End":
        event.preventDefault();
        setActiveIndex(step(0, -1));
        return;
      default:
        break;
    }

    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const query =
        now - typeAhead.current.at > 900 ? key : typeAhead.current.query + key;
      typeAhead.current = { query, at: now };
      const match = options.findIndex(
        (o) => !o.disabled && o.label.toLowerCase().startsWith(query.toLowerCase()),
      );
      if (match >= 0) {
        setActiveIndex(match);
      }
    }
  };

  return (
    <div className={`cx-select-wrap ${wrapperClassName}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={isOpen ? `${listId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        data-size={selectSize}
        data-tone={tone}
        data-open={isOpen}
        className={`cx-select ${className}`.trim()}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        onKeyDown={onKeyDown}
      >
        {icon && <span className="cx-select-icon">{icon}</span>}
        <span className="cx-select-value">{selected?.label ?? ""}</span>
        <ChevronDown className="cx-select-chevron w-3.5 h-3.5" />
      </button>

      {isOpen &&
        menuStyle &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className="cx-menu cx-select-menu custom-scrollbar font-mono"
            data-placement={menuStyle.placement}
            style={{
              top: menuStyle.top,
              left: menuStyle.left,
              minWidth: menuStyle.width,
              maxHeight: menuStyle.maxHeight,
            }}
          >
            {options.map((option, index) => {
              const isSelected = option.value === selectedValue;
              return (
                <div
                  key={`${option.value}-${index}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  data-active={isSelected}
                  data-highlighted={index === activeIndex}
                  data-disabled={option.disabled || undefined}
                  className="cx-menu-item"
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  onClick={() => commit(index)}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && (
                    <Check className="cx-select-option-check w-3.5 h-3.5" />
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

export default Select;
