import type { MatchModel, MatchPlayer } from '../model';

export type LaneId = 'bot' | 'mid' | 'top';

export interface LanePlayer { slot: number; gold: number; xp: number; lh: number; dn: number; eff: number | null }

export interface LaneResult {
  lane: LaneId;
  radiant: LanePlayer[];
  dire: LanePlayer[];
  /** Gold + XP at the laning minute of each side's richest hero there (the lane's core). */
  radiantValue: number;
  direValue: number;
  /** 'radiant' | 'dire' won the lane, 'even' within the margin. */
  winner: 'radiant' | 'dire' | 'even';
}

export interface Laning {
  minute: number;
  lanes: LaneResult[];
  /** Jungle / roaming players: not in any lane. */
  roamers: number[];
}

export const LANING = { minute: 10, margin: 0.15 } as const;

/**
 * Lane results at minute 10 from the parsed timelines. Radiant's safe lane
 * (bottom) meets Dire's off lane, mids meet, Radiant's off lane (top) meets
 * Dire's safe lane. The lane's cores are compared (gold + XP of the richest
 * hero on each side) — a 2 v 1 lane is not won by adding two heroes up. A side
 * is ahead when its core has ≥ 15% more.
 */
export function laning(m: MatchModel): Laning | null {
  if (!m.parsed || m.players.some((p) => !p.goldT || p.laneRole == null)) return null;
  const minute = Math.min(LANING.minute, ...m.players.map((p) => p.goldT!.length - 1));
  if (minute < 5) return null;
  const at = (arr: number[] | null) => (arr ? arr[Math.min(minute, arr.length - 1)] ?? 0 : 0);
  const row = (p: MatchPlayer): LanePlayer => ({ slot: p.slot, gold: at(p.goldT), xp: at(p.xpT), lh: at(p.lhT), dn: at(p.dnT), eff: p.laneEff });
  const inLane = (radiant: boolean, role: number) => m.players.filter((p) => p.radiant === radiant && p.laneRole === role && !p.roaming).map(row);
  const sum = (ps: LanePlayer[]) => Math.max(0, ...ps.map((p) => p.gold + p.xp));
  const lane = (id: LaneId, radiant: LanePlayer[], dire: LanePlayer[]): LaneResult => {
    const rv = sum(radiant);
    const dv = sum(dire);
    const winner = rv > dv * (1 + LANING.margin) ? 'radiant' : dv > rv * (1 + LANING.margin) ? 'dire' : 'even';
    return { lane: id, radiant, dire, radiantValue: rv, direValue: dv, winner };
  };
  const lanes = [
    lane('bot', inLane(true, 1), inLane(false, 3)),
    lane('mid', inLane(true, 2), inLane(false, 2)),
    lane('top', inLane(true, 3), inLane(false, 1)),
  ].filter((l) => l.radiant.length + l.dire.length > 0);
  const roamers = m.players.filter((p) => p.laneRole === 4 || p.roaming).map((p) => p.slot);
  return { minute, lanes, roamers };
}
