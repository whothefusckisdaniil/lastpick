import { describe, expect, it } from 'vitest';
import type { Build } from '../data/dataset';
import { idealBuild, itemLevel } from './idealBuild';
import type { ItemSuggestion } from './itemRules';

const ITEMS: Record<number, [string, string, string[]?]> = {
  29: ['boots', 'Boots of Speed'], 63: ['power_treads', 'Power Treads'],
  36: ['magic_wand', 'Magic Wand'],
  145: ['bfury', 'Battle Fury', ['pers', 'broadsword']], 69: ['pers', 'Perseverance'],
  170: ['yasha', 'Yasha'], 147: ['manta', 'Manta Style', ['yasha', 'diadem']],
  1: ['blink', 'Blink Dagger'], 139: ['butterfly', 'Butterfly'], 108: ['ultimate_scepter', "Aghanim's Scepter"],
  609: ['aghanims_shard', "Aghanim's Shard"], 135: ['monkey_king_bar', 'Monkey King Bar'], 143: ['basher', 'Skull Basher'],
  160: ['skadi', 'Eye of Skadi'], 158: ['mjollnir', 'Mjollnir', ['maelstrom', 'hyperstone']], 166: ['maelstrom', 'Maelstrom'],
};
const itemOf = (id: number) => ITEMS[id];

/** Anti-Mage-like build. */
const BUILD = {
  m: 10000, low: false, start: [], talents: [], skills: [],
  boots: [[63, 0.9, 9], [29, 0.3, 4]],
  items: [
    [36, 0.65, 3, 50], [69, 0.99, 11, 50], [145, 0.99, 15, 51], [170, 0.98, 18, 52], [147, 0.96, 22, 53],
    [1, 0.7, 25, 54], [139, 0.58, 30, 55], [108, 0.4, 33, 53], [609, 0.5, 28, 52], [143, 0.3, 31, 54],
    [135, 0.12, 35, 56], [160, 0.2, 33, 55], [166, 0.45, 14, 50], [158, 0.1, 28, 52],
  ],
} as unknown as Build;

describe('ideal build', () => {
  it('reports the shard from 10% of purchases (Tormentor shards are not purchases)', () => {
    const low = { ...BUILD, items: BUILD.items.map((x) => (x[0] === 609 ? [609, 0.13, 25, 52] : x)) } as unknown as Build;
    expect(idealBuild(low, itemOf).shard).toEqual({ id: 609, pct: 0.13, minute: 25 });
    const rare = { ...BUILD, items: BUILD.items.map((x) => (x[0] === 609 ? [609, 0.06, 25, 52] : x)) } as unknown as Build;
    expect(idealBuild(rare, itemOf).shard).toBeNull();
  });

  it('six slots in buying order, completed components replaced, shard and boots aside', () => {
    const ib = idealBuild(BUILD, itemOf);
    expect(ib.boots).toEqual({ id: 63, pct: 0.9, minute: 9 });
    expect(ib.shard?.id).toBe(609);
    const keys = ib.slots.map((s) => s.key);
    expect(keys).toHaveLength(6);
    expect(keys).not.toContain('yasha'); // → Manta
    expect(keys).not.toContain('pers'); // → Battle Fury (laning-minute items are not slots anyway)
    expect(keys).not.toContain('magic_wand');
    expect(keys).toContain('maelstrom'); // Mjollnir is rare: Maelstrom stays
    expect(keys).toEqual(['maelstrom', 'bfury', 'manta', 'blink', 'butterfly', 'ultimate_scepter']);
    expect(ib.slots.map((s) => s.minute)).toEqual([...ib.slots.map((s) => s.minute)].sort((a, b) => a - b));
  });

  it('puts draft items the hero buys into the slots with their reason', () => {
    const mkb = { key: 'monkey_king_bar', name: 'Monkey King Bar', score: 2, buildPct: 0.12, reasons: [] } as ItemSuggestion;
    const bkb = { key: 'black_king_bar', name: 'Black King Bar', score: 3, buildPct: 0, reasons: [] } as ItemSuggestion;
    const ib = idealBuild(BUILD, itemOf, [bkb, mkb]);
    const slot = ib.slots.find((s) => s.key === 'monkey_king_bar');
    expect(slot?.kind).toBe('draft');
    expect(slot?.suggestion).toBe(mkb);
    expect(ib.slots.map((s) => s.key)).not.toContain('black_king_bar'); // not in this hero's build
    expect(ib.slots).toHaveLength(6);
  });
});

describe('alternative upgrades of one intermediate item', () => {
  const ITEMS2: Record<number, [string, string, string[]?]> = {
    236: ['dragon_lance', 'Dragon Lance', ['blade_of_alacrity', 'belt_of_strength']],
    102: ['force_staff', 'Force Staff', ['staff_of_wizardry', 'fluffy_hat']],
    263: ['hurricane_pike', 'Hurricane Pike', ['force_staff', 'dragon_lance']],
    1806: ['hydras_breath', "Hydra's Breath", ['specialists_array', 'dragon_lance', 'orb_of_venom']],
    1800: ['specialists_array', "Specialist's Array", ['blade_of_alacrity', 'broadsword']],
    166: ['maelstrom', 'Maelstrom'], 158: ['mjollnir', 'Mjollnir', ['maelstrom', 'hyperstone']],
  };
  const SNIPER = {
    m: 1000, low: false, start: [], talents: [], skills: [], boots: [],
    items: [[166, 0.69, 15, 50], [236, 0.88, 17, 50], [102, 0.46, 24, 50], [263, 0.45, 25, 50], [158, 0.49, 26, 50],
      [1800, 0.31, 26, 50], [1806, 0.29, 28, 50]],
  } as unknown as Build;

  it("keeps one of Hurricane Pike / Hydra's Breath (both need Dragon Lance)", () => {
    const keys = idealBuild(SNIPER, (id) => ITEMS2[id]).slots.map((s) => s.key);
    expect(keys).toContain('hurricane_pike');
    expect(keys).not.toContain('hydras_breath');
    expect(keys).not.toContain('dragon_lance'); // completed into the Pike
    expect(keys).not.toContain('specialists_array'); // on the Hydra path, which is not taken
  });

  it('Sniper (Divine, 7.42): Lance completed by Pike + Hydra together, Array (Hydra path) dropped', () => {
    const SNIPER2 = {
      m: 9583, low: false, start: [], talents: [], skills: [], boots: [],
      items: [[236, 0.857, 17, 50], [166, 0.58, 14, 50], [102, 0.464, 23, 50], [158, 0.431, 24, 50], [263, 0.425, 24, 50],
        [1800, 0.306, 21, 50], [1806, 0.277, 25, 50]],
    } as unknown as Build;
    const keys = idealBuild(SNIPER2, (id) => ITEMS2[id]).slots.map((s) => s.key);
    expect(keys).toContain('hurricane_pike');
    expect(keys).toContain('mjollnir');
    expect(keys).not.toContain('dragon_lance');
    expect(keys).not.toContain('specialists_array');
    expect(keys).not.toContain('hydras_breath');
  });
});

describe('farming items are alternatives', () => {
  const ITEMS3: Record<number, [string, string, string[]?]> = {
    166: ['maelstrom', 'Maelstrom'], 158: ['mjollnir', 'Mjollnir', ['maelstrom', 'hyperstone']],
    137: ['radiance', 'Radiance'], 116: ['black_king_bar', 'Black King Bar'], 145: ['basher', 'Skull Basher'],
    127: ['blade_mail', 'Blade Mail'], 154: ['sange_and_yasha', 'Sange and Yasha'], 208: ['abyssal_blade', 'Abyssal Blade', ['basher']],
    108: ['ultimate_scepter', "Aghanim's Scepter"],
  };
  // Bloodseeker mid, Crusader–Archon, patch 7.42
  const BS = {
    m: 1586, low: false, start: [], talents: [], skills: [], boots: [],
    items: [[127, 0.396, 15, 50], [166, 0.479, 16, 50], [137, 0.233, 19, 50], [158, 0.296, 26, 50], [154, 0.197, 27, 50],
      [116, 0.624, 28, 50], [145, 0.411, 31, 50], [108, 0.153, 34, 50], [208, 0.185, 39, 50]],
  } as unknown as Build;

  it('Bloodseeker: Mjollnir or Radiance, not both', () => {
    const keys = idealBuild(BS, (id) => ITEMS3[id]).slots.map((s) => s.key);
    expect(keys).toContain('mjollnir');
    expect(keys).not.toContain('radiance');
    // Skull Basher stays (Abyssal is rare): Abyssal is not a second slot
    expect(keys).toContain('basher');
    expect(keys).not.toContain('abyssal_blade');
    expect(keys).toHaveLength(6);
  });

  it('two core farming items both stay', () => {
    const both = { ...BS, items: BS.items.map((x) => (x[0] === 137 ? [137, 0.4, 19, 50] : x[0] === 158 ? [158, 0.36, 26, 50] : x)) } as unknown as Build;
    const keys = idealBuild(both, (id) => ITEMS3[id]).slots.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['radiance', 'mjollnir']));
  });
});

describe('counter-only items', () => {
  const ITEMS4: Record<number, [string, string, string[]?]> = {
    158: ['mjollnir', 'Mjollnir'], 263: ['hurricane_pike', 'Hurricane Pike'], 116: ['black_king_bar', 'Black King Bar'],
    135: ['monkey_king_bar', 'Monkey King Bar'], 140: ['greater_crit', 'Daedalus'], 152: ['invis_sword', 'Shadow Blade'],
    164: ['mask_of_madness', 'Mask of Madness'],
  };
  const SN = {
    m: 9583, low: false, start: [], talents: [], skills: [], boots: [],
    items: [[164, 0.338, 12, 50], [158, 0.431, 24, 50], [263, 0.425, 24, 50], [116, 0.23, 32, 50], [135, 0.22, 34, 50],
      [140, 0.226, 36, 50], [152, 0.238, 28, 50]],
  } as unknown as Build;

  it('MKB is no filler without evasion in the draft; listed as on demand', () => {
    const ib = idealBuild(SN, (id) => ITEMS4[id]);
    expect(ib.slots.map((s) => s.key)).not.toContain('monkey_king_bar');
    expect(ib.onDemand.map((x) => x.key)).toEqual(['monkey_king_bar']);
  });

  it('MKB takes a slot when the draft asks for it', () => {
    const mkb = { key: 'monkey_king_bar', name: 'MKB', score: 2, buildPct: 0.22, reasons: [] } as ItemSuggestion;
    const ib = idealBuild(SN, (id) => ITEMS4[id], [mkb]);
    expect(ib.slots.find((s) => s.key === 'monkey_king_bar')?.kind).toBe('draft');
    expect(ib.onDemand).toEqual([]);
  });
});

describe('draft items that are upgrades', () => {
  // Storm Spirit-like (Crusader, mid): Orchid 24% "holds the slot" of Bloodthorn 10%
  const IT: Record<number, [string, string, string[]?]> = {
    63: ['power_treads', 'Power Treads'], 3: ['oblivion_staff', 'Oblivion Staff'], 4: ['kaya_and_sange', 'Kaya and Sange'],
    5: ['black_king_bar', 'Black King Bar'], 6: ['parasma', 'Parasma'], 7: ['orchid', 'Orchid Malevolence', ['oblivion_staff']],
    8: ['bloodthorn', 'Bloodthorn', ['orchid', 'hyperstone']], 9: ['shivas_guard', "Shiva's Guard"], 10: ['ultimate_scepter', "Aghanim's Scepter"],
    11: ['sheepstick', 'Scythe of Vyse'],
  };
  const STORM = {
    m: 18000, low: false, start: [], talents: [], skills: [], boots: [[63, 0.95, 9]],
    items: [[3, 0.95, 13, 50], [4, 0.62, 24, 50], [5, 0.62, 27, 50], [6, 0.5, 32, 50], [7, 0.24, 19, 50], [8, 0.1, 35, 50], [9, 0.06, 38, 50], [10, 0.23, 40, 50], [11, 0.1, 41, 50]],
  } as unknown as Build;
  const sug = (key: string): ItemSuggestion => ({ key, name: key, score: 1, buildPct: 0.1, reasons: [] });

  it('an asked-for upgrade goes into the slot and replaces its component', () => {
    const ib = idealBuild(STORM, (id) => IT[id], [sug('bloodthorn'), sug('shivas_guard')]);
    const keys = ib.slots.map((s) => s.key);
    expect(keys).toContain('bloodthorn');
    expect(keys).toContain('shivas_guard');
    expect(keys).not.toContain('orchid');
    expect(ib.slots.find((s) => s.key === 'bloodthorn')?.kind).toBe('draft');
    // solid core stays
    expect(keys).toEqual(expect.arrayContaining(['kaya_and_sange', 'black_king_bar', 'parasma']));
    expect(ib.slots).toHaveLength(6);
  });

  it('an asked-for component the hero completes is answered by the upgrade (no Force Staff next to Pike)', () => {
    const IT2: Record<number, [string, string, string[]?]> = { ...IT, 20: ['force_staff', 'Force Staff'], 21: ['hurricane_pike', 'Hurricane Pike', ['force_staff', 'dragon_lance']] };
    const b = { ...STORM, items: [...(STORM as unknown as { items: number[][] }).items, [20, 0.4, 20, 50], [21, 0.35, 28, 50]] } as unknown as Build;
    const ib = idealBuild(b, (id) => IT2[id], [sug('force_staff')]);
    const keys = ib.slots.map((s) => s.key);
    expect(keys).toContain('hurricane_pike');
    expect(keys).not.toContain('force_staff');
    // Pike is core here (35%): a core item that also answers the draft keeps its core label, as before
    expect(ib.slots.filter((s) => s.key === 'hurricane_pike')).toHaveLength(1);
  });

  it('without the draft asking, the upgrade stays out (its component holds the slot)', () => {
    expect(idealBuild(STORM, (id) => IT[id]).slots.map((s) => s.key)).not.toContain('bloodthorn');
  });
});

describe('leveled items (Dagon 1–5)', () => {
  // Nyx Assassin mid (Divine, 7.42): each Dagon level is its own item in the data
  const IT: Record<number, [string, string, string[]?]> = {
    180: ['arcane_boots', 'Arcane Boots'], 300: ['phylactery', 'Phylactery'], 104: ['dagon', 'Dagon', ['point_booster', 'crown', 'wizard_hat']],
    201: ['dagon_2', 'Dagon'], 202: ['dagon_3', 'Dagon'], 203: ['dagon_4', 'Dagon'], 204: ['dagon_5', 'Dagon'],
    108: ['ultimate_scepter', "Aghanim's Scepter"], 271: ['ultimate_scepter_2', "Aghanim's Blessing"], 223: ['meteor_hammer', 'Meteor Hammer'],
    100: ['cyclone', "Eul's Scepter of Divinity"], 102: ['force_staff', 'Force Staff'], 1: ['blink', 'Blink Dagger'], 259: ['kaya', 'Kaya'],
  };
  const NYX = {
    m: 9000, low: false, start: [], talents: [], skills: [], boots: [[180, 0.27, 9]],
    items: [[300, 0.41, 13, 50], [104, 0.47, 16, 50], [259, 0.42, 16, 50], [201, 0.35, 21, 50], [108, 0.51, 31, 50], [202, 0.31, 24, 50], [223, 0.3, 15, 50],
      [203, 0.26, 26, 50], [204, 0.23, 28, 50], [100, 0.19, 30, 50], [102, 0.13, 30, 50], [1, 0.06, 24, 50]],
  } as unknown as Build;

  it('one slot for all levels, with the level most buyers reach', () => {
    const ib = idealBuild(NYX, (id) => IT[id]);
    const dagons = ib.slots.filter((s) => s.key.startsWith('dagon'));
    expect(dagons).toHaveLength(1);
    expect(dagons[0]).toMatchObject({ key: 'dagon', pct: 0.47, minute: 16, kind: 'core' });
    // 2: 35%, 3: 31%, 4: 26% are ≥ half of 47%; 5: 23% is not
    expect(dagons[0].upTo).toEqual({ level: 4, minute: 26, pct: 0.26 });
    expect(ib.slots).toHaveLength(6);
    expect(ib.slots.map((s) => s.key)).toEqual(expect.arrayContaining(['phylactery', 'ultimate_scepter']));
  });

  it('items with a name of their own are not levels', () => {
    const idOf = (k: string) => Number(Object.entries(IT).find(([, v]) => v[0] === k)?.[0]);
    expect(itemLevel('dagon_3', (id) => IT[id], idOf)).toEqual({ base: 'dagon', level: 3 });
    expect(itemLevel('ultimate_scepter_2', (id) => IT[id], idOf)).toBeNull();
    expect(itemLevel('blink', (id) => IT[id], idOf)).toBeNull();
  });
});
