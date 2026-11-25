import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS, EVENT_NAMES, rankProp, resetOnce, resetTracking, sanitize, setProviders, trackEvent, trackOnce } from './index';
import { anonymousId, posthogProvider } from './posthog';
import type { AnalyticsProvider } from './types';

function recorder() {
  const calls: { event: string; props: Record<string, unknown> }[] = [];
  const provider: AnalyticsProvider = { name: 'test', track: (event, props) => calls.push({ event, props }) };
  return { calls, provider };
}

describe('event catalogue', () => {
  it('has exactly the six product events', () => {
    expect([...EVENT_NAMES].sort()).toEqual([
      'draft_results_viewed', 'hero_build_viewed', 'match_analysis_loaded',
      'my_pool_applied', 'player_profile_loaded', 'share_created',
    ]);
  });

  it('declares no key that could carry an identity', () => {
    for (const keys of Object.values(EVENTS)) {
      for (const k of keys as readonly string[]) expect(k).not.toMatch(/(^|[a-z])(id|Id|ID)$|name|nick|steam|account|match_?id|hero/i);
    }
  });
});

describe('trackEvent', () => {
  let rec: ReturnType<typeof recorder>;
  beforeEach(() => { rec = recorder(); setProviders([rec.provider]); resetTracking(); });
  afterEach(() => setProviders(null));

  it('sends the declared properties only', () => {
    trackEvent('draft_results_viewed', {
      position: '3', rank: 'divine_immortal', enemyCount: 5, allyCount: 3, banCount: 0, pool: false,
      // a caller mistake: must never leave the browser
      ...({ accountId: 123456789, heroes: '1,2,3', nickname: 'someone' } as object),
    } as never);
    expect(rec.calls).toEqual([{ event: 'draft_results_viewed', props: { position: '3', rank: 'divine_immortal', enemyCount: 5, allyCount: 3, banCount: 0, pool: false } }]);
  });

  it('drops long strings and non-plain values', () => {
    expect(sanitize('share_created', { surface: 'draft', kind: 'link', format: 'x'.repeat(41) as 'none' })).toEqual({ surface: 'draft', kind: 'link' });
    expect(sanitize('hero_build_viewed', { position: '1', rank: { a: 1 } as unknown as string })).toEqual({ position: '1' });
  });

  it('ignores unknown events and survives a failing provider', () => {
    setProviders([{ name: 'broken', track: () => { throw new Error('down'); } }, rec.provider]);
    expect(() => trackEvent('nope' as never, {} as never)).not.toThrow();
    expect(() => trackEvent('share_created', { surface: 'match', kind: 'image', format: 'story' })).not.toThrow();
    expect(rec.calls.map((c) => c.event)).toEqual(['share_created']);
  });

  it('trackOnce: re-renders and StrictMode double effects send one event', () => {
    for (let i = 0; i < 3; i++) trackOnce('9100000001|true', 'match_analysis_loaded', { parsed: true, perspective: 'match', source: 'input', mode: 'ranked' });
    trackOnce('9100000002|true', 'match_analysis_loaded', { parsed: true, perspective: 'match', source: 'input', mode: 'ranked' });
    expect(rec.calls).toHaveLength(2);
    // the local key (a match id) is not part of the payload
    expect(JSON.stringify(rec.calls)).not.toContain('91000000');
  });

  it('resetOnce lets the next switch-on count again', () => {
    const props = { position: 'all', rank: 'all', poolSize: '20-39', lowData: false } as const;
    trackOnce('on', 'my_pool_applied', props);
    trackOnce('on', 'my_pool_applied', props);
    resetOnce('my_pool_applied', 'on');
    trackOnce('on', 'my_pool_applied', props);
    expect(rec.calls).toHaveLength(2);
  });

  it('rank ids become lower-case values', () => {
    expect(rankProp('DIVINE_IMMORTAL')).toBe('divine_immortal');
    expect(rankProp(null)).toBe('all');
  });
});

describe('PostHog provider', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    });
  });

  it('beacons a personless event with the anonymous id, as text/plain', async () => {
    const beacons: { url: string; body: string; type: string }[] = [];
    vi.stubGlobal('navigator', { sendBeacon: (url: string, blob: Blob) => { void blob.text().then((body) => beacons.push({ url, body, type: blob.type })); return true; } });
    vi.stubGlobal('window', { innerWidth: 390, matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('document', { documentElement: { lang: 'ru' } });
    posthogProvider('phc_test', 'https://eu.i.posthog.com/').track('share_created', { surface: 'profile', kind: 'image', format: 'post' });
    await new Promise((r) => setTimeout(r, 0));
    vi.unstubAllGlobals();
    expect(beacons).toHaveLength(1);
    expect(beacons[0].url).toBe('https://eu.i.posthog.com/i/v0/e/');
    expect(beacons[0].type).toBe('text/plain');
    const body = JSON.parse(beacons[0].body);
    expect(body).toMatchObject({ api_key: 'phc_test', event: 'share_created', distinct_id: anonymousId() });
    expect(body.properties).toEqual({
      lang: 'ru', device: 'mobile', installed: false,
      surface: 'profile', kind: 'image', format: 'post',
      $process_person_profile: false, $lib: 'lastpick',
    });
  });

  it('keeps one anonymous id per browser', () => {
    const a = anonymousId();
    expect(a).toMatch(/[0-9a-f-]{20,}/);
    expect(anonymousId()).toBe(a);
  });
});
