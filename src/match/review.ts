import { APP_CONFIG } from '../config';
import type { HeroGame } from '../player/api';
import { TURBO_MODE, type MatchPlayer, type ReviewStat } from './model';

/**
 * Match review: what went well, what to improve and the next focus for one
 * player in one match — measured against that player's own previous games on
 * the same hero. Every statement is a comparison of numbers; texts live in
 * the i18n strings keyed by metric / focus id, so the set can grow without
 * touching the card.
 */

export type ReviewMetricId = 'gpm' | 'xpm' | 'lastHits' | 'deaths' | 'ka' | 'damage' | 'towers' | 'healing';
export type FocusId = ReviewMetricId | 'keep' | 'steady';

/** One number of this match against the player's usual. */
export interface MetricReading {
  id: ReviewMetricId;
  /** This match (per minute / per 10 min as the metric defines). */
  value: number;
  /** The median of the previous games. */
  usual: number;
  /** Share of the previous games this match did better than (0..1; "fewer deaths" counts as better). */
  beats: number;
  /** Previous games with a known value for this metric. */
  sample: number;
}

export interface ReviewBase {
  heroId: number;
  /** Position 1–5 from the match analysis, null when unknown. */
  position: number | null;
  minutes: number;
  win: boolean;
}

export interface PersonalReview extends ReviewBase {
  kind: 'personal';
  /** Compared with games on the same lane, or with all games on the hero. */
  basis: 'lane' | 'hero';
  /** Previous games compared with. */
  sample: number;
  good: MetricReading | null;
  improve: MetricReading | null;
  focus: FocusId;
  readings: MetricReading[];
}

export type BasicReason = 'private' | 'fewGames' | 'shortMatch' | 'leaver' | 'unavailable';

export interface BasicReview extends ReviewBase {
  kind: 'basic';
  reason: BasicReason;
  /** Previous games found (for "fewGames"). */
  sample: number;
  stats: { kills: number; deaths: number; assists: number; gpm: number; xpm: number; lastHits: number; heroDamage: number };
}

export type MatchReview = PersonalReview | BasicReview;

/** One game's numbers; null = unknown (OpenDota had no value), never treated as zero. */
interface Line { kills: number; deaths: number; assists: number; gpm: number | null; xpm: number | null; lastHits: number | null; heroDamage: number | null; towerDamage: number | null; heroHealing: number | null; duration: number }

interface MetricDef {
  id: ReviewMetricId;
  /** Null when an input is unknown: that game is left out of this metric only. */
  of: (g: Line) => number | null;
  lowerIsBetter?: boolean;
  /** Skip at these positions (meaningless there). */
  skipAt?: number[];
  /** Judged only when the usual value reaches the floor. */
  floor?: number;
}

const perMin = (v: number | null, g: Line) => (v == null ? null : v / Math.max(1, g.duration / 60));

/** In priority order: on equal strength the earlier one is named. */
export const REVIEW_METRICS: MetricDef[] = [
  { id: 'deaths', of: (g) => 10 * perMin(g.deaths, g)!, lowerIsBetter: true },
  { id: 'gpm', of: (g) => g.gpm },
  { id: 'ka', of: (g) => 10 * perMin(g.kills + g.assists, g)! },
  { id: 'damage', of: (g) => perMin(g.heroDamage, g) },
  { id: 'xpm', of: (g) => g.xpm },
  { id: 'lastHits', of: (g) => perMin(g.lastHits, g), skipAt: [4, 5] },
  { id: 'towers', of: (g) => perMin(g.towerDamage, g), floor: APP_CONFIG.review.minSideRate },
  { id: 'healing', of: (g) => perMin(g.heroHealing, g), floor: APP_CONFIG.review.minSideRate },
];

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Share of `others` this value is better than; ties count half. */
export function beatsShare(value: number, others: number[], lowerIsBetter = false): number {
  if (!others.length) return 0.5;
  let score = 0;
  for (const o of others) {
    if (o === value) score += 0.5;
    else if (lowerIsBetter ? value < o : value > o) score += 1;
  }
  return score / others.length;
}

/** The shortest game worth comparing in a game mode. */
export const minDurationFor = (gameMode: number, cfg = APP_CONFIG.review) => (gameMode === TURBO_MODE ? cfg.minDurationSecTurbo : cfg.minDurationSec);

/** The previous games to compare with: before this match, full length, no leavers; same lane when enough. */
export function baseline(history: HeroGame[], match: { id: number; start: number; gameMode: number; laneRole: number | null }, cfg = APP_CONFIG.review): { games: HeroGame[]; basis: 'lane' | 'hero' } {
  // same game mode (the loader asks for it; checked again so Turbo never meets All Pick)
  const prev = history.filter((g) => g.gameMode === match.gameMode && g.matchId !== match.id && g.start < match.start && !g.leaver && g.duration >= minDurationFor(match.gameMode, cfg));
  if (match.laneRole != null) {
    const lane = prev.filter((g) => g.laneRole === match.laneRole);
    if (lane.length >= cfg.minGames) return { games: lane, basis: 'lane' };
  }
  return { games: prev, basis: 'hero' };
}

export function reviewMatch(input: {
  player: MatchPlayer;
  match: { id: number; start: number; duration: number; radiantWin: boolean; gameMode: number };
  position: number | null;
  /** The player's games on this hero; null = could not be loaded. */
  history: HeroGame[] | null;
}, cfg = APP_CONFIG.review): MatchReview {
  const { player: p, match: m } = input;
  const unknown = new Set<ReviewStat>(p.missing ?? []);
  const known = (k: ReviewStat) => (unknown.has(k) ? null : p[k]);
  const line: Line = {
    kills: p.kills, deaths: p.deaths, assists: p.assists, duration: m.duration,
    gpm: known('gpm'), xpm: known('xpm'), lastHits: known('lastHits'),
    heroDamage: known('heroDamage'), towerDamage: known('towerDamage'), heroHealing: known('heroHealing'),
  };
  const base: ReviewBase = { heroId: p.heroId, position: input.position, minutes: Math.round(m.duration / 60), win: p.radiant === m.radiantWin };
  const basic = (reason: BasicReason, sample = 0): BasicReview => ({
    ...base, kind: 'basic', reason, sample,
    stats: { kills: p.kills, deaths: p.deaths, assists: p.assists, gpm: p.gpm, xpm: p.xpm, lastHits: p.lastHits, heroDamage: p.heroDamage },
  });

  if (p.accountId == null) return basic('private');
  if (p.leaver) return basic('leaver');
  if (m.duration < minDurationFor(m.gameMode, cfg)) return basic('shortMatch');
  if (!input.history) return basic('unavailable');
  const { games, basis } = baseline(input.history, { id: m.id, start: m.start, gameMode: m.gameMode, laneRole: p.laneRole }, cfg);
  if (games.length < cfg.minGames) return basic('fewGames', games.length);

  const lines: Line[] = games.map((g) => ({ ...g }));
  const readings: MetricReading[] = [];
  for (const d of REVIEW_METRICS) {
    if (input.position != null && d.skipAt?.includes(input.position)) continue;
    const value = d.of(line);
    if (value == null) continue; // unknown in this match: no comparison
    const others = lines.map(d.of).filter((v): v is number => v != null);
    if (others.length < cfg.minGames) continue; // too few games with a real value
    const usual = median(others);
    if (d.floor != null && usual < d.floor) continue;
    readings.push({ id: d.id, value, usual, beats: beatsShare(value, others, d.lowerIsBetter), sample: others.length });
  }
  // the strongest on each side; REVIEW_METRICS order breaks ties
  const good = readings.filter((r) => r.beats >= cfg.goodShare).sort((a, b) => b.beats - a.beats)[0] ?? null;
  const improve = readings.filter((r) => r.beats <= cfg.badShare).sort((a, b) => a.beats - b.beats)[0] ?? null;
  return {
    ...base, kind: 'personal', basis, sample: games.length, good, improve, readings,
    focus: improve ? improve.id : good ? 'keep' : 'steady',
  };
}
