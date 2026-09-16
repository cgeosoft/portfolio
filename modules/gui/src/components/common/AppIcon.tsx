/** Portfolio brand mark: the trending-up line inside a rounded tile. */
interface AppIconProps {
  className?: string;
}

export function AppIcon({ className = "h-6 w-6" }: AppIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M22 7 13.5 15.5 8.5 10.5 2 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 7h6v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
