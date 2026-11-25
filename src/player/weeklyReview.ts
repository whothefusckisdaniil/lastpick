import { APP_CONFIG } from '../config';
import type { HistoryGame } from './v3';

/**
 * Weekly review: the player's last 7 days against the 7 days before, by
 * match start time (not "the last N matches"). Pure functions, no React.
 */

export interface WeekStats {
  matches: number;
  wins: number;
  losses: number;
  /** %, null without matches. */
  winrate: number | null;
}

export interface TopHero {
  heroId: number;
  matches: number;
  wins: number;
  winrate: number;
}

export interface WeeklyReview {
  /** Unix seconds: the current week is (from, to], the previous (prevFrom, from]. */
  to: number;
  from: number;
  prevFrom: number;
  current: WeekStats;
  previous: WeekStats;
  /** Matches this week minus last week. */
  matchesChange: number;
  /** Win rate change in percentage points; null when either week has too few matches. */
  winrateChange: number | null;
  /** Enough matches this week to talk about it with some confidence. */
  confident: boolean;
  /** The most played hero this week (most played — not "best"); null without matches. */
  topHero: TopHero | null;
}

const DAY = 86400;

export function weekStats(games: HistoryGame[]): WeekStats {
  const wins = games.filter((g) => g.win).length;
  return { matches: games.length, wins, losses: games.length - wins, winrate: games.length ? (100 * wins) / games.length : null };
}

/** Most matches; ties: more wins, then the most recently played. */
export function mostPlayed(games: HistoryGame[]): TopHero | null {
  const by = new Map<number, { matches: number; wins: number; last: number }>();
  for (const g of games) {
    const h = by.get(g.heroId) ?? { matches: 0, wins: 0, last: 0 };
    h.matches++;
    if (g.win) h.wins++;
    h.last = Math.max(h.last, g.start);
    by.set(g.heroId, h);
  }
  const best = [...by.entries()].sort((a, b) => b[1].matches - a[1].matches || b[1].wins - a[1].wins || b[1].last - a[1].last)[0];
  return best ? { heroId: best[0], matches: best[1].matches, wins: best[1].wins, winrate: (100 * best[1].wins) / best[1].matches } : null;
}

export function weeklyReview(games: HistoryGame[], nowMs: number, cfg = APP_CONFIG.player.weekly): WeeklyReview {
  const to = Math.floor(nowMs / 1000);
  const from = to - cfg.days * DAY;
  const prevFrom = from - cfg.days * DAY;
  const cur = games.filter((g) => g.start > from && g.start <= to);
  const prev = games.filter((g) => g.start > prevFrom && g.start <= from);
  const current = weekStats(cur);
  const previous = weekStats(prev);
  const both = current.matches >= cfg.minMatches && previous.matches >= cfg.minMatches;
  return {
    to, from, prevFrom, current, previous,
    matchesChange: current.matches - previous.matches,
    winrateChange: both && current.winrate != null && previous.winrate != null ? current.winrate - previous.winrate : null,
    confident: current.matches >= cfg.minMatches,
    topHero: mostPlayed(cur),
  };
}
