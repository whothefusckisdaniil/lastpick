import { describe, expect, it } from 'vitest';
import { assertUpstreamHasData, upstreamOutageVerdict } from './update-data-stratz.mjs';

describe('STRATZ outage (empty weeks)', () => {
  const row = (g: number) => ({ hero_id: 2, games_played: g, wins: 0 });

  it('an all-zero window is an upstream outage, not a contract failure', () => {
    expect(() => assertUpstreamHasData({ 1: [row(0), row(0)], 2: [row(0)] })).toThrow(expect.objectContaining({ code: 'UPSTREAM_EMPTY' }));
  });

  it('a few 0-game pairs (a new hero) are fine', () => {
    expect(() => assertUpstreamHasData({ 1: [row(500), row(0)], 2: [row(300), row(40)] })).not.toThrow();
  });

  it('keeps recent data green, fails once it is stale', () => {
    const now = new Date('2026-11-23T06:00:00Z');
    expect(upstreamOutageVerdict('2026-11-21T10:56:45Z', now)).toBe('KEEP');
    expect(upstreamOutageVerdict('2026-11-18T10:56:45Z', now)).toBe('FAIL');
    expect(upstreamOutageVerdict('', now)).toBe('FAIL');
    expect(upstreamOutageVerdict('2026-11-15T00:00:00Z', now, 10)).toBe('KEEP');
  });
});

import { zeroPairShare, SYNERGY_MAX_ZERO_SHARE } from './update-data-stratz.mjs';
import synergyAll from '../public/data/synergy.json';
import synergyByBracket from '../public/data/synergy-by-bracket.json';

describe('degraded same-team data', () => {
  const r = (h: number, g: number) => ({ hero_id: h, games_played: g, wins: 0 });
  it('counts 0-game pairs, a brand-new hero left out', () => {
    expect(zeroPairShare({ 1: [r(2, 0), r(3, 10)], 2: [r(1, 0), r(3, 5)] })).toBe(0.5);
    expect(zeroPairShare({ 1: [r(2, 0), r(3, 10)], 2: [r(1, 0), r(3, 5)] }, [2])).toBe(0);
  });

  it('the published synergy is healthy in every rank', () => {
    expect(zeroPairShare(synergyAll)).toBeLessThanOrEqual(SYNERGY_MAX_ZERO_SHARE);
    for (const t of Object.values(synergyByBracket)) expect(zeroPairShare(t)).toBeLessThanOrEqual(SYNERGY_MAX_ZERO_SHARE);
  });
});
