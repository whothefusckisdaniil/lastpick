import { APP_CONFIG } from '../config';
import type { PlayerProfile } from './api';

/**
 * Per-hero numbers of one player against the hero's meta win rate on a rank
 * (the snapshot's hero baselines). Formulas, not opinions: every label below
 * is a threshold on these numbers.
 */
export interface HeroStat {
  heroId: number;
  games: number;
  win: number;
  /** Personal win rate, %. */
  winrate: number;
  /** The hero's win rate on the rank, %; null when the snapshot lacks it. */
  meta: number | null;
  /** winrate − meta (pp), 0 without meta. */
  edge: number;
  /** edge × games / (games + K): what the "strongest" order uses. */
  score: number;
  games90: number;
  winrate90: number | null;
  lastPlayed: number;
}

export type HeroSort = 'games' | 'strong' | 'recent' | 'rising';

export const shrink = (value: number, games: number, k: number = APP_CONFIG.player.shrinkK) => (value * games) / (games + k);

export function overallWinrate(p: Pick<PlayerProfile, 'win' | 'lose'>): number | null {
  const n = p.win + p.lose;
  return n > 0 ? (100 * p.win) / n : null;
}

export function heroStats(profile: PlayerProfile, meta: Map<number, number> | null | undefined): HeroStat[] {
  const by90 = new Map(profile.heroes90.map((h) => [h.heroId, h]));
  return profile.heroes.map((h) => {
    const winrate = (100 * h.win) / h.games;
    const m = meta?.get(h.heroId) ?? null;
    const edge = m == null ? 0 : winrate - m;
    const r = by90.get(h.heroId);
    return {
      heroId: h.heroId, games: h.games, win: h.win, winrate, meta: m, edge, score: shrink(edge, h.games),
      games90: r?.games ?? 0, winrate90: r ? (100 * r.win) / r.games : null, lastPlayed: h.lastPlayed,
    };
  });
}

/** Rising: last-90-days win rate above the all-time one (shrunk by the 90-day games). */
export const risingScore = (s: HeroStat) => (s.winrate90 == null ? -Infinity : shrink(s.winrate90 - s.winrate, s.games90));

export function sortHeroes(list: HeroStat[], by: HeroSort): HeroStat[] {
  const out = [...list];
  if (by === 'games') return out.sort((a, b) => b.games - a.games);
  if (by === 'strong') return out.filter((s) => s.games >= APP_CONFIG.player.strongMinGames).sort((a, b) => b.score - a.score || b.games - a.games);
  if (by === 'recent') return out.filter((s) => s.games90 > 0).sort((a, b) => b.games90 - a.games90 || (b.winrate90 ?? 0) - (a.winrate90 ?? 0));
  return out.filter((s) => s.games90 >= APP_CONFIG.player.minGames90).sort((a, b) => risingScore(b) - risingScore(a));
}

export interface Pool {
  /** Hero id → its stats, for the heroes that count as "played". */
  heroes: Map<number, HeroStat>;
  /** Few games in total: soft thresholds, results marked "little data". */
  lowData: boolean;
  /** Overall win rate, % (null without games). */
  overall: number | null;
  /** The player's favourite heroes: always in the pool, games or not. */
  favorites: Set<number>;
}

/** A favourite hero the stats do not have yet: no games, no personal edge. */
const noGames = (heroId: number, meta: Map<number, number> | null | undefined): HeroStat => ({
  heroId, games: 0, win: 0, winrate: 0, meta: meta?.get(heroId) ?? null, edge: 0, score: 0, games90: 0, winrate90: null, lastPlayed: 0,
});

/** Heroes the player really plays (enough games all-time or recently), plus the favourites they pick by hand. */
export function poolOf(profile: PlayerProfile, meta: Map<number, number> | null | undefined, favorites: number[] = []): Pool {
  const cfg = APP_CONFIG.player;
  const total = profile.win + profile.lose || profile.heroes.reduce((s, h) => s + h.games, 0);
  const lowData = total < cfg.lowDataGames;
  const stats = heroStats(profile, meta);
  const keep = stats.filter((s) => (lowData ? s.games >= cfg.lowDataMin : s.games >= cfg.minGamesAll || s.games90 >= cfg.minGames90));
  const heroes = new Map(keep.map((s) => [s.heroId, s]));
  const byId = new Map(stats.map((s) => [s.heroId, s]));
  for (const id of favorites) if (!heroes.has(id)) heroes.set(id, byId.get(id) ?? noGames(id, meta));
  return { heroes, lowData, overall: overallWinrate(profile), favorites: new Set(favorites) };
}

/**
 * Personal comfort on a hero (pp): the shrunk edge over the hero's meta,
 * centred on the player's own average edge — a 55% player is not "+5 on
 * every hero"; what matters is which heroes go better than the rest.
 */
export function comfort(s: HeroStat, overall: number | null): number {
  // no meta, or no games on it (a favourite not played yet): nothing personal to add
  if (s.meta == null || s.games === 0) return 0;
  const centre = overall == null ? 0 : overall - 50;
  return shrink(s.edge - centre, s.games);
}

export type PoolWidth = 'narrow' | 'medium' | 'wide';

/** Heroes with ≥ widthGames games, the top-3 share of all games, and a label. */
export function poolWidth(profile: PlayerProfile): { heroes: number; top3Share: number; label: PoolWidth } {
  const cfg = APP_CONFIG.player;
  const n = profile.heroes.filter((h) => h.games >= cfg.widthGames).length;
  const total = profile.heroes.reduce((s, h) => s + h.games, 0);
  const top3 = profile.heroes.slice(0, 3).reduce((s, h) => s + h.games, 0);
  return { heroes: n, top3Share: total ? top3 / total : 0, label: n < cfg.narrowPool ? 'narrow' : n >= cfg.widePool ? 'wide' : 'medium' };
}

/** Whole days since the last game OpenDota knows, null without any. */
export function daysSince(unixSec: number | null, now = Date.now()): number | null {
  return unixSec ? Math.max(0, Math.floor((now - unixSec * 1000) / 86_400_000)) : null;
}

export type HeroLabel = 'comfort' | 'gem' | 'under' | 'meta';

/** Labels of one hero (see APP_CONFIG.player for the thresholds). */
export function heroLabels(s: HeroStat): HeroLabel[] {
  const c = APP_CONFIG.player;
  if (s.meta == null) return [];
  const out: HeroLabel[] = [];
  if (s.games >= c.comfortGames && s.score >= c.comfortEdge) out.push('comfort');
  if (s.games >= c.gemMinGames && s.games <= c.gemMaxGames && s.edge >= c.gemEdge) out.push('gem');
  if (s.games >= c.underGames && s.score <= c.underEdge) out.push('under');
  if (s.score >= c.metaEdge && s.meta >= c.metaWinrate) out.push('meta');
  return out;
}

export interface RecentGame { matchId: number; heroId: number; win: boolean; start: number; kills: number; deaths: number; assists: number; /** OpenDota game mode (23 = Turbo); absent in old cache. */ gameMode?: number }

/** Last games, newest first: wins, losses and the current streak (positive = wins). */
export function form(games: RecentGame[]): { wins: number; losses: number; streak: number } {
  const wins = games.filter((g) => g.win).length;
  let streak = 0;
  for (const g of games) {
    if (streak === 0) streak = g.win ? 1 : -1;
    else if (g.win === streak > 0) streak += streak > 0 ? 1 : -1;
    else break;
  }
  return { wins, losses: games.length - wins, streak };
}
