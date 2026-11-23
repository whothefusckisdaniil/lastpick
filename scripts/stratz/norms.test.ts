import { describe, expect, it } from 'vitest';
import { accumulateNorms, buildNormsQuery, finalizeNorms, NORM_FIELDS, NORM_TIMES, normsFiles, validateNorms } from './norms.mjs';

const BR = ['HERALD_GUARDIAN', 'DIVINE_IMMORTAL'];
const row = (heroId: number, position: string, matchCount: number, networth: number, cs: number) => ({ heroId, position, matchCount, networth, cs, dn: 5, xp: networth, kills: 2, deaths: 1, assists: 3, heroDamage: 2000 });
const res = (rows: Record<string, unknown[]>) => ({ data: { heroStats: rows } });

describe('STRATZ hero norms', () => {
  it('one alias per bracket, at one minute, grouped by position and time', () => {
    const q = buildNormsQuery([1, 2], 123, BR, 20);
    expect(q).toContain('HERALD_GUARDIAN: stats(heroIds: [1,2], week: 123, bracketBasicIds: [HERALD_GUARDIAN], groupByPosition: true, groupByTime: true, minTime: 20, maxTime: 20)');
    expect(q).toContain('networth cs dn xp kills deaths assists heroDamage');
  });

  it('weights by games × bucket weight; ALL adds the brackets up', () => {
    const acc = {};
    for (const t of NORM_TIMES) {
      accumulateNorms(acc, res({ HERALD_GUARDIAN: [row(1, 'POSITION_1', 300, 3000 * t / 10, 30 * t / 10)], DIVINE_IMMORTAL: [row(1, 'POSITION_1', 100, 4000 * t / 10, 50 * t / 10)] }), BR, 1, t);
    }
    const n = finalizeNorms(acc, BR);
    const at = (r: (number | null)[], t: number, f: string) => r[1 + NORM_TIMES.indexOf(t) * NORM_FIELDS.length + NORM_FIELDS.indexOf(f)];
    expect(n.HERALD_GUARDIAN[1][1][0]).toBe(300);
    expect(at(n.DIVINE_IMMORTAL[1][1], 10, 'nw')).toBe(4000);
    expect(at(n.ALL[1][1], 10, 'nw')).toBe(3250); // (3000·300 + 4000·100) / 400
    expect(at(n.ALL[1][1], 20, 'cs')).toBe(70);
  });

  it('drops thin rows and thin minutes', () => {
    const acc = {};
    accumulateNorms(acc, res({ HERALD_GUARDIAN: [row(1, 'POSITION_1', 50, 3000, 30), row(2, 'POSITION_5', 500, 1800, 5), row(3, 'UNKNOWN', 900, 1, 1)] }), BR, 1, 10);
    accumulateNorms(acc, res({ HERALD_GUARDIAN: [row(2, 'POSITION_5', 20, 5000, 20)] }), BR, 1, 50);
    const n = finalizeNorms(acc, BR);
    expect(n.HERALD_GUARDIAN[1]).toBeUndefined();
    expect(n.HERALD_GUARDIAN[3]).toBeUndefined();
    const r = n.HERALD_GUARDIAN[2][5];
    expect(r[1 + NORM_TIMES.indexOf(50) * NORM_FIELDS.length]).toBeNull();
  });

  it('validation rejects thin coverage and impossible values', () => {
    const ok = { ALL: { 1: { 1: [500, ...NORM_TIMES.flatMap((t) => [t * 300, t * 4, 1, t * 300, 1, 1, 1, t * 100])] } } };
    expect(validateNorms(ok, [1], { minHeroes: 1 })).toBe(1);
    expect(() => validateNorms(ok, [1, 2, 3], { minHeroes: 3 })).toThrow(/cover only 1/);
    const bad = { ALL: { 1: { 1: [500, ...NORM_TIMES.flatMap(() => [100, 4, 1, 1, 1, 1, 1, 1])] } } };
    expect(() => validateNorms(bad, [1], { minHeroes: 1 })).toThrow(/networth@10/);
  });

  it('one file per rank', () => {
    const files = normsFiles({ ALL: {}, DIVINE_IMMORTAL: {} }, { latestPatch: '7.42' });
    expect(Object.keys(files)).toEqual(['ALL.json', 'DIVINE_IMMORTAL.json']);
    expect(files['ALL.json']).toMatchObject({ rank: 'ALL', patch: '7.42', times: NORM_TIMES, fields: NORM_FIELDS });
  });
});
