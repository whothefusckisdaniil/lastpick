import type { Hero } from '../../types';
import type { Build } from '../../data/dataset';
import { idealBuild, type SlotKind } from '../../scoring/idealBuild';
import { suggestItems, type ItemSuggestion } from '../../scoring/itemRules';
import { teamNeeds } from '../../scoring/teamNeeds';
import type { MatchPlayer } from '../model';
import type { Pos } from './players';

export type BuyVerdict = 'onTime' | 'early' | 'late' | 'missing' | 'have';

export interface BuildRow {
  key: string;
  id: number;
  kind: SlotKind | 'boots';
  /** Typical purchase minute in the statistical build. */
  typical: number;
  /** Minute this player completed it; null when not bought (or no purchase log). */
  bought: number | null;
  verdict: BuyVerdict;
  /** For kind 'draft': the rule behind it. */
  suggestion?: ItemSuggestion;
}

export interface BuildReview {
  rows: BuildRow[];
  /** Big items the player ended with that the ideal build does not list. */
  extra: string[];
  /** True when there is a purchase log (else only the final inventory). */
  timed: boolean;
}

/** Late = this many minutes after the usual time (or 25% of it, if more). */
export const LATE = { minutes: 4, share: 0.25 } as const;

/** Cheap or consumable items: never listed as "extra". */
const MINOR = new Set([
  'tpscroll', 'ward_observer', 'ward_sentry', 'ward_dispenser', 'dust', 'smoke_of_deceit', 'clarity', 'tango', 'flask', 'enchanted_mango',
  'faerie_fire', 'blood_grenade', 'branches', 'magic_stick', 'magic_wand', 'bottle', 'quelling_blade', 'orb_of_venom', 'circlet', 'slippers',
  'mantle', 'gauntlets', 'ring_of_protection', 'wind_lace', 'boots', 'gloves', 'boots_of_elves', 'belt_of_strength', 'robe', 'blades_of_attack',
  'ogre_axe', 'blade_of_alacrity', 'staff_of_wizardry', 'point_booster', 'vitality_booster', 'energy_booster', 'ring_of_health', 'void_stone',
  'sobi_mask', 'fluffy_hat', 'chainmail', 'broadsword', 'claymore', 'mithril_hammer', 'javelin', 'quarterstaff', 'cornucopia', 'tiara_of_selemene',
  'ring_of_regen', 'headdress', 'buckler', 'bracer', 'wraith_band', 'null_talisman', 'cheese', 'aegis', 'refresher_shard', 'ultimate_orb',
  'demon_edge', 'eagle', 'reaver', 'relic', 'mystic_staff', 'hyperstone', 'platemail', 'talisman_of_evasion', 'lifesteal', 'voodoo_mask',
  'shadow_amulet', 'cloak', 'helm_of_iron_will', 'crown', 'diadem', 'blitz_knuckles', 'great_famango', 'famango', 'infused_raindrop',
]);

/**
 * What the player bought against what the ideal build (the one the site
 * shows for this draft) asks for, and when.
 */
export function reviewBuild(args: {
  player: MatchPlayer;
  hero: Hero;
  pos: Pos;
  build: Build;
  itemOf: (id: number) => [string, string, string[]?] | undefined;
  /** Item key of any id (OpenDota constants), for the final inventory. */
  keyOfId: (id: number) => string | undefined;
  enemies: Hero[];
  allies: Hero[];
  available?: Set<string>;
}): BuildReview {
  const { player, hero, pos, build, itemOf, keyOfId } = args;
  const suggestions = suggestItems({ hero, position: pos, enemies: args.enemies, build, itemKeyOf: (id) => itemOf(id)?.[0], available: args.available });
  const ib = idealBuild(build, itemOf, suggestions, teamNeeds(args.allies, pos));

  const finalKeys = new Set([...player.items, ...player.backpack].map(keyOfId).filter((k): k is string => !!k));
  if (player.scepter) finalKeys.add('ultimate_scepter');
  const firstBuy = new Map<string, number>();
  for (const b of player.purchases ?? []) if (!firstBuy.has(b.key)) firstBuy.set(b.key, Math.max(0, Math.round(b.time / 60)));
  const timed = player.purchases != null;

  const row = (id: number, typical: number, kind: BuildRow['kind'], suggestion?: ItemSuggestion): BuildRow | null => {
    const key = itemOf(id)?.[0];
    if (!key) return null;
    const bought = firstBuy.get(key) ?? null;
    // An item upgraded later (Dragon Lance → Pike) is no longer in the
    // inventory; without a purchase log only the final inventory counts.
    const has = bought != null || finalKeys.has(key);
    const late = Math.max(LATE.minutes, typical * LATE.share);
    const verdict: BuyVerdict = !has ? 'missing'
      : bought == null ? 'have'
        : bought > typical + late ? 'late'
          : bought < typical - late ? 'early' : 'onTime';
    return { key, id, kind, typical, bought, verdict, suggestion };
  };

  const rows: BuildRow[] = [];
  if (ib.boots) { const r = row(ib.boots.id, ib.boots.minute, 'boots'); if (r) rows.push(r); }
  for (const s of ib.slots) { const r = row(s.id, s.minute, s.kind, s.suggestion); if (r) rows.push(r); }
  // A counter item the rules ask for but the ideal build had no room for
  // is still worth checking (BKB against six disables).
  for (const s of suggestions) {
    if (rows.some((r) => r.key === s.key)) continue;
    const entry = build.items.find((x) => itemOf(x[0])?.[0] === s.key);
    if (!entry) continue;
    const r = row(entry[0], entry[2], 'draft', s);
    if (r) rows.push(r);
  }

  const listed = new Set(rows.map((r) => r.key));
  const extra = [...new Set([...player.items, ...player.backpack].map(keyOfId))]
    .filter((k): k is string => !!k && !listed.has(k) && !MINOR.has(k) && !k.startsWith('recipe_'));
  return { rows, extra, timed };
}
