import type { MatchModel, MatchPlayer } from './model';

/**
 * Hero norms from STRATZ (public/builds/norms/<rank>.json, written by
 * scripts/stratz/norms.mjs): averages at minutes 10–50 per hero, position and
 * rank, for the games still running at that minute.
 */
export interface NormFile {
  generatedAt: string;
  patch: string;
  rank: string;
  times: number[];
  fields: string[];
  minGames: number;
  heroes: Record<string, Record<string, (number | null)[]>>;
}

export type NormField = 'nw' | 'cs' | 'dn' | 'xp' | 'k' | 'd' | 'a' | 'hd';

const cache = new Map<string, Promise<NormFile | null>>();

export function loadNorms(rank: string): Promise<NormFile | null> {
  let p = cache.get(rank);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}builds/norms/${rank}.json`)
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<NormFile>) : null))
      .catch(() => null);
    cache.set(rank, p);
  }
  return p;
}

/** Games behind a hero/position norm (at minute 10), 0 when none. */
export function normGames(f: NormFile, heroId: number, pos: number): number {
  return f.heroes[heroId]?.[pos]?.[0] ?? 0;
}

/**
 * The norm of `field` at `minute`: linear between the stored minutes; before
 * the first one from 0 at minute 0 (all fields are cumulative); after the
 * last available one along the last slope. Null without data.
 */
export function normAt(f: NormFile, heroId: number, pos: number, field: NormField, minute: number): number | null {
  const row = f.heroes[heroId]?.[pos];
  const fi = f.fields.indexOf(field);
  if (!row || fi < 0) return null;
  const pts: [number, number][] = [];
  f.times.forEach((t, k) => { const v = row[1 + k * f.fields.length + fi]; if (v != null) pts.push([t, v]); });
  if (!pts.length) return null;
  if (minute <= pts[0][0]) return (pts[0][1] * Math.max(0, minute)) / pts[0][0];
  for (let k = 1; k < pts.length; k++) {
    const [t0, v0] = pts[k - 1];
    const [t1, v1] = pts[k];
    if (minute <= t1) return v0 + ((v1 - v0) * (minute - t0)) / (t1 - t0);
  }
  if (pts.length === 1) return (pts[0][1] * minute) / pts[0][0];
  const [ta, va] = pts[pts.length - 2];
  const [tb, vb] = pts[pts.length - 1];
  return vb + ((vb - va) * (minute - tb)) / (tb - ta);
}

export type CompareKey = 'nw' | 'cs' | 'k' | 'd' | 'a' | 'hd' | 'cs10' | 'xp10';

export interface NormCompare {
  key: CompareKey;
  /** Minute the values are compared at. */
  minute: number;
  value: number;
  norm: number;
  /** value / norm − 1 (e.g. +0.12 = 12% above). */
  diff: number;
  /** Better than the norm (fewer deaths is better). */
  good: boolean;
  /** Close to the norm: within 10%, or for kills / deaths / assists within
   *  max(1.5, 25%) — one kill more is not "50% above". */
  even: boolean;
}

/** Below this difference a value is "about usual". */
export const NORM_EVEN = 0.1;

/**
 * A player against the norm for the hero, position and rank: at the minute
 * the match ended (net worth, last hits, K / D / A, hero damage) and, with a
 * parsed replay, at minute 10 (last hits, XP).
 */
export function compareToNorm(m: MatchModel, p: MatchPlayer, pos: number, f: NormFile): NormCompare[] {
  const end = m.duration / 60;
  const out: NormCompare[] = [];
  const push = (key: CompareKey, field: NormField, minute: number, value: number | null | undefined) => {
    if (value == null) return;
    const norm = normAt(f, p.heroId, pos, field, minute);
    if (norm == null || norm <= 0) return;
    const diff = value / norm - 1;
    const even = key === 'k' || key === 'd' || key === 'a' ? Math.abs(value - norm) < Math.max(1.5, norm * 0.25) : Math.abs(diff) < NORM_EVEN;
    out.push({ key, minute: Math.round(minute), value, norm, diff, good: key === 'd' ? diff < 0 : diff > 0, even });
  };
  if (m.parsed && end >= 10) {
    push('cs10', 'cs', 10, p.lhT?.[10]);
    push('xp10', 'xp', 10, p.xpT?.[10]);
  }
  push('nw', 'nw', end, p.netWorth);
  push('cs', 'cs', end, p.lastHits);
  push('hd', 'hd', end, p.heroDamage);
  push('k', 'k', end, p.kills);
  push('d', 'd', end, p.deaths);
  push('a', 'a', end, p.assists);
  return out;
}
