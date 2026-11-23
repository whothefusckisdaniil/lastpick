import type { MatchModel, MatchPlayer } from '../model';

export type Pos = 1 | 2 | 3 | 4 | 5;

/**
 * Positions 1–5 per team. With a parsed replay the lanes decide first: the
 * mid laner is 2; the richer hero of the safe lane 1 and the other 5; the
 * richer of the off lane 3 and the other 4 (a poor mid is still the mid).
 * Whoever is left (a third hero in a lane, junglers, roamers) fills the free
 * positions by net worth, cores first. Without lanes it is net worth order
 * alone — `guessed` is then true and the UI says the position is approximate.
 */
export function positions(m: MatchModel): { bySlot: Map<number, Pos>; guessed: boolean } {
  const bySlot = new Map<number, Pos>();
  let guessed = false;
  for (const radiant of [true, false]) {
    const ps = m.players.filter((p) => p.radiant === radiant).sort((a, b) => b.netWorth - a.netWorth);
    const hasLanes = ps.every((p) => p.laneRole != null);
    if (!hasLanes) guessed = true;
    const free = new Set<Pos>([1, 2, 3, 4, 5]);
    const take = (p: MatchPlayer | undefined, pos: Pos) => {
      if (!p || bySlot.has(p.slot) || !free.has(pos)) return;
      bySlot.set(p.slot, pos);
      free.delete(pos);
    };
    if (hasLanes) {
      const lane = (role: number) => ps.filter((p) => p.laneRole === role && !p.roaming);
      take(lane(2)[0], 2);
      take(lane(1)[0], 1);
      take(lane(1)[1], 5);
      take(lane(3)[0], 3);
      take(lane(3)[1], 4);
    }
    // the rest by net worth into the free positions, in position order
    for (const p of ps) {
      if (bySlot.has(p.slot)) continue;
      take(p, [...free].sort((a, b) => a - b)[0]);
    }
  }
  return { bySlot, guessed };
}

export interface TeamEconomy {
  netWorth: number;
  /** Each player's share of the team's net worth, by slot. */
  share: Map<number, number>;
}

export function economy(m: MatchModel): { radiant: TeamEconomy; dire: TeamEconomy; leader: MatchPlayer; carried: MatchPlayer } {
  const side = (radiant: boolean): TeamEconomy => {
    const ps = m.players.filter((p) => p.radiant === radiant);
    const total = ps.reduce((s, p) => s + p.netWorth, 0) || 1;
    return { netWorth: total, share: new Map(ps.map((p) => [p.slot, p.netWorth / total])) };
  };
  const radiant = side(true);
  const dire = side(false);
  const leader = [...m.players].sort((a, b) => b.netWorth - a.netWorth)[0];
  const winners = m.players.filter((p) => p.radiant === m.radiantWin);
  const wShare = m.radiantWin ? radiant.share : dire.share;
  const carried = [...winners].sort((a, b) => (wShare.get(b.slot) ?? 0) - (wShare.get(a.slot) ?? 0))[0];
  return { radiant, dire, leader, carried };
}

/** Kill participation 0..1. */
export function killShare(m: MatchModel, p: MatchPlayer): number {
  const kills = p.radiant ? m.radiantScore : m.direScore;
  return kills > 0 ? Math.min(1, (p.kills + p.assists) / kills) : 0;
}

/**
 * MVP score — a rough, labelled-as-such blend: KDA, kill participation,
 * share of the team's hero damage and of its net worth; winners get +10%.
 */
export function mvpScore(m: MatchModel, p: MatchPlayer): number {
  const mates = m.players.filter((x) => x.radiant === p.radiant);
  const dmg = mates.reduce((s, x) => s + x.heroDamage, 0) || 1;
  const nw = mates.reduce((s, x) => s + x.netWorth, 0) || 1;
  const kda = Math.min((p.kills + p.assists) / Math.max(1, p.deaths), 10) / 10;
  const score = 0.35 * kda + 0.25 * killShare(m, p) + 0.2 * (p.heroDamage / dmg) * 2.5 + 0.2 * (p.netWorth / nw) * 2.5;
  return score * (p.radiant === m.radiantWin ? 1.1 : 1);
}

export type AwardId = 'mvp' | 'farm' | 'killer' | 'team' | 'damage' | 'pusher' | 'healer' | 'eyes' | 'stacker' | 'control' | 'tavern' | 'buyback';

export interface Award { id: AwardId; slot: number; value: number }

/** Thresholds below which an award is not given (nobody stood out). */
const AWARDS: { id: AwardId; value: (m: MatchModel, p: MatchPlayer) => number | null; min: number }[] = [
  { id: 'mvp', value: (m, p) => mvpScore(m, p), min: 0 },
  { id: 'farm', value: (_, p) => p.lastHits, min: 150 },
  { id: 'killer', value: (_, p) => p.kills, min: 8 },
  { id: 'team', value: (m, p) => killShare(m, p), min: 0.7 },
  { id: 'damage', value: (_, p) => p.heroDamage, min: 15000 },
  { id: 'pusher', value: (_, p) => p.towerDamage, min: 5000 },
  { id: 'healer', value: (_, p) => p.heroHealing, min: 3000 },
  { id: 'eyes', value: (_, p) => p.obsPlaced, min: 8 },
  { id: 'stacker', value: (_, p) => p.campsStacked, min: 4 },
  { id: 'control', value: (_, p) => p.stuns, min: 40 },
  { id: 'tavern', value: (_, p) => p.deaths, min: 9 },
  { id: 'buyback', value: (_, p) => p.buybackTimes.length, min: 2 },
];

/** Fun but computed awards; one player gets at most two. */
export function awards(m: MatchModel): Award[] {
  const out: Award[] = [];
  const count = new Map<number, number>();
  for (const a of AWARDS) {
    const ranked = m.players
      .map((p) => ({ p, v: a.value(m, p) }))
      .filter((x): x is { p: MatchPlayer; v: number } => x.v != null && x.v >= a.min && (a.id === 'mvp' || x.v > 0))
      .sort((x, y) => y.v - x.v);
    const best = ranked.find((x) => (count.get(x.p.slot) ?? 0) < 2 && (a.id !== 'tavern' || x.v > ranked[0].v - 1));
    if (!best) continue;
    out.push({ id: a.id, slot: best.p.slot, value: best.v });
    count.set(best.p.slot, (count.get(best.p.slot) ?? 0) + 1);
  }
  return out;
}

/** Average rank of the lobby → STRATZ bracket for the draft tables. */
export function lobbyBracket(m: MatchModel): string | null {
  const tiers = m.players.map((p) => p.rankTier).filter((x): x is number => !!x && x >= 10);
  if (tiers.length < 3) return null;
  const medal = Math.round(tiers.reduce((s, x) => s + Math.floor(x / 10), 0) / tiers.length);
  return medal <= 2 ? 'HERALD_GUARDIAN' : medal <= 4 ? 'CRUSADER_ARCHON' : medal <= 6 ? 'LEGEND_ANCIENT' : 'DIVINE_IMMORTAL';
}

/** Medal 1..8 (Herald..Immortal) of the lobby, null when unknown. */
export function lobbyMedal(m: MatchModel): number | null {
  const tiers = m.players.map((p) => p.rankTier).filter((x): x is number => !!x && x >= 10);
  if (tiers.length < 3) return null;
  return Math.round(tiers.reduce((s, x) => s + Math.floor(x / 10), 0) / tiers.length);
}
