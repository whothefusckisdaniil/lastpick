import { EMPTY_GOALS, type GoalOutcome, type GoalState, type ImprovementGoal } from './model';

/**
 * Where goals live. Calculations and UI only see this interface, so a cloud
 * store (sync between devices) can replace localStorage later without
 * touching them.
 */
export interface GoalStore {
  load(): GoalState;
  save(state: GoalState): void;
}

const KEY = 'lp.goals';
/**
 * Stored shape version. v1 (the first tracker) had no frozen results;
 * v2 adds `outcome` to finished goals. Older versions are migrated on read,
 * never dropped.
 */
const VERSION = 2;

const isOutcome = (o: unknown): o is GoalOutcome => {
  const x = o as GoalOutcome;
  if (!x || typeof x !== 'object') return false;
  if (x.kind === 'unknown') return true;
  if (x.kind === 'insufficient') return typeof x.count === 'number' && typeof x.needed === 'number';
  return x.kind === 'measured' && typeof x.value === 'number' && Number.isFinite(x.value) && typeof x.count === 'number' && ['better', 'worse', 'same'].includes(x.trend);
};

/** One record → the current shape: a finished goal always has an outcome ("unknown" when it was never recorded). */
function migrate(g: ImprovementGoal): ImprovementGoal {
  if (g.status === 'active') { const { outcome: _drop, ...rest } = g; return rest; }
  return { ...g, outcome: isOutcome(g.outcome) ? g.outcome : { kind: 'unknown' } };
}

const isGoal = (g: unknown): g is ImprovementGoal => {
  const x = g as ImprovementGoal;
  return !!x && typeof x.id === 'string' && typeof x.accountId === 'number' && typeof x.heroId === 'number'
    && typeof x.gameMode === 'number' && typeof x.metric === 'string' && typeof x.baseline?.value === 'number'
    && typeof x.createdAt === 'number';
};

/** This browser only. Unreadable or foreign data counts as "no goals" instead of breaking the page. */
export function localGoalStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): GoalStore {
  return {
    load() {
      try {
        const raw = JSON.parse(storage?.getItem(KEY) ?? 'null') as { v?: number; active?: unknown; past?: unknown[] } | null;
        if (!raw || typeof raw.v !== 'number' || raw.v < 1 || raw.v > VERSION) return EMPTY_GOALS;
        return {
          active: isGoal(raw.active) && raw.active.status === 'active' ? migrate(raw.active) : null,
          past: Array.isArray(raw.past) ? raw.past.filter(isGoal).filter((g) => g.status !== 'active').map(migrate) : [],
        };
      } catch {
        return EMPTY_GOALS;
      }
    },
    save(state) {
      try { storage?.setItem(KEY, JSON.stringify({ v: VERSION, ...state })); } catch { /* storage full or blocked */ }
    },
  };
}
