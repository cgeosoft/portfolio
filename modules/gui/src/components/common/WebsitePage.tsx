import { useState, useRef, useCallback } from "react";
import {
  ArrowLeft,
  FileText,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  HeartHandshake,
  type LucideIcon,
} from "lucide-react";
import { rpc } from "../../rpc";
import { APP_NAME, WEBPAGE_URL } from "../../environment";
import { t } from "../../i18n";

/** The website pages the app shows in a frame. Each needs a framing exception in `extras/website/_headers`. */
export type WebsitePageId = "terms" | "sponsorship";

const PAGES: Record<WebsitePageId, { path: string; icon: LucideIcon }> = {
  terms: { path: "terms", icon: ShieldCheck },
  sponsorship: { path: "sponsorship", icon: HeartHandshake },
};

export interface WebsitePageProps {
  page: WebsitePageId;
  onBack: () => void;
  webpageUrl?: string;
}

/**
 * A page of the website inside the app, with Back, Reload and Open in Browser.
 * The page texts are `layout.<page>.*`; the shared ones stay under `layout.terms`.
 */
export function WebsitePage({ page, onBack, webpageUrl }: WebsitePageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const cleanBaseUrl = (webpageUrl || WEBPAGE_URL).replace(/\/+$/, "");
  const { path, icon: Icon } = PAGES[page];
  const pageUrl = `${cleanBaseUrl}/${path}/`;
  const isLocalhost = cleanBaseUrl.includes("localhost") || cleanBaseUrl.includes("127.0.0.1");

  const handleReload = useCallback(() => {
    setIsLoading(true);
    setLoadFailed(false);
    if (iframeRef.current) {
      iframeRef.current.src = pageUrl;
    }
  }, [pageUrl]);

  const handleOpenBrowser = useCallback(async () => {
    try {
      await rpc.request.openExternalUrl({ url: pageUrl });
    } catch {
      window.open(pageUrl, "_blank");
    }
  }, [pageUrl]);

  // The URL sits inside the sentence as code; split the translated sentence around it.
  const [connectBefore, connectAfter = ""] = t("layout.terms.couldNotConnect", { url: "\u0000" }).split("\u0000");

  return (
    <div className="flex-1 w-full max-w-full flex flex-col font-mono min-h-0 space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800 shrink-0">

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-slate-50 transition-colors cursor-pointer focus:outline-hidden"
            title={t("common.back")}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("common.back")}</span>
          </button>

          <button
            type="button"
            onClick={handleReload}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-slate-50 transition-colors cursor-pointer focus:outline-hidden"
            title={t(`layout.${page}.reloadTitle`)}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-[#DD3C73]" : ""}`} />
            <span className="hidden sm:inline">{t("layout.terms.reload")}</span>
          </button>

          <button
            type="button"
            onClick={handleOpenBrowser}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-[#DD3C73] transition-colors cursor-pointer focus:outline-hidden"
            title={t(`layout.${page}.openTitle`)}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("layout.terms.openInBrowser")}</span>
          </button>

          <div className="flex text-xs font-bold text-slate-400 uppercase tracking-widest items-center gap-1.5 min-w-0">
            <Icon className="w-4 h-4 text-[#DD3C73] shrink-0" />
            <span className="truncate">{APP_NAME} &bull; {t(`layout.${page}.title`)}</span>
          </div>
        </div>
      </div>

      {/* Frame Container */}
      <div className="flex-1 min-h-[500px] h-[calc(100vh-160px)] relative rounded-2xl overflow-hidden border border-slate-800 bg-widget shadow-2xl flex flex-col">
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-canvas/80 backdrop-blur-xs gap-3">
            <RefreshCw className="w-6 h-6 text-[#DD3C73] animate-spin" />
            <span className="text-xs text-slate-400 tracking-wider">
              {t(`layout.${page}.loading`, { app: APP_NAME, url: pageUrl })}
            </span>
          </div>
        )}

        {/* Error Fallback */}
        {loadFailed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-canvas">
            <div className="w-12 h-12 rounded-2xl bg-[#DD3C73]/10 border border-[#DD3C73]/30 flex items-center justify-center text-[#DD3C73]">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="max-w-md space-y-1">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                {t(`layout.${page}.loadFailed`, { app: APP_NAME })}
              </h3>
              <p className="text-xs text-slate-400">
                {connectBefore}
                <code className="text-[#DD3C73]">{pageUrl}</code>
                {connectAfter}{" "}
                {isLocalhost ? t("layout.terms.checkLocal") : t("layout.terms.checkInternet")}
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleReload}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                {t("layout.terms.tryAgain")}
              </button>
              <button
                type="button"
                onClick={handleOpenBrowser}
                className="px-4 py-2 bg-[#DD3C73] hover:bg-[#DD3C73]/90 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <span>{t("layout.terms.openInBrowser")}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Embedded IFrame */}
        <iframe
          ref={iframeRef}
          src={pageUrl}
          title={t(`layout.${page}.frameTitle`, { app: APP_NAME })}
          className="w-full h-full flex-1 border-0 rounded-2xl bg-canvas"
          onLoad={() => {
            setIsLoading(false);
          }}
          onError={() => {
            setIsLoading(false);
            setLoadFailed(true);
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
