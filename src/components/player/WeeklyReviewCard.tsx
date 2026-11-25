import { useI18n } from '../../i18n';
import type { Hero } from '../../types';
import { APP_CONFIG } from '../../config';
import type { WeeklyReview } from '../../player/weeklyReview';
import { HeroPortrait } from '../HeroPortrait';
import { DiamondLoader } from '../Brand';
import { StatTile } from '../ui';

export type WeeklyState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; review: WeeklyReview; stale: boolean; fetchedAt: number };

const signed = (v: number, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`;

/** The weekly review: display only — numbers come ready from player/weeklyReview.ts. */
export function WeeklyReviewCard({ state, isMe, heroById }: { state: WeeklyState; isMe: boolean; heroById: Map<number, Hero> | undefined }) {
  const i18n = useI18n();
  const { t, plural } = i18n;
  const locale = i18n.lang === 'ru' ? 'ru-RU' : 'en-US';
  const day = (unix: number) => new Date(unix * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const matches = (n: number) => `${n} ${plural(n, 'match')}`;

  return (
    <section className="panel p-4 sm:p-6" aria-labelledby="weekly-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="weekly-title" className="font-display text-[16px] font-bold text-ink">{t(isMe ? 'weekly.titleMe' : 'weekly.title')}</h3>
        {state.kind === 'ready' && <span className="tnum text-[12px] text-muted">{t('weekly.range', { from: day(state.review.from), to: day(state.review.to) })}</span>}
      </div>

      {state.kind === 'loading' && <div className="mt-4"><DiamondLoader label={t('weekly.loading')} /></div>}
      {state.kind === 'error' && <p className="mt-3 text-[13px] text-muted">{t('weekly.error')}</p>}

      {state.kind === 'ready' && (() => {
        const { review: r } = state;
        const top = r.topHero;
        const hero = top ? heroById?.get(top.heroId) : undefined;
        return (
          <>
            {state.stale && (
              <div className="notice mt-3">{t('weekly.stale', { date: new Date(state.fetchedAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}</div>
            )}

            {r.current.matches === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-line-2 px-4 py-5 text-center">
                <p className="text-[14px] font-semibold text-ink">{t('weekly.empty')}</p>
                <p className="mt-1 text-[13px] text-muted">
                  {r.previous.matches > 0
                    ? t('weekly.emptyPrev', { matches: matches(r.previous.matches), wr: Math.round(r.previous.winrate ?? 0) })
                    : t('weekly.emptyBoth')}
                </p>
              </div>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                  <StatTile label={t('weekly.matches')} value={r.current.matches} />
                  <StatTile label={t('weekly.winrate')} value={`${r.current.winrate!.toFixed(1)}%`} tone={r.current.winrate! >= 50 ? 'pos' : 'neg'} />
                  <StatTile label={t('weekly.wins')} value={r.current.wins} tone="pos" />
                  <StatTile label={t('weekly.losses')} value={r.current.losses} tone="neg" />
                </div>
                {!r.confident && <p className="mt-2 text-[12px] leading-4 text-muted">{t('weekly.few', { matches: matches(r.current.matches), min: APP_CONFIG.player.weekly.minMatches })}</p>}

                <div className="mt-4">
                  <div className="label mb-1.5">{t('weekly.vsPrev')}</div>
                  {r.previous.matches === 0 ? (
                    <p className="text-[13px] text-muted">{t('weekly.noPrev')}</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="panel-2 flex items-center justify-between gap-3 px-3 py-2.5">
                        <span className="text-[13px] text-muted">{t('weekly.winrate')}</span>
                        {r.winrateChange == null ? (
                          <span className="text-right text-[12px] text-muted">{t('weekly.noChange')}</span>
                        ) : (
                          <span className={`tnum font-display text-[15px] font-bold ${r.winrateChange > 0.05 ? 'text-pos' : r.winrateChange < -0.05 ? 'text-neg' : 'text-muted'}`}>
                            {signed(r.winrateChange, 1)} {t('weekly.pp')}
                          </span>
                        )}
                      </div>
                      <div className="panel-2 flex items-center justify-between gap-3 px-3 py-2.5">
                        <span className="text-[13px] text-muted">{t('weekly.matches')}</span>
                        <span className="text-right">
                          <span className="tnum font-display text-[15px] font-bold text-ink">{signed(r.matchesChange)}</span>
                          <span className="tnum block text-[11px] text-muted">{t('weekly.prevWas', { matches: matches(r.previous.matches) })}</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {top && (
                  <div className="mt-4">
                    <div className="label mb-1.5">{t('weekly.topHero')}</div>
                    <div className="panel-2 flex items-center gap-3 px-3 py-2.5">
                      <span className="h-11 w-11 flex-none overflow-hidden rounded-lg">{hero && <HeroPortrait hero={hero} fill />}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold text-ink">{hero ? i18n.heroName(hero) : `#${top.heroId}`}</div>
                        <div className="tnum text-[12px] text-muted">{t('weekly.topLine', { matches: matches(top.matches), wr: Math.round(top.winrate) })}</div>
                      </div>
                    </div>
                    {top.matches < APP_CONFIG.player.weekly.minMatches && <p className="mt-1.5 text-[11px] leading-[14px] text-muted">{t('weekly.topFew')}</p>}
                  </div>
                )}
              </>
            )}
            <p className="mt-3 text-[11px] leading-[14px] text-muted">{t('weekly.note')}</p>
          </>
        );
      })()}
    </section>
  );
}
