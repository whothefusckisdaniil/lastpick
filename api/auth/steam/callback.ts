import { env } from '../../_lib/env';
import { safeReturn, sessionCookie } from '../../_lib/http';
import { signSession } from '../../_lib/session';
import { verifyCallback } from '../../_lib/steam';

/** Steam's answer: verified with Steam, then a session cookie and back to the page. */
export async function GET(req: Request): Promise<Response> {
  const secret = env.sessionSecret();
  const url = new URL(req.url);
  const back = safeReturn(url.searchParams.get('r'));
  const site = env.siteUrl();
  const fail = (reason: string) => new Response(null, { status: 302, headers: { Location: `${site}${back}${back.includes('?') ? '&' : '?'}signin=${reason}` } });
  if (!secret) return fail('unavailable');
  const accountId = await verifyCallback(url.searchParams, `${site}/api/auth/steam/callback`).catch(() => null);
  if (!accountId) return fail('failed');
  return new Response(null, { status: 302, headers: { Location: `${site}${back}`, 'Set-Cookie': sessionCookie(await signSession(accountId, secret)) } });
}
