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

/**
 * Fixed 6-digit PIN input with six distinct boxes.
 * Supports typing, backspace, arrow navigation, paste, and auto-submit on completion.
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

  // 6 boxes, each containing at most 1 character.
  const digits = Array.from({ length: PIN_LENGTH }, (_, i) => value[i] || "");

  useImperativeHandle(
    ref,
    () => ({
      focus: (index = 0) => {
        const target = Math.max(0, Math.min(index, PIN_LENGTH - 1));
        inputRefs.current[target]?.focus();
      },
      clear: () => {
        onChange("");
      },
      select: (index = 0) => {
        const target = Math.max(0, Math.min(index, PIN_LENGTH - 1));
        inputRefs.current[target]?.select();
      },
    }),
    [onChange],
  );

  useEffect(() => {
    if (autoFocus && !disabled) {
      const timer = setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, disabled]);

  const handleChange = useCallback(
    (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const raw = e.target.value;
      const cleaned = raw.replace(/[^0-9]/g, "");
      const prevChar = digits[index];

      // Handle multi-character paste or autofill (length > 2, or length 2 when box was empty)
      if (cleaned.length > 2 || (cleaned.length === 2 && !prevChar)) {
        const nextDigits = [...digits];
        const startIdx = cleaned.length === PIN_LENGTH ? 0 : index;
        for (let j = 0; j < cleaned.length && startIdx + j < PIN_LENGTH; j++) {
          nextDigits[startIdx + j] = cleaned[j];
        }
        const nextVal = nextDigits.join("");
        onChange(nextVal);

        if (nextDigits.every((d) => d !== "") && nextVal.length === PIN_LENGTH) {
          inputRefs.current[PIN_LENGTH - 1]?.focus();
          onComplete?.(nextVal);
        } else {
          const firstEmpty = nextDigits.findIndex((d) => d === "");
          const focusTarget = firstEmpty !== -1 ? firstEmpty : Math.min(startIdx + cleaned.length, PIN_LENGTH - 1);
          inputRefs.current[focusTarget]?.focus();
        }
        return;
      }

      // Input was cleared
      if (cleaned.length === 0) {
        const nextDigits = [...digits];
        nextDigits[index] = "";
        const nextVal = nextDigits.join("");
        onChange(nextVal);
        return;
      }

      // Single digit entry (or replacing existing digit)
      let char = cleaned;
      if (cleaned.length === 2 && prevChar) {
        char = cleaned[0] === prevChar ? cleaned[1] : cleaned[cleaned.length - 1];
      } else if (cleaned.length > 1) {
        char = cleaned.slice(-1);
      }

      const nextDigits = [...digits];
      nextDigits[index] = char;
      const nextVal = nextDigits.join("");
      onChange(nextVal);

      // Advance focus if not last box
      if (index < PIN_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus();
      }

      // Auto-submit when all 6 characters are filled
      if (nextDigits.every((d) => d !== "") && nextVal.length === PIN_LENGTH) {
        onComplete?.(nextVal);
      }
    },
    [digits, disabled, onChange, onComplete],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;

      if (e.key === "Backspace") {
        if (digits[index] === "" && index > 0) {
          e.preventDefault();
          const nextDigits = [...digits];
          nextDigits[index - 1] = "";
          const nextVal = nextDigits.join("");
          onChange(nextVal);
          inputRefs.current[index - 1]?.focus();
        } else if (digits[index] !== "") {
          e.preventDefault();
          const nextDigits = [...digits];
          nextDigits[index] = "";
          const nextVal = nextDigits.join("");
          onChange(nextVal);
        }
      } else if (e.key === "Delete") {
        e.preventDefault();
        const nextDigits = [...digits];
        nextDigits[index] = "";
        onChange(nextDigits.join(""));
      } else if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        inputRefs.current[index - 1]?.focus();
      } else if (e.key === "ArrowRight" && index < PIN_LENGTH - 1) {
        e.preventDefault();
        inputRefs.current[index + 1]?.focus();
      } else if (e.key === "Enter") {
        if (digits.every((d) => d !== "") && value.length === PIN_LENGTH) {
          e.preventDefault();
          onComplete?.(value);
        }
      }
    },
    [digits, disabled, onChange, onComplete, value],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, PIN_LENGTH);
      if (!pasted) return;

      const nextDigits = Array(PIN_LENGTH).fill("");
      for (let i = 0; i < pasted.length; i++) {
        nextDigits[i] = pasted[i];
      }
      const nextVal = nextDigits.join("");
      onChange(nextVal);

      if (pasted.length === PIN_LENGTH) {
        inputRefs.current[PIN_LENGTH - 1]?.focus();
        onComplete?.(nextVal);
      } else {
        inputRefs.current[pasted.length]?.focus();
      }
    },
    [disabled, onChange, onComplete],
  );

  const handleFocus = useCallback(
    (index: number, e: React.FocusEvent<HTMLInputElement>) => {
      e.target.select();
      const firstEmpty = digits.findIndex((d) => d === "");
      if (firstEmpty !== -1 && index > firstEmpty) {
        inputRefs.current[firstEmpty]?.focus();
      }
    },
    [digits],
  );

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
      {Array.from({ length: PIN_LENGTH }).map((_, i) => {
        const isFilled = Boolean(digits[i]);
        const stateClass = hasError
          ? "border-rose-500/70 ring-1 ring-rose-500/30 bg-rose-950/25 text-rose-300 focus:border-rose-400 focus:ring-rose-500/50"
          : isFilled
          ? "border-white/20 bg-slate-950/80 text-white focus:border-[#DD3C73] focus:ring-[#DD3C73]/30"
          : "border-white/10 bg-slate-950/60 text-slate-100 focus:border-[#DD3C73] focus:ring-[#DD3C73]/30";

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
            value={digits[i]}
            disabled={disabled}
            onChange={(e) => handleChange(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => handleFocus(i, e)}
            aria-label={ariaLabel ? `${ariaLabel} digit ${i + 1}` : `PIN digit ${i + 1} of 6`}
            className={`${sizeClass} ${stateClass} text-center font-mono font-bold caret-[#DD3C73] border transition-all duration-150 focus:outline-none focus:ring-2 focus:bg-slate-900/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-inner`}
          />
        );
      })}
    </div>
  );
});
