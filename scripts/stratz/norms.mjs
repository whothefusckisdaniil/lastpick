/**
 * Hero norms per position and rank, for the match recap ("above / below the
 * usual for this hero at this position in this rank, at this minute").
 *
 * STRATZ heroStats.stats(groupByPosition, groupByTime) returns, per minute t,
 * the averages *at* minute t (networth, cs, xp, kills, deaths, assists, hero
 * damage — all cumulative) over the games still running then (`matchCount`).
 * We keep minutes 10, 20, 30, 40, 50; the app interpolates to the minute a
 * match ended. One request per minute and weekly bucket (the four brackets as
 * aliases): 5 × buckets requests (~10–25). Weighted by match count × bucket
 * weight; "ALL" adds the four brackets up (they partition the population).
 *
 * Output: public/builds/norms/<ALL | bracket>.json, one file per rank so the
 * page loads only the lobby's:
 *   { generatedAt, patch, rank, times, fields, minGames,
 *     heroes: { <heroId>: { <pos 1..5>: [games at 10, then `fields` × `times`] } } }
 * A minute with fewer than `minGames` games (few games reach 50) is null.
 */
import { BUCKET_SEC } from './buckets.mjs';

const POSITIONS = ['POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5'];

export const NORM_TIMES = [10, 20, 30, 40, 50];
/** [field in our file, STRATZ field]. */
const SPEC = [['nw', 'networth'], ['cs', 'cs'], ['dn', 'dn'], ['xp', 'xp'], ['k', 'kills'], ['d', 'deaths'], ['a', 'assists'], ['hd', 'heroDamage']];
export const NORM_FIELDS = SPEC.map((f) => f[0]);
/** Below this many (weighted) games a hero/position/rank/minute has no norm. */
export const NORM_MIN_GAMES = 100;

export function buildNormsQuery(heroIds, week, brackets, minute) {
  const fields = ['heroId', 'position', 'matchCount', ...SPEC.map((f) => f[1])].join(' ');
  const body = brackets
    .map((b) => `${b}: stats(heroIds: ${JSON.stringify(heroIds)}, week: ${week}, bracketBasicIds: [${b}], groupByPosition: true, groupByTime: true, minTime: ${minute}, maxTime: ${minute}) { ${fields} }`)
    .join('\n    ');
  return `{ heroStats {\n    ${body}\n  } }`;
}

/** acc[bracket][hero][pos][minute] = { w, sums } */
export function accumulateNorms(acc, response, brackets, weight, minute) {
  for (const b of brackets) {
    for (const row of response?.data?.heroStats?.[b] ?? []) {
      const p = POSITIONS.indexOf(row.position);
      const id = Number(row.heroId);
      const games = Number(row.matchCount ?? 0);
      if (p < 0 || !Number.isInteger(id) || !(games > 0)) continue;
      const cell = ((((acc[b] ??= {})[id] ??= {})[p + 1] ??= {})[minute] ??= { w: 0, sums: {} });
      const w = games * weight;
      cell.w += w;
      for (const [ours, theirs] of SPEC) {
        const v = Number(row[theirs]);
        if (Number.isFinite(v)) cell.sums[ours] = (cell.sums[ours] ?? 0) + v * w;
      }
    }
  }
  return acc;
}

const DIGITS = { nw: 0, cs: 1, dn: 1, xp: 0, k: 2, d: 2, a: 2, hd: 0 };
const round = (v, digits) => { const k = 10 ** digits; return Math.round(v * k) / k; };

/** { rank: { hero: { pos: row } } } with "ALL"; rows below the games floor dropped. */
export function finalizeNorms(acc, brackets, { minGames = NORM_MIN_GAMES } = {}) {
  const all = {};
  for (const b of brackets) {
    for (const [id, byPos] of Object.entries(acc[b] ?? {})) {
      for (const [p, byMin] of Object.entries(byPos)) {
        for (const [t, cell] of Object.entries(byMin)) {
          const dst = ((((all[id] ??= {})[p] ??= {})[t]) ??= { w: 0, sums: {} });
          dst.w += cell.w;
          for (const [k, v] of Object.entries(cell.sums)) dst.sums[k] = (dst.sums[k] ?? 0) + v;
        }
      }
    }
  }
  const out = {};
  for (const [rank, table] of [['ALL', all], ...brackets.map((b) => [b, acc[b] ?? {}])]) {
    out[rank] = {};
    for (const [id, byPos] of Object.entries(table)) {
      for (const [p, byMin] of Object.entries(byPos)) {
        const first = byMin[NORM_TIMES[0]];
        if (!first || first.w < minGames) continue;
        const row = [Math.round(first.w)];
        for (const t of NORM_TIMES) {
          const cell = byMin[t];
          for (const f of NORM_FIELDS) {
            row.push(cell && cell.w >= minGames && cell.sums[f] != null ? round(cell.sums[f] / cell.w, DIGITS[f]) : null);
          }
        }
        (out[rank][id] ??= {})[p] = row;
      }
    }
  }
  return out;
}

/** Fails on a thin or nonsensical result instead of publishing it. */
export function validateNorms(norms, heroIds, { minHeroes = 100 } = {}) {
  const all = norms.ALL ?? {};
  const covered = heroIds.filter((id) => all[id]).length;
  if (covered < Math.min(minHeroes, heroIds.length)) throw new Error(`norms cover only ${covered} heroes`);
  const at = (row, t, f) => row[1 + NORM_TIMES.indexOf(t) * NORM_FIELDS.length + NORM_FIELDS.indexOf(f)];
  for (const [id, byPos] of Object.entries(all)) {
    for (const [p, row] of Object.entries(byPos)) {
      const cs10 = at(row, 10, 'cs');
      const nw10 = at(row, 10, 'nw');
      if (cs10 == null || cs10 < 0 || cs10 > 150) throw new Error(`norms: hero ${id} pos ${p} cs@10 ${cs10}`);
      if (nw10 == null || nw10 < 600 || nw10 > 15000) throw new Error(`norms: hero ${id} pos ${p} networth@10 ${nw10}`);
      const nw20 = at(row, 20, 'nw');
      if (nw20 != null && nw20 < nw10) throw new Error(`norms: hero ${id} pos ${p} networth falls from minute 10 to 20`);
    }
  }
  return covered;
}

/** All requests for one run: one per minute and bucket. */
export async function fetchNorms(transport, heroIds, buckets, weights, brackets, { query = (q) => transport.query(q), log = console.log } = {}) {
  const acc = {};
  for (const bucket of buckets) {
    for (const minute of NORM_TIMES) {
      accumulateNorms(acc, await query(buildNormsQuery(heroIds, bucket * BUCKET_SEC, brackets, minute)), brackets, weights?.[bucket] ?? 1, minute);
    }
  }
  const norms = finalizeNorms(acc, brackets);
  const n = validateNorms(norms, heroIds);
  log(`    norms: ${n} heroes, ${buckets.length * NORM_TIMES.length} requests`);
  return norms;
}

/** One file per rank. */
export function normsFiles(norms, meta) {
  const generatedAt = new Date().toISOString();
  return Object.fromEntries(Object.entries(norms).map(([rank, heroes]) => [`${rank}.json`, {
    generatedAt, patch: meta.latestPatch, rank, times: NORM_TIMES, fields: NORM_FIELDS, minGames: NORM_MIN_GAMES, heroes,
  }]));
}
