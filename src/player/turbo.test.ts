import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import openFx from './fixtures/open.json';
import {
  cachedProfile, clearHistoryMemory, clearPlayerCache, fetchProfile, loadHistory, normalizeProfile, normalizeRecent,
  withMode, type RawHeroRow, type RawPlayer,
} from './api';
import { minDurationFor, reviewMatch } from '../match/review';
import { isTurbo } from '../match/model';

type Fx = { player: RawPlayer; wl: { win: number; lose: number }; heroes: RawHeroRow[]; heroes90: RawHeroRow[] };
const open = openFx as unknown as Fx;
const reply = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe('Turbo is its own mode', () => {
  it('mode query: nothing for normal games, game_mode=23 + significant=0 for Turbo', () => {
    expect(withMode('/players/1/wl')).toBe('/players/1/wl');
    expect(withMode('/players/1/wl', 'turbo')).toBe('/players/1/wl?game_mode=23&significant=0');
    expect(withMode('/players/1/heroes?date=90', 'turbo')).toBe('/players/1/heroes?date=90&game_mode=23&significant=0');
    expect(isTurbo({ gameMode: 23 })).toBe(true);
    expect(isTurbo({ gameMode: 22 })).toBe(false);
  });

  it('no Turbo games is an empty Turbo profile, not a hidden one', () => {
    const p = normalizeProfile(1001, open.player, { win: 0, lose: 0 }, [], [], 0, 'turbo')!;
    expect(p).toMatchObject({ hidden: false, win: 0, lose: 0, heroes: [], mode: 'turbo' });
    // the normal view keeps inferring "hidden" from emptiness
    expect(normalizeProfile(1001, open.player, { win: 0, lose: 0 }, [], [], 0)!.hidden).toBe(true);
  });

  it('recent matches keep their game mode', () => {
    const g = normalizeRecent([{ match_id: 1, player_slot: 0, radiant_win: true, hero_id: 2, start_time: 5, kills: 1, deaths: 2, assists: 3, game_mode: 23 }]);
    expect(g[0].gameMode).toBe(23);
  });
});

describe('Turbo requests and caches', () => {
  let calls: string[];
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      configurable: true,
    });
    calls = [];
    clearHistoryMemory();
  });
  afterEach(() => { vi.unstubAllGlobals(); clearPlayerCache(); });

  it('a Turbo profile asks for Turbo only and is cached apart from the normal one', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      const turbo = url.includes('game_mode=23');
      return reply(200, url.includes('/wl') ? (turbo ? { win: 11, lose: 12 } : open.wl) : url.includes('/heroes') ? (turbo ? [{ hero_id: 13, games: 23, win: 11, last_played: 1 }] : open.heroes) : open.player);
    });
    const now = Date.UTC(2026, 10, 27);
    const normal = await fetchProfile(1001, { now });
    const turbo = await fetchProfile(1001, { now, mode: 'turbo' });
    expect(calls.filter((u) => u.includes('game_mode=23&significant=0'))).toHaveLength(3); // wl, heroes, heroes 90 d
    expect(turbo.profile).toMatchObject({ win: 11, lose: 12, mode: 'turbo' });
    expect(normal.profile.win).toBe(open.wl.win);
    expect(cachedProfile(1001)?.win).toBe(open.wl.win);
    expect(cachedProfile(1001, 'turbo')?.win).toBe(11);
    await fetchProfile(1001, { now: now + 1000, mode: 'turbo' });
    expect(calls).toHaveLength(8);
  });

  it('match history: Turbo has its own request and cache', async () => {
    vi.stubGlobal('fetch', async (url: string) => { calls.push(url); return reply(200, []); });
    const now = Date.UTC(2026, 10, 27);
    await loadHistory(1001, now / 1000 - 14 * 86400, { now });
    await loadHistory(1001, now / 1000 - 14 * 86400, { now, mode: 'turbo' });
    await loadHistory(1001, now / 1000 - 14 * 86400, { now: now + 1000, mode: 'turbo' });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('game_mode=23&significant=0');
    expect(calls[0]).not.toContain('game_mode');
  });
});

describe('Turbo match review', () => {
  it('shorter games still count in Turbo', () => {
    expect(minDurationFor(23)).toBe(600);
    expect(minDurationFor(22)).toBe(900);
    const player = { slot: 0, radiant: true, heroId: 8, accountId: 1, name: null, rankTier: null, kills: 5, deaths: 3, assists: 9, lastHits: 100, denies: 0, gpm: 900, xpm: 1200, netWorth: 0, heroDamage: 20000, towerDamage: 0, heroHealing: 0, level: 25, items: [], backpack: [], neutral: null, scepter: false, shard: false, leaver: false, laneRole: null, roaming: false, purchases: null, goldT: null, lhT: null, xpT: null, dnT: null, laneEff: null, deadSeconds: null, deathTimes: null, buybackTimes: [], obsPlaced: null, campsStacked: null, stuns: null, teamfightShare: null, bench: { gpm: null, xpm: null, lhpm: null, damage: null } };
    const match = (gameMode: number) => ({ id: 1, start: 2_000_000_000, duration: 12 * 60, radiantWin: true, gameMode });
    expect(reviewMatch({ player, match: match(22), position: 1, history: [] })).toMatchObject({ reason: 'shortMatch' });
    expect(reviewMatch({ player, match: match(23), position: 1, history: [] })).toMatchObject({ reason: 'fewGames' });
  });
});
