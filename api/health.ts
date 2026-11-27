import { env } from './_lib/env.js';
import { json } from './_lib/http.js';

/**
 * Is sign-in and sync set up on this deployment? Booleans only — no values,
 * no secrets. Storage is checked with a PING.
 */
export async function GET(): Promise<Response> {
  const session = env.sessionSecret().length >= 32;
  const url = env.redisUrl();
  const token = env.redisToken();
  let storage = false;
  if (url && token) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(['PING']) });
      storage = res.ok && ((await res.json()) as { result?: unknown }).result === 'PONG';
    } catch { storage = false; }
  }
  return json({ session, storageConfigured: !!(url && token), storage, siteUrl: env.siteUrl() });
}
