import type { MatchModel, MatchWard } from '../model';

/** Observer ward lifetime when nothing destroys it (seconds). */
export const OBSERVER_LIFE = 360;

export interface TeamVision { obs: number; sen: number; /** Enemy wards this side destroyed. */ dewards: number; /** Seconds, observers only; null without any. */ obsLife: number | null }

export interface WardSummary {
  wards: MatchWard[];
  radiant: TeamVision;
  dire: TeamVision;
  /** Players who placed or destroyed wards, most active first. */
  players: { slot: number; obs: number; sen: number; dewards: number }[];
}

export function lifetime(w: MatchWard, duration: number): number {
  const end = w.end ?? Math.min(duration, w.time + (w.kind === 'obs' ? OBSERVER_LIFE : Infinity));
  return Math.max(0, end - w.time);
}

export function wardSummary(m: MatchModel): WardSummary | null {
  if (!m.parsed || !m.wards?.length) return null;
  const team = (radiant: boolean): TeamVision => {
    const own = m.wards.filter((w) => w.radiant === radiant);
    const obs = own.filter((w) => w.kind === 'obs');
    return {
      obs: obs.length,
      sen: own.length - obs.length,
      dewards: m.wards.filter((w) => w.radiant !== radiant && w.killedBy != null).length,
      obsLife: obs.length ? Math.round(obs.reduce((s, w) => s + lifetime(w, m.duration), 0) / obs.length) : null,
    };
  };
  const players = m.players.map((p) => ({
    slot: p.slot,
    obs: m.wards.filter((w) => w.slot === p.slot && w.kind === 'obs').length,
    sen: m.wards.filter((w) => w.slot === p.slot && w.kind === 'sen').length,
    dewards: m.wards.filter((w) => w.killedBy === p.slot).length,
  })).filter((x) => x.obs + x.sen + x.dewards > 0)
    .sort((a, b) => b.obs + b.sen + b.dewards - (a.obs + a.sen + a.dewards));
  return { wards: m.wards, radiant: team(true), dire: team(false), players };
}

/** Time windows for the map filter (minutes; `to` null = to the end). */
export const WARD_PHASES: { id: string; from: number; to: number | null }[] = [
  { id: 'all', from: 0, to: null },
  { id: '0-10', from: 0, to: 10 },
  { id: '10-20', from: 10, to: 20 },
  { id: '20-30', from: 20, to: 30 },
  { id: '30+', from: 30, to: null },
];

export function inPhase(w: MatchWard, phase: { from: number; to: number | null }): boolean {
  // wards placed before the horn (negative time) belong to the first phase
  return (phase.from === 0 || w.time >= phase.from * 60) && (phase.to == null || w.time < phase.to * 60);
}
