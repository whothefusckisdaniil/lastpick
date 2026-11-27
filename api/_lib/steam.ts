/**
 * Steam sign-in (OpenID 2.0). Steam only ever tells us the SteamID64 of the
 * person who signed in — no password, no token, no profile data. The
 * assertion is checked back with Steam (check_authentication), so a forged
 * callback is rejected.
 */
export const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const STEAM64_BASE = 76561197960265728n;
const CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export function loginUrl(callbackUrl: string, realm: string): string {
  const p = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': callbackUrl,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID}?${p}`;
}

/** SteamID64 → the 32-bit account id Dota uses (the "Dota ID"). */
export const accountIdOf = (steam64: string) => Number(BigInt(steam64) - STEAM64_BASE);

/**
 * The Dota account id from Steam's callback, or null when the answer is not
 * a genuine, positive assertion for our return address.
 */
export async function verifyCallback(params: URLSearchParams, expectedReturnTo: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  if (params.get('openid.mode') !== 'id_res') return null;
  if (params.get('openid.op_endpoint') !== STEAM_OPENID) return null;
  const returnTo = params.get('openid.return_to') ?? '';
  if (!returnTo.startsWith(expectedReturnTo)) return null;
  const m = CLAIMED.exec(params.get('openid.claimed_id') ?? '');
  if (!m || params.get('openid.identity') !== params.get('openid.claimed_id')) return null;
  const check = new URLSearchParams();
  for (const [k, v] of params) if (k.startsWith('openid.')) check.set(k, v);
  check.set('openid.mode', 'check_authentication');
  const res = await fetchImpl(STEAM_OPENID, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: check.toString() });
  if (!res.ok) return null;
  if (!/(^|\n)is_valid\s*:\s*true(\n|$)/.test(await res.text())) return null;
  const id = accountIdOf(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
