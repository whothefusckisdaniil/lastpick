import { MODEL_VERSION, type MatchModel } from './model';
import { normalizeMatch, type RawMatch } from './normalize';

/**
 * OpenDota from the browser (it sends CORS headers for any origin). Limits
 * are per viewer IP (60 / minute, ~3000 / day without a key), so the site
 * itself spends nothing. Matches are cached in localStorage (last few).
 */
const API = 'https://api.opendota.com/api';
const CACHE_KEY = 'lp.matches';
/** Older keys, removed on the first read. */
const OLD_KEYS = ['lp.matches.v1'];
const CACHE_MAX = 6;

export type MatchErrorKind = 'notFound' | 'rateLimit' | 'network' | 'server';
export class MatchError extends Error {
  constructor(public kind: MatchErrorKind) { super(kind); }
}

type Cached = { at: number; v?: number; model: MatchModel };

/** Cached matches of the current model version only (an older shape would crash the slides). */
function readCache(): Record<string, Cached> {
  try {
    for (const k of OLD_KEYS) localStorage.removeItem(k);
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, Cached>;
    return Object.fromEntries(Object.entries(all).filter(([, c]) => c?.v === MODEL_VERSION && c.model?.players?.length));
  } catch {
    return {};
  }
}

export function clearMatchCache() {
  try { for (const k of [CACHE_KEY, ...OLD_KEYS]) localStorage.removeItem(k); } catch { /* ignore */ }
}

function writeCache(model: MatchModel) {
  try {
    const all = readCache();
    all[model.id] = { at: Date.now(), v: MODEL_VERSION, model };
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* storage full or blocked: no cache */ }
}

export function cachedMatch(id: number): MatchModel | null {
  return readCache()[id]?.model ?? null;
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try { res = await fetch(`${API}${path}`); } catch { throw new MatchError('network'); }
  if (res.status === 429) throw new MatchError('rateLimit');
  if (res.status === 404) throw new MatchError('notFound');
  if (!res.ok) throw new MatchError(res.status >= 500 ? 'server' : 'notFound');
  return res.json() as Promise<T>;
}

/**
 * The match, from cache when it is already parsed (a parsed match never
 * changes). An unparsed one is fetched again: it may have been parsed since.
 */
export async function fetchMatch(id: number, heroKeyOf: (heroId: number) => string | undefined, opts: { fresh?: boolean } = {}): Promise<MatchModel> {
  const hit = cachedMatch(id);
  if (hit?.parsed && !opts.fresh) return hit;
  try {
    const raw = await get<RawMatch & { error?: string }>(`/matches/${id}`);
    if (!raw || raw.error || !raw.players?.length) throw new MatchError('notFound');
    const model = normalizeMatch(raw, heroKeyOf);
    writeCache(model);
    return model;
  } catch (e) {
    // over the limit or offline: an older copy is better than nothing
    if (hit && e instanceof MatchError && (e.kind === 'rateLimit' || e.kind === 'network')) return hit;
    throw e;
  }
}

/** Ask OpenDota to download and parse the replay. */
export async function requestParse(id: number): Promise<void> {
  let res: Response;
  try { res = await fetch(`${API}/request/${id}`, { method: 'POST' }); } catch { throw new MatchError('network'); }
  if (res.status === 429) throw new MatchError('rateLimit');
  if (!res.ok) throw new MatchError('server');
}

/** Pauses between polls while a parse runs (seconds); the last repeats. */
export const POLL_STEPS = [5, 10, 20, 30];
export const POLL_LIMIT_MS = 8 * 60 * 1000;

export function pollDelay(attempt: number): number {
  return POLL_STEPS[Math.min(attempt, POLL_STEPS.length - 1)] * 1000;
}

/** Wait for the parse: refetch with growing pauses until parsed, the time limit or `signal`. */
export async function waitForParse(
  id: number,
  heroKeyOf: (heroId: number) => string | undefined,
  signal: AbortSignal,
  onTick?: (attempt: number) => void,
): Promise<MatchModel | null> {
  const started = Date.now();
  for (let attempt = 0; Date.now() - started < POLL_LIMIT_MS; attempt++) {
    await new Promise<void>((resolve) => {
      const t = window.setTimeout(resolve, pollDelay(attempt));
      signal.addEventListener('abort', () => { window.clearTimeout(t); resolve(); }, { once: true });
    });
    if (signal.aborted) return null;
    onTick?.(attempt);
    try {
      const m = await fetchMatch(id, heroKeyOf, { fresh: true });
      if (m.parsed) return m;
    } catch (e) {
      if (!(e instanceof MatchError) || e.kind !== 'rateLimit') throw e;
    }
  }
  return null;
}

/* Small OpenDota constants, kept for a week. */
async function constant<T>(name: string): Promise<T | null> {
  const key = `lp.const.${name}`;
  try {
    const c = JSON.parse(localStorage.getItem(key) ?? 'null') as { at: number; v: T } | null;
    if (c && Date.now() - c.at < 7 * 864e5) return c.v;
  } catch { /* ignore */ }
  try {
    const v = await get<T>(`/constants/${name}`);
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch { /* ignore */ }
    return v;
  } catch {
    return null;
  }
}

/** Item id → key for every item (the builds index only has the common ones). */
export const loadItemIds = () => constant<Record<string, string>>('item_ids');
/** Patch id → name ("7.42") and release date. */
export const loadPatches = () => constant<{ id: number; name: string; date: string }[]>('patch');
