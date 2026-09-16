import type { CSSProperties } from "react";

export interface Glow {
  x: string;
  y: string;
  radius: number;
  rgb: string;
  alpha: number;
}

interface AmbientGlowProps {
  glows: Glow[];
  pulse?: boolean;
  position?: "absolute" | "fixed";
  className?: string;
}

const PULSE_MAX_RADIUS = 140;

const gradient = (g: Glow, alpha = g.alpha) => `radial-gradient(circle ${g.radius}px at ${g.x} ${g.y}, rgba(${g.rgb}, ${alpha}), transparent 70%)`;

/**
 * Soft coloured glows drawn with radial gradients instead of `filter: blur()`:
 * WebKitGTK renders in software on Linux and a blurred element is rasterised
 * again whenever anything animates on top of it. Same component as Assistant.
 */
export function AmbientGlow({ glows, pulse = false, position = "absolute", className = "" }: AmbientGlowProps) {
  if (glows.length === 0) return null;
  const base: CSSProperties = { background: glows.map((g) => gradient(g)).join(", ") };
  const layer = `${position} pointer-events-none ${className}`;
  const first = glows[0]!;
  const r = Math.min(first.radius, PULSE_MAX_RADIUS);
  const pulseStyle: CSSProperties = {
    left: `calc(${first.x} - ${r}px)`,
    top: `calc(${first.y} - ${r}px)`,
    width: r * 2,
    height: r * 2,
    background: `radial-gradient(circle ${r}px at 50% 50%, rgba(${first.rgb}, ${first.alpha * 0.7}), transparent 70%)`,
  };
  return (
    <>
      <div className={`${layer} inset-0`} style={base} aria-hidden="true" />
      {pulse && <div className={`${layer} animate-pulse`} style={pulseStyle} aria-hidden="true" />}
    </>
  );
}
