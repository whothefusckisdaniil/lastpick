import type { RecentGame } from './poolStats';
import type { HistoryGame, Patch } from './v3';
/**
 * Player profile from OpenDota, straight from the browser (CORS is open; the
 * limits are per viewer IP, so the site spends nothing). Four requests in
 * parallel: /players/{id}, /wl, /heroes and /heroes?date=90 (the last 90 days,
 * to tell "played once" from "plays now"). Cached in localStorage for a few
 * hours; an older copy is shown when OpenDota is over the limit or down.
 */
const API = 'https://api.opendota.com/api';
const CACHE_KEY = 'lp.players';
const CACHE_MAX = 5;
export const PROFILE_TTL_MS = 6 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 15000;
/** Bump when the stored shape changes. */
const CACHE_VERSION = 1;

export type PlayerErrorKind = 'notFound' | 'rateLimit' | 'network' | 'server';
export class PlayerError extends Error {
  constructor(public kind: PlayerErrorKind) { super(kind); }
}

export interface PlayerHero {
  heroId: number;
  games: number;
  win: number;
  /** Unix seconds, 0 = never. */
  lastPlayed: number;
}

export interface PlayerProfile {
  id: number;
  name: string;
  avatar: string | null;
  rankTier: number | null;
  leaderboard: number | null;
  /** OpenDota has no match history for this account ("Expose Public Match Data" off). */
  hidden: boolean;
  win: number;
  lose: number;
  /** Heroes with at least one game, most played first. */
  heroes: PlayerHero[];
  /** Same, last 90 days. */
  heroes90: PlayerHero[];
  /** Unix seconds of the last game OpenDota knows, null without any. */
  lastPlayed: number | null;
  fetchedAt: number;
}

/** Raw OpenDota shapes (only the fields we read). */
export interface RawPlayer {
  profile: { account_id: number; personaname: string | null; avatarfull: string | null; fh_unavailable?: boolean } | null;
  rank_tier: number | null;
  leaderboard_rank: number | null;
}
export interface RawHeroRow { hero_id: number | string; games: number; win: number; last_played: number }
export interface RawSearchRow { account_id: number; personaname: string | null; avatarfull: string | null; last_match_time?: string | null }

const heroesOf = (rows: RawHeroRow[]): PlayerHero[] =>
  rows.filter((r) => r.games > 0)
    .map((r) => ({ heroId: Number(r.hero_id), games: r.games, win: r.win, lastPlayed: r.last_played ?? 0 }))
    .sort((a, b) => b.games - a.games);

/** OpenDota answers → our profile; null = no such account. */
export function normalizeProfile(id: number, p: RawPlayer, wl: { win: number; lose: number }, heroes: RawHeroRow[], heroes90: RawHeroRow[], now = Date.now()): PlayerProfile | null {
  const hs = heroesOf(heroes);
  // an id OpenDota knows nothing about still returns a profile, with no name
  if (!p?.profile || (!p.profile.personaname && hs.length === 0)) return null;
  const last = hs.reduce((m, h) => Math.max(m, h.lastPlayed), 0);
  return {
    id,
    name: p.profile.personaname || `#${id}`,
    avatar: p.profile.avatarfull || null,
    rankTier: p.rank_tier ?? null,
    leaderboard: p.leaderboard_rank ?? null,
    hidden: !!p.profile.fh_unavailable || (wl.win + wl.lose === 0 && hs.length === 0),
    win: wl.win,
    lose: wl.lose,
    heroes: hs,
    heroes90: heroesOf(heroes90),
    lastPlayed: last > 0 ? last : null,
    fetchedAt: now,
  };
}

function failedKind(): PlayerErrorKind {
  return typeof navigator !== 'undefined' && navigator.onLine === false ? 'network' : 'server';
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined;
  try { res = await fetch(`${API}${path}`, { signal }); } catch { throw new PlayerError(failedKind()); }
  if (res.status === 429) throw new PlayerError('rateLimit');
  if (res.status === 400 || res.status === 404) throw new PlayerError('notFound');
  if (!res.ok) throw new PlayerError('server');
  return res.json() as Promise<T>;
}

type Cached = { v: number; profile: PlayerProfile };

function readCache(): Record<string, Cached> {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, Cached>;
    return Object.fromEntries(Object.entries(all).filter(([, c]) => c?.v === CACHE_VERSION && c.profile?.id));
  } catch {
    return {};
  }
}

function writeCache(p: PlayerProfile) {
  try {
    const all = readCache();
    all[p.id] = { v: CACHE_VERSION, profile: p };
    const keep = Object.entries(all).sort((a, b) => b[1].profile.fetchedAt - a[1].profile.fetchedAt).slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* storage full or blocked */ }
}

export function cachedProfile(id: number): PlayerProfile | null {
  return readCache()[id]?.profile ?? null;
}

export function clearPlayerCache() {
  try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem('lp.playerRecent'); localStorage.removeItem('lp.patches'); localStorage.removeItem(HISTORY_KEY); localStorage.removeItem('lp.heroGames'); } catch { /* ignore */ }
}

/**
 * The profile: from the cache while it is fresh (unless `fresh`), otherwise
 * from OpenDota; on a rate limit or an outage the cached copy, however old.
 */
export async function fetchProfile(id: number, opts: { fresh?: boolean; now?: number } = {}): Promise<{ profile: PlayerProfile; stale: boolean }> {
  const now = opts.now ?? Date.now();
  const hit = cachedProfile(id);
  if (hit && !opts.fresh && now - hit.fetchedAt < PROFILE_TTL_MS) return { profile: hit, stale: false };
  try {
    const [p, wl, heroes, heroes90] = await Promise.all([
      get<RawPlayer>(`/players/${id}`),
      get<{ win: number; lose: number }>(`/players/${id}/wl`),
      get<RawHeroRow[]>(`/players/${id}/heroes`),
      get<RawHeroRow[]>(`/players/${id}/heroes?date=90`),
    ]);
    const profile = normalizeProfile(id, p, wl, heroes ?? [], heroes90 ?? [], now);
    if (!profile) throw new PlayerError('notFound');
    writeCache(profile);
    return { profile, stale: false };
  } catch (e) {
    if (hit && e instanceof PlayerError && e.kind !== 'notFound') return { profile: hit, stale: true };
    throw e;
  }
}

export interface SearchHit { id: number; name: string; avatar: string | null; lastMatch: string | null }

/** Nickname search (OpenDota /search): at most `limit` hits, the closest first. */
export async function searchPlayers(q: string, limit = 12): Promise<SearchHit[]> {
  const rows = await get<RawSearchRow[]>(`/search?q=${encodeURIComponent(q)}`);
  return (rows ?? []).slice(0, limit).map((r) => ({ id: r.account_id, name: r.personaname || `#${r.account_id}`, avatar: r.avatarfull || null, lastMatch: r.last_match_time ?? null }));
}

export interface RawRecentMatch { match_id: number; player_slot: number; radiant_win: boolean; hero_id: number; start_time: number; kills: number; deaths: number; assists: number }

const RECENT_KEY = 'lp.playerRecent';

/** Raw /recentMatches → our games, newest first. Radiant slots are 0–127. */
export function normalizeRecent(rows: RawRecentMatch[]): RecentGame[] {
  return (rows ?? [])
    .map((r) => ({ matchId: r.match_id, heroId: r.hero_id, win: (r.player_slot < 128) === !!r.radiant_win, start: r.start_time, kills: r.kills, deaths: r.deaths, assists: r.assists }))
    .sort((a, b) => b.start - a.start);
}

/** The last 20 matches (OpenDota /recentMatches), cached like the profile. */
export async function fetchRecent(id: number, opts: { fresh?: boolean; now?: number } = {}): Promise<RecentGame[]> {
  const now = opts.now ?? Date.now();
  let all: Record<string, { at: number; games: RecentGame[] }> = {};
  try { all = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}'); } catch { /* ignore */ }
  const hit = all[id];
  if (hit && !opts.fresh && now - hit.at < PROFILE_TTL_MS) return hit.games;
  try {
    const games = normalizeRecent(await get<RawRecentMatch[]>(`/players/${id}/recentMatches`));
    try {
      all[id] = { at: now, games };
      const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(Object.fromEntries(keep)));
    } catch { /* storage full or blocked */ }
    return games;
  } catch (e) {
    if (hit) return hit.games;
    throw e;
  }
}

/* ───────────── v3: patches, match history, teammates ───────────── */

const PATCH_KEY = 'lp.patches';
const PATCH_TTL_MS = 3 * 86_400_000;

/** Patch names and start dates (OpenDota constants), cached for a few days. */
export async function fetchPatches(now = Date.now()): Promise<Patch[]> {
  let hit: { at: number; list: Patch[] } | null = null;
  try { hit = JSON.parse(localStorage.getItem(PATCH_KEY) ?? 'null'); } catch { /* ignore */ }
  if (hit?.list?.length && now - hit.at < PATCH_TTL_MS) return hit.list;
  try {
    const rows = await get<{ name: string; date: string }[]>('/constants/patch');
    const list = (rows ?? []).map((r) => ({ name: r.name, start: Math.floor(Date.parse(r.date) / 1000) })).filter((p) => Number.isFinite(p.start));
    try { localStorage.setItem(PATCH_KEY, JSON.stringify({ at: now, list })); } catch { /* ignore */ }
    return list;
  } catch (e) {
    if (hit?.list?.length) return hit.list;
    throw e;
  }
}

export interface RawHistoryRow { match_id: number; player_slot: number; radiant_win: boolean; hero_id: number; start_time: number }

export const normalizeHistory = (rows: RawHistoryRow[]): HistoryGame[] =>
  (rows ?? []).map((r) => ({ heroId: r.hero_id, win: (r.player_slot < 128) === !!r.radiant_win, start: r.start_time }));

/**
 * Match history: one loader and one cache for everything built on it (the
 * weekly review, dynamics by patch).
 *  - memory: the widest window loaded per player this visit; a narrower
 *    request inside it is answered from it, with no new request;
 *  - localStorage: the last RECENT_DAYS days only (small even for an active
 *    player), so a reload within the TTL costs nothing and an outage still
 *    shows the last copy with its date.
 */
export const HISTORY_TTL_MS = 30 * 60 * 1000;
const RECENT_DAYS = 14;
const HISTORY_KEY = 'lp.playerHistory';
const HISTORY_VERSION = 1;

export interface History {
  games: HistoryGame[];
  /** When it was loaded (ms). */
  fetchedAt: number;
  /** Loaded at least this far back (unix seconds). */
  since: number;
  /** An older copy because the service did not answer. */
  stale: boolean;
}

type StoredHistory = { v: number; at: number; since: number; games: [number, 0 | 1, number][] };

const historyMem = new Map<number, { games: HistoryGame[]; fetchedAt: number; since: number }>();

function readStored(id: number): { games: HistoryGame[]; fetchedAt: number; since: number } | null {
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as Record<string, StoredHistory>;
    const h = all[id];
    if (!h || h.v !== HISTORY_VERSION) return null;
    return { fetchedAt: h.at, since: h.since, games: h.games.map(([heroId, w, start]) => ({ heroId, win: w === 1, start })) };
  } catch { return null; }
}

function store(id: number, games: HistoryGame[], fetchedAt: number, nowSec: number) {
  try {
    const since = Math.floor(nowSec - RECENT_DAYS * 86400);
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as Record<string, StoredHistory>;
    all[id] = { v: HISTORY_VERSION, at: fetchedAt, since, games: games.filter((g) => g.start >= since).map((g) => [g.heroId, g.win ? 1 : 0, g.start]) };
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* storage full or blocked */ }
}

/** Every game since `sinceSec` (hero, result, date), from the cache while fresh unless `fresh`. */
export async function loadHistory(id: number, sinceSec: number, opts: { fresh?: boolean; now?: number } = {}): Promise<History> {
  const now = opts.now ?? Date.now();
  const nowSec = now / 1000;
  const covers = (h: { since: number; fetchedAt: number } | null | undefined) => !!h && h.since <= sinceSec + 60;
  const fresh = (h: { fetchedAt: number }) => now - h.fetchedAt < HISTORY_TTL_MS;
  const pick = (h: { games: HistoryGame[]; fetchedAt: number; since: number }, stale: boolean): History =>
    ({ games: h.games.filter((g) => g.start >= sinceSec), fetchedAt: h.fetchedAt, since: h.since, stale });

  const mem = historyMem.get(id);
  if (!opts.fresh && mem && covers(mem) && fresh(mem)) return pick(mem, false);
  const saved = readStored(id);
  if (!opts.fresh && saved && covers(saved) && fresh(saved)) { historyMem.set(id, saved); return pick(saved, false); }

  const days = Math.max(1, Math.ceil((nowSec - sinceSec) / 86400));
  try {
    const games = normalizeHistory(await get<RawHistoryRow[]>(`/players/${id}/matches?date=${days}&project=hero_id&project=start_time`));
    const entry = { games, fetchedAt: now, since: Math.floor(nowSec - days * 86400) };
    // keep the widest fresh window in memory
    if (!mem || !fresh(mem) || entry.since <= mem.since || opts.fresh) historyMem.set(id, entry);
    store(id, games, now, nowSec);
    return pick(entry, false);
  } catch (e) {
    const fallback = [mem, saved].filter((h): h is NonNullable<typeof h> => covers(h)).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    if (fallback && !(e instanceof PlayerError && e.kind === 'notFound')) return pick(fallback, true);
    throw e;
  }
}

/** The games since `sinceSec` (dynamics by patch). */
export async function fetchHistory(id: number, sinceSec: number, now = Date.now()): Promise<HistoryGame[]> {
  return (await loadHistory(id, sinceSec, { now })).games;
}

/** Test hook. */
export function clearHistoryMemory() { historyMem.clear(); }

export interface Peer { id: number; name: string; avatar: string | null; withGames: number; withWin: number; againstGames: number; againstWin: number }

export interface RawPeer { account_id: number; personaname: string | null; avatarfull: string | null; with_games: number; with_win: number; against_games: number; against_win: number }

export const normalizePeers = (rows: RawPeer[]): Peer[] =>
  (rows ?? []).filter((r) => r.with_games + r.against_games > 0)
    .map((r) => ({ id: r.account_id, name: r.personaname || `#${r.account_id}`, avatar: r.avatarfull || null, withGames: r.with_games, withWin: r.with_win, againstGames: r.against_games, againstWin: r.against_win }))
    .sort((a, b) => b.withGames - a.withGames);

const peersMem = new Map<number, Peer[]>();

/** Everyone the player met in their games (OpenDota /peers), most games in one team first. */
export async function fetchPeers(id: number): Promise<Peer[]> {
  const hit = peersMem.get(id);
  if (hit) return hit;
  const list = normalizePeers(await get<RawPeer[]>(`/players/${id}/peers`));
  peersMem.set(id, list);
  return list;
}

/* ───────────── a player's own games on one hero (match review baseline) ───────────── */

export interface HeroGame {
  matchId: number;
  /** Unix seconds. */
  start: number;
  /** Seconds. */
  duration: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Null = OpenDota has no value for this game (unknown, not zero). */
  gpm: number | null;
  xpm: number | null;
  lastHits: number | null;
  heroDamage: number | null;
  towerDamage: number | null;
  heroHealing: number | null;
  gameMode: number;
  /** 1 safe, 2 mid, 3 off, 4 jungle; parsed matches only. */
  laneRole: number | null;
  leaver: boolean;
}

export interface RawHeroGameRow {
  match_id: number; start_time: number; duration: number; kills: number; deaths: number; assists: number;
  gold_per_min: number | null; xp_per_min: number | null; last_hits: number | null; hero_damage: number | null; tower_damage: number | null;
  hero_healing: number | null; game_mode: number; lane_role: number | null; leaver_status: number | null;
}

export const HERO_GAMES_LIMIT = 100;
export const HERO_GAMES_TTL_MS = 6 * 3600 * 1000;
const HERO_GAMES_KEY = 'lp.heroGames';
const HERO_GAMES_FIELDS = ['start_time', 'duration', 'kills', 'deaths', 'assists', 'gold_per_min', 'xp_per_min', 'last_hits', 'hero_damage', 'tower_damage', 'hero_healing', 'game_mode', 'lane_role', 'leaver_status'];
/** Bump when the stored row shape changes. */
const HERO_GAMES_VERSION = 2;

const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const normalizeHeroGames = (rows: RawHeroGameRow[]): HeroGame[] =>
  (rows ?? []).map((r) => ({
    matchId: r.match_id, start: r.start_time, duration: r.duration ?? 0,
    kills: r.kills ?? 0, deaths: r.deaths ?? 0, assists: r.assists ?? 0,
    gpm: numOrNull(r.gold_per_min), xpm: numOrNull(r.xp_per_min), lastHits: numOrNull(r.last_hits),
    heroDamage: numOrNull(r.hero_damage), towerDamage: numOrNull(r.tower_damage), heroHealing: numOrNull(r.hero_healing),
    gameMode: r.game_mode ?? 0, laneRole: r.lane_role ?? null, leaver: (r.leaver_status ?? 0) > 1,
  }));

const heroGamesMem = new Map<string, { games: HeroGame[]; at: number }>();
const heroGamesInflight = new Map<string, Promise<HeroGame[]>>();

/**
 * The player's last 100 games on a hero in one game mode (Turbo is compared
 * with Turbo, All Pick with All Pick): one request — `significant=0`, or
 * OpenDota would drop non-standard modes — cached in memory and localStorage,
 * concurrent calls share it. Stored compactly as arrays.
 */
export async function loadHeroGames(accountId: number, heroId: number, gameMode: number, opts: { now?: number } = {}): Promise<HeroGame[]> {
  const now = opts.now ?? Date.now();
  const key = `${accountId}:${heroId}:${gameMode}`;
  const mem = heroGamesMem.get(key);
  if (mem && now - mem.at < HERO_GAMES_TTL_MS) return mem.games;
  let stored: Record<string, { v?: number; at: number; rows: (number | null)[][] }> = {};
  try { stored = JSON.parse(localStorage.getItem(HERO_GAMES_KEY) ?? '{}'); } catch { /* ignore */ }
  const unpack = (rows: (number | null)[][]): HeroGame[] => rows.map(([matchId, start, duration, kills, deaths, assists, gpm, xpm, lastHits, heroDamage, towerDamage, heroHealing, mode, laneRole, leaver]) => ({
    matchId: matchId!, start: start!, duration: duration!, kills: kills!, deaths: deaths!, assists: assists!, gpm, xpm, lastHits,
    heroDamage, towerDamage, heroHealing, gameMode: mode!, laneRole, leaver: leaver === 1,
  }));
  const hit = stored[key]?.v === HERO_GAMES_VERSION ? stored[key] : undefined;
  if (hit && now - hit.at < HERO_GAMES_TTL_MS) {
    const games = unpack(hit.rows);
    heroGamesMem.set(key, { games, at: hit.at });
    return games;
  }
  const running = heroGamesInflight.get(key);
  if (running) return running;
  const task = (async () => {
    try {
      const qs = HERO_GAMES_FIELDS.map((f) => `project=${f}`).join('&');
      const games = normalizeHeroGames(await get<RawHeroGameRow[]>(`/players/${accountId}/matches?hero_id=${heroId}&game_mode=${gameMode}&significant=0&limit=${HERO_GAMES_LIMIT}&${qs}`));
      heroGamesMem.set(key, { games, at: now });
      try {
        stored[key] = { v: HERO_GAMES_VERSION, at: now, rows: games.map((g) => [g.matchId, g.start, g.duration, g.kills, g.deaths, g.assists, g.gpm, g.xpm, g.lastHits, g.heroDamage, g.towerDamage, g.heroHealing, g.gameMode, g.laneRole, g.leaver ? 1 : 0]) };
        const keep = Object.entries(stored).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
        localStorage.setItem(HERO_GAMES_KEY, JSON.stringify(Object.fromEntries(keep)));
      } catch { /* storage full or blocked */ }
      return games;
    } catch (e) {
      // an outage: the last copy, however old
      if (hit) return unpack(hit.rows);
      throw e;
    } finally {
      heroGamesInflight.delete(key);
    }
  })();
  heroGamesInflight.set(key, task);
  return task;
}

/** Test hook. */
export function clearHeroGamesMemory() { heroGamesMem.clear(); heroGamesInflight.clear(); }
