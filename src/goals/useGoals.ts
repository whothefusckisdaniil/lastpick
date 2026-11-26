import { useSyncExternalStore } from 'react';
import { loadHeroGames, type HeroGame } from '../player/api';
import { completeGoal, freezeOutcome, startGoal } from './calculations';
import type { GoalOutcome, GoalState, ImprovementGoal } from './model';
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

type Loader = (goal: ImprovementGoal) => Promise<HeroGame[]>;
/** The match review's own loader: a forced refresh, the last copy if the service is down. */
let loadGames: Loader = (g) => loadHeroGames(g.accountId, g.heroId, g.gameMode, { fresh: true });

/** The active goal's result at this moment (games already loaded by the caller are reused). */
async function outcomeNow(goal: ImprovementGoal, now: number, games?: HeroGame[]): Promise<GoalOutcome> {
  if (games) return freezeOutcome(goal, games, now);
  try { return freezeOutcome(goal, await loadGames(goal), now); } catch { return freezeOutcome(goal, null, now); }
}

export const goalActions = {
  /** Start a goal; an active one is replaced, its result frozen first. */
  async start(goal: ImprovementGoal): Promise<void> {
    const now = Date.now();
    const old = state.active;
    const outcome = old ? await outcomeNow(old, now) : undefined;
    // the state may have changed while loading (another tab): replace whatever is active now
    commit(startGoal(state, goal, now, state.active?.id === old?.id ? outcome : undefined));
  },
  /** The player completes the active goal; its result is frozen now. */
  async complete(games?: HeroGame[]): Promise<void> {
    const active = state.active;
    if (!active) return;
    const now = Date.now();
    const outcome = await outcomeNow(active, now, games);
    if (state.active?.id !== active.id) return; // already finished elsewhere
    commit(completeGoal(state, now, outcome));
  },
};

export function useGoals(): GoalState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}

/** Test hooks / a future cloud store. */
export function setGoalStore(next: GoalStore) { store = next; state = store.load(); emit(); }
export function setGoalGamesLoader(next: Loader) { loadGames = next; }
