import { afterEach, describe, expect, it } from 'vitest';
import type { HeroGame } from '../player/api';
import { EMPTY_GOALS, type GoalState, type ImprovementGoal } from './model';
import { goalActions, setGoalGamesLoader, setGoalStore } from './useGoals';
import type { GoalStore } from './storage';

const T0 = Date.now() - 10 * 86400e3;
const goal = (o: Partial<ImprovementGoal> = {}): ImprovementGoal => ({
  id: 'g1', accountId: 1001, heroId: 13, gameMode: 22, metric: 'deaths', lowerIsBetter: true,
  baseline: { value: 3, sample: 74 }, sourceMatchId: 9, createdAt: T0, status: 'active', ...o,
});
const game = (i: number): HeroGame => ({
  matchId: i, start: T0 / 1000 + (i + 1) * 3600, duration: 2400, kills: 5, deaths: 8, assists: 10, gpm: 500, xpm: 600,
  lastHits: 200, heroDamage: 20000, towerDamage: 1000, heroHealing: 0, gameMode: 22, laneRole: null, leaver: false,
});

function memoryStore(initial: GoalState = EMPTY_GOALS): GoalStore & { saved: GoalState[] } {
  let st = initial;
  const saved: GoalState[] = [];
  return { saved, load: () => st, save: (s) => { st = s; saved.push(s); } };
}

describe('goal actions', () => {
  afterEach(() => setGoalGamesLoader(async () => []));

  it('replacing freezes the old goal\'s result from its own matches first', async () => {
    const store = memoryStore({ active: goal(), past: [] });
    setGoalStore(store);
    const asked: string[] = [];
    setGoalGamesLoader(async (g) => { asked.push(`${g.accountId}:${g.heroId}:${g.gameMode}`); return Array.from({ length: 6 }, (_, i) => game(i)); });
    await goalActions.start(goal({ id: 'g2', heroId: 8, metric: 'gpm', lowerIsBetter: false, createdAt: Date.now() }));
    expect(asked).toEqual(['1001:13:22']);
    const st = store.saved.at(-1)!;
    expect(st.active?.id).toBe('g2');
    expect(st.past[0]).toMatchObject({ id: 'g1', status: 'replaced', outcome: { kind: 'measured', value: 2, count: 6, trend: 'better' } });
  });

  it('completing freezes the result; a load failure records "unknown", not a guess', async () => {
    const store = memoryStore({ active: goal(), past: [] });
    setGoalStore(store);
    setGoalGamesLoader(async () => { throw new Error('down'); });
    await goalActions.complete();
    expect(store.saved.at(-1)).toMatchObject({ active: null, past: [{ id: 'g1', status: 'completed', outcome: { kind: 'unknown' } }] });
  });

  it('starting the first goal needs no loading', async () => {
    const store = memoryStore();
    setGoalStore(store);
    let loads = 0;
    setGoalGamesLoader(async () => { loads++; return []; });
    await goalActions.start(goal());
    expect(loads).toBe(0);
    expect(store.saved.at(-1)?.past).toEqual([]);
  });
});
