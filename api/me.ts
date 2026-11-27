import { env } from './_lib/env';
import { accountOf, json } from './_lib/http';

/** Who is signed in: { signedIn, accountId } — or that sign-in is not set up on this deployment. */
export async function GET(req: Request): Promise<Response> {
  if (!env.sessionSecret()) return json({ available: false, signedIn: false });
  const accountId = await accountOf(req);
  return json({ available: true, signedIn: accountId != null, accountId });
}
