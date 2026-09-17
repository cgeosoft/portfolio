import type { CSSProperties } from "react";

export interface Glow {
  /** Centre as CSS positions, for example "50%" or "-10%". */
  x: string;
  y: string;
  /** Radius in px of the soft disc. */
  radius: number;
  /** "r, g, b" so the alpha can vary between layers. */
  rgb: string;
  alpha: number;
}

interface AmbientGlowProps {
  glows: Glow[];
  /** Slowly fades the first glow in and out. Opacity only, so the repaint stays cheap. */
  pulse?: boolean;
  /**
   * Lets every glow wander slowly around its centre. Each glow becomes its own
   * disc-sized layer moved with `transform`, so the gradient itself is painted
   * once and only re-composited; the global reduced-motion rule stops it.
   */
  drift?: boolean;
  /** `absolute` covers the positioned parent, `fixed` covers the viewport. */
  position?: "absolute" | "fixed";
  className?: string;
}

const PULSE_MAX_RADIUS = 140;

/** Three different paths and periods so the discs never move in step. */
const DRIFT_ANIMATIONS = ["ambient-drift-a 26s", "ambient-drift-b 32s", "ambient-drift-c 38s"];

const gradient = (g: Glow, alpha = g.alpha) =>
  `radial-gradient(circle ${g.radius}px at ${g.x} ${g.y}, rgba(${g.rgb}, ${alpha}), transparent 70%)`;

/** The same disc drawn centred inside its own box. */
const discStyle = (g: Glow, r: number, alpha = g.alpha): CSSProperties => ({
  left: `calc(${g.x} - ${r}px)`,
  top: `calc(${g.y} - ${r}px)`,
  width: r * 2,
  height: r * 2,
  background: `radial-gradient(circle ${r}px at 50% 50%, rgba(${g.rgb}, ${alpha}), transparent 70%)`,
});

/**
 * Soft coloured glows drawn with radial gradients instead of `filter: blur()`.
 *
 * The desktop shell renders the GUI in WebKitGTK, which on Linux falls back to
 * software rendering. There, a blurred element is rasterised again whenever
 * anything animates on top of it; three 400-600px discs with a 120-140px blur
 * cost about 250 ms per frame on the login screen. A gradient is a flat fill
 * and repaints in well under a millisecond, and it looks the same.
 */
export function AmbientGlow({ glows, pulse = false, drift = false, position = "absolute", className = "" }: AmbientGlowProps) {
  if (glows.length === 0) return null;
  const layer = `${position} pointer-events-none ${className}`;
  const first = glows[0]!;

  if (drift) {
    // Clipped wrapper: the discs stick out past the edges while they wander
    // and must not give a scrolling parent extra room.
    return (
      <div className={`${layer} inset-0 overflow-hidden`} aria-hidden="true">
        {glows.map((g, i) => {
          const animations = [`${DRIFT_ANIMATIONS[i % DRIFT_ANIMATIONS.length]} ease-in-out infinite alternate`];
          if (pulse && i === 0) animations.push("ambient-pulse 5s ease-in-out infinite");
          const style: CSSProperties = {
            ...discStyle(g, g.radius),
            // Travel scales with the disc so small glows stay put and big ones roam.
            ["--ambient-drift" as string]: `${Math.round(g.radius * 0.3)}px`,
            animation: animations.join(", "),
            animationDelay: `${-i * 9}s, 0s`,
            willChange: "transform",
          };
          return <div key={i} className="absolute" style={style} />;
        })}
      </div>
    );
  }

  const base: CSSProperties = { background: glows.map((g) => gradient(g)).join(", ") };
  // The pulsing layer is a small box at the centre of the first glow, not the
  // whole viewport: a software renderer repaints the animated element's full
  // bounds every frame, and the cost grows with its area. Measured in
  // WebKitGTK on the login screen: a 280px box keeps 60 fps, a full-viewport
  // pulse drops to about 20 fps.
  const r = Math.min(first.radius, PULSE_MAX_RADIUS);
  const pulseStyle = discStyle(first, r, first.alpha * 0.7);
  return (
    <>
      <div className={`${layer} inset-0`} style={base} aria-hidden="true" />
      {pulse && <div className={`${layer} animate-pulse`} style={pulseStyle} aria-hidden="true" />}
    </>
  );
}
