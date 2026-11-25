import { APP_CONFIG } from '../config';
import { tagsFor } from '../data/heroTags';
import type { Hero, PositionDataset } from '../types';
import { sortHeroes, type HeroStat, type Pool } from './poolStats';

/* ───────────── Heroes worth learning ───────────── */

const posVec = (positions: PositionDataset, id: number): number[] =>
  [1, 2, 3, 4, 5].map((p) => positions[id]?.positions?.[p as 1]?.share ?? 0);

function cosine(a: number[], b: number[]): number {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

function jaccard<T>(a: Iterable<T>, b: Iterable<T>): number {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return both / (A.size + B.size - both);
}

/**
 * How alike two heroes play, 0..1 — a formula over the data we have, not an
 * opinion: the positions they are picked on (positions.json), the Dota role
 * tags, the hand-written threat tags (damage type, disables, flags) and
 * attribute / attack type.
 */
export function heroSimilarity(a: Hero, b: Hero, positions: PositionDataset): number {
  const w = APP_CONFIG.player.learn.weights;
  const pos = cosine(posVec(positions, a.id), posVec(positions, b.id));
  const roles = jaccard(a.roles, b.roles);
  const ta = tagsFor(a.key), tb = tagsFor(b.key);
  const tags = ta && tb
    ? ((ta.damage === tb.damage ? 1 : ta.damage === 'mixed' || tb.damage === 'mixed' ? 0.5 : 0) + (1 - Math.abs(ta.disables - tb.disables) / 3) + jaccard(ta.flags, tb.flags)) / 3
    : 0.5;
  const kind = ((a.primaryAttr === b.primaryAttr ? 1 : 0) + (a.attackType === b.attackType ? 1 : 0)) / 2;
  return w.pos * pos + w.roles * roles + w.tags * tags + w.kind * kind;
}

export interface LearnPick {
  heroId: number;
  /** The hero's win rate on the rank, %. */
  meta: number;
  /** Best similarity to one of the player's strong heroes, 0..1. */
  sim: number;
  /** The player's strong heroes it resembles most (up to 2). */
  like: number[];
  /** The player's games on it (few or none). */
  games: number;
  score: number;
}

/**
 * Heroes the player barely plays that look like the heroes they are strong
 * on and do well on their rank now. score = similarity + metaWeight × (meta − 50);
 * with roles given, only heroes picked on one of them.
 */
export function heroesToLearn(input: {
  stats: HeroStat[];
  heroes: Hero[];
  positions: PositionDataset;
  meta: Map<number, number>;
  roles?: string[];
  limit?: number;
}): LearnPick[] {
  const c = APP_CONFIG.player.learn;
  const byId = new Map(input.heroes.map((h) => [h.id, h]));
  const strongList = sortHeroes(input.stats, 'strong').filter((s) => s.score > 0);
  const base = (strongList.length ? strongList : sortHeroes(input.stats, 'games')).slice(0, c.strongCount);
  const strong = base.map((s) => byId.get(s.heroId)).filter((h): h is Hero => !!h);
  if (!strong.length) return [];
  const played = new Map(input.stats.map((s) => [s.heroId, s.games]));
  const roles = input.roles?.length ? input.roles : null;
  const out: LearnPick[] = [];
  for (const h of input.heroes) {
    const games = played.get(h.id) ?? 0;
    const meta = input.meta.get(h.id);
    if (games >= c.maxGames || meta == null || meta < c.metaMin) continue;
    if (roles && !roles.some((r) => (input.positions[h.id]?.positions?.[Number(r) as 1]?.share ?? 0) >= c.roleShare)) continue;
    const sims = strong.map((s) => ({ id: s.id, sim: heroSimilarity(h, s, input.positions) })).sort((a, b) => b.sim - a.sim);
    const sim = sims[0].sim;
    if (sim < c.minSim) continue;
    out.push({ heroId: h.id, meta, sim, like: sims.slice(0, 2).filter((x) => x.sim >= c.minSim).map((x) => x.id), games, score: sim * (1 + c.metaWeight * Math.min(meta - 50, c.metaCap)) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, input.limit ?? c.count);
}

/* ───────────── Dynamics by patch ───────────── */

export interface Patch { name: string; /** Unix seconds. */ start: number }
export interface HistoryGame { heroId: number; win: boolean; start: number }

export interface PatchRow {
  patch: string;
  games: number;
  wins: number;
  /** %, null without games. */
  winrate: number | null;
  /** Distinct heroes played. */
  heroCount: number;
  /** Most played, up to 3. */
  top: { heroId: number; games: number; win: number }[];
}

/** Games grouped by the patch they were played on, newest patch first (empty patches kept). */
export function byPatch(games: HistoryGame[], patches: Patch[], last: number = APP_CONFIG.player.patchCount): PatchRow[] {
  const sorted = [...patches].sort((a, b) => a.start - b.start);
  const shown = sorted.slice(-last);
  const rows = shown.map((p) => ({ patch: p.name, start: p.start, heroes: new Map<number, { games: number; win: number }>(), games: 0, wins: 0 }));
  for (const g of games) {
    let i = -1;
    for (let k = rows.length - 1; k >= 0; k--) if (g.start >= rows[k].start) { i = k; break; }
    if (i < 0) continue;
    const r = rows[i];
    r.games++;
    if (g.win) r.wins++;
    const h = r.heroes.get(g.heroId) ?? { games: 0, win: 0 };
    h.games++;
    if (g.win) h.win++;
    r.heroes.set(g.heroId, h);
  }
  return rows.reverse().map((r) => ({
    patch: r.patch,
    games: r.games,
    wins: r.wins,
    winrate: r.games ? (100 * r.wins) / r.games : null,
    heroCount: r.heroes.size,
    top: [...r.heroes.entries()].map(([heroId, v]) => ({ heroId, ...v })).sort((a, b) => b.games - a.games || b.win - a.win).slice(0, 3),
  }));
}

/* ───────────── Two friends' pools ───────────── */

export interface PoolCompare {
  /** Heroes in both pools, the most played (together) first. */
  common: { heroId: number; a: HeroStat; b: HeroStat }[];
  /** In one pool only, strongest first. */
  onlyA: HeroStat[];
  onlyB: HeroStat[];
}

const strongFirst = (list: HeroStat[]) => [...list].sort((x, y) => y.score - x.score || y.games - x.games);

export function comparePools(a: Pool, b: Pool, limit: number = APP_CONFIG.player.compareCount): PoolCompare {
  const common: PoolCompare['common'] = [];
  for (const [id, sa] of a.heroes) {
    const sb = b.heroes.get(id);
    if (sb) common.push({ heroId: id, a: sa, b: sb });
  }
  common.sort((x, y) => y.a.games + y.b.games - (x.a.games + x.b.games));
  return {
    common: common.slice(0, limit),
    onlyA: strongFirst([...a.heroes.values()].filter((s) => !b.heroes.has(s.heroId))).slice(0, limit),
    onlyB: strongFirst([...b.heroes.values()].filter((s) => !a.heroes.has(s.heroId))).slice(0, limit),
  };
}

/** Pool overlap, 0..1: shared heroes over the smaller pool. */
export function poolOverlap(a: Pool, b: Pool): number {
  const n = Math.min(a.heroes.size, b.heroes.size);
  if (!n) return 0;
  let both = 0;
  for (const id of a.heroes.keys()) if (b.heroes.has(id)) both++;
  return both / n;
}
