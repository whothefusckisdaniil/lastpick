import { env } from './env.js';
import { readSession, SESSION_COOKIE, SESSION_DAYS } from './session.js';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export function cookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export const sessionCookie = (token: string) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
export const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** The signed-in account, or null. */
export async function accountOf(req: Request): Promise<number | null> {
  return readSession(cookie(req, SESSION_COOKIE), env.sessionSecret());
}

/** Writes only from our own pages (the cookie is SameSite=Lax too). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
    return o.host === host || o.origin === env.siteUrl();
  } catch {
    return false;
  }
}

/** A path on our own site to come back to ("/?profile"), never another host. */
export const safeReturn = (r: string | null) => (r && r.startsWith('/') && !r.startsWith('//') && !r.startsWith('/\\') ? r : '/?profile');
