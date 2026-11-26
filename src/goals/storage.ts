import { EMPTY_GOALS, type GoalState, type ImprovementGoal } from './model';

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
const VERSION = 1;

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
        if (!raw || raw.v !== VERSION) return EMPTY_GOALS;
        return { active: isGoal(raw.active) ? raw.active : null, past: Array.isArray(raw.past) ? raw.past.filter(isGoal) : [] };
      } catch {
        return EMPTY_GOALS;
      }
    },
    save(state) {
      try { storage?.setItem(KEY, JSON.stringify({ v: VERSION, ...state })); } catch { /* storage full or blocked */ }
    },
  };
}
