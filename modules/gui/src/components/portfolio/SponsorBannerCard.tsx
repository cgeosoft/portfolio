import { useState, useEffect, useRef } from "react";
import { HelpCircle } from "lucide-react";
import type { AppTheme } from "portfolio-shared/api-types";
import { api } from "../../api";
import { openExternal } from "../../environment";
import { SponsorInfoModal } from "./SponsorInfoModal";

export interface SponsorBannerCardProps {
  /** Unused: the service picks the banner page on the Portfolio website. */
  webpageUrl?: string;
  devEmail?: string;
  theme?: AppTheme;
}

/** How long the skeleton waits for the banner's first message before the card hides. */
const SPONSOR_WAIT_MS = 8000;

/**
 * The sponsor banner is a page of the website with its own scripts. The
 * service serves it as a separate document with its own sandbox policy
 * (`/api/app/sponsor/frame`), so it runs in an opaque origin: no session
 * cookie, no API, no access to this document. It talks to the app only by
 * postMessage: its size, and the links the user clicks.
 */
export function SponsorBannerCard({ devEmail, theme = "dark" }: SponsorBannerCardProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "none">("loading");
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(90);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [systemIsDark, setSystemIsDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const isLight = theme === "light" || (theme === "system" && !systemIsDark);
  const frameUrl = api.sponsorFrameUrl(isLight ? "light" : "dark");

  // A new page loads with each theme: show the skeleton until it reports its size, and
  // hide the card when nothing arrives (the website and the bundled copy both missing).
  useEffect(() => {
    setStatus("loading");
    const timer = setTimeout(() => setStatus((s) => (s === "loading" ? "none" : s)), SPONSOR_WAIT_MS);
    return () => clearTimeout(timer);
  }, [frameUrl]);

  // Messages from the banner frame only: its sandbox gives it an opaque origin, so the source is the check.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (!event.data || typeof event.data !== "object") return;

      if (event.data.type === "SPONSOR_CLICK" && typeof event.data.url === "string") {
        // A sponsor link opens in the system browser, and only as https.
        if (/^https:\/\//i.test(event.data.url.trim())) openExternal(event.data.url);
      }

      if (event.data.type === "SPONSOR_RESIZE" && typeof event.data.height === "number" && event.data.height > 0) {
        const nextHeight = Math.max(70, Math.min(event.data.height, 300));
        setStatus("ready");
        setBannerHeight((prev) => {
          // Ignore small height differences to prevent recursive resize loops
          if (Math.abs(prev - nextHeight) <= 4) {
            return prev;
          }
          return nextHeight;
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (status === "none") {
    return null;
  }

  return (
    <>
      <div className="relative w-full">
        {/* Card containing the iframe with rounded corners and overflow hidden */}
        <div
          className="w-full rounded-2xl overflow-hidden border border-[#DD3C73] bg-canvas shadow-sm shadow-[#DD3C73]/10"
          style={{ height: `${bannerHeight}px` }}
        >
          <iframe
            ref={iframeRef}
            src={frameUrl}
            title="Sponsor Banner"
            className="w-full h-full block border-0 overflow-hidden"
            style={{ backgroundColor: isLight ? "#ffffff" : "#08080a" }}
            sandbox="allow-scripts allow-popups"
            referrerPolicy="no-referrer"
            scrolling="no"
          />
        </div>

        {/* Skeleton over the frame until the banner reports its size */}
        {status === "loading" && (
          <div
            className="absolute inset-0 w-full rounded-2xl bg-widget border border-[#DD3C73] flex items-center justify-between px-6 animate-pulse shadow-sm shadow-[#DD3C73]/10"
            style={{ height: `${bannerHeight}px` }}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-yellow-500/10 border border-yellow-500/20" />
              <div className="space-y-1.5">
                <div className="w-28 h-3.5 bg-slate-200 dark:bg-slate-700/50 rounded" />
                <div className="w-44 h-2.5 bg-slate-100 dark:bg-slate-800/60 rounded" />
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-3">
              <div className="w-20 h-6 bg-slate-100 dark:bg-slate-800/40 rounded" />
              <div className="w-20 h-6 bg-slate-100 dark:bg-slate-800/40 rounded" />
            </div>
            <div className="w-28 h-8 bg-yellow-500/20 rounded-lg" />
          </div>
        )}

        {/* Top-left question mark button layered above the iframe content */}
        {status === "ready" && (
          <button
            type="button"
            onClick={() => setIsInfoModalOpen(true)}
            className="absolute -top-2 -left-2 z-30 w-5 h-5 rounded-full bg-widget hover:bg-[#DD3C73]/20 border border-border hover:border-[#DD3C73] text-muted hover:text-[#DD3C73] flex items-center justify-center transition-all cursor-pointer shadow-md focus:outline-none"
            title="About sponsorship"
            aria-label="About sponsorship"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <SponsorInfoModal
        isOpen={isInfoModalOpen}
        onClose={() => setIsInfoModalOpen(false)}
        devEmail={devEmail}
      />
    </>
  );
}
