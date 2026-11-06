/**
 * Consent for usage analytics and error reporting. Both options are off by
 * default and independent. Each change updates the setting and the consent
 * record in one place. The rules are in the standard that
 * `docs/telemetry-consent.md` names.
 */
import { randomUUID } from "node:crypto";
import type { ConsentChoice, ConsentRecord, ConsentSource, PrivacyConsentResponse } from "portfolio-shared/api-types";
import { PRIVACY_NOTICE_VERSION } from "portfolio-shared/brand";
import { loadConfig, updateConfig, type DesktopConfig } from "../config";
import { readConsentRecord, writeConsentRecord } from "../db/privacy-consent.repo";

export interface ConsentChanges {
  analytics?: boolean;
  errorReporting?: boolean;
}

/**
 * Takes the consent keys out of a settings update and returns the real
 * changes. A value equal to the stored one is no change, so a client that sends
 * a whole config object does not need the rights to change consent.
 */
export function takeConsentChanges(update: Partial<DesktopConfig>): ConsentChanges | null {
  const config = loadConfig();
  const changes: ConsentChanges = {};
  if ("analyticsEnabled" in update) {
    if (typeof update.analyticsEnabled === "boolean" && update.analyticsEnabled !== config.analyticsEnabled) changes.analytics = update.analyticsEnabled;
    delete update.analyticsEnabled;
  }
  if ("errorReportingEnabled" in update) {
    if (typeof update.errorReportingEnabled === "boolean" && update.errorReportingEnabled !== config.errorReportingEnabled) changes.errorReporting = update.errorReportingEnabled;
    delete update.errorReportingEnabled;
  }
  return "analytics" in changes || "errorReporting" in changes ? changes : null;
}

/** Stores the choices: the settings and the record. An option that is not named keeps its state. */
export function applyConsent(changes: ConsentChanges, source: ConsentSource): ConsentRecord {
  const previous = readConsentRecord();
  const config = loadConfig();
  const at = new Date().toISOString();
  const choice = (granted: boolean | undefined, stored: boolean, old: ConsentChoice | undefined): ConsentChoice =>
    granted === undefined && old ? old : { granted: granted ?? stored, at, source };

  const record: ConsentRecord = {
    noticeVersion: PRIVACY_NOTICE_VERSION,
    analytics: choice(changes.analytics, config.analyticsEnabled, previous?.analytics),
    errorReporting: choice(changes.errorReporting, config.errorReportingEnabled, previous?.errorReporting),
  };
  updateConfig({ analyticsEnabled: record.analytics.granted, errorReportingEnabled: record.errorReporting.granted });
  writeConsentRecord(record);
  return record;
}

/** The notice version that events carry. 0 means a choice from before the consent record. */
export function consentVersion(): number {
  return readConsentRecord()?.noticeVersion ?? 0;
}

/** An install from before the record, or one that saw an older notice, gets the one-time prompt. */
export function needsConsentPrompt(): boolean {
  if (!loadConfig().setupCompleted) return false;
  const record = readConsentRecord();
  return !record || record.noticeVersion < PRIVACY_NOTICE_VERSION;
}

/** Only the desktop window sees the analytics ID and can change a choice. */
export function consentStatus(isLocal: boolean): PrivacyConsentResponse {
  const config = loadConfig();
  return {
    record: readConsentRecord(),
    needsPrompt: needsConsentPrompt(),
    analyticsEnabled: config.analyticsEnabled,
    errorReportingEnabled: config.errorReportingEnabled,
    canChange: isLocal,
    analyticsId: isLocal ? config.deviceId : undefined,
  };
}

/** Replaces the analytics ID. Events sent with the old ID stay with PostHog until they expire. */
export function resetAnalyticsId(): string {
  return updateConfig({ deviceId: randomUUID() }).deviceId;
}
