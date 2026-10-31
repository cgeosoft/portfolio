import type { ReactNode } from "react";
import { AppIcon } from "./AppIcon";
import { AmbientGlow } from "./AmbientGlow";
import { APP_NAME } from "../../environment";

/**
 * Full-screen page with the brand mark above a centred card: the backdrop of the lock
 * screen and of the setup wizard. `children` is the card.
 */
export function BrandScreen({ children }: { children: ReactNode }) {
  // z-70: above the menu bar (.app-menubar, z-index 60), which stays above modals.
  return (
    <div className="fixed inset-0 z-70 bg-canvas text-slate-100 overflow-y-auto select-none">
      <AmbientGlow
        pulse
        drift
        glows={[
          // Brand accent (#DD3C73) with the purple it is paired with in the app's gradients.
          { x: "50%", y: "25%", radius: 420, rgb: "221, 60, 115", alpha: 0.22 },
          { x: "33%", y: "78%", radius: 330, rgb: "168, 85, 247", alpha: 0.18 },
          { x: "78%", y: "36%", radius: 300, rgb: "244, 63, 94", alpha: 0.12 },
        ]}
      />
      <div className="absolute inset-0 bg-[radial-gradient(rgb(var(--border-rgb))_1px,transparent_1px)] bg-size-[32px_32px] opacity-25 pointer-events-none" />

      {/* min-h-full instead of centring the scroller: a card taller than the window scrolls from its top */}
      <div className="relative min-h-full flex flex-col items-center justify-center px-4 sm:px-6 py-6">
        <div className="relative z-10 flex flex-col items-center mb-6 sm:mb-8">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-linear-to-tr from-accent-500 via-purple-500 to-cyan-400 p-px shadow-xl shadow-accent-500/20 mb-3">
            <div className="w-full h-full bg-slate-950 rounded-[15px] flex items-center justify-center">
              <AppIcon className="w-6 h-6 sm:w-7 sm:h-7 text-accent-400" />
            </div>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight bg-linear-to-r from-slate-50 via-slate-200 to-accent-bright bg-clip-text text-transparent">{APP_NAME}</h1>
          <p className="text-xs font-mono text-accent-400 mt-1">Personal Investment Tracker</p>
        </div>

        {children}
      </div>
    </div>
  );
}
