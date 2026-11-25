import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { fetchProfile, PlayerError, type PlayerErrorKind, type PlayerProfile } from './api';

/**
 * "This is me": the saved Dota ID and its profile, shared by the profile page
 * and the draft's "My pool" mode. The ID lives only in this browser
 * (localStorage); requests go straight to OpenDota.
 */
const ME_KEY = 'lp.playerId';
const POOL_KEY = 'lp.pool';
const ROLES_KEY = 'lp.roles';

export type Role = '1' | '2' | '3' | '4' | '5';
const ROLE_IDS: Role[] = ['1', '2', '3', '4', '5'];

export type MeStatus =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; profile: PlayerProfile; stale: boolean }
  | { kind: 'error'; error: PlayerErrorKind };

interface State { id: number | null; status: MeStatus; poolOn: boolean; /** Positions the player says they play (empty = not set). */ roles: Role[] }

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
  if (id == null) { set({ id: null, status: { kind: 'none' }, poolOn: false, roles: [] }); write(POOL_KEY, null); write(ROLES_KEY, null); return; }
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
}

export function useMe() {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  // first use with a saved ID: load it (from cache when fresh)
  useEffect(() => { if (s.id != null && s.status.kind === 'none') void load(s.id); }, [s.id, s.status.kind]);
  const refresh = useCallback(() => { if (state.id != null) void load(state.id, true); }, []);
  const profile = s.status.kind === 'ready' ? s.status.profile : null;
  return { id: s.id, status: s.status, profile, poolOn: s.poolOn && !!profile && !profile.hidden, poolWanted: s.poolOn, roles: s.roles, refresh };
}
