import { useState, useEffect, useRef, useCallback } from "react";
import { HelpCircle } from "lucide-react";
import { rpc, ensureRpcReady } from "../../rpc";
import { WEBPAGE_URL } from "../../environment";
import { SponsorInfoModal } from "./SponsorInfoModal";

export interface SponsorBannerCardProps {
  webpageUrl?: string;
  devEmail?: string;
}

export function SponsorBannerCard({ webpageUrl, devEmail }: SponsorBannerCardProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(90);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const cleanBase = (webpageUrl || WEBPAGE_URL).replace(/\/+$/, "");
  const sponsorUrl = `${cleanBase}/sponsor/`;

  const fetchBanner = useCallback(async () => {
    setIsLoading(true);
    let loadedHtml = "";

    // 1. Try RPC call to backend
    try {
      await ensureRpcReady();
      const rpcPromise = rpc.request.getSponsorBanner({ url: sponsorUrl });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Sponsor banner timeout")), 2500)
      );
      const response = await Promise.race([rpcPromise, timeoutPromise]);
      if (response && response.success && response.html) {
        loadedHtml = response.html;
      }
    } catch {
      // Best-effort RPC attempt
    }

    // 2. Direct browser fetch fallback if RPC did not return content
    if (!loadedHtml) {
      try {
        const res = await fetch(sponsorUrl, {
          headers: { Accept: "text/html,application/xhtml+xml" },
        });
        if (res.ok) {
          const text = await res.text();
          if (text.trim().length > 0) {
            loadedHtml = text;
          }
        }
      } catch {
        // Fetch failed (network or CORS)
      }
    }

    if (loadedHtml) {
      setHtmlContent(loadedHtml);
    }
    setIsLoading(false);
  }, [sponsorUrl]);

  useEffect(() => {
    void fetchBanner();
  }, [fetchBanner]);

  // Handle messages from iframe (external link clicks and resize)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== "object") return;

      if (event.data.type === "SPONSOR_CLICK" && typeof event.data.url === "string") {
        const targetUrl = event.data.url;
        rpc.request.openExternalUrl({ url: targetUrl }).catch(() => {
          if (typeof window !== "undefined") {
            window.open(targetUrl, "_blank", "noopener,noreferrer");
          }
        });
      }

      if (event.data.type === "SPONSOR_RESIZE" && typeof event.data.height === "number" && event.data.height > 0) {
        const nextHeight = Math.max(70, Math.min(event.data.height, 300));
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

  if (isLoading && !htmlContent) {
    return (
      <div
        className="w-full rounded-2xl bg-[#111726]/60 border border-[#DD3C73] flex items-center justify-between px-6 animate-pulse shadow-sm shadow-[#DD3C73]/10"
        style={{ height: `${bannerHeight}px` }}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-yellow-500/10 border border-yellow-500/20" />
          <div className="space-y-1.5">
            <div className="w-28 h-3.5 bg-slate-700/50 rounded" />
            <div className="w-44 h-2.5 bg-slate-800/60 rounded" />
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <div className="w-20 h-6 bg-slate-800/40 rounded" />
          <div className="w-20 h-6 bg-slate-800/40 rounded" />
        </div>
        <div className="w-28 h-8 bg-yellow-500/20 rounded-lg" />
      </div>
    );
  }

  if (!htmlContent) {
    return null;
  }

  return (
    <>
      <div className="relative w-full">
        {/* Card containing the iframe with rounded corners and overflow hidden */}
        <div
          className="w-full rounded-2xl overflow-hidden border border-[#DD3C73] bg-[#0b0f19] shadow-sm shadow-[#DD3C73]/10"
          style={{ height: `${bannerHeight}px` }}
        >
          <iframe
            ref={iframeRef}
            srcDoc={htmlContent}
            title="Sponsor Banner"
            className="w-full h-full block border-0 overflow-hidden"
            style={{ backgroundColor: "#08080a" }}
            sandbox="allow-scripts allow-popups allow-forms allow-same-origin"
            scrolling="no"
          />
        </div>

        {/* Top-left question mark button layered above the iframe content */}
        <button
          type="button"
          onClick={() => setIsInfoModalOpen(true)}
          className="absolute -top-2 -left-2 z-30 w-5 h-5 rounded-full bg-slate-900/95 hover:bg-[#DD3C73]/20 border border-slate-700 hover:border-[#DD3C73] text-slate-400 hover:text-[#DD3C73] flex items-center justify-center transition-all cursor-pointer shadow-md focus:outline-none"
          title="About sponsorship"
          aria-label="About sponsorship"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </div>

      <SponsorInfoModal
        isOpen={isInfoModalOpen}
        onClose={() => setIsInfoModalOpen(false)}
        devEmail={devEmail}
      />
    </>
  );
}
