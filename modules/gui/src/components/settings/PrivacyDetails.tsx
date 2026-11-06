import { useEffect, useState } from "react";
import { ExternalLink, Fingerprint, ScrollText } from "lucide-react";
import { PRIVACY_NOTICE_URL } from "portfolio-shared/brand";
import { api } from "../../api";
import { openExternal } from "../../environment";
import { t } from "../../i18n";
import { SettingItem } from "./SettingsFields";

const BUTTON = "h-8 px-3 rounded-lg border border-slate-800 bg-slate-950/60 text-[11px] font-bold text-slate-300 hover:border-slate-700 transition-colors cursor-pointer";

/** Settings → Privacy & Security: the Privacy Notice and the analytics ID. Only the desktop window sees the ID. */
export function PrivacyDetails() {
  const [analyticsId, setAnalyticsId] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .getPrivacyConsent()
      .then((status) => setAnalyticsId(status.analyticsId))
      .catch(() => {});
  }, []);

  const copy = async () => {
    if (!analyticsId) return;
    await navigator.clipboard?.writeText(analyticsId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <SettingItem
        icon={ScrollText}
        title={t("settings.privacy.noticeTitle")}
        description={t("settings.privacy.noticeDescription")}
        control={
          <button type="button" onClick={() => openExternal(PRIVACY_NOTICE_URL)} className={`${BUTTON} inline-flex items-center gap-1.5 shrink-0`}>
            <span>{t("settings.privacy.open")}</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        }
      />
      {analyticsId && (
        <SettingItem icon={Fingerprint} title={t("settings.privacy.idTitle")} description={t("settings.privacy.idDescription")}>
          <code className="text-[11px] font-mono text-slate-300 break-all">{analyticsId}</code>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void copy()} className={BUTTON}>
              {copied ? t("settings.privacy.copied") : t("settings.privacy.copy")}
            </button>
            <button type="button" onClick={() => void api.resetAnalyticsId().then((res) => setAnalyticsId(res.analyticsId))} className={BUTTON}>
              {t("settings.privacy.reset")}
            </button>
          </div>
        </SettingItem>
      )}
    </>
  );
}
