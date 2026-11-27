import { env } from '../../_lib/env';
import { safeReturn } from '../../_lib/http';
import { loginUrl } from '../../_lib/steam';

/** Start Steam sign-in: off to Steam, which comes back to /api/auth/steam/callback. */
export function GET(req: Request): Response {
  if (!env.sessionSecret()) return new Response('Sign-in is not configured', { status: 503 });
  const back = safeReturn(new URL(req.url).searchParams.get('return'));
  const site = env.siteUrl();
  const callback = `${site}/api/auth/steam/callback?r=${encodeURIComponent(back)}`;
  return Response.redirect(loginUrl(callback, site), 302);
}
