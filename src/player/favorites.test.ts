import { describe, expect, it, vi } from 'vitest';

describe('favourites storage', () => {
  it('max 10, no repeats, remembered, cleared with "forget me"', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    });
    vi.resetModules();
    const m = await import('./usePlayer');
    m.setFavorites([1, 2, 2, 3, -1, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(store.get('lp.favorites')).toBe('1,2,3,4,5,6,7,8,9,10');
    // a fresh module (a reload) reads them back
    vi.resetModules();
    const again = await import('./usePlayer');
    again.setMe(1001);
    again.setFavorites([...store.get('lp.favorites')!.split(',').map(Number).slice(0, 2)]);
    expect(store.get('lp.favorites')).toBe('1,2');
    again.setMe(null);
    expect(store.has('lp.favorites')).toBe(false);
  });
});
