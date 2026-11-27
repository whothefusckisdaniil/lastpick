/**
 * Stateless sessions: a cookie holding { account id, expiry }, signed with
 * HMAC-SHA256 (Web Crypto). Nothing to store server-side; a changed or
 * expired cookie is simply not a session.
 */
export const SESSION_COOKIE = 'lp_session';
export const SESSION_DAYS = 180;

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signSession(accountId: number, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ a: accountId, e: nowSec + SESSION_DAYS * 86400 })));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

/** The account id of a valid, unexpired session; null otherwise. */
export async function readSession(token: string | null | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<number | null> {
  if (!token || !secret) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    if (!sameBytes(fromB64url(sig), await hmac(secret, payload))) return null;
    const { a, e } = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { a: unknown; e: unknown };
    return typeof a === 'number' && Number.isInteger(a) && a > 0 && typeof e === 'number' && e > nowSec ? a : null;
  } catch {
    return null;
  }
}
