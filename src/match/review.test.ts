import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseline, beatsShare, median, reviewMatch } from './review';
import { clearHeroGamesMemory, loadHeroGames, type HeroGame } from '../player/api';
import type { MatchPlayer } from './model';

const START = 1_800_000_000;
const MATCH = { id: 999, start: START, duration: 40 * 60, radiantWin: true };

/** A previous game, 40 min, with "usual" numbers unless overridden. */
const prev = (i: number, o: Partial<HeroGame> = {}): HeroGame => ({
  matchId: i, start: START - (i + 1) * 3600, duration: 40 * 60,
  kills: 6, deaths: 6, assists: 10, gpm: 500 + (i % 5) * 10, xpm: 600 + (i % 5) * 10, lastHits: 240,
  heroDamage: 20000, towerDamage: 2000, heroHealing: 0, laneRole: null, leaver: false, ...o,
});
const history = (n: number, o: Partial<HeroGame> = {}) => Array.from({ length: n }, (_, i) => prev(i, o));

const player = (o: Partial<MatchPlayer> = {}): MatchPlayer => ({
  slot: 0, radiant: true, heroId: 8, accountId: 1001, name: 'Player1', rankTier: 70,
  kills: 6, deaths: 6, assists: 10, lastHits: 240, denies: 5, gpm: 520, xpm: 620, netWorth: 20000,
  heroDamage: 20000, towerDamage: 2000, heroHealing: 0, level: 25, items: [], backpack: [], neutral: null,
  scepter: false, shard: false, leaver: false, laneRole: null, roaming: false, purchases: null,
  goldT: null, lhT: null, xpT: null, dnT: null, laneEff: null, deadSeconds: null, deathTimes: null,
  buybackTimes: [], obsPlaced: null, campsStacked: null, stuns: null, teamfightShare: null,
  bench: { gpm: null, xpm: null, lhpm: null, damage: null }, ...o,
});

const review = (p: Partial<MatchPlayer>, h: HeroGame[] | null, position: number | null = 1) =>
  reviewMatch({ player: player(p), match: MATCH, position, history: h });

describe('helpers', () => {
  it('median and share beaten', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(beatsShare(5, [1, 2, 5, 9])).toBe(0.625);
    expect(beatsShare(2, [1, 3, 4, 5], true)).toBe(0.75);
  });
});

describe('baseline', () => {
  it('only games before this match, full length, no leavers, not this match', () => {
    const h = [...history(12), prev(50, { start: START + 100 }), prev(51, { duration: 600 }), prev(52, { leaver: true }), prev(999)];
    const b = baseline(h, { id: 999, start: START, laneRole: null });
    expect(b.games).toHaveLength(12);
    expect(b.basis).toBe('hero');
  });

  it('the same lane when it has enough games, else the whole hero', () => {
    const h = [...history(12, { laneRole: 1 }).map((g, i) => ({ ...g, matchId: 100 + i })), ...history(20, { laneRole: 3 })];
    expect(baseline(h, { id: 999, start: START, laneRole: 1 })).toMatchObject({ basis: 'lane' });
    expect(baseline(h, { id: 999, start: START, laneRole: 1 }).games).toHaveLength(12);
    expect(baseline(h.slice(0, 5).concat(history(20, { laneRole: 3 })), { id: 999, start: START, laneRole: 1 })).toMatchObject({ basis: 'hero' });
  });
});

describe('review', () => {
  it('names one strength, one problem and the focus that follows', () => {
    const r = review({ gpm: 700, deaths: 14 }, history(20));
    expect(r.kind).toBe('personal');
    if (r.kind !== 'personal') return;
    expect(r.good?.id).toBe('gpm');
    expect(r.good?.beats).toBe(1);
    expect(r.improve?.id).toBe('deaths');
    expect(r.improve?.value).toBeCloseTo(3.5); // 14 deaths in 40 min = 3.5 per 10 min
    expect(r.improve?.usual).toBeCloseTo(1.5);
    expect(r.focus).toBe('deaths');
    expect(r.sample).toBe(20);
  });

  it('fewer deaths is the good side', () => {
    const r = review({ deaths: 1 }, history(20));
    expect(r.kind === 'personal' && r.good?.id).toBe('deaths');
  });

  it('a usual game: no claims, a steady focus', () => {
    const r = review({ gpm: 520, xpm: 620 }, history(20));
    expect(r).toMatchObject({ kind: 'personal', good: null, improve: null, focus: 'steady' });
  });

  it('only a strength: keep the approach', () => {
    const r = review({ heroDamage: 40000 }, history(20));
    expect(r).toMatchObject({ kind: 'personal', improve: null, focus: 'keep' });
    if (r.kind === 'personal') expect(r.good?.id).toBe('damage');
  });

  it('supports are not judged on last hits; tower damage / healing only where they matter', () => {
    const sup = review({ lastHits: 5, heroHealing: 9000 }, history(20, { lastHits: 40, towerDamage: 100 }), 5);
    if (sup.kind !== 'personal') throw new Error('expected personal');
    const ids = sup.readings.map((x) => x.id);
    expect(ids).not.toContain('lastHits');
    expect(ids).not.toContain('towers'); // usual 2.5/min < floor
    expect(ids).not.toContain('healing'); // usual 0 < floor
    const core = review({ lastHits: 100 }, history(20), 1);
    expect(core.kind === 'personal' && core.readings.map((x) => x.id)).toContain('lastHits');
  });

  it('not enough to compare: plain stats, no personal statements', () => {
    expect(review({}, history(9))).toMatchObject({ kind: 'basic', reason: 'fewGames', sample: 9 });
    expect(review({ accountId: null }, history(20))).toMatchObject({ kind: 'basic', reason: 'private' });
    expect(review({ leaver: true }, history(20))).toMatchObject({ kind: 'basic', reason: 'leaver' });
    expect(review({}, null)).toMatchObject({ kind: 'basic', reason: 'unavailable' });
    const short = reviewMatch({ player: player(), match: { ...MATCH, duration: 600 }, position: 1, history: history(20) });
    expect(short).toMatchObject({ kind: 'basic', reason: 'shortMatch', stats: { kills: 6, deaths: 6, assists: 10 } });
  });

  it('result and length come from the match', () => {
    expect(review({ radiant: false }, history(20))).toMatchObject({ win: false, minutes: 40, heroId: 8, position: 1 });
  });
});

describe('hero games loader', () => {
  const store = new Map<string, string>();
  let calls: string[];
  const row = { match_id: 1, start_time: START - 3600, duration: 2400, kills: 5, deaths: 4, assists: 9, gold_per_min: 510, xp_per_min: 600, last_hits: 230, hero_damage: 18000, tower_damage: null, hero_healing: 0, lane_role: 1, leaver_status: 0 };
  beforeEach(() => {
    store.clear();
    clearHeroGamesMemory();
    calls = [];
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    });
    vi.stubGlobal('fetch', async (url: string) => { calls.push(url); return new Response(JSON.stringify([row]), { status: 200 }); });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('one request even for concurrent calls; then memory, then storage', async () => {
    const [a, b] = await Promise.all([loadHeroGames(1001, 8), loadHeroGames(1001, 8)]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/players/1001/matches?hero_id=8&limit=100&project=start_time');
    expect(a).toBe(b);
    expect(a[0]).toMatchObject({ matchId: 1, gpm: 510, towerDamage: 0, laneRole: 1, leaver: false });
    await loadHeroGames(1001, 8);
    clearHeroGamesMemory();
    const c = await loadHeroGames(1001, 8);
    expect(calls).toHaveLength(1);
    expect(c).toEqual(a);
  });

  it('an outage returns the stored copy', async () => {
    await loadHeroGames(1001, 8, { now: 0 });
    clearHeroGamesMemory();
    vi.stubGlobal('fetch', async () => new Response('', { status: 522 }));
    expect(await loadHeroGames(1001, 8, { now: 7 * 3600_000 })).toHaveLength(1);
  });
});
