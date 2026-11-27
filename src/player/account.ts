/**
 * Steam sign-in on the client: who is signed in and their synced settings
 * (favourite heroes, roles) from /api. Without the server part (local dev,
 * or sign-in not configured) everything reports "unavailable" and the site
 * keeps working from this browser only.
 */
export type Account =
  | { kind: 'checking' }
  | { kind: 'unavailable' }
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; accountId: number };

export interface SyncedSettings { favorites: number[]; roles: string[]; updatedAt: number }

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; data: T | null }> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  // the SPA fallback answers HTML where there is no server part
  const data = (res.headers.get('content-type') ?? '').includes('application/json') ? ((await res.json()) as T) : null;
  return { status: res.status, data };
}

export const accountApi = {
  async me(): Promise<Account> {
    try {
      const { data } = await call<{ available: boolean; signedIn: boolean; accountId: number | null }>('/api/me');
      if (!data || !data.available) return { kind: 'unavailable' };
      return data.signedIn && data.accountId ? { kind: 'signedIn', accountId: data.accountId } : { kind: 'signedOut' };
    } catch {
      return { kind: 'unavailable' };
    }
  },
  async getSettings(): Promise<SyncedSettings | null | 'error'> {
    try {
      const { status, data } = await call<{ settings: SyncedSettings | null }>('/api/settings');
      return status === 200 && data ? data.settings : 'error';
    } catch { return 'error'; }
  },
  async putSettings(s: { favorites: number[]; roles: string[] }): Promise<boolean> {
    try { return (await call('/api/settings', { method: 'PUT', body: JSON.stringify(s) })).status === 200; } catch { return false; }
  },
  async deleteSettings(): Promise<boolean> {
    try { return (await call('/api/settings', { method: 'DELETE' })).status === 200; } catch { return false; }
  },
  async logout(): Promise<void> {
    try { await call('/api/auth/logout', { method: 'POST' }); } catch { /* the cookie expires anyway */ }
  },
  /** Where "Sign in through Steam" goes; Steam brings the player back to `returnPath`. */
  loginHref: (returnPath = '/?profile') => `/api/auth/steam/login?return=${encodeURIComponent(returnPath)}`,
};
