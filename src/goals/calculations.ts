import { APP_CONFIG } from '../config';
import type { HeroGame } from '../player/api';
import { median, REVIEW_METRICS, type PersonalReview } from '../match/review';
import type { GoalOutcome, GoalState, ImprovementGoal } from './model';

/**
 * Improvement goal maths, no React. The metric formulas are the match
 * review's own (REVIEW_METRICS), so a goal measures exactly what the review
 * measured.
 */

export type GoalProgress =
  | {
    kind: 'waiting';
    /** Counted matches after the start so far. */
    count: number;
    needed: number;
  }
  | {
    kind: 'progress';
    count: number;
    /** Median of the last `window` counted matches. */
    current: number;
    /** current − baseline. */
    change: number;
    trend: 'better' | 'worse' | 'same';
  };

/** A goal from a personal review's "to improve" (null when there is nothing to track). */
export function goalFromReview(review: PersonalReview, input: { accountId: number; gameMode: number; matchId: number; now: number; id?: string }): ImprovementGoal | null {
  const r = review.improve;
  if (!r) return null;
  const def = REVIEW_METRICS.find((d) => d.id === r.id);
  if (!def) return null;
  return {
    id: input.id ?? `${input.now.toString(36)}-${r.id}`,
    accountId: input.accountId,
    heroId: review.heroId,
    gameMode: input.gameMode,
    metric: r.id,
    lowerIsBetter: !!def.lowerIsBetter,
    baseline: { value: r.usual, sample: r.sample },
    sourceMatchId: input.matchId,
    createdAt: input.now,
    status: 'active',
  };
}

/** The matches that count for a goal: same mode, begun after the start, full length, no leavers, value known. */
export function goalGames(goal: ImprovementGoal, games: HeroGame[], cfg = APP_CONFIG.review, untilMs?: number): { game: HeroGame; value: number }[] {
  const def = REVIEW_METRICS.find((d) => d.id === goal.metric);
  if (!def) return [];
  const from = goal.createdAt / 1000;
  const until = untilMs == null ? Infinity : untilMs / 1000;
  return games
    .filter((g) => g.gameMode === goal.gameMode && g.start > from && g.start <= until && !g.leaver && g.duration >= cfg.minDurationSec)
    .map((g) => ({ game: g, value: def.of(g) }))
    .filter((x): x is { game: HeroGame; value: number } => x.value != null)
    .sort((a, b) => b.game.start - a.game.start);
}

export function goalProgress(goal: ImprovementGoal, games: HeroGame[], cfg = APP_CONFIG.goals, untilMs?: number): GoalProgress {
  const counted = goalGames(goal, games, APP_CONFIG.review, untilMs);
  if (counted.length < cfg.minGames) return { kind: 'waiting', count: counted.length, needed: cfg.minGames };
  const current = median(counted.slice(0, cfg.window).map((x) => x.value));
  const change = current - goal.baseline.value;
  const rel = goal.baseline.value === 0 ? (change === 0 ? 0 : Infinity) : Math.abs(change) / Math.abs(goal.baseline.value);
  const improved = goal.lowerIsBetter ? change < 0 : change > 0;
  return { kind: 'progress', count: counted.length, current, change, trend: rel < cfg.sameShare ? 'same' : improved ? 'better' : 'worse' };
}

/**
 * Freeze a goal's result at the moment it ends: only matches that began
 * between its start and `endedAt` count, so later games never change it.
 * `games` null = could not be loaded → "unknown", never a guessed result.
 */
export function freezeOutcome(goal: ImprovementGoal, games: HeroGame[] | null, endedAt: number): GoalOutcome {
  if (!games) return { kind: 'unknown' };
  const p = goalProgress(goal, games, APP_CONFIG.goals, endedAt);
  return p.kind === 'waiting'
    ? { kind: 'insufficient', count: p.count, needed: p.needed }
    : { kind: 'measured', value: p.current, count: p.count, trend: p.trend };
}

/* ───── state transitions (pure; storage.ts persists them) ───── */

export const HISTORY_KEEP = 20;

/** Start a goal; an active one goes to history as "replaced", with its result frozen now. */
export function startGoal(state: GoalState, goal: ImprovementGoal, now: number, replacedOutcome: GoalOutcome = { kind: 'unknown' }, keep = HISTORY_KEEP): GoalState {
  const past = state.active ? [{ ...state.active, status: 'replaced' as const, endedAt: now, outcome: replacedOutcome }, ...state.past] : state.past;
  return { active: { ...goal, status: 'active' }, past: past.slice(0, keep) };
}

/** The player finishes the active goal (never automatic); its result is frozen now. */
export function completeGoal(state: GoalState, now: number, outcome: GoalOutcome = { kind: 'unknown' }, keep = HISTORY_KEEP): GoalState {
  if (!state.active) return state;
  return { active: null, past: [{ ...state.active, status: 'completed' as const, endedAt: now, outcome }, ...state.past].slice(0, keep) };
}

/** Finished goals of one player, newest first. */
export const historyOf = (state: GoalState, accountId: number) => state.past.filter((g) => g.accountId === accountId && g.status !== 'active');
