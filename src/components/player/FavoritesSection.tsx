import { useMemo } from 'react';
import { useI18n } from '../../i18n';
import type { Hero } from '../../types';
import { MAX_FAVORITES, setFavorites } from '../../player/usePlayer';
import { HeroPortrait } from '../HeroPortrait';
import { HeroSearch } from '../HeroSearch';

/** Up to 10 favourite heroes: always offered in "My pool", even without games on them yet. */
export function FavoritesSection({ favorites, heroes, heroById }: { favorites: number[]; heroes: Hero[]; heroById: Map<number, Hero> }) {
  const i18n = useI18n();
  const { t } = i18n;
  const chosen = useMemo(() => new Set(favorites), [favorites]);
  const full = favorites.length >= MAX_FAVORITES;

  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="fav-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="fav-title" className="font-display text-[16px] font-bold text-ink">{t('fav.title')}</h3>
        <span className="tnum text-[12px] text-muted">{t('fav.count', { n: favorites.length, max: MAX_FAVORITES })}</span>
      </div>
      <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('fav.text')}</p>

      {favorites.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {favorites.map((id) => {
            const h = heroById.get(id);
            const name = h ? i18n.heroName(h) : `#${id}`;
            return (
              <li key={id} className="panel-2 flex items-center gap-2 py-1 pl-1 pr-1.5">
                <span className="h-8 w-8 flex-none overflow-hidden rounded-md">{h && <HeroPortrait hero={h} fill />}</span>
                <span className="text-[13px] font-semibold text-ink">{name}</span>
                <button type="button" onClick={() => setFavorites(favorites.filter((x) => x !== id))}
                  className="icon-btn !h-7 !w-7 !rounded-md text-[15px]" aria-label={t('fav.remove', { name })} title={t('fav.remove', { name })}>×</button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3">
        {full ? <p className="text-[12px] text-muted">{t('fav.full', { max: MAX_FAVORITES })}</p>
          : <HeroSearch heroes={heroes} excluded={chosen} onPick={(h) => setFavorites([...favorites, h.id])} />}
      </div>
    </section>
  );
}
