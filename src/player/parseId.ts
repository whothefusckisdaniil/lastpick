/**
 * What the player typed into the profile field:
 * - a Dota ID (account_id, the friend code in the client): up to 10 digits;
 * - a Steam64 id (17 digits, 7656…): account_id = steam64 − STEAM64_BASE;
 * - a Dotabuff / OpenDota / STRATZ player link, a Steam /profiles/<steam64> link;
 * - a Steam /id/<vanity> link: cannot be resolved without a Steam API key;
 * - anything else: a nickname for the OpenDota search.
 */
export type PlayerInput =
  | { kind: 'id'; id: number }
  | { kind: 'vanity' }
  | { kind: 'search'; q: string }
  | { kind: 'empty' };

export const STEAM64_BASE = 76561197960265728n;
/** account_id is a 32-bit number. */
const MAX_ID = 4294967295;

export function steam64ToId(steam64: string): number | null {
  try {
    const n = BigInt(steam64) - STEAM64_BASE;
    return n > 0n && n <= BigInt(MAX_ID) ? Number(n) : null;
  } catch {
    return null;
  }
}

function digitsToId(d: string): number | null {
  if (/^7656\d{13}$/.test(d)) return steam64ToId(d);
  if (/^\d{1,10}$/.test(d)) {
    const n = Number(d);
    return n > 0 && n <= MAX_ID ? n : null;
  }
  return null;
}

export function parsePlayerInput(text: string): PlayerInput {
  const s = text.trim();
  if (!s) return { kind: 'empty' };
  if (/steamcommunity\.com\/id\//i.test(s)) return { kind: 'vanity' };
  const link = s.match(/(?:dotabuff\.com|opendota\.com|stratz\.com)\/players\/(\d+)/i) ?? s.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (link) {
    const id = digitsToId(link[1]);
    return id ? { kind: 'id', id } : { kind: 'search', q: s };
  }
  if (/^\d+$/.test(s)) {
    const id = digitsToId(s);
    if (id) return { kind: 'id', id };
  }
  return { kind: 'search', q: s };
}
