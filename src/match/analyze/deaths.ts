import type { MatchModel, ObjectiveKind } from '../model';

export interface DeathCost {
  slot: number;
  time: number;
  /** What the enemy took within the window after it. */
  took: { roshan: number; tower: number; barracks: number; ancient: number };
  /** Late death before barracks / the Ancient fell, and no buyback in time. */
  noBuyback: boolean;
  score: number;
  /** Teammates who died in the same skirmish (± 20 s), this player first. */
  group: number[];
}

export interface BuybackUse { slot: number; time: number; /** The buyer's side then took an objective. */ paidOff: boolean }

export interface DeathsSummary {
  costly: DeathCost[];
  buybacks: BuybackUse[];
  /** Most deaths, then most time dead. */
  mostDead: { slot: number; deaths: number; deadSeconds: number | null } | null;
  /** Every death, for the timeline. */
  all: { slot: number; time: number }[];
}

export const DEATHS = { window: 90, lateMinute: 25, top: 3, skirmish: 20 } as const;
const WEIGHT: Record<Exclude<ObjectiveKind, 'firstblood'>, number> = { tower: 1, roshan: 3, barracks: 3, ancient: 10 };

/**
 * Which deaths cost the team the most: objectives the enemy took within 90 s
 * (towers 1, Roshan 3, barracks 3, the Ancient 10); ties go to the richer
 * hero. A buyback counts as paid off when the buyer's side took an
 * objective within the same 90 s.
 */
export function deaths(m: MatchModel): DeathsSummary | null {
  if (!m.parsed || m.players.some((p) => !p.deathTimes)) return null;
  const all = m.players.flatMap((p) => p.deathTimes!.map((time) => ({ slot: p.slot, time }))).sort((a, b) => a.time - b.time);
  const goldAt = (slot: number, t: number) => { const g = m.players[slot].goldT; return g ? g[Math.min(g.length - 1, Math.max(0, Math.floor(t / 60)))] ?? 0 : 0; };

  const costly: DeathCost[] = all.map(({ slot, time }) => {
    const radiant = m.players[slot].radiant;
    const after = m.objectives.filter((o) => o.radiant !== radiant && o.time > time && o.time <= time + DEATHS.window && o.kind !== 'firstblood');
    const took = { roshan: 0, tower: 0, barracks: 0, ancient: 0 };
    for (const o of after) took[o.kind as keyof typeof took]++;
    const score = took.tower * WEIGHT.tower + took.roshan * WEIGHT.roshan + took.barracks * WEIGHT.barracks + took.ancient * WEIGHT.ancient;
    const bought = m.players[slot].buybackTimes.some((b) => b >= time && b <= time + DEATHS.window);
    const noBuyback = time >= DEATHS.lateMinute * 60 && (took.barracks > 0 || took.ancient > 0) && !bought;
    const group = [slot, ...new Set(all.filter((x) => x.slot !== slot && m.players[x.slot].radiant === radiant && Math.abs(x.time - time) <= DEATHS.skirmish).map((x) => x.slot))];
    return { slot, time, took, noBuyback, score, group };
  }).filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || goldAt(b.slot, b.time) - goldAt(a.slot, a.time));

  // one death per moment: several heroes dying in the same push share the same objectives
  const picked: DeathCost[] = [];
  for (const d of costly) {
    if (picked.length >= DEATHS.top) break;
    if (picked.some((x) => m.players[x.slot].radiant === m.players[d.slot].radiant && Math.abs(x.time - d.time) < DEATHS.window)) continue;
    picked.push(d);
  }

  const buybacks: BuybackUse[] = m.players.flatMap((p) => p.buybackTimes.map((time) => ({
    slot: p.slot,
    time,
    paidOff: m.objectives.some((o) => o.radiant === p.radiant && o.time > time && o.time <= time + DEATHS.window && o.kind !== 'firstblood'),
  }))).sort((a, b) => a.time - b.time);

  const mostDead = [...m.players].sort((a, b) => b.deaths - a.deaths || (b.deadSeconds ?? 0) - (a.deadSeconds ?? 0))[0];
  return {
    costly: picked.sort((a, b) => a.time - b.time),
    buybacks,
    mostDead: mostDead && mostDead.deaths > 0 ? { slot: mostDead.slot, deaths: mostDead.deaths, deadSeconds: mostDead.deadSeconds } : null,
    all,
  };
}
