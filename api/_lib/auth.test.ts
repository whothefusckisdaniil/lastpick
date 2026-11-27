import { describe, expect, it } from 'vitest';
import { readSession, signSession } from './session.js';
import { accountIdOf, loginUrl, STEAM_OPENID, verifyCallback } from './steam.js';
import { cleanSettings, type SettingsStore, type UserSettings } from './store.js';
import { safeReturn } from './http.js';
import { handle } from '../settings.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const SITE = 'https://lastpick-pro.vercel.app';
const CALLBACK = `${SITE}/api/auth/steam/callback`;

describe('session cookie', () => {
  it('round-trips, rejects tampering, another secret and expiry', async () => {
    const t = await signSession(86745912, SECRET, 1000);
    expect(await readSession(t, SECRET, 1001)).toBe(86745912);
    const [p, s] = t.split('.');
    const forged = `${btoa(JSON.stringify({ a: 1, e: 9e9 })).replace(/=+$/, '')}.${s}`;
    expect(await readSession(forged, SECRET, 1001)).toBeNull();
    expect(await readSession(`${p}.${s.slice(0, -2)}xx`, SECRET, 1001)).toBeNull();
    expect(await readSession(t, 'another-secret-0123456789abcdef', 1001)).toBeNull();
    expect(await readSession(t, SECRET, 1000 + 181 * 86400)).toBeNull();
    expect(await readSession(null, SECRET)).toBeNull();
    expect(await readSession('garbage', SECRET)).toBeNull();
  });
});

describe('Steam OpenID', () => {
  const STEAM64 = '76561198047011640'; // account 86745912
  const positive = (o: Record<string, string> = {}) => new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': STEAM_OPENID,
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM64}`, 'openid.identity': `https://steamcommunity.com/openid/id/${STEAM64}`,
    'openid.return_to': `${CALLBACK}?r=%2F%3Fprofile`, 'openid.response_nonce': '2026-11-27T10:00:00Zabc', 'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': 'sig=', ...o,
  });
  const steamSays = (body: string) => {
    const calls: { url: string; body: string }[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return new Response(body, { status: 200 }); }) as unknown as typeof fetch;
    return { f, calls };
  };

  it('Steam64 → Dota account id; the login URL points to Steam with our return address', () => {
    expect(accountIdOf(STEAM64)).toBe(86745912);
    const u = new URL(loginUrl(`${CALLBACK}?r=%2F`, SITE));
    expect(u.origin + u.pathname).toBe(STEAM_OPENID);
    expect(u.searchParams.get('openid.return_to')).toBe(`${CALLBACK}?r=%2F`);
    expect(u.searchParams.get('openid.mode')).toBe('checkid_setup');
  });

  it('a genuine answer, confirmed by Steam, gives the account id', async () => {
    const { f, calls } = steamSays('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n');
    expect(await verifyCallback(positive(), CALLBACK, f)).toBe(86745912);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(STEAM_OPENID);
    expect(new URLSearchParams(calls[0].body).get('openid.mode')).toBe('check_authentication');
  });

  it('rejected: Steam says not valid, another return address, another provider, mismatched ids, a cancel', async () => {
    expect(await verifyCallback(positive(), CALLBACK, steamSays('is_valid:false\n').f)).toBeNull();
    const ok = steamSays('is_valid:true\n').f;
    expect(await verifyCallback(positive({ 'openid.return_to': 'https://evil.example/api/auth/steam/callback' }), CALLBACK, ok)).toBeNull();
    expect(await verifyCallback(positive({ 'openid.op_endpoint': 'https://evil.example/openid/login' }), CALLBACK, ok)).toBeNull();
    expect(await verifyCallback(positive({ 'openid.identity': 'https://steamcommunity.com/openid/id/76561197960265729' }), CALLBACK, ok)).toBeNull();
    expect(await verifyCallback(positive({ 'openid.claimed_id': 'https://evil.example/openid/id/76561198047011640' }), CALLBACK, ok)).toBeNull();
    expect(await verifyCallback(positive({ 'openid.mode': 'cancel' }), CALLBACK, ok)).toBeNull();
  });
});

describe('settings', () => {
  it('only clean data: ≤ 10 distinct hero ids, known roles', () => {
    expect(cleanSettings({ favorites: [1, 2, 2, -3, 1.5, 'x', ...Array.from({ length: 20 }, (_, i) => 10 + i)], roles: ['2', '9', '1', 'x'] }, 5)).toEqual({
      favorites: [1, 2, 10, 11, 12, 13, 14, 15, 16, 17], roles: ['1', '2'], updatedAt: 5,
    });
    expect(cleanSettings({ favorites: 'no', roles: [] })).toBeNull();
    expect(cleanSettings(null)).toBeNull();
  });

  it('the return path never leaves the site', () => {
    expect(safeReturn('/?profile')).toBe('/?profile');
    expect(safeReturn('//evil.example')).toBe('/?profile');
    expect(safeReturn('https://evil.example')).toBe('/?profile');
    expect(safeReturn('/\\evil.example')).toBe('/?profile');
    expect(safeReturn(null)).toBe('/?profile');
  });

  function memory(): SettingsStore & { data: Map<number, UserSettings> } {
    const data = new Map<number, UserSettings>();
    return { data, get: async (id) => data.get(id) ?? null, set: async (id, s) => void data.set(id, s), delete: async (id) => void data.delete(id) };
  }

  it('signed out → 401; signed in → own settings only; writes need our origin', async () => {
    const penv = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    penv.SESSION_SECRET = SECRET;
    penv.SITE_URL = SITE;
    const store = memory();
    const token = await signSession(86745912, SECRET);
    const req = (method: string, init: { cookie?: boolean; origin?: string; body?: unknown } = {}) => new Request(`${SITE}/api/settings`, {
      method,
      headers: { ...(init.cookie !== false ? { cookie: `lp_session=${token}` } : {}), ...(init.origin ? { origin: init.origin } : {}), host: 'lastpick-pro.vercel.app', 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    expect((await handle(req('GET', { cookie: false }), store)).status).toBe(401);
    expect(await (await handle(req('GET'), store)).json()).toEqual({ settings: null });
    expect((await handle(req('PUT', { body: { favorites: [1], roles: [] }, origin: 'https://evil.example' }), store)).status).toBe(403);
    expect((await handle(req('PUT', { body: { favorites: [1], roles: [] } }), store)).status).toBe(403); // no Origin header
    const put = await handle(req('PUT', { body: { favorites: [14, 91, 91], roles: ['2'] }, origin: SITE }), store);
    expect(put.status).toBe(200);
    expect(store.data.get(86745912)).toMatchObject({ favorites: [14, 91], roles: ['2'] });
    expect((await (await handle(req('GET'), store)).json()).settings.favorites).toEqual([14, 91]);
    expect((await handle(req('DELETE', { origin: SITE }), store)).status).toBe(200);
    expect(store.data.has(86745912)).toBe(false);
    expect((await handle(req('GET'), null)).status).toBe(503);
  });
});
