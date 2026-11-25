import type { RecentGame } from './poolStats';
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
  try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem('lp.playerRecent'); } catch { /* ignore */ }
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
