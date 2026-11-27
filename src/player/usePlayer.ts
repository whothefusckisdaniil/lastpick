import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { fetchProfile, PlayerError, type PlayerErrorKind, type PlayerProfile } from './api';
import { accountApi, type Account } from './account';

/**
 * "This is me": the saved Dota ID and its profile, shared by the profile page
 * and the draft's "My pool" mode. The ID lives only in this browser
 * (localStorage); requests go straight to OpenDota.
 */
const ME_KEY = 'lp.playerId';
const POOL_KEY = 'lp.pool';
const ROLES_KEY = 'lp.roles';
const FAV_KEY = 'lp.favorites';
export const MAX_FAVORITES = 10;

export type Role = '1' | '2' | '3' | '4' | '5';
const ROLE_IDS: Role[] = ['1', '2', '3', '4', '5'];

export type MeStatus =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; profile: PlayerProfile; stale: boolean }
  | { kind: 'error'; error: PlayerErrorKind };

interface State { id: number | null; status: MeStatus; poolOn: boolean; /** Positions the player says they play (empty = not set). */ roles: Role[]; /** Heroes always in "My pool" (up to MAX_FAVORITES). */ favorites: number[]; /** Steam sign-in: favourites and roles synced across devices. */ account: Account; /** Last sync with the server failed (shown, retried on the next change). */ syncError: boolean }

function read<T>(key: string, parse: (v: string) => T, fallback: T): T {
  try { const v = localStorage.getItem(key); return v == null ? fallback : parse(v); } catch { return fallback; }
}
function write(key: string, value: string | null) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* not remembered */ }
}

let state: State = {
  id: read(ME_KEY, (v) => (/^\d+$/.test(v) ? Number(v) : null), null),
  status: { kind: 'none' },
  poolOn: read(POOL_KEY, (v) => v === 'on', false),
  roles: read(ROLES_KEY, (v) => ROLE_IDS.filter((r) => v.split(',').includes(r)), [] as Role[]),
  favorites: read(FAV_KEY, (v) => [...new Set(v.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_FAVORITES), [] as number[]),
  account: { kind: 'checking' },
  syncError: false,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

let loadSeq = 0;
async function load(id: number, fresh = false) {
  const seq = ++loadSeq;
  if (state.status.kind !== 'ready' || state.status.profile.id !== id) set({ status: { kind: 'loading' } });
  try {
    const { profile, stale } = await fetchProfile(id, { fresh });
    if (seq === loadSeq && state.id === id) set({ status: { kind: 'ready', profile, stale } });
  } catch (e) {
    if (seq === loadSeq && state.id === id) set({ status: { kind: 'error', error: e instanceof PlayerError ? e.kind : 'server' } });
  }
}

/** Save (or forget) the player as "me". Loading starts right away. */
export function setMe(id: number | null, profile?: PlayerProfile) {
  write(ME_KEY, id == null ? null : String(id));
  if (id == null) {
    // "Forget me" also signs out: otherwise the next visit would sign the same account back in
    if (state.account.kind === 'signedIn') { void accountApi.logout(); set({ account: { kind: 'signedOut' } }); }
    set({ id: null, status: { kind: 'none' }, poolOn: false, roles: [], favorites: [] }); write(POOL_KEY, null); write(ROLES_KEY, null); write(FAV_KEY, null); return;
  }
  set({ id, status: profile ? { kind: 'ready', profile, stale: false } : { kind: 'loading' } });
  if (!profile) void load(id);
}

export function setPoolOn(on: boolean) {
  write(POOL_KEY, on ? 'on' : null);
  set({ poolOn: on });
}

export function setRoles(roles: Role[]) {
  const clean = ROLE_IDS.filter((r) => roles.includes(r));
  write(ROLES_KEY, clean.length ? clean.join(',') : null);
  set({ roles: clean });
  schedulePush();
}

/** Favourite heroes, in the order chosen; at most MAX_FAVORITES, no repeats. */
export function setFavorites(ids: number[]) {
  const clean = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_FAVORITES);
  write(FAV_KEY, clean.length ? clean.join(',') : null);
  set({ favorites: clean });
  schedulePush();
}

/* ───── Steam sign-in and sync ───── */

let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** Send favourites and roles to the server shortly after a change (signed in only). */
function schedulePush() {
  if (state.account.kind !== 'signedIn') return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    const ok = await accountApi.putSettings({ favorites: state.favorites, roles: state.roles });
    set({ syncError: !ok });
  }, 500);
}

/** Apply what the server keeps (another device may have changed it), without sending it back. */
function applyRemote(s: { favorites: number[]; roles: string[] }) {
  const favorites = [...new Set(s.favorites)].filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_FAVORITES);
  const roles = ROLE_IDS.filter((r) => s.roles.includes(r));
  write(FAV_KEY, favorites.length ? favorites.join(',') : null);
  write(ROLES_KEY, roles.length ? roles.join(',') : null);
  set({ favorites, roles, syncError: false });
}

/** Pull the synced settings; the first time on an account, an empty server takes this browser's. */
async function pull() {
  if (state.account.kind !== 'signedIn') return;
  const remote = await accountApi.getSettings();
  if (remote === 'error') { set({ syncError: true }); return; }
  if (remote) applyRemote(remote);
  else if (state.favorites.length || state.roles.length) schedulePush();
}

let accountStarted = false;
/** Once per page: who is signed in; a signed-in account is "me" and its settings come in. */
export async function startAccount() {
  if (accountStarted) return;
  accountStarted = true;
  const account = await accountApi.me();
  set({ account });
  if (account.kind !== 'signedIn') return;
  if (state.id !== account.accountId) setMe(account.accountId);
  await pull();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void pull(); });
  }
}

export async function signOut() {
  await accountApi.logout();
  set({ account: { kind: 'signedOut' }, syncError: false });
}

/** Remove everything stored on the server for this account (local copies stay). */
export async function deleteServerData(): Promise<boolean> {
  return accountApi.deleteSettings();
}

export function useMe() {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  // first use with a saved ID: load it (from cache when fresh)
  useEffect(() => { if (s.id != null && s.status.kind === 'none') void load(s.id); }, [s.id, s.status.kind]);
  useEffect(() => { void startAccount(); }, []);
  const refresh = useCallback(() => { if (state.id != null) void load(state.id, true); }, []);
  const profile = s.status.kind === 'ready' ? s.status.profile : null;
  return { id: s.id, status: s.status, profile, poolOn: s.poolOn && !!profile && !profile.hidden, poolWanted: s.poolOn, roles: s.roles, favorites: s.favorites, account: s.account, syncError: s.syncError, refresh };
}
