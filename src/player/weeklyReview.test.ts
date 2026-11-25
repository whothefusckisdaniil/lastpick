import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mostPlayed, weeklyReview, weekStats } from './weeklyReview';
import { clearHistoryMemory, HISTORY_TTL_MS, loadHistory } from './api';
import type { HistoryGame } from './v3';

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const DAY = 86400;
const nowSec = NOW / 1000;
/** A game `daysAgo` days before NOW. */
const g = (daysAgo: number, win: boolean, heroId = 1): HistoryGame => ({ heroId, win, start: Math.floor(nowSec - daysAgo * DAY) });

describe('weekly review: numbers', () => {
  it('counts the last 7 days against the 7 before, by match time', () => {
    const games = [
      ...Array.from({ length: 14 }, (_, i) => g(0.1 + i * 0.4, true, 2)),
      ...Array.from({ length: 10 }, (_, i) => g(0.2 + i * 0.6, false, 3)),
      ...Array.from({ length: 10 }, (_, i) => g(7.5 + i * 0.6, i < 5, 2)),
      g(14.5, true), g(30, true), // older: ignored
    ];
    const r = weeklyReview(games, NOW);
    expect(r.current).toEqual({ matches: 24, wins: 14, losses: 10, winrate: (100 * 14) / 24 });
    expect(r.previous).toEqual({ matches: 10, wins: 5, losses: 5, winrate: 50 });
    expect(r.matchesChange).toBe(14);
    expect(r.winrateChange).toBeCloseTo(58.333 - 50, 2);
    expect(r.confident).toBe(true);
    expect(r.topHero).toEqual({ heroId: 2, matches: 14, wins: 14, winrate: 100 });
  });

  it('the boundary: exactly 7 days ago belongs to the previous week', () => {
    const r = weeklyReview([g(7, true), g(6.99, false)], NOW);
    expect(r.current.matches).toBe(1);
    expect(r.previous.matches).toBe(1);
  });

  it('no matches: an empty week, not zeros dressed up as a win rate', () => {
    const r = weeklyReview([g(9, true)], NOW);
    expect(r.current).toEqual({ matches: 0, wins: 0, losses: 0, winrate: null });
    expect(r.topHero).toBeNull();
    expect(r.confident).toBe(false);
    expect(r.winrateChange).toBeNull();
    expect(r.matchesChange).toBe(-1);
  });

  it('fewer than 5 matches: shown, but no confident change', () => {
    const r = weeklyReview([g(1, true), g(2, true), g(3, false), ...Array.from({ length: 6 }, (_, i) => g(8 + i * 0.5, false))], NOW);
    expect(r.current.matches).toBe(3);
    expect(r.confident).toBe(false);
    expect(r.winrateChange).toBeNull();
  });

  it('too few matches last week: no win-rate change', () => {
    const r = weeklyReview([...Array.from({ length: 6 }, (_, i) => g(1 + i * 0.5, true)), g(9, false)], NOW);
    expect(r.confident).toBe(true);
    expect(r.winrateChange).toBeNull();
    expect(r.matchesChange).toBe(5);
  });

  it('most played: ties go to more wins, then the latest game', () => {
    expect(mostPlayed([g(1, false, 5), g(2, false, 5), g(1, true, 6), g(3, false, 6)])?.heroId).toBe(6);
    expect(mostPlayed([g(3, true, 7), g(1, true, 8)])?.heroId).toBe(8);
    expect(mostPlayed([])).toBeNull();
    expect(weekStats([])).toEqual({ matches: 0, wins: 0, losses: 0, winrate: null });
  });
});

describe('weekly review: history loading and cache', () => {
  const store = new Map<string, string>();
  let calls: string[];
  const rows = [
    { match_id: 1, player_slot: 0, radiant_win: true, hero_id: 2, start_time: Math.floor(nowSec - 2 * DAY) },
    { match_id: 2, player_slot: 130, radiant_win: true, hero_id: 3, start_time: Math.floor(nowSec - 9 * DAY) },
  ];
  beforeEach(() => {
    store.clear();
    clearHistoryMemory();
    calls = [];
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    });
    vi.stubGlobal('fetch', async (url: string) => { calls.push(url); return new Response(JSON.stringify(rows), { status: 200 }); });
  });
  afterEach(() => vi.unstubAllGlobals());

  const since14 = nowSec - 14 * DAY;

  it('one request, then memory; the result has only the asked window', async () => {
    const a = await loadHistory(1001, since14, { now: NOW });
    const b = await loadHistory(1001, nowSec - 7 * DAY, { now: NOW + 1000 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/players/1001/matches?date=14&project=hero_id&project=start_time');
    expect(a.games).toHaveLength(2);
    expect(b.games).toHaveLength(1);
    expect(a.games[1]).toEqual({ heroId: 3, win: false, start: rows[1].start_time });
  });

  it('a wider window loaded for patches answers the week without a request', async () => {
    await loadHistory(1001, nowSec - 400 * DAY, { now: NOW });
    await loadHistory(1001, since14, { now: NOW + 5000 });
    expect(calls).toHaveLength(1);
  });

  it('after a reload the stored copy is used while fresh, refetched after the TTL', async () => {
    await loadHistory(1001, since14, { now: NOW });
    clearHistoryMemory();
    await loadHistory(1001, since14 + 60, { now: NOW + 60_000 });
    expect(calls).toHaveLength(1);
    clearHistoryMemory();
    await loadHistory(1001, since14, { now: NOW + HISTORY_TTL_MS + 1 });
    expect(calls).toHaveLength(2);
  });

  it('an outage shows the stored copy, marked stale with its date', async () => {
    await loadHistory(1001, since14, { now: NOW });
    clearHistoryMemory();
    vi.stubGlobal('fetch', async () => new Response('', { status: 522 }));
    const h = await loadHistory(1001, since14 + 3600, { now: NOW + HISTORY_TTL_MS + 3600_000 });
    expect(h.stale).toBe(true);
    expect(h.fetchedAt).toBe(NOW);
    expect(h.games).toHaveLength(2);
  });

  it('"fresh" (the refresh button) always asks again', async () => {
    await loadHistory(1001, since14, { now: NOW });
    await loadHistory(1001, since14, { now: NOW + 1000, fresh: true });
    expect(calls).toHaveLength(2);
  });
});
