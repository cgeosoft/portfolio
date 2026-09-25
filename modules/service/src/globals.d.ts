/**
 * Build-time constants. modules/desktop/scripts/stage.ts bakes them into the
 * service bundle with `bun build --define APP_VERSION='"1.2.3"'`. From a
 * checkout they are not defined: read them behind `typeof X !== "undefined"`.
 */

/** Version of the release, e.g. "1.2.3". */
declare const APP_VERSION: string | undefined;

/** PostHog project key of the release build. Telemetry stays off without it. */
declare const POSTHOG_API_KEY: string | undefined;
