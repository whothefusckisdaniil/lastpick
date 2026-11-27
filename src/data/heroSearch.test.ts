import { describe, expect, it } from 'vitest';
import heroesRaw from '../../public/data/heroes.json';
import type { Hero } from '../types';
import { initialsOf, searchHeroes } from './heroes';
import { HERO_ALIASES_EN } from '../i18n/heroAliasesEn';

const heroes = heroesRaw as unknown as Hero[];
const first = (q: string) => searchHeroes(heroes, q)[0]?.name;

describe('English hero search', () => {
  it.each([
    ['sk', 'Sand King'], ['sf', 'Shadow Fiend'], ['am', 'Anti-Mage'], ['cm', 'Crystal Maiden'],
    ['pa', 'Phantom Assassin'], ['pl', 'Phantom Lancer'], ['qop', 'Queen of Pain'], ['kotl', 'Keeper of the Light'],
    ['np', "Nature's Prophet"], ['od', 'Outworld Destroyer'], ['wk', 'Wraith King'], ['wd', 'Witch Doctor'],
    ['lc', 'Legion Commander'], ['mk', 'Monkey King'], ['aa', 'Ancient Apparition'], ['ta', 'Templar Assassin'],
    ['ck', 'Chaos Knight'], ['dk', 'Dragon Knight'], ['bh', 'Bounty Hunter'], ['ww', 'Winter Wyvern'],
  ])('initials: %s → %s', (q, name) => expect(first(q)).toBe(name));

  it.each([
    ['wr', 'Windranger'], ['es', 'Earthshaker'], ['ss', 'Shadow Shaman'], ['ns', 'Night Stalker'],
    ['bb', 'Bristleback'], ['tb', 'Terrorblade'], ['ls', 'Lifestealer'], ['bm', 'Beastmaster'], ['cw', 'Clockwerk'],
    ['wisp', 'Io'], ['furion', "Nature's Prophet"], ['rhasta', 'Shadow Shaman'], ['jugg', 'Juggernaut'],
    ['invo', 'Invoker'], ['timber', 'Timbersaw'], ['pango', 'Pangolier'], ['naix', 'Lifestealer'],
  ])('slang: %s → %s', (q, name) => expect(first(q)).toBe(name));

  it('a hand-written alias ranks above derived initials; the others still follow', () => {
    const es = searchHeroes(heroes, 'es').map((h) => h.name);
    expect(es[0]).toBe('Earthshaker');
    expect(es).toEqual(expect.arrayContaining(['Ember Spirit', 'Earth Spirit']));
    expect(searchHeroes(heroes, 'ss').map((h) => h.name).slice(0, 2)).toEqual(['Shadow Shaman', 'Storm Spirit']);
  });

  it('full names and prefixes still work; case and punctuation do not matter', () => {
    expect(first('sand')).toBe('Sand King');
    expect(first('SAND KING')).toBe('Sand King');
    expect(first('natures')).toBe("Nature's Prophet");
    expect(first('anti mage')).toBe('Anti-Mage');
  });

  it('Russian search is unchanged', () => {
    expect(first('сф')).toBe('Shadow Fiend');
    expect(first('дровка')).toBe('Drow Ranger');
  });

  it('initials only for multi-word names', () => {
    expect(initialsOf('Sand King')).toBe('sk');
    expect(initialsOf("Nature's Prophet")).toBe('np');
    expect(initialsOf('Axe')).toBeNull();
  });

  it('the alias list names real heroes and no alias points to two of them', () => {
    const keys = new Set(heroes.map((h) => h.key.replace('npc_dota_hero_', '')));
    for (const k of Object.keys(HERO_ALIASES_EN)) expect(keys, k).toContain(k);
    const seen = new Map<string, string>();
    for (const [k, list] of Object.entries(HERO_ALIASES_EN)) for (const a of list) {
      expect(a, a).toBe(a.toLowerCase());
      expect(seen.get(a), `"${a}" used by ${seen.get(a)} and ${k}`).toBeUndefined();
      seen.set(a, k);
    }
  });
});
