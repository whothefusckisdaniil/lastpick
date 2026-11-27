import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { method: string; path: string; body?: unknown };

function setup(server: { me: unknown; settings?: unknown; html?: boolean }) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  });
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    // where the server part is missing, the site answers with its HTML page
    if (server.html) return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const body = path === '/api/me' ? server.me : path === '/api/settings' && method === 'GET' ? { settings: server.settings ?? null } : { ok: true, settings: init.body ? JSON.parse(String(init.body)) : null };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  // the profile fetches of setMe are not part of this test
  vi.doMock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), fetchProfile: vi.fn(() => new Promise(() => {})) }));
  return { store, calls };
}

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe('Steam sync of favourites and roles', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock('./api'); });

  it('signed in on a new device: the account becomes "me" and its settings come in', async () => {
    const { store } = setup({ me: { available: true, signedIn: true, accountId: 86745912 }, settings: { favorites: [91, 10], roles: ['2'], updatedAt: 1 } });
    const m = await import('./usePlayer');
    await m.startAccount(); await flush();
    expect(store.get('lp.playerId')).toBe('86745912');
    expect(store.get('lp.favorites')).toBe('91,10');
    expect(store.get('lp.roles')).toBe('2');
  });

  it('changes are sent to the server shortly after (one request for quick edits)', async () => {
    const { calls } = setup({ me: { available: true, signedIn: true, accountId: 1001 }, settings: { favorites: [], roles: [], updatedAt: 1 } });
    const m = await import('./usePlayer');
    await m.startAccount(); await flush();
    m.setFavorites([14]); m.setFavorites([14, 91]); m.setRoles(['2', '1']);
    await vi.advanceTimersByTimeAsync(600);
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]).toEqual({ method: 'PUT', path: '/api/settings', body: { favorites: [14, 91], roles: ['1', '2'] } });
  });

  it('an empty server takes what this browser already has', async () => {
    const { calls, store } = setup({ me: { available: true, signedIn: true, accountId: 1001 }, settings: null });
    store.set('lp.favorites', '5,6');
    const m = await import('./usePlayer');
    await m.startAccount(); await flush();
    await vi.advanceTimersByTimeAsync(600);
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ favorites: [5, 6], roles: [] });
  });

  it('signed out: nothing leaves the browser', async () => {
    const { calls } = setup({ me: { available: true, signedIn: false, accountId: null } });
    const m = await import('./usePlayer');
    await m.startAccount(); await flush();
    m.setFavorites([1, 2]);
    await vi.advanceTimersByTimeAsync(600);
    expect(calls.map((c) => c.path)).toEqual(['/api/me']);
  });

  it('no server part (local dev, not configured): "unavailable", everything stays local', async () => {
    const { calls } = setup({ me: null, html: true });
    const m = await import('./usePlayer');
    await m.startAccount(); await flush();
    m.setFavorites([1]);
    await vi.advanceTimersByTimeAsync(600);
    expect(calls.map((c) => c.path)).toEqual(['/api/me']);
  });

  it('"Forget me" also signs out', async () => {
    const { calls } = setup({ me: { available: true, signedIn: true, accountId: 1001 }, settings: null });
    const m = await import('./usePlayer');
    await m.startAccount(); await flush();
    m.setMe(null); await flush();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/auth/logout')).toBe(true);
  });
});
