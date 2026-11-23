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
