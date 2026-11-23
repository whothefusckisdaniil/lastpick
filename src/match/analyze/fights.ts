import type { MatchModel } from '../model';

export interface FightSummary {
  start: number;
  end: number;
  radiantDeaths: number;
  direDeaths: number;
  /** Gold change in Radiant's favour over the fight. */
  goldSwing: number;
  /** Side that won it: fewer deaths, else the gold swing; null = a trade. */
  radiantWon: boolean | null;
  /** The match winner's biggest fight win (by gold swing). */
  decisive: boolean;
  /** Who died, who killed (slots, most kills first), who dealt the most damage. */
  dead: number[];
  killers: { slot: number; kills: number }[];
  topDamage: number | null;
  buybacks: number[];
}

/** Below this swing a fight with equal deaths is called a trade. */
export const TRADE_GOLD = 600;

export function fights(m: MatchModel): FightSummary[] {
  const list: FightSummary[] = m.teamfights.map((f) => {
    const radiantWon = f.radiantDeaths !== f.direDeaths ? f.radiantDeaths < f.direDeaths
      : Math.abs(f.goldSwing) >= TRADE_GOLD ? f.goldSwing > 0 : null;
    const killers = f.players.map((p, slot) => ({ slot, kills: p.kills })).filter((x) => x.kills > 0).sort((a, b) => b.kills - a.kills);
    const dmg = f.players.map((p, slot) => ({ slot, d: p.damage })).sort((a, b) => b.d - a.d)[0];
    return {
      start: f.start,
      end: f.end,
      radiantDeaths: f.radiantDeaths,
      direDeaths: f.direDeaths,
      goldSwing: f.goldSwing,
      radiantWon,
      decisive: false,
      dead: f.dead,
      killers,
      topDamage: dmg && dmg.d > 0 ? dmg.slot : null,
      buybacks: f.players.flatMap((p, slot) => (p.buyback ? [slot] : [])),
    };
  });
  const forWinner = (f: FightSummary) => (m.radiantWin ? f.goldSwing : -f.goldSwing);
  const best = list.filter((f) => f.radiantWon === m.radiantWin).sort((a, b) => forWinner(b) - forWinner(a))[0];
  if (best && forWinner(best) > 0) best.decisive = true;
  return list;
}

/** Fights won by each side (trades not counted). */
export function fightScore(list: FightSummary[]): { radiant: number; dire: number } {
  return {
    radiant: list.filter((f) => f.radiantWon === true).length,
    dire: list.filter((f) => f.radiantWon === false).length,
  };
}
