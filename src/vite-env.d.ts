/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project API key (public, phc_…). Without it no product events are sent. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingestion host, e.g. https://eu.i.posthog.com (default: US cloud). */
  readonly VITE_POSTHOG_HOST?: string;
}
