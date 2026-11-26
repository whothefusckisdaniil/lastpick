import { describe, expect, it } from 'vitest';
import type { HeroGame } from '../player/api';
import type { PersonalReview } from '../match/review';
import { completeGoal, goalFromReview, goalGames, goalProgress, startGoal } from './calculations';
import { EMPTY_GOALS, sameFocus, type ImprovementGoal } from './model';
import { localGoalStore } from './storage';

const T0 = Date.UTC(2026, 10, 20); // goal start (ms)
const s0 = T0 / 1000;

const game = (i: number, o: Partial<HeroGame> = {}): HeroGame => ({
  matchId: 1000 + i, start: s0 + (i + 1) * 3600, duration: 40 * 60,
  kills: 5, deaths: 8, assists: 10, gpm: 500, xpm: 600, lastHits: 200,
  heroDamage: 20000, towerDamage: 1000, heroHealing: 0, gameMode: 22, laneRole: null, leaver: false, ...o,
});

const review = (o: Partial<PersonalReview> = {}): PersonalReview => ({
  kind: 'personal', heroId: 13, position: 2, minutes: 40, win: false, basis: 'hero', sample: 74, good: null,
  improve: { id: 'deaths', value: 3.5, usual: 3, beats: 0.1, sample: 74 }, focus: 'deaths', readings: [], ...o,
});

const goal = (o: Partial<ImprovementGoal> = {}): ImprovementGoal => ({
  ...goalFromReview(review(), { accountId: 1001, gameMode: 22, matchId: 9, now: T0, id: 'g1' })!, ...o,
});

describe('creating a goal', () => {
  it('from the review\'s "to improve": metric, hero, mode, frozen baseline', () => {
    expect(goal()).toEqual({
      id: 'g1', accountId: 1001, heroId: 13, gameMode: 22, metric: 'deaths', lowerIsBetter: true,
      baseline: { value: 3, sample: 74 }, sourceMatchId: 9, createdAt: T0, status: 'active',
    });
  });

  it('nothing to improve → no goal', () => {
    expect(goalFromReview(review({ improve: null }), { accountId: 1, gameMode: 22, matchId: 9, now: T0 })).toBeNull();
  });

  it('higher-is-better metrics keep their direction', () => {
    const g = goalFromReview(review({ improve: { id: 'gpm', value: 380, usual: 470, beats: 0.1, sample: 50 } }), { accountId: 1, gameMode: 22, matchId: 9, now: T0 })!;
    expect(g).toMatchObject({ metric: 'gpm', lowerIsBetter: false, baseline: { value: 470, sample: 50 } });
  });
});

describe('progress', () => {
  it('counts only matches after the start, same mode, full length, no leavers, known value', () => {
    const games = [
      ...Array.from({ length: 3 }, (_, i) => game(i)),
      game(10, { start: s0 - 60 }), // before the goal
      game(11, { gameMode: 23 }), // Turbo
      game(12, { duration: 600 }), // too short
      game(13, { leaver: true }),
      game(14, { gpm: null }), // deaths still known → counts for a deaths goal
    ];
    expect(goalGames(goal(), games)).toHaveLength(4);
    expect(goalGames(goal({ metric: 'gpm', lowerIsBetter: false }), games)).toHaveLength(3);
  });

  it('fewer than 5 new matches: waiting, no numbers', () => {
    expect(goalProgress(goal(), Array.from({ length: 4 }, (_, i) => game(i)))).toEqual({ kind: 'waiting', count: 4, needed: 5 });
  });

  it('the median of the new matches against the frozen baseline', () => {
    // deaths per 10 min: 8 deaths in 40 min = 2.0; baseline 3.0 → better
    const p = goalProgress(goal(), Array.from({ length: 6 }, (_, i) => game(i)));
    expect(p).toMatchObject({ kind: 'progress', count: 6, current: 2, trend: 'better' });
    if (p.kind === 'progress') expect(p.change).toBeCloseTo(-1);
  });

  it('a median is not moved by one outlier', () => {
    const games = [...Array.from({ length: 5 }, (_, i) => game(i)), game(5, { deaths: 30 })];
    const p = goalProgress(goal(), games);
    expect(p.kind === 'progress' && p.current).toBe(2);
  });

  it('worse and "about the same"', () => {
    const worse = goalProgress(goal(), Array.from({ length: 5 }, (_, i) => game(i, { deaths: 16 })));
    expect(worse).toMatchObject({ trend: 'worse', current: 4 });
    const same = goalProgress(goal({ baseline: { value: 2.05, sample: 74 } }), Array.from({ length: 5 }, (_, i) => game(i)));
    expect(same).toMatchObject({ trend: 'same' });
    const gpm = goalProgress(goal({ metric: 'gpm', lowerIsBetter: false, baseline: { value: 450, sample: 40 } }), Array.from({ length: 5 }, (_, i) => game(i)));
    expect(gpm).toMatchObject({ trend: 'better', current: 500 });
  });

  it('uses the latest 20 of them', () => {
    const old = Array.from({ length: 20 }, (_, i) => game(i, { deaths: 20 }));
    const recent = Array.from({ length: 20 }, (_, i) => game(100 + i));
    expect(goalProgress(goal(), [...old, ...recent])).toMatchObject({ count: 40, current: 2 });
  });

  it('the baseline never changes with new games', () => {
    const g = goal();
    goalProgress(g, Array.from({ length: 30 }, (_, i) => game(i)));
    expect(g.baseline).toEqual({ value: 3, sample: 74 });
  });
});

describe('one active goal: replace and complete', () => {
  it('starting another goal replaces the active one and keeps it in history', () => {
    const a = startGoal(EMPTY_GOALS, goal(), T0);
    const b = startGoal(a, goal({ id: 'g2', metric: 'gpm' }), T0 + 5);
    expect(b.active?.id).toBe('g2');
    expect(b.past).toEqual([{ ...goal(), status: 'replaced', endedAt: T0 + 5 }]);
  });

  it('only the player completes a goal', () => {
    const a = startGoal(EMPTY_GOALS, goal(), T0);
    const done = completeGoal(a, T0 + 9);
    expect(done.active).toBeNull();
    expect(done.past[0]).toMatchObject({ id: 'g1', status: 'completed', endedAt: T0 + 9 });
    expect(completeGoal(done, T0 + 10)).toBe(done);
  });

  it('same focus = same player, hero, mode and metric', () => {
    expect(sameFocus(goal(), goal({ id: 'x' }))).toBe(true);
    expect(sameFocus(goal(), goal({ gameMode: 23 }))).toBe(false);
  });
});

describe('storage', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

  it('survives a reload', () => {
    const s = mem();
    const state = startGoal(EMPTY_GOALS, goal(), T0);
    localGoalStore(s).save(state);
    expect(localGoalStore(s).load()).toEqual(state);
  });

  it('broken or foreign data reads as no goals', () => {
    const s = mem();
    s.setItem('lp.goals', '{oops');
    expect(localGoalStore(s).load()).toEqual(EMPTY_GOALS);
    s.setItem('lp.goals', JSON.stringify({ v: 1, active: { id: 'x' }, past: [null, 5] }));
    expect(localGoalStore(s).load()).toEqual(EMPTY_GOALS);
    expect(localGoalStore(null).load()).toEqual(EMPTY_GOALS);
  });
});
