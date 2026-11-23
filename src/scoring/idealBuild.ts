import type { Build } from '../data/dataset';
import type { ItemSuggestion } from './itemRules';
import type { TeamNeed } from './teamNeeds';
import { itemHasRole } from '../data/itemTags';

/**
 * "Ideal build" for your hero: boots + 6 slots in buying order.
 *
 *  1. Core — what this hero buys in ≥ 35% of games at this position/rank.
 *  2. Draft — up to 3 items for the enemy draft, only from what this hero
 *     buys (itemRules already filters that), with the reason. They may take
 *     the place of a weak core item (35–50%), never of solid core (≥ 50%).
 *  3. Team — up to 2 of the remaining slots for what your team lacks
 *     (teamNeeds.ts: damage / control / saves), from what this hero buys.
 *  4. Situational — the hero's next most popular items fill the rest, the
 *     ones the team needs first.
 *
 * Components most players complete are replaced by the finished item (Yasha
 * → Manta, Perseverance → Battle Fury, Crystalys → Daedalus): a component
 * leaves the list when its upgrade is bought in at least half as many games.
 * Two upgrades of the same intermediate (Hurricane Pike and Hydra's Breath
 * both need Dragon Lance) are alternatives: only the more popular one stays.
 * So are the farming items (Radiance / Maelstrom-Mjollnir / Battle Fury) —
 * see FARM_ALTERNATIVES.
 * Aghanim's Shard / Blessing and boots do not take a slot; the shard is
 * reported separately (shown after the slots as "no slot"). Order = typical purchase minute.
 */
export type SlotKind = 'core' | 'draft' | 'team' | 'situational';

export interface IdealSlot {
  id: number;
  key: string;
  pct: number;
  minute: number;
  kind: SlotKind;
  suggestion?: ItemSuggestion;
  /** For kind 'team': the team need it answers. */
  need?: TeamNeed;
}

export interface IdealBuild {
  boots: { id: number; pct: number; minute: number } | null;
  /** Counter items this hero buys that this draft does not call for (shown
   *  apart with their condition, not in a slot). */
  onDemand: { id: number; key: string; pct: number; minute: number }[];
  slots: IdealSlot[];
  shard: { id: number; pct: number; minute: number } | null;
}

export const IDEAL = { slots: 6, corePct: 0.35, solidCorePct: 0.5, laningMinute: 12, draftSlots: 3, teamSlots: 2, teamMinPct: 0.05, upgradeRatio: 0.5, shardMinPct: 0.1, onDemandMinPct: 0.05 } as const;

const NO_SLOT = new Set(['aghanims_shard', 'ultimate_scepter_2']);

/** First big farming item: heroes go one way (Radiance OR Maelstrom/Mjollnir
 *  OR Battle Fury), rarely two. The data only has each item's own share, not
 *  how often they are bought together, so a non-core one of these is dropped
 *  when a more popular one is in the build. Two core ones (≥ 35%) both stay. */
/**
 * Items bought only as an answer to a specific enemy (MKB vs evasion, Pipe vs
 * magic burst, Spirit Vessel vs heals…). Unless the hero buys one in ≥ 35% of
 * games (core), it takes a slot only when the draft rules ask for it — never
 * as a filler — and is otherwise listed under "on demand" with its condition.
 * The value is the condition's string key (build.when.*).
 */
export const COUNTER_ONLY: Record<string, string> = {
  monkey_king_bar: 'evasion', nullifier: 'dispel', ghost: 'physical', heavens_halberd: 'physical',
  crimson_guard: 'physical', pipe: 'magic', lotus_orb: 'targeted', spirit_vessel: 'heal', mage_slayer: 'magic',
  aeon_disk: 'burst', sphere: 'targeted', gem: 'invis', dust: 'invis', ward_sentry: 'invis',
};

export const FARM_ALTERNATIVES = new Set(['radiance', 'maelstrom', 'mjollnir', 'gleipnir', 'bfury']);

export function idealBuild(
  build: Build,
  /** itemId → [key, name, components?] (builds index). */
  itemOf: (id: number) => [string, string, string[]?] | undefined,
  suggestions: ItemSuggestion[] = [],
  /** What your team lacks (teamNeeds.ts): up to 2 slots go to items for it. */
  needs: TeamNeed[] = [],
): IdealBuild {
  const key = (id: number) => itemOf(id)?.[0] ?? '';
  const allLater = build.items.filter((x) => x[2] >= IDEAL.laningMinute && !NO_SLOT.has(key(x[0])));
  const comps = (id: number) => itemOf(id)?.[2] ?? [];
  // Intermediate items: bought on their own here and part of another recipe
  // (Dragon Lance, Maelstrom, Yasha, Kaya…).
  const boughtKeys = new Set(allLater.map((x) => key(x[0])));
  // Alternative upgrades of one intermediate (Dragon Lance → Hurricane Pike
  // OR Hydra's Breath) need it twice to have both: keep the more popular one.
  const later = allLater.filter((x) => !allLater.some((y) => y !== x
    && (y[1] > x[1] || (y[1] === x[1] && y[0] < x[0]))
    && comps(x[0]).some((c) => boughtKeys.has(c) && comps(y[0]).includes(c))));

  // Drop a component when its upgrades together are bought by at least half
  // as many: Dragon Lance 86% → Pike 42% + Hydra 28% = 70% (each alone is
  // under half). Upgrades left out as alternatives count too — Specialist's
  // Array leads to Hydra's Breath, and without Hydra it is a path not taken.
  const isCompleted = (k: string, pct: number) => allLater
    .filter((y) => comps(y[0]).includes(k))
    .reduce((sum, y) => sum + y[1], 0) >= pct * IDEAL.upgradeRatio;
  const finished = later.filter((x) => !isCompleted(key(x[0]), x[1]));
  const farm = finished.filter((x) => FARM_ALTERNATIVES.has(key(x[0])));
  // A component that stayed (its upgrade is rare: Skull Basher 41% vs Abyssal
  // 19%) already fills that slot — the upgrade is the same slot later, not
  // another item, so it does not get a slot of its own.
  const keptKeys = new Set(finished.map((x) => key(x[0])));
  const pool = finished.filter((x) => !FARM_ALTERNATIVES.has(key(x[0])) || x[1] >= IDEAL.corePct
    || !farm.some((y) => y !== x && (y[1] > x[1] || (y[1] === x[1] && y[0] < x[0]))))
    .filter((x) => !comps(x[0]).some((c) => keptKeys.has(c)));

  const chosen = new Map<number, IdealSlot>();
  const add = (x: (typeof pool)[number], kind: SlotKind, suggestion?: ItemSuggestion, need?: TeamNeed) => {
    if (chosen.size >= IDEAL.slots || chosen.has(x[0])) return;
    chosen.set(x[0], { id: x[0], key: key(x[0]), pct: x[1], minute: x[2], kind, suggestion, need });
  };
  const needOf = (x: (typeof pool)[number]) => needs.find((n) => itemHasRole(key(x[0]), n.role));

  const byPct = [...pool].sort((a, b) => b[1] - a[1]);
  const core = byPct.filter((x) => x[1] >= IDEAL.corePct);
  const draft = suggestions
    .map((s) => ({ s, x: pool.find((p) => key(p[0]) === s.key) }))
    .filter((d): d is { s: ItemSuggestion; x: (typeof pool)[number] } => !!d.x)
    .slice(0, IDEAL.draftSlots);
  // Solid core (≥ 50%: BKB, the main damage) is never displaced; draft items
  // take the free slots and then those of the weakest core (35–50%).
  const solid = core.filter((x) => x[1] >= IDEAL.solidCorePct);
  const room = Math.max(0, IDEAL.slots - solid.length);
  const draftFit = draft.slice(0, room);
  solid.forEach((x) => add(x, 'core'));
  core.filter((x) => x[1] < IDEAL.solidCorePct).slice(0, room - draftFit.length).forEach((x) => add(x, 'core'));
  draftFit.forEach(({ s, x }) => add(x, 'draft', s));
  // Team slots: the slots left after core and draft (core is never displaced)
  // go first to items this hero buys (≥ 5%) that answer what the team lacks.
  byPct
    .filter((x) => x[1] < IDEAL.corePct && x[1] >= IDEAL.teamMinPct && needOf(x) && !(key(x[0]) in COUNTER_ONLY))
    .slice(0, IDEAL.teamSlots)
    .forEach((x) => add(x, 'team', undefined, needOf(x)));
  // the rest: popular items, the ones the team needs first
  // the rest: popular items, the ones the team needs first — never a
  // counter-only item the draft did not ask for
  const filler = (x: (typeof pool)[number]) => !(key(x[0]) in COUNTER_ONLY);
  [...byPct].filter(filler).sort((a, b) => (needOf(b) ? 1.5 : 1) * b[1] - (needOf(a) ? 1.5 : 1) * a[1]).forEach((x) => add(x, 'situational'));
  const onDemand = byPct
    .filter((x) => !filler(x) && !chosen.has(x[0]) && x[1] >= IDEAL.onDemandMinPct)
    .map((x) => ({ id: x[0], key: key(x[0]), pct: x[1], minute: x[2] }));

  const upgraded = build.boots.filter(([id]) => key(id) !== 'boots');
  const b = (upgraded.length ? upgraded : build.boots)[0];
  const shardRow = build.items.find((x) => key(x[0]) === 'aghanims_shard');

  return {
    boots: b ? { id: b[0], pct: b[1], minute: b[2] } : null,
    onDemand,
    slots: [...chosen.values()].sort((a, b) => a.minute - b.minute),
    // Purchases only: a shard from a Tormentor is free and invisible here, so
    // the real share is higher — a low bar, and the UI says so.
    shard: shardRow && shardRow[1] >= IDEAL.shardMinPct ? { id: shardRow[0], pct: shardRow[1], minute: shardRow[2] } : null,
  };
}
