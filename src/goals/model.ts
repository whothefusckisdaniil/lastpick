import type { ReviewMetricId } from '../match/review';

/**
 * An improvement goal: one metric, on one hero, in one game mode, for one
 * player — started from a personal match review's "to improve". The baseline
 * is frozen when the goal starts; progress is measured on the matches played
 * after that moment.
 */
export type GoalStatus = 'active' | 'completed' | 'replaced';

/**
 * The result of a finished goal, frozen when it was completed or replaced:
 * history never changes with matches played later.
 *  - measured: the median over the matches between start and end (5+);
 *  - insufficient: fewer than 5 such matches — no result is claimed;
 *  - unknown: not recorded (a goal from before results were kept, or the
 *    matches could not be loaded at the moment it ended).
 */
export type GoalOutcome =
  | { kind: 'measured'; value: number; count: number; trend: 'better' | 'worse' | 'same' }
  | { kind: 'insufficient'; count: number; needed: number }
  | { kind: 'unknown' };

export interface ImprovementGoal {
  id: string;
  accountId: number;
  heroId: number;
  gameMode: number;
  metric: ReviewMetricId;
  lowerIsBetter: boolean;
  /** Frozen at the start: the player's usual value before the goal (median) and how many games it came from. */
  baseline: { value: number; sample: number };
  /** The match whose review started the goal. */
  sourceMatchId: number;
  /** When the goal started (ms); only matches that began after it count. */
  createdAt: number;
  status: GoalStatus;
  /** When it was completed or replaced (ms). */
  endedAt?: number;
  /** Frozen result of a finished goal (absent while active). */
  outcome?: GoalOutcome;
}

export interface GoalState {
  /** At most one goal is active at a time. */
  active: ImprovementGoal | null;
  /** Finished goals, newest first (kept for later features, not shown yet). */
  past: ImprovementGoal[];
}

export const EMPTY_GOALS: GoalState = { active: null, past: [] };

/** The same focus: same player, hero, game mode and metric. */
export const sameFocus = (a: Pick<ImprovementGoal, 'accountId' | 'heroId' | 'gameMode' | 'metric'>, b: Pick<ImprovementGoal, 'accountId' | 'heroId' | 'gameMode' | 'metric'>) =>
  a.accountId === b.accountId && a.heroId === b.heroId && a.gameMode === b.gameMode && a.metric === b.metric;

/** How many decimals a metric reads best with. */
export const METRIC_DECIMALS: Record<ReviewMetricId, number> = { gpm: 0, xpm: 0, lastHits: 1, deaths: 1, ka: 1, damage: 0, towers: 0, healing: 0 };
