import type { Hero } from '../../types';
import type { Build } from '../../data/dataset';
import { enemyProfile, type EnemyProfile } from '../../scoring/itemRules';
import type { MatchPlayer } from '../model';

/** Cheap items, consumables and components: not listed among the purchases. */
const MINOR = new Set([
  'tpscroll', 'ward_observer', 'ward_sentry', 'ward_dispenser', 'dust', 'smoke_of_deceit', 'clarity', 'tango', 'flask', 'enchanted_mango',
  'faerie_fire', 'blood_grenade', 'branches', 'magic_stick', 'magic_wand', 'bottle', 'quelling_blade', 'orb_of_venom', 'circlet', 'slippers',
  'mantle', 'gauntlets', 'ring_of_protection', 'wind_lace', 'boots', 'gloves', 'boots_of_elves', 'belt_of_strength', 'robe', 'blades_of_attack',
  'ogre_axe', 'wizard_hat', 'blade_of_alacrity', 'staff_of_wizardry', 'point_booster', 'vitality_booster', 'energy_booster', 'ring_of_health', 'void_stone',
  'sobi_mask', 'fluffy_hat', 'chainmail', 'broadsword', 'claymore', 'mithril_hammer', 'javelin', 'quarterstaff', 'cornucopia', 'tiara_of_selemene',
  'ring_of_regen', 'headdress', 'buckler', 'bracer', 'wraith_band', 'null_talisman', 'cheese', 'aegis', 'refresher_shard', 'ultimate_orb',
  'demon_edge', 'eagle', 'reaver', 'relic', 'mystic_staff', 'hyperstone', 'platemail', 'talisman_of_evasion', 'lifesteal', 'voodoo_mask',
  'shadow_amulet', 'cloak', 'helm_of_iron_will', 'crown', 'diadem', 'blitz_knuckles', 'great_famango', 'famango', 'infused_raindrop',
]);

/**
 * Why a purchase looks like a mistake:
 * - notNeeded: an answer to a threat the enemies did not have (MKB with no
 *   evasion, Pipe with little magic, Lotus / Linken's with almost no disables);
 * - wasted: bought in the last minutes, it had no time to matter;
 * - rare: this hero at this position almost never buys it (< 5% of games).
 * Deliberately lenient: a wrong "mistake" is worse than a missed one.
 */
export type PurchaseFlag = 'notNeeded' | 'wasted' | 'rare';

export interface PurchaseRow {
  key: string;
  /** Minute bought; null without a purchase log (final inventory only). */
  minute: number | null;
  flag: PurchaseFlag | null;
  /** notNeeded: the threat that was missing (build.when.* key); rare: share of games, 0..1 (0 = under the list's floor). */
  why?: string;
  pct?: number;
  /** wasted: minutes before the end. */
  beforeEnd?: number;
}

export interface PurchaseReview {
  rows: PurchaseRow[];
  timed: boolean;
  mistakes: number;
}

/** Thresholds of the purchase checks. */
export const PURCHASE = {
  /** A finished item bought this close to the end (minutes), in a game of at least `wastedMinGame` = wasted. */
  wastedMinutes: 2,
  wastedMinGame: 20,
  /** A hero buying it in this share of games or more: never "not needed". */
  commonPct: 0.2,
  /** "rare" only when the build lists items down to this share (so absent = rarer). */
  listFloor: 0.06,
  /** …and has this many games behind it. */
  minGames: 300,
} as const;

/** Bought for these and nothing else; the check says whether the threat was there. */
const THREAT: Record<string, { when: string; present: (p: EnemyProfile) => boolean }> = {
  monkey_king_bar: { when: 'evasion', present: (p) => p.flags.eva.length > 0 },
  pipe: { when: 'magic', present: (p) => p.magicShare >= 0.4 },
  mage_slayer: { when: 'magic', present: (p) => p.magicShare >= 0.4 },
  ghost: { when: 'physical', present: (p) => p.physCarries.length > 0 },
  heavens_halberd: { when: 'physical', present: (p) => p.physCarries.length > 0 },
  crimson_guard: { when: 'physical', present: (p) => p.physCarries.length > 0 || p.flags.ill.length + p.flags.sum.length > 0 },
  lotus_orb: { when: 'targeted', present: (p) => p.disablers.length >= 2 || p.flags.sil.length > 0 },
  sphere: { when: 'targeted', present: (p) => p.disablers.length >= 2 || p.flags.sil.length > 0 },
  spirit_vessel: { when: 'heal', present: (p) => p.flags.heal.length > 0 },
};

/** Never judged as "rare": bought by anyone for reasons a hero build does not show. */
const NOT_RARE = new Set(['aghanims_shard', 'ultimate_scepter', 'ultimate_scepter_2', 'moon_shard', 'tome_of_knowledge', 'travel_boots', 'travel_boots_2', 'blink', 'black_king_bar', 'gem']);

/**
 * What the player bought and when (every real item, first purchase, in
 * order), with the purchases that look like mistakes for this game.
 */
export function reviewPurchases(args: {
  player: MatchPlayer;
  /** Match length, seconds. */
  duration: number;
  /** The hero's builds at this position, every rank: an item is "unusual"
   *  only when no rank buys it in 5%+ of games. */
  builds: Build[];
  itemOf: (id: number) => [string, string, string[]?] | undefined;
  keyOfId: (id: number) => string | undefined;
  enemies: Hero[];
  /** Item key → its components (the builds index); hides a component once the item it builds into is bought. */
  components?: Map<string, string[]>;
}): PurchaseReview {
  const { player, duration, builds, itemOf, keyOfId } = args;
  const components = args.components ?? new Map<string, string[]>();
  /** Built into something bigger (Kaya, Soul Booster…): not judged as wasted or rare. */
  const intermediate = new Set([...components.values()].flat());
  /** Keys the statistics know this patch (a brand-new item cannot be "rare"). */
  const known = new Set(components.keys());
  const timed = player.purchases != null;
  const major = (k: string | undefined): k is string => !!k && !MINOR.has(k) && !k.startsWith('recipe_') && !k.startsWith('ward_');

  const bought: { key: string; minute: number | null }[] = [];
  if (timed) {
    const seen = new Set<string>();
    for (const b of [...(player.purchases ?? [])].sort((a, z) => a.time - z.time)) {
      if (!major(b.key) || seen.has(b.key)) continue;
      seen.add(b.key);
      bought.push({ key: b.key, minute: Math.max(0, Math.round(b.time / 60)) });
    }
    // a component disappears once the item it builds into is bought (same minute or later)
    const partOf = (k: string, minute: number) => bought.some((x) => x.key !== k && (x.minute ?? 0) >= minute && (components.get(x.key) ?? []).includes(k));
    for (let i = bought.length - 1; i >= 0; i--) if (partOf(bought[i].key, bought[i].minute ?? 0)) bought.splice(i, 1);
  } else {
    for (const k of new Set([...player.items, ...player.backpack].map(keyOfId))) if (major(k)) bought.push({ key: k, minute: null });
  }

  const pctOf = new Map<string, number>();
  for (const b of builds) {
    for (const [id, pct] of [...b.items, ...b.boots]) {
      const k = itemOf(id)?.[0];
      if (k) pctOf.set(k, Math.max(pctOf.get(k) ?? 0, pct));
    }
  }
  // judged on the biggest sample, and only when its list goes down to ~5%
  const main = [...builds].sort((a, z) => z.m - a.m)[0];
  const judgeRare = !!main && !main.low && main.m >= PURCHASE.minGames && main.items.length > 0 && Math.min(...main.items.map((x) => x[1])) <= PURCHASE.listFloor;
  const profile = args.enemies.length ? enemyProfile(args.enemies) : null;
  const judgeThreats = !!profile && profile.untagged.length === 0;
  const end = duration / 60;

  const rows = bought.map(({ key, minute }): PurchaseRow => {
    const pct = pctOf.get(key) ?? 0;
    const threat = THREAT[key];
    if (judgeThreats && threat && pct < PURCHASE.commonPct && !threat.present(profile!)) return { key, minute, flag: 'notNeeded', why: threat.when };
    const finished = !intermediate.has(key);
    if (finished && minute != null && end >= PURCHASE.wastedMinGame && end - minute <= PURCHASE.wastedMinutes) return { key, minute, flag: 'wasted', beforeEnd: Math.max(0, Math.round(end - minute)) };
    if (judgeRare && finished && known.has(key) && !pctOf.has(key) && !NOT_RARE.has(key) && !threat) return { key, minute, flag: 'rare', pct: 0 };
    return { key, minute, flag: null };
  });
  return { rows, timed, mistakes: rows.filter((r) => r.flag).length };
}
