import type { AnalyticsProvider } from './types';

/**
 * PostHog over its plain capture API — no SDK, so no autocapture of clicks,
 * no session replay, no cookies. Events are "personless"
 * ($process_person_profile: false): counted by an anonymous random ID that
 * lives only in this browser (enough for funnels and retention), with no
 * person profile behind it.
 */
const AID_KEY = 'lp.aid';

let sessionAid: string | null = null;

function randomId(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
}

/** The anonymous ID; a per-tab one when storage is blocked. */
export function anonymousId(): string {
  try {
    let id = localStorage.getItem(AID_KEY);
    if (!id) { id = randomId(); localStorage.setItem(AID_KEY, id); }
    return id;
  } catch {
    sessionAid ??= randomId();
    return sessionAid;
  }
}

/** Context sent with every event: coarse, nothing identifying. */
function context(): Record<string, string | boolean> {
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  return {
    lang: document.documentElement.lang || 'en',
    device: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1280 ? 'tablet' : 'desktop',
    installed: !!standalone,
  };
}

function send(url: string, body: string) {
  // text/plain keeps it a "simple" request: no CORS preflight, and sendBeacon
  // still delivers when the tab is closed right after the action
  try {
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
  } catch { /* fall back to fetch */ }
  fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => { /* analytics never breaks the app */ });
}

export function posthogProvider(apiKey: string, host = 'https://us.i.posthog.com'): AnalyticsProvider {
  const url = `${host.replace(/\/$/, '')}/i/v0/e/`;
  return {
    name: 'posthog',
    track(event, props) {
      send(url, JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: anonymousId(),
        timestamp: new Date().toISOString(),
        properties: { ...context(), ...props, $process_person_profile: false, $lib: 'lastpick' },
      }));
    },
  };
}
