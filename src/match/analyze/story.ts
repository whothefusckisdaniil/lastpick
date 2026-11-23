import type { MatchModel, MatchObjective } from '../model';

/** How the game went, in one word, for the cover headline. */
export type StoryKind = 'comeback' | 'stomp' | 'close' | 'steady';

export interface Verdict {
  radiantWin: boolean;
  minute: number;
  kind: StoryKind;
  /** Biggest gold deficit the winner overcame (≥ 0). Null without a timeline. */
  deficit: number | null;
  /** Biggest gold lead the winner had. Null without a timeline. */
  maxLead: number | null;
  /** Kill score, winner first. */
  score: [number, number];
}

export const STORY = { comeback: 5000, stompLead: 15000, stompDeficit: 2000, close: 6000 } as const;

export function verdict(m: MatchModel): Verdict {
  const minute = Math.max(1, Math.round(m.duration / 60));
  const score: [number, number] = m.radiantWin ? [m.radiantScore, m.direScore] : [m.direScore, m.radiantScore];
  if (!m.goldAdv?.length) {
    // no timeline: only the kill score and the length
    const diff = score[0] - score[1];
    const kind: StoryKind = diff >= 20 && minute < 32 ? 'stomp' : Math.abs(diff) <= 4 ? 'close' : diff < 0 ? 'comeback' : 'steady';
    return { radiantWin: m.radiantWin, minute, kind, deficit: null, maxLead: null, score };
  }
  const forWinner = m.goldAdv.map((g) => (m.radiantWin ? g : -g));
  const deficit = Math.max(0, -Math.min(...forWinner));
  const maxLead = Math.max(0, ...forWinner);
  const kind: StoryKind = deficit >= STORY.comeback ? 'comeback'
    : deficit < STORY.stompDeficit && maxLead >= STORY.stompLead ? 'stomp'
      : maxLead < STORY.close ? 'close' : 'steady';
  return { radiantWin: m.radiantWin, minute, kind, deficit, maxLead, score };
}

export interface Swing {
  /** Minutes [from, to]. */
  from: number;
  to: number;
  /** Gold change in Radiant's favour (negative = Dire gained). */
  delta: number;
  roshan: boolean;
  towers: number;
  barracks: number;
  /** Biggest fight in the window. */
  fight: { radiantDeaths: number; direDeaths: number } | null;
}

export const SWING = { window: 2, minGold: 2500, count: 3 } as const;

/** The biggest gold swings over 2 minutes, with what happened then. */
export function swings(m: MatchModel): Swing[] {
  const adv = m.goldAdv;
  if (!adv || adv.length <= SWING.window) return [];
  const cands: { from: number; delta: number }[] = [];
  for (let t = 0; t + SWING.window < adv.length; t++) cands.push({ from: t, delta: adv[t + SWING.window] - adv[t] });
  cands.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const picked: { from: number; delta: number }[] = [];
  for (const c of cands) {
    if (Math.abs(c.delta) < SWING.minGold || picked.length >= SWING.count) break;
    if (picked.some((p) => Math.abs(p.from - c.from) <= SWING.window)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.from - b.from).map(({ from, delta }) => {
    const lo = from * 60 - 30;
    const hi = (from + SWING.window) * 60 + 30;
    const inWin = (o: MatchObjective) => o.time >= lo && o.time <= hi && o.radiant === delta > 0;
    const fights = m.teamfights.filter((f) => f.start <= hi && f.end >= lo);
    const big = fights.sort((a, b) => b.radiantDeaths + b.direDeaths - (a.radiantDeaths + a.direDeaths))[0];
    return {
      from,
      to: from + SWING.window,
      delta,
      roshan: m.objectives.some((o) => o.kind === 'roshan' && inWin(o)),
      towers: m.objectives.filter((o) => o.kind === 'tower' && inWin(o)).length,
      barracks: m.objectives.filter((o) => o.kind === 'barracks' && inWin(o)).length,
      fight: big && big.radiantDeaths + big.direDeaths >= 2 ? { radiantDeaths: big.radiantDeaths, direDeaths: big.direDeaths } : null,
    };
  });
}
