import { EVENTS } from './events';
import { posthogProvider } from './posthog';
import type { AnalyticsProvider, EventName, EventProps } from './types';

/**
 * LASTPICK product analytics: the one interface components use.
 *
 *   trackEvent('draft_results_viewed', { position: '3', rank: 'divine_immortal', … })
 *
 * Page views stay with Vercel Web Analytics (./vercel.ts); actions go to the
 * providers below (PostHog when VITE_POSTHOG_KEY is set). Swapping or adding a
 * provider touches only this folder.
 */
export type { EventName, EventProps } from './types';
export { EVENTS, EVENT_NAMES } from './events';
export { analyticsUrl, beforeSend, resetAnalyticsState } from './vercel';

let providers: AnalyticsProvider[] | null = null;

function defaultProviders(): AnalyticsProvider[] {
  const env = import.meta.env;
  const list: AnalyticsProvider[] = [];
  if (env.PROD && env.VITE_POSTHOG_KEY) list.push(posthogProvider(env.VITE_POSTHOG_KEY, env.VITE_POSTHOG_HOST || undefined));
  if (env.DEV && env.MODE !== 'test') list.push({ name: 'console', track: (e, p) => console.debug('[analytics]', e, p) });
  return list;
}

/** Keeps only the declared keys and plain short values. */
export function sanitize<E extends EventName>(event: E, props: EventProps[E]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const src = props as unknown as Record<string, unknown>;
  for (const key of EVENTS[event] as readonly string[]) {
    const v = src[key];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[key] = v;
    else if (typeof v === 'string' && v.length <= 40) out[key] = v;
  }
  return out;
}

/** Send one event to every provider. Never throws. */
export function trackEvent<E extends EventName>(event: E, props: EventProps[E]): void {
  if (!(event in EVENTS)) return;
  providers ??= defaultProviders();
  const clean = sanitize(event, props);
  for (const p of providers) {
    try { p.track(event, clean); } catch { /* analytics never breaks the app */ }
  }
}

const sentKeys = new Set<string>();

/**
 * trackEvent at most once per `key` in this page session — React re-renders
 * and StrictMode double effects do not send duplicates. The key is local
 * (it may contain an ID) and is never sent.
 */
export function trackOnce<E extends EventName>(key: string, event: E, props: EventProps[E]): void {
  const k = `${event}|${key}`;
  if (sentKeys.has(k)) return;
  sentKeys.add(k);
  trackEvent(event, props);
}

/** Forget a trackOnce key (e.g. My pool switched off, so the next switch-on counts). */
export function resetOnce(event: EventName, key: string) {
  sentKeys.delete(`${event}|${key}`);
}

/** The site's rank id ('DIVINE_IMMORTAL' / 'ALL') as an event value. */
export const rankProp = (rank: string | null | undefined) => (rank ? rank.toLowerCase() : 'all');

/** Test hooks. */
export function setProviders(list: AnalyticsProvider[] | null) { providers = list; }
export function resetTracking() { sentKeys.clear(); }
