import { accountOf, json, sameOrigin } from './_lib/http.js';
import { cleanSettings, redisStore, type SettingsStore } from './_lib/store.js';

/**
 * The signed-in player's synced settings (favourite heroes, roles).
 *   GET    → { settings } (null when nothing is stored yet)
 *   PUT    { favorites, roles } → stored, with the server time
 *   DELETE → everything stored for this account is removed
 */
export async function handle(req: Request, store: SettingsStore | null): Promise<Response> {
  const accountId = await accountOf(req);
  if (accountId == null) return json({ error: 'signed out' }, 401);
  if (!store) return json({ error: 'storage is not configured' }, 503);
  if (req.method === 'GET') return json({ settings: await store.get(accountId) });
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  if (req.method === 'DELETE') { await store.delete(accountId); return json({ ok: true }); }
  if (req.method === 'PUT') {
    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const s = cleanSettings({ ...(body as object), updatedAt: Date.now() });
    if (!s) return json({ error: 'bad settings' }, 400);
    await store.set(accountId, s);
    return json({ settings: s });
  }
  return json({ error: 'method' }, 405);
}

export const GET = (req: Request) => handle(req, redisStore());
export const PUT = (req: Request) => handle(req, redisStore());
export const DELETE = (req: Request) => handle(req, redisStore());
