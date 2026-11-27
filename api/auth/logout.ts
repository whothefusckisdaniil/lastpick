import { clearCookie, json, sameOrigin } from '../_lib/http';

export function POST(req: Request): Response {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}
