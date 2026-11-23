/**
 * Our own model of a finished match. Everything in src/match works on this,
 * never on the raw OpenDota response: if OpenDota ever stops being enough,
 * only normalize.ts changes.
 */

export interface MatchPurchase { key: string; time: number }

export interface MatchPlayer {
  /** 0..4 Radiant, 5..9 Dire. */
  slot: number;
  radiant: boolean;
  heroId: number;
  /** Null when the profile is private. */
  accountId: number | null;
  name: string | null;
  /** OpenDota rank tier (e.g. 74 = Divine 4), null when unknown. */
  rankTier: number | null;
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
  gpm: number;
  xpm: number;
  netWorth: number;
  heroDamage: number;
  towerDamage: number;
  heroHealing: number;
  level: number;
  /** Final inventory (item ids, empty slots dropped). */
  items: number[];
  backpack: number[];
  neutral: number | null;
  scepter: boolean;
  shard: boolean;
  /** Abandoned the game. */
  leaver: boolean;
  /** Parsed only: 1 safe, 2 mid, 3 off, 4 jungle. */
  laneRole: number | null;
  roaming: boolean;
  /** Parsed only. */
  purchases: MatchPurchase[] | null;
  /** Parsed only: gold / last hits by minute. */
  goldT: number[] | null;
  lhT: number[] | null;
  /** Parsed only: when the player died (seconds). */
  deathTimes: number[] | null;
  buybackTimes: number[];
  obsPlaced: number | null;
  campsStacked: number | null;
  stuns: number | null;
  /** 0..1, parsed only. */
  teamfightShare: number | null;
  /** OpenDota per-hero percentiles (0..1) over all ranks. */
  bench: { gpm: number | null; xpm: number | null; lhpm: number | null; damage: number | null };
}

export type ObjectiveKind = 'firstblood' | 'roshan' | 'tower' | 'barracks' | 'ancient';

export interface MatchObjective {
  time: number;
  kind: ObjectiveKind;
  /** Side that got it (killed the building, Roshan, drew first blood). */
  radiant: boolean;
}

export interface MatchTeamfight {
  start: number;
  end: number;
  radiantDeaths: number;
  direDeaths: number;
  /** Gold change of Radiant minus Dire over the fight. */
  goldSwing: number;
  /** Slots of players who died in it. */
  dead: number[];
}

export interface PickBan { heroId: number; pick: boolean; radiant: boolean; order: number }

export interface MatchModel {
  id: number;
  startTime: number;
  duration: number;
  radiantWin: boolean;
  gameMode: number;
  lobbyType: number;
  patchId: number | null;
  /** Replay parsed: timelines, purchases, teamfights. */
  parsed: boolean;
  radiantScore: number;
  direScore: number;
  picksBans: PickBan[];
  players: MatchPlayer[];
  /** Per minute, Radiant minus Dire. Parsed only. */
  goldAdv: number[] | null;
  xpAdv: number[] | null;
  objectives: MatchObjective[];
  teamfights: MatchTeamfight[];
}

/** All Pick, Captains Mode, Random/Single/Captains Draft, Ranked All Pick. */
const DRAFT_MODES = new Set([1, 2, 3, 4, 8, 16, 22]);

/** Modes where a draft verdict makes sense (not Turbo, Ability Draft, customs). */
export function hasRealDraft(m: Pick<MatchModel, 'gameMode' | 'players'>): boolean {
  return DRAFT_MODES.has(m.gameMode) && m.players.length === 10;
}

export const team = (m: MatchModel, radiant: boolean) => m.players.filter((p) => p.radiant === radiant);
