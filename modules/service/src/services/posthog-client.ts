/**
 * The only place that creates a PostHog client. A checkout has no key, and a
 * development run sends nothing even with one.
 */
import { PostHog, type PostHogOptions } from "posthog-node";
import { isDev } from "../environment";

/** Baked into the release bundle (see ../globals.d.ts); empty from a checkout. */
const POSTHOG_KEY = typeof POSTHOG_API_KEY !== "undefined" ? (POSTHOG_API_KEY ?? "") : "";
const POSTHOG_HOST = "https://eu.i.posthog.com";

export function createPostHogClient(options: Pick<PostHogOptions, "before_send"> = {}): PostHog | null {
  if (!POSTHOG_KEY || isDev()) return null;
  return new PostHog(POSTHOG_KEY, {
    ...options,
    host: POSTHOG_HOST,
    disableGeoip: true,
    // The SDK's own capture sends raw errors and exits the process on a fatal one.
    enableExceptionAutocapture: false,
  });
}
