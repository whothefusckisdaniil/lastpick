import { describe, expect, it } from 'vitest';
import matchupsRaw from '../../public/data/matchups.json';
import heroesRaw from '../../public/data/heroes.json';
import positionsRaw from '../../public/data/positions.json';
import openFx from './fixtures/open.json';
import type { Hero, MatchupRow, PositionDataset } from '../types';
import { computeBaseWinrates } from '../scoring/baseline';
import { APP_CONFIG } from '../config';
import { normalizeHistory, normalizePeers, normalizeProfile, type RawHeroRow, type RawPlayer } from './api';
import { heroStats, poolOf, type HeroStat } from './poolStats';
import { byPatch, comparePools, heroesToLearn, heroSimilarity, poolOverlap } from './v3';

const heroes = heroesRaw as unknown as Hero[];
const byKey = (k: string) => heroes.find((h) => h.key === `npc_dota_hero_${k}`)!;
const positions: PositionDataset = Object.fromEntries(Object.entries(positionsRaw as unknown as Record<string, PositionDataset[number]>).map(([id, v]) => [Number(id), v]));
const base = computeBaseWinrates(new Map(Object.entries(matchupsRaw as unknown as Record<string, MatchupRow[]>).map(([id, rows]) => [Number(id), rows])));
type Fx = { player: RawPlayer; wl: { win: number; lose: number }; heroes: RawHeroRow[]; heroes90: RawHeroRow[] };
const open = openFx as unknown as Fx;
const profile = normalizeProfile(1001, open.player, open.wl, open.heroes, open.heroes90, Date.UTC(2026, 10, 25))!;

describe('hero similarity', () => {
  it('supports look alike, a support and a carry do not', () => {
    const sim = (a: string, b: string) => heroSimilarity(byKey(a), byKey(b), positions);
    expect(sim('lion', 'shadow_shaman')).toBeGreaterThan(sim('lion', 'antimage'));
    expect(sim('antimage', 'phantom_lancer')).toBeGreaterThan(sim('antimage', 'crystal_maiden'));
    expect(sim('lion', 'lion')).toBeCloseTo(1, 5);
    for (const [a, b] of [['lion', 'antimage'], ['axe', 'crystal_maiden']]) {
      const v = sim(a, b);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('heroes worth learning', () => {
  const stats = heroStats(profile, base);
  const cfg = APP_CONFIG.player.learn;

  it('suggests barely played heroes, strong on the rank, like the strong ones', () => {
    const picks = heroesToLearn({ stats, heroes, positions, meta: base });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(cfg.count);
    const played = new Map(stats.map((s) => [s.heroId, s.games]));
    for (const p of picks) {
      expect(played.get(p.heroId) ?? 0).toBeLessThan(cfg.maxGames);
      expect(p.meta).toBeGreaterThanOrEqual(cfg.metaMin);
      expect(p.sim).toBeGreaterThanOrEqual(cfg.minSim);
      expect(p.like.length).toBeGreaterThan(0);
      expect(p.like).not.toContain(p.heroId);
    }
    for (let i = 1; i < picks.length; i++) expect(picks[i - 1].score).toBeGreaterThanOrEqual(picks[i].score);
  });

  it('keeps to the chosen roles', () => {
    const picks = heroesToLearn({ stats, heroes, positions, meta: base, roles: ['5'], limit: 20 });
    for (const p of picks) expect(positions[p.heroId].positions[5].share).toBeGreaterThanOrEqual(cfg.roleShare);
  });

  it('is empty without games', () => {
    expect(heroesToLearn({ stats: [], heroes, positions, meta: base })).toEqual([]);
  });
});

describe('dynamics by patch', () => {
  const patches = [{ name: '7.40', start: 1000 }, { name: '7.41', start: 2000 }, { name: '7.42', start: 3000 }];
  const games = normalizeHistory([
    { match_id: 1, player_slot: 0, radiant_win: true, hero_id: 1, start_time: 500 }, // before the window
    { match_id: 2, player_slot: 0, radiant_win: true, hero_id: 1, start_time: 2100 },
    { match_id: 3, player_slot: 130, radiant_win: true, hero_id: 2, start_time: 2200 },
    { match_id: 4, player_slot: 131, radiant_win: false, hero_id: 2, start_time: 3100 },
    { match_id: 5, player_slot: 1, radiant_win: true, hero_id: 2, start_time: 3200 },
    { match_id: 6, player_slot: 2, radiant_win: false, hero_id: 3, start_time: 3300 },
  ]);

  it('groups games by patch, newest first', () => {
    const rows = byPatch(games, patches, 2);
    expect(rows.map((r) => r.patch)).toEqual(['7.42', '7.41']);
    expect(rows[0]).toMatchObject({ games: 3, wins: 2, heroCount: 2 });
    expect(rows[0].top[0]).toEqual({ heroId: 2, games: 2, win: 2 });
    expect(rows[1]).toMatchObject({ games: 2, wins: 1, winrate: 50 });
  });

  it('keeps empty patches with a null win rate', () => {
    const rows = byPatch(games, patches, 3);
    expect(rows[2]).toMatchObject({ patch: '7.40', games: 0, winrate: null, top: [] });
  });
});

describe('two pools', () => {
  const stat = (heroId: number, games: number, score = 0): HeroStat => ({ heroId, games, win: games / 2, winrate: 50, meta: 50, edge: 0, score, games90: 0, winrate90: null, lastPlayed: 0 });
  const pool = (list: HeroStat[]) => ({ heroes: new Map(list.map((s) => [s.heroId, s])), lowData: false, overall: 50 });

  it('splits common and own heroes', () => {
    const a = pool([stat(1, 100), stat(2, 20, 3), stat(3, 10, 1)]);
    const b = pool([stat(1, 50), stat(3, 80), stat(4, 30)]);
    const c = comparePools(a, b);
    expect(c.common.map((x) => x.heroId)).toEqual([1, 3]);
    expect(c.onlyA.map((x) => x.heroId)).toEqual([2]);
    expect(c.onlyB.map((x) => x.heroId)).toEqual([4]);
    expect(poolOverlap(a, b)).toBeCloseTo(2 / 3);
  });

  it('a pool against itself overlaps fully', () => {
    const p = poolOf(profile, base);
    expect(poolOverlap(p, p)).toBe(1);
    expect(comparePools(p, p).onlyA).toEqual([]);
  });

  it('peers: most games in one team first, strangers dropped', () => {
    const l = normalizePeers([
      { account_id: 1, personaname: 'A', avatarfull: null, with_games: 3, with_win: 2, against_games: 1, against_win: 0 },
      { account_id: 2, personaname: null, avatarfull: null, with_games: 9, with_win: 5, against_games: 0, against_win: 0 },
      { account_id: 3, personaname: 'C', avatarfull: null, with_games: 0, with_win: 0, against_games: 0, against_win: 0 },
    ]);
    expect(l.map((p) => p.id)).toEqual([2, 1]);
    expect(l[0].name).toBe('#2');
  });
});
