import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import type { Hero } from '../../types';
import { fetchRecent } from '../../player/api';
import type { RecentGame } from '../../player/poolStats';
import { useMe } from '../../player/usePlayer';
import { HeroPortrait } from '../HeroPortrait';

type Load = { kind: 'loading' } | { kind: 'ready'; games: RecentGame[] } | { kind: 'error' };

function ago(t: (k: StringKey, v?: Record<string, string | number>) => string, unixSec: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - unixSec * 1000) / 60_000));
  if (min < 60) return t('match.recent.min', { n: Math.max(1, min) });
  const h = Math.round(min / 60);
  if (h < 24) return t('match.recent.h', { n: h });
  return t('match.recent.d', { n: Math.round(h / 24) });
}

/**
 * "Your recent matches": with a saved profile the last 20 games are one tap
 * away (fresh each visit, the cached list if the service is down); without
 * one, an invitation to connect it.
 */
export function MyMatches({ heroById, current, onPick }: {
  heroById: Map<number, Hero> | undefined;
  current: number | null;
  onPick: (matchId: number, accountId: number) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const me = useMe();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const hidden = me.profile?.hidden ?? false;

  useEffect(() => {
    if (me.id == null || hidden) return;
    let alive = true;
    setLoad({ kind: 'loading' });
    fetchRecent(me.id, { fresh: true })
      .then((games) => alive && setLoad({ kind: 'ready', games }))
      .catch(() => alive && setLoad({ kind: 'error' }));
    return () => { alive = false; };
  }, [me.id, hidden]);

  if (me.id == null) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line-2 px-3 py-2.5">
        <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted">{t('match.recent.connect')}</p>
        <a href={`/?profile${i18n.lang === 'ru' ? '&lang=ru' : ''}`} className="btn btn-ghost btn-sm">{t('match.recent.connectBtn')} →</a>
      </div>
    );
  }
  if (hidden) return <p className="mt-4 text-[13px] leading-[18px] text-muted">{t('match.recent.hidden')}</p>;

  const id = me.id;
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="label">{t('match.recent.title')}</h3>
        <span className="hidden text-[11px] text-muted sm:block">{t('match.recent.hint')}</span>
      </div>
      {load.kind === 'loading' && (
        <div className="mt-2 flex gap-2 overflow-hidden" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((k) => <div key={k} className="skeleton h-[124px] w-[104px] flex-none !rounded-xl" />)}
        </div>
      )}
      {load.kind === 'error' && <p className="mt-2 text-[13px] text-muted">{t('match.recent.error')}</p>}
      {load.kind === 'ready' && (load.games.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">{t('match.recent.none')}</p>
      ) : (
        <ol className="no-scrollbar stagger -mx-4 mt-2 flex snap-x scroll-pl-4 gap-2 overflow-x-auto px-4 pb-2 pt-1 sm:-mx-6 sm:scroll-pl-6 sm:px-6">
          {load.games.map((g, i) => {
            const h = heroById?.get(g.heroId);
            const on = current === g.matchId;
            return (
              <li key={g.matchId} className="flex-none snap-start" style={{ '--i': i } as React.CSSProperties}>
                <button type="button" onClick={() => onPick(g.matchId, id)} aria-pressed={on}
                  aria-label={`${h ? i18n.heroName(h) : ''} · ${t(g.win ? 'match.win' : 'match.loss')} · ${g.kills}/${g.deaths}/${g.assists} · ${ago(t, g.start)}`}
                  className={`my-match ${on ? 'is-on' : ''}`}>
                  <span className={`block h-14 w-full overflow-hidden rounded-lg border-b-[3px] ${g.win ? 'border-pos' : 'border-neg'}`}>
                    {h && <HeroPortrait hero={h} fill />}
                  </span>
                  <span className={`mt-1.5 block text-left text-[11px] font-bold leading-[14px] ${g.win ? 'text-pos' : 'text-neg'}`}>{t(g.win ? 'match.recent.w' : 'match.recent.l')}</span>
                  <span className="tnum block text-left text-[12px] font-semibold leading-4 text-ink" title={t('cover.kda')}>{g.kills}/{g.deaths}/{g.assists}</span>
                  <span className="block truncate text-left text-[10px] text-muted">{ago(t, g.start)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ))}
    </div>
  );
}
