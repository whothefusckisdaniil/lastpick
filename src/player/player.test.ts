import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import matchupsRaw from '../../public/data/matchups.json';
import heroesRaw from '../../public/data/heroes.json';
import positionsRaw from '../../public/data/positions.json';
import openFx from './fixtures/open.json';
import closedFx from './fixtures/closed.json';
import recentFx from './fixtures/recent.json';
import type { Hero, MatchupRow, PositionDataset } from '../types';
import { computeBaseWinrates } from '../scoring/baseline';
import { scoreCandidates } from '../scoring/engine';
import { scorePool } from '../scoring/poolScoring';
import { APP_CONFIG } from '../config';
import { parsePlayerInput, steam64ToId } from './parseId';
import { rankInfo } from './rankBracket';
import { cachedProfile, clearPlayerCache, fetchProfile, normalizeProfile, normalizeRecent, PlayerError, PROFILE_TTL_MS, type RawHeroRow, type RawPlayer, type RawRecentMatch } from './api';
import { comfort, daysSince, form, heroLabels, heroStats, poolOf, poolWidth, shrink, sortHeroes } from './poolStats';

const heroes = heroesRaw as unknown as Hero[];
const tables = matchupsRaw as unknown as Record<string, MatchupRow[]>;
const positions: PositionDataset = Object.fromEntries(Object.entries(positionsRaw as unknown as Record<string, PositionDataset[number]>).map(([id, v]) => [Number(id), v]));
const matchupMap = new Map(Object.entries(tables).map(([id, rows]) => [Number(id), rows]));
const base = computeBaseWinrates(matchupMap);

type Fx = { player: RawPlayer; wl: { win: number; lose: number }; heroes: RawHeroRow[]; heroes90: RawHeroRow[] };
const open = openFx as unknown as Fx;
const closed = closedFx as unknown as Fx;
const profileOf = (fx: Fx, id = 1001) => normalizeProfile(id, fx.player, fx.wl, fx.heroes, fx.heroes90, Date.UTC(2026, 10, 25))!;

describe('player input', () => {
  it.each([
    ['123456789', 123456789],
    ['  86745912 ', 86745912],
    ['76561198047011640', 86745912], // Steam64
    ['https://www.dotabuff.com/players/86745912', 86745912],
    ['https://www.opendota.com/players/86745912/heroes', 86745912],
    ['https://stratz.com/players/86745912', 86745912],
    ['https://steamcommunity.com/profiles/76561198047011640/', 86745912],
  ])('%s → id %s', (text, id) => {
    expect(parsePlayerInput(text)).toEqual({ kind: 'id', id });
  });

  it('a Steam vanity link cannot be resolved; a name is a search; empty is empty', () => {
    expect(parsePlayerInput('https://steamcommunity.com/id/somebody/')).toEqual({ kind: 'vanity' });
    expect(parsePlayerInput('Doctor Pizdusto')).toEqual({ kind: 'search', q: 'Doctor Pizdusto' });
    expect(parsePlayerInput('   ')).toEqual({ kind: 'empty' });
    // too long for an account id and not a Steam64: searched as text
    expect(parsePlayerInput('12345678901234').kind).toBe('search');
  });

  it('Steam64 conversion', () => {
    expect(steam64ToId('76561197960265729')).toBe(1);
    expect(steam64ToId('76561197960265728')).toBeNull();
  });
});

describe('rank tier', () => {
  it('medal, stars and the site rank group', () => {
    expect(rankInfo(54)).toEqual({ medal: 'legend', medalIndex: 5, stars: 4, bracket: 'LEGEND_ANCIENT' });
    expect(rankInfo(73)?.bracket).toBe('DIVINE_IMMORTAL');
    expect(rankInfo(80)).toMatchObject({ medal: 'immortal', stars: 0, bracket: 'DIVINE_IMMORTAL' });
    expect(rankInfo(25)?.bracket).toBe('HERALD_GUARDIAN');
    expect(rankInfo(35)?.bracket).toBe('CRUSADER_ARCHON');
    expect(rankInfo(null)).toBeNull();
    expect(rankInfo(0)).toBeNull();
  });
});

describe('profile', () => {
  it('an open profile: totals, heroes most played first, last game', () => {
    const p = profileOf(open);
    expect(p.hidden).toBe(false);
    expect(p.win + p.lose).toBeGreaterThan(1000);
    expect(p.heroes.length).toBeGreaterThan(50);
    expect(p.heroes[0].games).toBeGreaterThanOrEqual(p.heroes[1].games);
    expect(p.heroes90.length).toBeGreaterThan(0);
    expect(p.lastPlayed).toBeGreaterThan(0);
  });

  it('a hidden profile ("Expose Public Match Data" off) keeps its rank', () => {
    const p = profileOf(closed, 1002);
    expect(p.hidden).toBe(true);
    expect(p.heroes).toEqual([]);
    expect(p.rankTier).toBe(52);
    expect(p.lastPlayed).toBeNull();
  });

  it('an account OpenDota does not know is not found', () => {
    const raw: RawPlayer = { profile: { account_id: 5, personaname: null, avatarfull: null, fh_unavailable: true }, rank_tier: null, leaderboard_rank: null };
    expect(normalizeProfile(5, raw, { win: 0, lose: 0 }, [], [])).toBeNull();
    expect(normalizeProfile(5, { profile: null, rank_tier: null, leaderboard_rank: null }, { win: 0, lose: 0 }, [], [])).toBeNull();
  });
});

describe('profile requests and cache', () => {
  const reply = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const route = (url: string) => (url.includes('/wl') ? open.wl : url.includes('date=90') ? open.heroes90 : url.includes('/heroes') ? open.heroes : open.player);
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      configurable: true,
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); clearPlayerCache(); });

  it('four requests, then the cache while fresh', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { calls.push(url); return reply(200, route(url)); });
    const now = Date.UTC(2026, 10, 25);
    const a = await fetchProfile(1001, { now });
    expect(calls).toHaveLength(4);
    expect(calls.some((u) => u.endsWith('/players/1001/heroes?date=90'))).toBe(true);
    expect(a.profile.name).toBe('Player1');
    await fetchProfile(1001, { now: now + 1000 });
    expect(calls).toHaveLength(4);
    expect(cachedProfile(1001)?.id).toBe(1001);
  });

  it('429 or an outage: the cached copy, marked stale; without one, the error', async () => {
    const now = Date.UTC(2026, 10, 25);
    vi.stubGlobal('fetch', async (url: string) => reply(200, route(url)));
    await fetchProfile(1001, { now });
    vi.stubGlobal('fetch', async () => reply(429, {}));
    const r = await fetchProfile(1001, { now: now + PROFILE_TTL_MS + 1 });
    expect(r.stale).toBe(true);
    const err = await fetchProfile(7777, { now }).catch((e) => e);
    expect(err).toBeInstanceOf(PlayerError);
    expect((err as PlayerError).kind).toBe('rateLimit');
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    expect(((await fetchProfile(7777, { now }).catch((e) => e)) as PlayerError).kind).toBe('server');
  });

  it('an unknown id is not found (and not cached)', async () => {
    vi.stubGlobal('fetch', async (url: string) => reply(200, url.includes('/wl') ? { win: 0, lose: 0 } : url.includes('/heroes') ? [] : { profile: { account_id: 9, personaname: null, avatarfull: null }, rank_tier: null, leaderboard_rank: null }));
    expect(((await fetchProfile(9).catch((e) => e)) as PlayerError).kind).toBe('notFound');
    expect(cachedProfile(9)).toBeNull();
  });
});

describe('pool stats', () => {
  const p = profileOf(open);

  it('the shrunk edge keeps 3 lucky games out of the top', () => {
    expect(shrink(30, 3)).toBeLessThan(shrink(8, 100));
    const top = sortHeroes(heroStats(p, base), 'strong').slice(0, 10);
    expect(top.every((s) => s.games >= 5)).toBe(true);
    for (let i = 1; i < top.length; i++) expect(top[i - 1].score).toBeGreaterThanOrEqual(top[i].score);
  });

  it('sorts: most played, last 90 days only, rising needs recent games', () => {
    const stats = heroStats(p, base);
    expect(sortHeroes(stats, 'games')[0].games).toBe(Math.max(...stats.map((s) => s.games)));
    expect(sortHeroes(stats, 'recent').every((s) => s.games90 > 0)).toBe(true);
    expect(sortHeroes(stats, 'rising').every((s) => s.games90 >= APP_CONFIG.player.minGames90)).toBe(true);
  });

  it('the pool: enough games all-time or recently; few games = soft thresholds', () => {
    const pool = poolOf(p, base);
    expect(pool.lowData).toBe(false);
    for (const s of pool.heroes.values()) expect(s.games >= APP_CONFIG.player.minGamesAll || s.games90 >= APP_CONFIG.player.minGames90).toBe(true);
    const fresh = { ...p, win: 6, lose: 4, heroes: [{ heroId: 14, games: 4, win: 3, lastPlayed: 1 }, { heroId: 1, games: 1, win: 1, lastPlayed: 1 }], heroes90: [] };
    const small = poolOf(fresh, base);
    expect(small.lowData).toBe(true);
    expect([...small.heroes.keys()]).toEqual([14]);
  });

  it('comfort is centred on the player\'s own average', () => {
    const s = heroStats(p, base)[0];
    const meta = s.meta!;
    const even = { ...s, winrate: meta + 5, edge: 5 };
    expect(comfort(even, 55)).toBeCloseTo(0, 5);
    expect(comfort(even, 50)).toBeGreaterThan(0);
  });

  it('pool width and days since the last game', () => {
    const w = poolWidth(p);
    expect(w.heroes).toBeGreaterThan(0);
    expect(w.top3Share).toBeGreaterThan(0);
    expect(['narrow', 'medium', 'wide']).toContain(w.label);
    expect(daysSince(Date.UTC(2026, 10, 20) / 1000, Date.UTC(2026, 10, 25))).toBe(5);
    expect(daysSince(null)).toBeNull();
  });
});

describe('pool scoring', () => {
  const p = profileOf(open);
  const pool = poolOf(p, base);
  // enemies the player does not have in the pool (else they would be filtered out of the draft)
  const enemyIds = heroes.map((h) => h.id).filter((id) => !pool.heroes.has(id)).slice(0, 5);
  const input = { heroes, enemyIds, matchupByEnemy: new Map(enemyIds.map((e) => [e, tables[String(e)]])), positions, heroById: new Map(heroes.map((h) => [h.id, h])), baseWinrates: base };

  it('only pool heroes, every eligible one (no top-15 cut), ordered by counter + comfort', () => {
    for (const lane of ['1', '2', '3', '4', '5'] as const) {
      const r = scorePool(input, lane, pool);
      expect(r.list.every((x) => pool.heroes.has(x.c.hero.id))).toBe(true);
      for (let i = 1; i < r.list.length; i++) expect(r.list[i - 1].score).toBeGreaterThanOrEqual(r.list[i].score);
      for (const x of r.list) expect(x.score).toBeCloseTo(x.c.finalScore + APP_CONFIG.player.wComfort * x.comfort, 6);
      // the same hero gets the same counter score as in the normal ranking
      const all = scoreCandidates(input, lane, { topN: heroes.length });
      for (const x of r.list) expect(x.c.finalScore).toBeCloseTo(all.find((c) => c.hero.id === x.c.hero.id)!.finalScore, 9);
      if (r.bestOverall && r.list[0]) expect(r.bestOverall.finalScore).toBeGreaterThanOrEqual(r.list[0].c.finalScore);
    }
    expect(enemyIds).toHaveLength(5);
    expect((['1', '2', '3', '4', '5'] as const).reduce((n, lane) => n + scorePool(input, lane, pool).list.length, 0)).toBeGreaterThan(10);
  });

  it('the personal part stays small next to the counter part', () => {
    const r = scorePool(input, '2', pool);
    for (const x of r.list) expect(Math.abs(x.comfortPoints)).toBeLessThan(3);
  });
});

describe('v2: labels, form, avoid', () => {
  const p = profileOf(open);

  it('labels follow the thresholds', () => {
    const c = APP_CONFIG.player;
    const s = { heroId: 1, games: 100, win: 60, winrate: 60, meta: 50, edge: 10, score: shrink(10, 100), games90: 0, winrate90: null, lastPlayed: 0 };
    expect(heroLabels(s)).toContain('comfort');
    expect(heroLabels({ ...s, meta: c.metaWinrate + 1, winrate: c.metaWinrate + 11 })).toContain('meta');
    expect(heroLabels({ ...s, games: 8, edge: 25, score: shrink(25, 8) })).toContain('gem');
    expect(heroLabels({ ...s, winrate: 44, edge: -6, score: shrink(-6, 100) })).toEqual(['under']);
    expect(heroLabels({ ...s, meta: null })).toEqual([]);
    // labels on real data: a hero is never both comfort and below the meta
    for (const x of heroStats(p, base)) {
      const l = heroLabels(x);
      expect(l.includes('comfort') && l.includes('under')).toBe(false);
    }
  });

  it('recent matches: win from the slot side, newest first; form and streak', () => {
    const games = normalizeRecent(recentFx as unknown as RawRecentMatch[]);
    expect(games).toHaveLength(20);
    for (let i = 1; i < games.length; i++) expect(games[i - 1].start).toBeGreaterThanOrEqual(games[i].start);
    const raw = recentFx[0] as RawRecentMatch;
    expect(normalizeRecent([{ ...raw, player_slot: 2, radiant_win: true }])[0].win).toBe(true);
    expect(normalizeRecent([{ ...raw, player_slot: 130, radiant_win: true }])[0].win).toBe(false);
    const f = form(games);
    expect(f.wins + f.losses).toBe(20);
    const g = (win: boolean) => ({ matchId: 0, heroId: 1, win, start: 0, kills: 0, deaths: 0, assists: 0 });
    expect(form([g(true), g(true), g(true), g(false)]).streak).toBe(3);
    expect(form([g(false), g(false), g(true)]).streak).toBe(-2);
    expect(form([]).streak).toBe(0);
  });

  it('"better avoid": negative pool scores outside the top 5, worst first', () => {
    const pool = poolOf(p, base);
    // enemies the player does not have in the pool (else they would be filtered out of the draft)
  const enemyIds = heroes.map((h) => h.id).filter((id) => !pool.heroes.has(id)).slice(0, 5);
    const input = { heroes, enemyIds, matchupByEnemy: new Map(enemyIds.map((e) => [e, tables[String(e)]])), positions, heroById: new Map(heroes.map((h) => [h.id, h])), baseWinrates: base };
    let seen = 0;
    for (const lane of ['1', '2', '3', '4', '5'] as const) {
      const r = scorePool(input, lane, pool);
      const top5 = new Set(r.list.slice(0, 5).map((x) => x.c.hero.id));
      expect(r.avoid.length).toBeLessThanOrEqual(APP_CONFIG.player.avoidCount);
      for (const x of r.avoid) { expect(x.score).toBeLessThan(0); expect(top5.has(x.c.hero.id)).toBe(false); }
      for (let i = 1; i < r.avoid.length; i++) expect(r.avoid[i - 1].score).toBeLessThanOrEqual(r.avoid[i].score);
      seen += r.avoid.length;
    }
    expect(seen).toBeGreaterThan(0);
  });
});
