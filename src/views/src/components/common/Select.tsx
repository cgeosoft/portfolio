import { forwardRef } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";

export type SelectSize = "sm" | "md" | "lg";
export type SelectTone = "default" | "accent" | "muted";

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** Visual size: sm for toolbars and filters, md for form fields, lg for settings. */
  selectSize?: SelectSize;
  /** Colour treatment. Use accent for emphasised pickers. */
  tone?: SelectTone;
  /** Optional leading icon rendered inside the control. */
  icon?: ReactNode;
  /** Classes for the positioning wrapper, for example width or flex rules. */
  wrapperClassName?: string;
}

/**
 * Native select styled with the shared `.cx-select` surface. The chevron comes
 * from CSS, so callers never place their own indicator.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      selectSize = "md",
      tone = "default",
      icon,
      wrapperClassName = "",
      className = "",
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <div
        className={`cx-select-wrap ${wrapperClassName}`.trim()}
        data-size={selectSize}
        data-tone={tone}
      >
        {icon && <span className="cx-select-icon">{icon}</span>}
        <select
          ref={ref}
          className={`cx-select ${className}`.trim()}
          data-size={selectSize}
          data-tone={tone}
          data-has-icon={icon ? "true" : undefined}
          {...rest}
        >
          {children}
        </select>
      </div>
    );
  },
);

export default Select;
