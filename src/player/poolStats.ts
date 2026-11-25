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
}

/** Heroes the player really plays: enough games all-time or recently. */
export function poolOf(profile: PlayerProfile, meta: Map<number, number> | null | undefined): Pool {
  const cfg = APP_CONFIG.player;
  const total = profile.win + profile.lose || profile.heroes.reduce((s, h) => s + h.games, 0);
  const lowData = total < cfg.lowDataGames;
  const stats = heroStats(profile, meta);
  const keep = stats.filter((s) => (lowData ? s.games >= cfg.lowDataMin : s.games >= cfg.minGamesAll || s.games90 >= cfg.minGames90));
  return { heroes: new Map(keep.map((s) => [s.heroId, s])), lowData, overall: overallWinrate(profile) };
}

/**
 * Personal comfort on a hero (pp): the shrunk edge over the hero's meta,
 * centred on the player's own average edge — a 55% player is not "+5 on
 * every hero"; what matters is which heroes go better than the rest.
 */
export function comfort(s: HeroStat, overall: number | null): number {
  if (s.meta == null) return 0;
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
