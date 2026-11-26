import { useSyncExternalStore } from 'react';
import { completeGoal, startGoal } from './calculations';
import type { GoalState, ImprovementGoal } from './model';
import { localGoalStore, type GoalStore } from './storage';

/** One shared goal state for the match review and the profile (and other tabs via the storage event). */
let store: GoalStore = localGoalStore();
let state: GoalState = store.load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const commit = (next: GoalState) => { state = next; store.save(next); emit(); };

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === 'lp.goals') { state = store.load(); emit(); } });
}

export const goalActions = {
  start: (goal: ImprovementGoal) => commit(startGoal(state, goal, Date.now())),
  complete: () => commit(completeGoal(state, Date.now())),
};

export function useGoals(): GoalState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}

/** Test hook / future cloud store. */
export function setGoalStore(next: GoalStore) { store = next; state = store.load(); emit(); }
