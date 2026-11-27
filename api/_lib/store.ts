import { env } from './env.js';

/**
 * What a signed-in player keeps on the server: favourite heroes and roles.
 * Keyed by the Dota account id Steam confirmed. Upstash Redis over its REST
 * API (no client library); the interface keeps the storage swappable.
 */
export interface UserSettings {
  favorites: number[];
  roles: string[];
  /** ms */
  updatedAt: number;
}

export interface SettingsStore {
  get(accountId: number): Promise<UserSettings | null>;
  set(accountId: number, s: UserSettings): Promise<void>;
  delete(accountId: number): Promise<void>;
}

const key = (accountId: number) => `lp:settings:${accountId}`;

export function redisStore(url = env.redisUrl(), token = env.redisToken(), fetchImpl: typeof fetch = fetch): SettingsStore | null {
  if (!url || !token) return null;
  const cmd = async (args: (string | number)[]) => {
    const res = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`redis ${res.status}`);
    return ((await res.json()) as { result: unknown }).result;
  };
  return {
    async get(id) {
      const raw = await cmd(['GET', key(id)]);
      if (typeof raw !== 'string') return null;
      try { return cleanSettings(JSON.parse(raw)); } catch { return null; }
    },
    async set(id, s) { await cmd(['SET', key(id), JSON.stringify(s)]); },
    async delete(id) { await cmd(['DEL', key(id)]); },
  };
}

export const MAX_FAVORITES = 10;
const ROLES = ['1', '2', '3', '4', '5'];

/** Only valid data is ever stored: ≤ 10 distinct hero ids, known roles. */
export function cleanSettings(x: unknown, now = Date.now()): UserSettings | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as { favorites?: unknown; roles?: unknown; updatedAt?: unknown };
  if (!Array.isArray(o.favorites) || !Array.isArray(o.roles)) return null;
  const favorites = [...new Set(o.favorites.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 1000))].slice(0, MAX_FAVORITES);
  const roles = ROLES.filter((r) => (o.roles as unknown[]).includes(r));
  const updatedAt = typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : now;
  return { favorites, roles, updatedAt };
}
