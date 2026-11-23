import type { MatchModel, MatchObjective, MatchPlayer, MatchTeamfight, PickBan } from './model';

/* Raw OpenDota /matches/{id} response — only the fields we read. */
type Num = number | null | undefined;
interface RawPlayer {
  player_slot: number;
  isRadiant?: boolean;
  hero_id: number;
  account_id?: Num;
  personaname?: string | null;
  rank_tier?: Num;
  kills?: Num; deaths?: Num; assists?: Num; last_hits?: Num; denies?: Num;
  gold_per_min?: Num; xp_per_min?: Num; net_worth?: Num;
  hero_damage?: Num; tower_damage?: Num; hero_healing?: Num; level?: Num;
  item_0?: Num; item_1?: Num; item_2?: Num; item_3?: Num; item_4?: Num; item_5?: Num;
  backpack_0?: Num; backpack_1?: Num; backpack_2?: Num; item_neutral?: Num;
  aghanims_scepter?: Num; aghanims_shard?: Num;
  leaver_status?: Num; abandons?: Num;
  lane_role?: Num; is_roaming?: boolean | null;
  purchase_log?: { time: number; key: string }[] | null;
  gold_t?: number[] | null; lh_t?: number[] | null; xp_t?: number[] | null; dn_t?: number[] | null;
  lane_efficiency?: Num; life_state_dead?: Num;
  kills_log?: { time: number; key: string }[] | null;
  buyback_log?: { time: number }[] | null;
  obs_placed?: Num; camps_stacked?: Num; stuns?: Num; teamfight_participation?: Num;
  benchmarks?: Record<string, { raw?: number; pct?: number } | undefined> | null;
}
export interface RawMatch {
  match_id: number;
  start_time?: number;
  duration?: number;
  radiant_win?: boolean;
  game_mode?: number;
  lobby_type?: number;
  patch?: Num;
  version?: Num;
  radiant_score?: Num;
  dire_score?: Num;
  picks_bans?: { is_pick: boolean; hero_id: number; team: number; order: number }[] | null;
  players?: RawPlayer[];
  radiant_gold_adv?: number[] | null;
  radiant_xp_adv?: number[] | null;
  objectives?: { time: number; type: string; key?: string | number; team?: number; slot?: number; player_slot?: number }[] | null;
  teamfights?: { start: number; end: number; players?: { deaths?: number; gold_delta?: number; damage?: number; buybacks?: number; killed?: Record<string, number> }[] }[] | null;
}

const n = (v: Num) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const opt = (v: Num) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isRadiantSlot = (playerSlot: number) => playerSlot < 128;

function objective(o: NonNullable<RawMatch['objectives']>[number]): MatchObjective | null {
  if (o.type === 'CHAT_MESSAGE_FIRSTBLOOD') {
    const s = o.player_slot ?? o.slot;
    return typeof s === 'number' ? { time: o.time, kind: 'firstblood', radiant: isRadiantSlot(s) } : null;
  }
  if (o.type === 'CHAT_MESSAGE_ROSHAN_KILL') {
    return o.team === 2 || o.team === 3 ? { time: o.time, kind: 'roshan', radiant: o.team === 2 } : null;
  }
  if (o.type === 'building_kill' && typeof o.key === 'string') {
    // the building's owner is in its name; the other side destroyed it (denies too, close enough)
    const radiant = o.key.includes('badguys');
    const kind = o.key.includes('tower') ? 'tower' : o.key.includes('rax') ? 'barracks' : o.key.includes('fort') ? 'ancient' : null;
    return kind ? { time: o.time, kind, radiant } : null;
  }
  return null;
}

/**
 * OpenDota → MatchModel. `heroKeyOf` maps a hero id to its npc key
 * (npc_dota_hero_*) — used to read deaths out of the killers' logs.
 */
export function normalizeMatch(raw: RawMatch, heroKeyOf: (heroId: number) => string | undefined): MatchModel {
  const rawPlayers = [...(raw.players ?? [])].sort((a, b) => a.player_slot - b.player_slot);
  const parsed = typeof raw.version === 'number' && raw.version > 0;

  // victim npc key → death times, from everyone's kills_log
  const deathsByKey = new Map<string, number[]>();
  if (parsed) {
    for (const p of rawPlayers) {
      for (const k of p.kills_log ?? []) {
        if (!k.key?.startsWith('npc_dota_hero_')) continue;
        const list = deathsByKey.get(k.key) ?? [];
        list.push(k.time);
        deathsByKey.set(k.key, list);
      }
    }
  }

  const players: MatchPlayer[] = rawPlayers.map((p, i) => {
    const b = p.benchmarks ?? {};
    const pct = (k: string) => opt(b[k]?.pct);
    const key = heroKeyOf(p.hero_id);
    const purchases = parsed && Array.isArray(p.purchase_log)
      ? p.purchase_log.filter((x) => typeof x.key === 'string' && typeof x.time === 'number').map((x) => ({ key: x.key, time: x.time }))
      : null;
    return {
      slot: i,
      radiant: p.isRadiant ?? isRadiantSlot(p.player_slot),
      heroId: p.hero_id,
      accountId: opt(p.account_id) || null,
      name: p.personaname || null,
      rankTier: opt(p.rank_tier) || null,
      kills: n(p.kills),
      deaths: n(p.deaths),
      assists: n(p.assists),
      lastHits: n(p.last_hits),
      denies: n(p.denies),
      gpm: n(p.gold_per_min),
      xpm: n(p.xp_per_min),
      netWorth: n(p.net_worth),
      heroDamage: n(p.hero_damage),
      towerDamage: n(p.tower_damage),
      heroHealing: n(p.hero_healing),
      level: n(p.level),
      items: [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5].map(n).filter((x) => x > 0),
      backpack: [p.backpack_0, p.backpack_1, p.backpack_2].map(n).filter((x) => x > 0),
      neutral: opt(p.item_neutral) || null,
      scepter: n(p.aghanims_scepter) > 0,
      shard: n(p.aghanims_shard) > 0,
      leaver: n(p.leaver_status) >= 2 || n(p.abandons) > 0,
      laneRole: parsed ? opt(p.lane_role) : null,
      roaming: !!p.is_roaming,
      purchases,
      goldT: parsed && Array.isArray(p.gold_t) ? p.gold_t : null,
      lhT: parsed && Array.isArray(p.lh_t) ? p.lh_t : null,
      xpT: parsed && Array.isArray(p.xp_t) ? p.xp_t : null,
      dnT: parsed && Array.isArray(p.dn_t) ? p.dn_t : null,
      laneEff: parsed ? opt(p.lane_efficiency) : null,
      deadSeconds: parsed ? opt(p.life_state_dead) : null,
      deathTimes: parsed && key ? (deathsByKey.get(key) ?? []).sort((x, y) => x - y) : null,
      buybackTimes: (p.buyback_log ?? []).map((x) => x.time).filter((t) => typeof t === 'number'),
      obsPlaced: parsed ? opt(p.obs_placed) : null,
      campsStacked: parsed ? opt(p.camps_stacked) : null,
      stuns: parsed ? opt(p.stuns) : null,
      teamfightShare: parsed ? opt(p.teamfight_participation) : null,
      bench: { gpm: pct('gold_per_min'), xpm: pct('xp_per_min'), lhpm: pct('last_hits_per_min'), damage: pct('hero_damage_per_min') },
    };
  });

  const picksBans: PickBan[] = (raw.picks_bans ?? []).map((x) => ({ heroId: x.hero_id, pick: x.is_pick, radiant: x.team === 0, order: x.order }))
    .sort((a, b) => a.order - b.order);

  const teamfights: MatchTeamfight[] = (raw.teamfights ?? []).flatMap((tf) => {
    const ps = tf.players ?? [];
    if (ps.length !== players.length) return [];
    let radiantDeaths = 0, direDeaths = 0, goldSwing = 0;
    const dead: number[] = [];
    const fighters = ps.map((x) => ({
      deaths: n(x.deaths),
      kills: Object.entries(x.killed ?? {}).reduce((sum, [k, v]) => sum + (k.startsWith('npc_dota_hero_') ? n(v) : 0), 0),
      goldDelta: n(x.gold_delta),
      damage: n(x.damage),
      buyback: n(x.buybacks) > 0,
    }));
    ps.forEach((x, i) => {
      const d = n(x.deaths);
      const r = players[i].radiant;
      if (d > 0) dead.push(i);
      if (r) radiantDeaths += d; else direDeaths += d;
      goldSwing += (r ? 1 : -1) * n(x.gold_delta);
    });
    return [{ start: tf.start, end: tf.end, radiantDeaths, direDeaths, goldSwing, dead, players: fighters }];
  });

  return {
    id: raw.match_id,
    startTime: n(raw.start_time),
    duration: n(raw.duration),
    radiantWin: !!raw.radiant_win,
    gameMode: n(raw.game_mode),
    lobbyType: n(raw.lobby_type),
    patchId: opt(raw.patch),
    parsed,
    radiantScore: n(raw.radiant_score) || players.filter((p) => p.radiant).reduce((s, p) => s + p.kills, 0),
    direScore: n(raw.dire_score) || players.filter((p) => !p.radiant).reduce((s, p) => s + p.kills, 0),
    picksBans,
    players,
    goldAdv: parsed && raw.radiant_gold_adv?.length ? raw.radiant_gold_adv : null,
    xpAdv: parsed && raw.radiant_xp_adv?.length ? raw.radiant_xp_adv : null,
    objectives: (raw.objectives ?? []).map(objective).filter((o): o is MatchObjective => !!o).sort((a, b) => a.time - b.time),
    teamfights,
  };
}

/** Match id from what people paste: a bare id, a Dotabuff / OpenDota / STRATZ link, `?match=`. */
export function parseMatchInput(text: string): number | null {
  const s = text.trim();
  const m = s.match(/(?:matches?[/=]|^|\D)(\d{9,11})(?:\D|$)/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
