import type { MatchModel, MatchPlayer } from '../model';

export type Pos = 1 | 2 | 3 | 4 | 5;

/**
 * Positions 1–5 per team. Parsed matches have each player's lane; the three
 * richest are the cores (mid = 2, safe lane = 1, off lane = 3), the other two
 * supports (off lane = 4, safe lane = 5). Without lanes it is net worth order
 * alone — `guessed` is then true and the UI says the position is approximate.
 */
export function positions(m: MatchModel): { bySlot: Map<number, Pos>; guessed: boolean } {
  const bySlot = new Map<number, Pos>();
  let guessed = false;
  for (const radiant of [true, false]) {
    const ps = m.players.filter((p) => p.radiant === radiant).sort((a, b) => b.netWorth - a.netWorth);
    const hasLanes = ps.every((p) => p.laneRole != null);
    if (!hasLanes) guessed = true;
    const cores = ps.slice(0, 3);
    const supports = ps.slice(3);
    const assign = (group: MatchPlayer[], wanted: [lane: number, pos: Pos][], order: Pos[]) => {
      const free = new Set(order);
      const left: MatchPlayer[] = [];
      for (const p of group) {
        const hit = hasLanes ? wanted.find(([lane, pos]) => lane === p.laneRole && free.has(pos)) : undefined;
        if (hit) { bySlot.set(p.slot, hit[1]); free.delete(hit[1]); } else left.push(p);
      }
      // the rest by net worth, in position order
      for (const p of left) { const pos = order.find((x) => free.has(x))!; bySlot.set(p.slot, pos); free.delete(pos); }
    };
    assign(cores, [[2, 2], [1, 1], [3, 3]], [1, 2, 3]);
    assign(supports, [[3, 4], [1, 5]], [4, 5]);
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
