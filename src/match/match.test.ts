import { afterEach, describe, expect, it, vi } from 'vitest';
import heroesRaw from '../../public/data/heroes.json';
import buildIndex from '../../public/builds/index.json';
import parsedRaw from './fixtures/parsed-ranked.json';
import unparsedRaw from './fixtures/unparsed-ranked.json';
import turboRaw from './fixtures/turbo.json';
import leaverRaw from './fixtures/leaver-turbo.json';
import itemIds from './fixtures/item-ids.json';
import type { Hero } from '../types';
import type { BuildIndex, HeroBuilds } from '../data/dataset';
import { chooseBuild } from '../data/dataset';
import { normalizeMatch, parseMatchInput, type RawMatch } from './normalize';
import { hasRealDraft, type MatchModel } from './model';
import { STORY, swings, verdict } from './analyze/story';
import { awards, economy, killShare, lobbyBracket, positions } from './analyze/players';
import { reviewPurchases } from './analyze/builds';
import { fetchMatch, MatchError, pollDelay, POLL_LIMIT_MS } from './api';
import { fights, fightScore } from './analyze/fights';
import { laning } from './analyze/lanes';
import { deaths, DEATHS } from './analyze/deaths';
import { inPhase, lifetime, OBSERVER_LIFE, wardSummary, WARD_PHASES } from './analyze/wards';
import { compareToNorm, normAt, type NormFile } from './norms';
import normsDivine from '../../public/builds/norms/DIVINE_IMMORTAL.json';

const buildFiles = import.meta.glob('../../public/builds/[0-9]*.json', { eager: true, import: 'default' }) as Record<string, HeroBuilds>;
const heroBuild = (id: number) => buildFiles[`../../public/builds/${id}.json`];
const heroes = heroesRaw as unknown as Hero[];
const heroById = new Map(heroes.map((h) => [h.id, h]));
const keyOf = (id: number) => heroById.get(id)?.key;
const norm = (raw: unknown) => normalizeMatch(raw as RawMatch, keyOf);

const parsed = norm(parsedRaw);
const unparsed = norm(unparsedRaw);
const turbo = norm(turboRaw);
const leaver = norm(leaverRaw);

describe('match input', () => {
  it('reads an id from links and bare numbers', () => {
    expect(parseMatchInput('9102267811')).toBe(9102267811);
    expect(parseMatchInput('https://www.dotabuff.com/matches/9102267811')).toBe(9102267811);
    expect(parseMatchInput('https://www.opendota.com/matches/9102267811/overview')).toBe(9102267811);
    expect(parseMatchInput('https://stratz.com/matches/9102267811')).toBe(9102267811);
    expect(parseMatchInput('https://lastpick-pro.vercel.app/?match=9102267811&lang=ru')).toBe(9102267811);
    expect(parseMatchInput(' 9102267811 ')).toBe(9102267811);
  });
  it('rejects junk', () => {
    expect(parseMatchInput('')).toBeNull();
    expect(parseMatchInput('hello')).toBeNull();
    expect(parseMatchInput('12345')).toBeNull();
  });
});

describe('normalize', () => {
  it('parsed ranked match: timelines, purchases, deaths, teamfights', () => {
    expect(parsed.parsed).toBe(true);
    expect(parsed.players).toHaveLength(10);
    expect(parsed.players.slice(0, 5).every((p) => p.radiant)).toBe(true);
    expect(parsed.goldAdv!.length).toBeGreaterThan(30);
    expect(parsed.players.every((p) => p.purchases && p.purchases.length > 5)).toBe(true);
    // deaths read from the killers' logs match the scoreboard (± denies / creeps)
    for (const p of parsed.players) expect(Math.abs(p.deathTimes!.length - p.deaths)).toBeLessThanOrEqual(2);
    expect(parsed.teamfights.length).toBeGreaterThan(5);
    expect(parsed.objectives.some((o) => o.kind === 'tower')).toBe(true);
    expect(parsed.picksBans.filter((x) => x.pick)).toHaveLength(10);
    expect(hasRealDraft(parsed)).toBe(true);
  });

  it('unparsed match: scoreboard only', () => {
    expect(unparsed.parsed).toBe(false);
    expect(unparsed.goldAdv).toBeNull();
    expect(unparsed.players.every((p) => p.purchases === null && p.deathTimes === null)).toBe(true);
    expect(unparsed.players.every((p) => p.items.length > 0)).toBe(true);
    expect(unparsed.players[0].bench.gpm).not.toBeNull();
  });

  it('Turbo has no real draft', () => {
    expect(hasRealDraft(turbo)).toBe(false);
  });

  it('marks leavers (abandoned), not a short disconnect', () => {
    expect(leaver.players.filter((p) => p.leaver)).toHaveLength(0); // leaver_status 1 = reconnected
    const raw = structuredClone(leaverRaw) as unknown as RawMatch;
    raw.players![2].leaver_status = 3;
    expect(norm(raw).players.filter((p) => p.leaver).map((p) => p.slot)).toEqual([2]);
  });
});

describe('story', () => {
  it('verdict follows the gold graph', () => {
    const v = verdict(parsed);
    expect(v.radiantWin).toBe(parsed.radiantWin);
    expect(v.minute).toBe(Math.round(parsed.duration / 60));
    expect(v.deficit).toBeGreaterThanOrEqual(0);
    expect(v.maxLead).toBeGreaterThan(0);
  });

  const withAdv = (adv: number[], radiantWin = true): MatchModel => ({ ...parsed, goldAdv: adv, radiantWin, teamfights: [], objectives: [] });

  it('comeback / stomp / close', () => {
    expect(verdict(withAdv([0, -3000, -STORY.comeback - 100, 2000, 9000])).kind).toBe('comeback');
    expect(verdict(withAdv([0, 3000, 9000, 16000])).kind).toBe('stomp');
    expect(verdict(withAdv([0, -1000, 2000, -1500, 3000])).kind).toBe('close');
    // the same graph seen by a Dire win
    expect(verdict(withAdv([0, 3000, 6000, -1000], false)).kind).toBe('comeback');
  });

  it('without a timeline: kill score decides', () => {
    expect(verdict(unparsed).deficit).toBeNull();
  });

  it('swings: biggest 2-minute changes, not overlapping, with events', () => {
    const m = { ...withAdv([0, 0, 0, 500, 8000, 8000, 8000, 8000, 2000, 2000, 2000]),
      objectives: [{ time: 4 * 60, kind: 'roshan' as const, radiant: true }],
      teamfights: [{ start: 220, end: 250, radiantDeaths: 1, direDeaths: 4, goldSwing: 5000, dead: [], players: [] }] };
    const s = swings(m);
    expect(s).toHaveLength(2);
    expect(s[0].delta).toBeGreaterThan(0);
    expect(s[0].roshan).toBe(true);
    expect(s[0].fight).toEqual({ radiantDeaths: 1, direDeaths: 4 });
    expect(s[1].delta).toBeLessThan(0);
    expect(swings(parsed).length).toBeGreaterThan(0);
    expect(swings(unparsed)).toEqual([]);
  });
});

describe('players', () => {
  it('positions: 1..5 once per team', () => {
    for (const m of [parsed, unparsed]) {
      const { bySlot } = positions(m);
      for (const r of [true, false]) {
        const ps = m.players.filter((p) => p.radiant === r).map((p) => bySlot.get(p.slot)).sort();
        expect(ps).toEqual([1, 2, 3, 4, 5]);
      }
    }
    expect(positions(parsed).guessed).toBe(false);
    expect(positions(unparsed).guessed).toBe(true);
  });

  it('parsed: the mid laner is pos 2', () => {
    const { bySlot } = positions(parsed);
    const mids = parsed.players.filter((p) => p.laneRole === 2);
    expect(mids.some((p) => bySlot.get(p.slot) === 2)).toBe(true);
  });

  it('a poor mid is still pos 2; the safe lane gives 1 and 5', () => {
    const { bySlot } = positions(parsed);
    for (const r of [true, false]) {
      const team = parsed.players.filter((p) => p.radiant === r);
      const mid = team.filter((p) => p.laneRole === 2 && !p.roaming).sort((a, b) => b.netWorth - a.netWorth)[0];
      expect(bySlot.get(mid.slot)).toBe(2);
      const safe = team.filter((p) => p.laneRole === 1 && !p.roaming).sort((a, b) => b.netWorth - a.netWorth);
      if (safe[0]) expect(bySlot.get(safe[0].slot)).toBe(1);
      if (safe[1]) expect(bySlot.get(safe[1].slot)).toBe(5);
    }
    // the fixture's Radiant mid is only 4th by net worth
    const rad = parsed.players.filter((p) => p.radiant).sort((a, b) => b.netWorth - a.netWorth);
    expect(rad.findIndex((p) => p.laneRole === 2)).toBeGreaterThan(2);
  });

  it('economy shares add up', () => {
    const e = economy(parsed);
    const sum = [...e.radiant.share.values()].reduce((s, x) => s + x, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(e.carried.radiant).toBe(parsed.radiantWin);
  });

  it('kill share within 0..1', () => {
    for (const p of parsed.players) expect(killShare(parsed, p)).toBeLessThanOrEqual(1);
  });

  it('awards: MVP first, at most 2 per player, deaths award only to the top', () => {
    const a = awards(parsed);
    expect(a[0].id).toBe('mvp');
    const per = new Map<number, number>();
    for (const x of a) per.set(x.slot, (per.get(x.slot) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(2);
    const tavern = a.find((x) => x.id === 'tavern');
    if (tavern) expect(tavern.value).toBe(Math.max(...parsed.players.map((p) => p.deaths)));
  });

  it('lobby rank → bracket', () => {
    expect(lobbyBracket(parsed)).toMatch(/_/);
    expect(lobbyBracket({ ...parsed, players: parsed.players.map((p) => ({ ...p, rankTier: null })) })).toBeNull();
  });
});

describe('purchase review', () => {
  const ix = buildIndex as unknown as BuildIndex;
  const itemOf = (id: number) => ix.items[id];
  const keyOfId = (id: number) => (itemIds as Record<string, string>)[id];
  const hero = (name: string) => heroes.find((h) => h.name === name)!;
  const id = (k: string) => Number(Object.entries(ix.items).find(([, v]) => v[0] === k)![0]);
  const p0 = parsed.players[0];
  const components = new Map(Object.values(ix.items).map((v) => [v[0], v[2] ?? []]));
  const build = (items: [string, number][]) => ({ m: 5000, low: false, start: [], boots: [], talents: [], skills: [], items: items.map(([k, pct]) => [id(k), pct, 20, 0.5]) as [number, number, number, number][] });

  it('lists big items in purchase order with the minute, skips consumables, components and repeats', () => {
    const player = { ...p0, purchases: [
      { key: 'tango', time: -60 }, { key: 'power_treads', time: 9 * 60 }, { key: 'recipe_black_king_bar', time: 17 * 60 },
      { key: 'black_king_bar', time: 17 * 60 }, { key: 'ogre_axe', time: 15 * 60 }, { key: 'blink', time: 13 * 60 }, { key: 'black_king_bar', time: 40 * 60 },
    ] };
    const r = reviewPurchases({ player, duration: 40 * 60, builds: [], itemOf, keyOfId, enemies: [] });
    expect(r.timed).toBe(true);
    expect(r.rows.map((x) => [x.key, x.minute])).toEqual([['power_treads', 9], ['blink', 13], ['black_king_bar', 17]]);
    expect(r.mistakes).toBe(0);
  });

  it('a counter item with no such threat is "not needed"; with it, fine', () => {
    const player = { ...p0, purchases: [{ key: 'monkey_king_bar', time: 25 * 60 }] };
    const noEvasion = ['Pudge', 'Lion', 'Axe', 'Zeus', 'Sniper'].map(hero);
    const withPA = ['Pudge', 'Lion', 'Axe', 'Zeus', 'Phantom Assassin'].map(hero);
    const b = build([['black_king_bar', 0.6]]);
    const r1 = reviewPurchases({ player, duration: 45 * 60, builds: [b], itemOf, keyOfId, enemies: noEvasion });
    expect(r1.rows[0]).toMatchObject({ flag: 'notNeeded', why: 'evasion' });
    const r2 = reviewPurchases({ player, duration: 45 * 60, builds: [b], itemOf, keyOfId, enemies: withPA });
    expect(r2.rows[0].flag).toBeNull();
    // a hero that buys it often is never told it was not needed
    const r3 = reviewPurchases({ player, duration: 45 * 60, builds: [build([['monkey_king_bar', 0.3]])], itemOf, keyOfId, enemies: noEvasion });
    expect(r3.rows[0].flag).toBeNull();
  });

  it('bought in the last minutes = useless; an item the hero almost never buys = unusual', () => {
    const player = { ...p0, purchases: [{ key: 'black_king_bar', time: 18 * 60 }, { key: 'satanic', time: 38 * 60 }, { key: 'radiance', time: 20 * 60 }, { key: 'kaya', time: 39 * 60 }] };
    const b = build([['black_king_bar', 0.6], ['satanic', 0.3], ['desolator', 0.05]]);
    const r = reviewPurchases({ player, duration: 40 * 60, builds: [b], itemOf, keyOfId, enemies: [], components });
    const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));
    expect(by.black_king_bar.flag).toBeNull();
    expect(by.satanic).toMatchObject({ flag: 'wasted', beforeEnd: 2 });
    expect(by.radiance.flag).toBe('rare');
    // a component bought at the end is gold carried forward, not a mistake
    expect(by.kaya.flag).toBeNull();
    expect(r.mistakes).toBe(2);
    // an item the statistics do not know (new this patch) is never "unusual"
    const fresh = reviewPurchases({ player: { ...p0, purchases: [{ key: 'brand_new_item', time: 20 * 60 }] }, duration: 40 * 60, builds: [b], itemOf, keyOfId, enemies: [], components });
    expect(fresh.rows[0].flag).toBeNull();
    // a build cut at a high share cannot tell what is rare
    const cut = reviewPurchases({ player, duration: 40 * 60, builds: [build([['black_king_bar', 0.6], ['satanic', 0.4]])], itemOf, keyOfId, enemies: [], components });
    expect(cut.rows.find((x) => x.key === 'radiance')!.flag).toBeNull();
    // another rank buying it in 5%+ of games: not unusual
    const ranks = reviewPurchases({ player, duration: 40 * 60, builds: [b, { ...build([['radiance', 0.06]]), m: 800 }], itemOf, keyOfId, enemies: [], components });
    expect(ranks.rows.find((x) => x.key === 'radiance')!.flag).toBeNull();
  });

  it('without a purchase log: the final inventory, no minutes', () => {
    const p = unparsed.players[0];
    const r = reviewPurchases({ player: p, duration: unparsed.duration, builds: [], itemOf, keyOfId, enemies: [] });
    expect(r.timed).toBe(false);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.minute == null && x.flag !== 'wasted')).toBe(true);
  });

  it('a component is hidden once the item it builds into is bought', () => {
    const player = { ...p0, purchases: [{ key: 'kaya', time: 14 * 60 }, { key: 'sange', time: 18 * 60 }, { key: 'kaya_and_sange', time: 18 * 60 }, { key: 'soul_booster', time: 25 * 60 }] };
    const r = reviewPurchases({ player, duration: 40 * 60, builds: [], itemOf, keyOfId, enemies: [], components });
    expect(r.rows.map((x) => x.key)).toEqual(['kaya_and_sange', 'soul_booster']);
  });

  it('works on every player of a parsed match', () => {
    for (const p of parsed.players) {
      const enemies = parsed.players.filter((x) => x.radiant !== p.radiant).map((x) => heroById.get(x.heroId)!);
      const r = reviewPurchases({ player: p, duration: parsed.duration, builds: [], itemOf, keyOfId, enemies });
      expect(r.rows.every((x) => x.minute != null && x.minute <= Math.ceil(parsed.duration / 60))).toBe(true);
    }
  });
});

describe('parse polling', () => {
  it('backs off 5 → 10 → 20 → 30 s and stops within the limit', () => {
    expect([0, 1, 2, 3, 4, 9].map(pollDelay)).toEqual([5000, 10000, 20000, 30000, 30000, 30000]);
    expect(POLL_LIMIT_MS).toBeLessThanOrEqual(10 * 60 * 1000);
  });
});

describe('teamfights', () => {
  const list = fights(parsed);
  it('every fight has a side or is a trade; deaths match the dead list', () => {
    expect(list.length).toBe(parsed.teamfights.length);
    for (const f of list) {
      expect(f.dead.length).toBeLessThanOrEqual(f.radiantDeaths + f.direDeaths);
      if (f.radiantDeaths !== f.direDeaths) expect(f.radiantWon).toBe(f.radiantDeaths < f.direDeaths);
    }
  });
  it('one decisive fight, won by the match winner', () => {
    const d = list.filter((f) => f.decisive);
    expect(d).toHaveLength(1);
    expect(d[0].radiantWon).toBe(parsed.radiantWin);
  });
  it('fight score counts wins only', () => {
    const s = fightScore(list);
    expect(s.radiant + s.dire).toBeLessThanOrEqual(list.length);
  });
  it('kills in a fight come from the hero kills, not creeps', () => {
    for (const f of list) expect(f.killers.reduce((a, k) => a + k.kills, 0)).toBeLessThanOrEqual(f.radiantDeaths + f.direDeaths);
  });
});

describe('laning', () => {
  it('three lanes at minute 10, each player once', () => {
    const l = laning(parsed)!;
    expect(l.minute).toBe(10);
    const slots = [...l.lanes.flatMap((x) => [...x.radiant, ...x.dire].map((p) => p.slot)), ...l.roamers];
    expect(new Set(slots).size).toBe(slots.length);
    expect(l.lanes.map((x) => x.lane)).toEqual(['bot', 'mid', 'top']);
  });
  it('winner needs a 15% margin', () => {
    for (const x of laning(parsed)!.lanes) {
      if (x.winner === 'radiant') expect(x.radiantValue).toBeGreaterThan(x.direValue * 1.15);
      if (x.winner === 'even') expect(Math.max(x.radiantValue, x.direValue)).toBeLessThanOrEqual(Math.min(x.radiantValue, x.direValue) * 1.15 + 1e-6);
    }
  });
  it('unparsed → none', () => {
    expect(laning(unparsed)).toBeNull();
  });
});

describe('deaths and buybacks', () => {
  const d = deaths(parsed)!;
  it('timeline has every death', () => {
    expect(d.all.length).toBe(parsed.players.reduce((s, p) => s + p.deathTimes!.length, 0));
  });
  it('costly deaths: an enemy objective followed, sorted by time, one per push', () => {
    expect(d.costly.length).toBeGreaterThan(0);
    expect(d.costly.length).toBeLessThanOrEqual(DEATHS.top);
    for (const c of d.costly) {
      expect(c.score).toBeGreaterThan(0);
      expect(c.group[0]).toBe(c.slot);
      for (const s of c.group) expect(parsed.players[s].radiant).toBe(parsed.players[c.slot].radiant);
    }
    for (let i = 1; i < d.costly.length; i++) expect(d.costly[i].time).toBeGreaterThanOrEqual(d.costly[i - 1].time);
  });
  it('a late death before the barracks without a buyback is flagged', () => {
    const m: MatchModel = {
      ...parsed,
      objectives: [{ time: 1900, kind: 'barracks', radiant: false }],
      players: parsed.players.map((p) => ({ ...p, deathTimes: p.slot === 0 ? [1850] : [], buybackTimes: [] })),
    };
    const r = deaths(m)!;
    expect(r.costly).toHaveLength(1);
    expect(r.costly[0]).toMatchObject({ slot: 0, noBuyback: true, group: [0] });
    const withBb = deaths({ ...m, players: m.players.map((p) => (p.slot === 0 ? { ...p, buybackTimes: [1870] } : p)) })!;
    expect(withBb.costly[0].noBuyback).toBe(false);
    expect(withBb.buybacks).toEqual([{ slot: 0, time: 1870, paidOff: false }]);
  });
  it('unparsed → none', () => {
    expect(deaths(unparsed)).toBeNull();
  });
});

describe('wards', () => {
  const w = wardSummary(parsed)!;
  it('placements from both logs, positions on the 0..1 map', () => {
    expect(w.wards.length).toBeGreaterThan(20);
    for (const x of w.wards) {
      expect(x.x).toBeGreaterThanOrEqual(0); expect(x.x).toBeLessThanOrEqual(1);
      expect(x.y).toBeGreaterThanOrEqual(0); expect(x.y).toBeLessThanOrEqual(1);
      if (x.end != null) expect(x.end).toBeGreaterThanOrEqual(x.time);
    }
    expect(w.radiant.obs + w.radiant.sen + w.dire.obs + w.dire.sen).toBe(w.wards.length);
  });
  it('dewards: only by enemy heroes, counted for the destroying side', () => {
    for (const x of w.wards) if (x.killedBy != null) expect(parsed.players[x.killedBy].radiant).not.toBe(x.radiant);
    expect(w.radiant.dewards + w.dire.dewards).toBe(w.wards.filter((x) => x.killedBy != null).length);
    expect(w.players.reduce((s, p) => s + p.dewards, 0)).toBe(w.radiant.dewards + w.dire.dewards);
  });
  it('observer lifetime: until destroyed, else 6 minutes or the end of the match', () => {
    const base = { slot: 0, radiant: true, kind: 'obs' as const, x: 0.5, y: 0.5, killedBy: null };
    expect(lifetime({ ...base, time: 100, end: 160 }, 3000)).toBe(60);
    expect(lifetime({ ...base, time: 100, end: null }, 3000)).toBe(OBSERVER_LIFE);
    expect(lifetime({ ...base, time: 2900, end: null }, 3000)).toBe(100);
  });
  it('phases cover each ward exactly once (besides "all")', () => {
    for (const x of w.wards) expect(WARD_PHASES.slice(1).filter((p) => inPhase(x, p))).toHaveLength(1);
  });
  it('none without a parse', () => {
    expect(wardSummary(unparsed)).toBeNull();
  });
});

describe('STRATZ norms in the recap', () => {
  const f = normsDivine as unknown as NormFile;
  const am = 1;
  it('interpolates between the stored minutes and extrapolates past them', () => {
    const n10 = normAt(f, am, 1, 'nw', 10)!;
    const n20 = normAt(f, am, 1, 'nw', 20)!;
    expect(normAt(f, am, 1, 'nw', 15)).toBeCloseTo((n10 + n20) / 2, 5);
    expect(normAt(f, am, 1, 'nw', 5)).toBeCloseTo(n10 / 2, 5);
    expect(normAt(f, am, 1, 'nw', 60)!).toBeGreaterThan(normAt(f, am, 1, 'nw', 50)!);
    expect(normAt(f, 99999, 1, 'nw', 10)).toBeNull();
  });
  it('compares a player at the end minute and at minute 10', () => {
    const { bySlot } = positions(parsed);
    let compared = 0;
    for (const p of parsed.players) {
      const c = compareToNorm(parsed, p, bySlot.get(p.slot)!, f);
      if (!c.length) continue;
      compared++;
      expect(c.map((x) => x.key)).toContain('nw');
      expect(c.map((x) => x.key)).toContain('cs10');
      const d = c.find((x) => x.key === 'd');
      if (d && !d.even) expect(d.good).toBe(d.value < d.norm);
    }
    expect(compared).toBeGreaterThan(5);
  });
  it('one kill above a low norm is "about usual", not +100%', () => {
    const p = { ...parsed.players[0], kills: 2 };
    const c = compareToNorm({ ...parsed, duration: 600 }, p, 5, f).find((x) => x.key === 'k');
    if (c) expect(c.even).toBe(true);
  });
});

describe('match cache', () => {
  it('drops models of an older shape instead of returning them', async () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
    const { cachedMatch } = await import('./api');
    const { MODEL_VERSION } = await import('./model');
    const old = { ...parsed } as Partial<MatchModel>;
    delete old.wards;
    store.set('lp.matches.v1', JSON.stringify({ [parsed.id]: { at: 1, model: old } }));
    store.set('lp.matches', JSON.stringify({ [parsed.id]: { at: 1, model: old } }));
    expect(cachedMatch(parsed.id)).toBeNull();
    expect(store.has('lp.matches.v1')).toBe(false);
    store.set('lp.matches', JSON.stringify({ [parsed.id]: { at: 1, v: MODEL_VERSION, model: parsed } }));
    expect(cachedMatch(parsed.id)?.id).toBe(parsed.id);
  });

  it('analysis survives a model without the newer fields', () => {
    const old = { ...parsed, wards: undefined, teamfights: parsed.teamfights.map((f) => ({ ...f, players: undefined })) } as unknown as MatchModel;
    expect(wardSummary(old)).toBeNull();
    expect(fights(old)).toEqual([]);
  });
});

describe('OpenDota outage', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const keyOf = () => 'hero';

  it('a blocked / failed request while online is an OpenDota outage, not the viewer\'s network', async () => {
    // when OpenDota is down Cloudflare answers 522 without CORS headers: fetch just rejects
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    const err = await fetchMatch(123456789, keyOf).catch((e) => e);
    expect(err).toBeInstanceOf(MatchError);
    expect((err as MatchError).kind).toBe('server');
  });

  it('offline is the viewer\'s network', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('navigator', { onLine: false });
    const err = await fetchMatch(123456789, keyOf).catch((e) => e);
    expect((err as MatchError).kind).toBe('network');
  });
});
