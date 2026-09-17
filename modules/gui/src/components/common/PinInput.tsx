import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

export interface PinInputHandle {
  focus: (index?: number) => void;
  clear: () => void;
  select: (index?: number) => void;
}

export interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  masked?: boolean;
  size?: "sm" | "md" | "lg";
  hasError?: boolean;
  ariaLabel?: string;
  className?: string;
  id?: string;
}

const PIN_LENGTH = 6;

const clampIndex = (index: number) => Math.max(0, Math.min(index, PIN_LENGTH - 1));

/**
 * Fixed 6-digit PIN input with six distinct boxes.
 *
 * `value` is always a contiguous run of digits (no gaps), so the box at
 * `value.length` is the next one to fill. Handlers read the latest value from
 * a ref rather than from the render closure: focus moves synchronously into
 * the next box, whose `onFocus` guard would otherwise still see the previous
 * value and bounce straight back.
 */
export const PinInput = forwardRef<PinInputHandle, PinInputProps>(function PinInput(
  {
    value,
    onChange,
    onComplete,
    disabled = false,
    autoFocus = false,
    masked = true,
    size = "lg",
    hasError = false,
    ariaLabel,
    className = "",
    id,
  },
  ref,
) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const valueRef = useRef(value);
  valueRef.current = value;

  const digits = Array.from({ length: PIN_LENGTH }, (_, i) => value[i] || "");

  const focusBox = useCallback((index: number) => {
    const el = inputRefs.current[clampIndex(index)];
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  /** Push a new value to the parent and move the caret to the given box. */
  const commit = useCallback(
    (nextVal: string, focusIndex: number) => {
      const next = nextVal.slice(0, PIN_LENGTH);
      valueRef.current = next;
      onChange(next);
      focusBox(focusIndex);
      if (next.length === PIN_LENGTH) onComplete?.(next);
    },
    [focusBox, onChange, onComplete],
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: (index = 0) => focusBox(index),
      clear: () => {
        valueRef.current = "";
        onChange("");
        focusBox(0);
      },
      select: (index = 0) => inputRefs.current[clampIndex(index)]?.select(),
    }),
    [focusBox, onChange],
  );

  useEffect(() => {
    if (autoFocus && !disabled) {
      const timer = setTimeout(() => focusBox(0), 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, disabled, focusBox]);

  const handleChange = useCallback(
    (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const current = valueRef.current;
      const typed = e.target.value.replace(/[^0-9]/g, "");

      if (typed.length === 0) {
        // Box emptied by the browser (e.g. cut); drop this digit.
        commit(current.slice(0, index) + current.slice(index + 1), index);
        return;
      }

      // Paste or autofill of several digits: fill from this box onwards.
      // A single keystroke into a box that already has a digit shows up as
      // two characters when the browser did not replace the selection.
      const prevChar = current[index] || "";
      const chars = typed.length === 2 && prevChar && typed[0] === prevChar ? typed.slice(1) : typed.length > 1 && prevChar ? typed.slice(-1) : typed;

      const next = current.slice(0, index) + chars + current.slice(index + chars.length);
      commit(next, index + chars.length);
    },
    [commit, disabled],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      const current = valueRef.current;

      if (e.key === "Backspace") {
        e.preventDefault();
        if (current[index]) {
          // Clear from this box onwards; the value never has gaps.
          commit(current.slice(0, index), index);
        } else if (index > 0) {
          commit(current.slice(0, index - 1), index - 1);
        }
      } else if (e.key === "Delete") {
        e.preventDefault();
        commit(current.slice(0, index) + current.slice(index + 1), index);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        focusBox(index - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        focusBox(Math.min(index + 1, current.length));
      } else if (e.key === "Enter") {
        if (current.length === PIN_LENGTH) {
          e.preventDefault();
          onComplete?.(current);
        }
      } else if (e.key.length === 1 && !/[0-9]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Ignore letters and symbols outright so nothing flickers into the box.
        e.preventDefault();
      }
    },
    [commit, disabled, focusBox, onComplete],
  );

  const handlePaste = useCallback(
    (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").replace(/[^0-9]/g, "");
      if (!pasted) return;
      // A full PIN always replaces everything; a partial one continues from here.
      const start = pasted.length >= PIN_LENGTH ? 0 : index;
      const next = valueRef.current.slice(0, start) + pasted;
      commit(next, Math.min(start + pasted.length, PIN_LENGTH - 1));
    },
    [commit, disabled],
  );

  const handleFocus = useCallback((index: number, e: React.FocusEvent<HTMLInputElement>) => {
    // Never leave a gap: focusing past the first empty box lands on it instead.
    const firstEmpty = valueRef.current.length;
    if (index > firstEmpty && firstEmpty < PIN_LENGTH) {
      inputRefs.current[firstEmpty]?.focus();
      return;
    }
    e.target.select();
  }, []);

  const sizeClass = {
    sm: "w-8 h-10 text-base rounded-lg",
    md: "w-9 h-11 sm:w-10 sm:h-12 text-lg sm:text-xl rounded-xl",
    lg: "w-11 h-14 sm:w-12 sm:h-14 text-xl sm:text-2xl rounded-2xl",
  }[size];

  return (
    <div
      id={id}
      className={`flex items-center gap-1.5 sm:gap-2.5 select-none ${className}`}
      role="group"
      aria-label={ariaLabel || "6-digit PIN input"}
    >
      {digits.map((digit, i) => {
        const stateClass = hasError
          ? "border-rose-500/70 ring-1 ring-rose-500/30 bg-rose-950/25 text-rose-300 focus:border-rose-400 focus:ring-rose-500/50"
          : digit
          ? "border-slate-700 bg-slate-950/80 text-slate-50 focus:border-[#DD3C73] focus:ring-[#DD3C73]/30"
          : "border-slate-800 bg-slate-950/60 text-slate-100 focus:border-[#DD3C73] focus:ring-[#DD3C73]/30";

        return (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            type={masked ? "password" : "text"}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            value={digit}
            disabled={disabled}
            onChange={(e) => handleChange(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => handleFocus(i, e)}
            aria-label={ariaLabel ? `${ariaLabel} digit ${i + 1}` : `PIN digit ${i + 1} of 6`}
            className={`${sizeClass} ${stateClass} text-center font-mono font-bold caret-[#DD3C73] border transition-colors duration-100 focus:outline-none focus:ring-2 focus:bg-slate-900/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-inner`}
          />
        );
      })}
    </div>
  );
});
