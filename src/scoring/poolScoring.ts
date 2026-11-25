import { APP_CONFIG } from '../config';
import type { CandidateScore } from '../types';
import type { Lane } from './positionsExtra';
import { scoreCandidates, type ScoreInput } from './engine';
import { comfort, type HeroStat, type Pool } from '../player/poolStats';

/**
 * "My pool": the usual draft scoring, run only over the heroes the player
 * really plays, plus a small personal adjustment. The engine and its hard
 * rules (position eligibility, full matchup coverage) are untouched.
 *
 *   pool score = counter score + wComfort × comfort
 *
 * Both parts are kept apart so the card can show them separately
 * ("Counter +4.1 · Your comfort +1.2").
 */
export interface PoolCandidate {
  c: CandidateScore;
  stat: HeroStat;
  /** Personal comfort, pp (see poolStats.comfort). */
  comfort: number;
  /** wComfort × comfort: what it adds to the score. */
  comfortPoints: number;
  /** c.finalScore + comfortPoints: the pool order. */
  score: number;
}

export interface PoolResult {
  /** Pool heroes for this lane, best first. */
  list: PoolCandidate[];
  /** The best hero overall (any hero), for the comparison line. */
  bestOverall: CandidateScore | null;
}

export function scorePool(input: ScoreInput, lane: Lane, pool: Pool, overall?: CandidateScore[] | null): PoolResult {
  const heroes = input.heroes.filter((h) => pool.heroes.has(h.id));
  const scored = scoreCandidates({ ...input, heroes }, lane, { topN: heroes.length });
  const w = APP_CONFIG.player.wComfort;
  const list = scored.map((c): PoolCandidate => {
    const stat = pool.heroes.get(c.hero.id)!;
    const cf = comfort(stat, pool.overall);
    return { c, stat, comfort: cf, comfortPoints: w * cf, score: c.finalScore + w * cf };
  }).sort((a, b) => b.score - a.score);
  const best = overall === undefined ? scoreCandidates(input, lane)[0] ?? null : overall?.[0] ?? null;
  return { list, bestOverall: best };
}
