import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import type { Hero } from '../../types';
import type { MatchReview, MetricReading, ReviewMetricId } from '../../match/review';
import { HeroPortrait } from '../HeroPortrait';

export type ReviewState = { kind: 'loading' } | { kind: 'ready'; review: MatchReview };

/** Per-minute rates read better with a decimal when small. */
const DECIMALS: Record<ReviewMetricId, number> = { gpm: 0, xpm: 0, lastHits: 1, deaths: 1, ka: 1, damage: 0, towers: 0, healing: 0 };

/** The personal match review: display only — the observations come ready from match/review.ts. */
export function MatchReviewCard({ state, hero, playerName, action }: { state: ReviewState; hero: Hero | undefined; playerName: string | null; /** Optional extra under the focus (e.g. "track this focus"). */ action?: ReactNode }) {
  const i18n = useI18n();
  const { t, plural } = i18n;
  const num = (v: number, d: number) => v.toLocaleString(i18n.lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const heroName = hero ? i18n.heroName(hero) : '';

  const detail = (r: MetricReading, good: boolean) => t(good ? 'review.better' : 'review.worse', {
    value: num(r.value, DECIMALS[r.id]),
    unit: t(`review.unit.${r.id}` as StringKey),
    pct: Math.round(100 * (good ? r.beats : 1 - r.beats)),
    usual: num(r.usual, DECIMALS[r.id]),
  });

  if (state.kind === 'loading') {
    return <div className="skeleton mb-4 h-[188px] !rounded-[14px]" aria-label={t('review.loading')} />;
  }
  const r = state.review;

  return (
    <section className="panel mb-4 p-4 sm:p-5" aria-labelledby="review-title">
      <div className="flex items-center gap-3">
        <span className="h-12 w-12 flex-none overflow-hidden rounded-xl">{hero && <HeroPortrait hero={hero} fill />}</span>
        <div className="min-w-0 flex-1">
          <h3 id="review-title" className="label text-accent">{t('review.title')}</h3>
          <div className="truncate font-display text-[16px] font-bold leading-5 text-ink">{heroName}{playerName ? <span className="font-sans text-[13px] font-medium text-muted"> · {playerName}</span> : null}</div>
          <div className="mt-0.5 text-[12px] text-muted">
            {r.position ? `${t('review.position', { n: r.position })} · ` : ''}{t('match.min', { n: r.minutes })}
          </div>
        </div>
        <span className={`badge flex-none ${r.win ? 'badge-pos' : 'badge-neg'}`}>{t(r.win ? 'match.win' : 'match.loss')}</span>
      </div>

      {r.kind === 'personal' ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="review-block review-good">
              <div className="label !text-pos">{t('review.good')}</div>
              {r.good ? (
                <>
                  <div className="mt-1 text-[14px] font-semibold leading-5 text-ink">{t(`review.good.${r.good.id}` as StringKey)}</div>
                  <p className="tnum mt-0.5 text-[12px] leading-4 text-muted">{detail(r.good, true)}</p>
                </>
              ) : <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('review.noGood')}</p>}
            </div>
            <div className="review-block review-improve">
              <div className="label !text-neg">{t('review.improve')}</div>
              {r.improve ? (
                <>
                  <div className="mt-1 text-[14px] font-semibold leading-5 text-ink">{t(`review.improve.${r.improve.id}` as StringKey)}</div>
                  <p className="tnum mt-0.5 text-[12px] leading-4 text-muted">{detail(r.improve, false)}</p>
                </>
              ) : <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('review.noImprove')}</p>}
            </div>
          </div>
          <div className="review-block review-focus mt-2">
            <div className="label !text-accent">{t('review.focus')}</div>
            <p className="mt-1 text-[14px] leading-5 text-ink">{t(`review.focus.${r.focus}` as StringKey)}</p>
          </div>
          {action}
          <p className="mt-3 text-[11px] leading-[14px] text-muted">
            {t(r.basis === 'lane' ? 'review.basisLane' : 'review.basisHero', { n: r.sample, games: plural(r.sample, 'game'), hero: heroName })} {t('review.disclaimer')}
          </p>
        </>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {([
              ['review.stat.kda', `${r.stats.kills}/${r.stats.deaths}/${r.stats.assists}`],
              ['review.stat.gpm', num(r.stats.gpm, 0)],
              ['review.stat.xpm', num(r.stats.xpm, 0)],
              ['review.stat.lh', num(r.stats.lastHits, 0)],
              ['review.stat.damage', num(r.stats.heroDamage, 0)],
              ['review.stat.length', t('match.min', { n: r.minutes })],
            ] as [StringKey, string][]).map(([k, v]) => (
              <div key={k} className="panel-2 px-2.5 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">{t(k)}</dt>
                <dd className="tnum mt-0.5 text-[14px] font-bold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] leading-4 text-muted">{t(`review.basic.${r.reason}` as StringKey, { n: r.sample, games: plural(r.sample, 'game'), hero: heroName })}</p>
        </>
      )}
    </section>
  );
}
