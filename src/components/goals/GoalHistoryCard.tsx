import { useI18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import type { Hero } from '../../types';
import { METRIC_DECIMALS, type ImprovementGoal } from '../../goals/model';
import { HeroPortrait } from '../HeroPortrait';

/** Finished goals with their frozen results: display only — nothing here is recalculated. */
export function GoalHistoryCard({ goals, heroById }: { goals: ImprovementGoal[]; heroById: Map<number, Hero> | undefined }) {
  const i18n = useI18n();
  const { t } = i18n;
  const locale = i18n.lang === 'ru' ? 'ru-RU' : 'en-US';
  const day = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  return (
    <section className="panel p-4 sm:p-6" aria-labelledby="goal-history-title">
      <h3 id="goal-history-title" className="font-display text-[16px] font-bold text-ink">{t('goalHistory.title')}</h3>
      <ol className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
        {goals.map((g) => {
          const hero = heroById?.get(g.heroId);
          const d = METRIC_DECIMALS[g.metric];
          const num = (v: number) => v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
          const o = g.outcome ?? { kind: 'unknown' as const };
          const completed = g.status === 'completed';
          const period = g.endedAt ? `${day(g.createdAt)} – ${day(g.endedAt)}` : day(g.createdAt);
          const tone = o.kind === 'measured' ? (o.trend === 'better' ? 'text-pos' : o.trend === 'worse' ? 'text-neg' : 'text-muted') : 'text-muted';
          return (
            <li key={g.id} className="panel-2 px-3 py-3">
              <div className="flex items-start gap-3">
                <span className="h-10 w-10 flex-none overflow-hidden rounded-lg">{hero && <HeroPortrait hero={hero} fill />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[14px] font-semibold leading-5 text-ink">{t(`goal.title.${g.metric}` as StringKey)}</span>
                    <span className={`badge ${completed ? 'badge-pos' : ''}`}>{t(completed ? 'goalHistory.completed' : 'goalHistory.replaced')}</span>
                  </div>
                  <div className="tnum mt-0.5 truncate text-[12px] text-muted">
                    {hero ? i18n.heroName(hero) : `#${g.heroId}`}
                    {o.kind === 'measured' || o.kind === 'insufficient' ? ` · ${t('goalHistory.matches', { n: o.count })}` : ''} · {period}
                  </div>
                </div>
              </div>
              <div className="mt-2 border-t border-line pt-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{t(`review.unit.${g.metric}` as StringKey)}</div>
                {o.kind === 'measured' ? (
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
                    <span className={`tnum font-display text-[18px] font-bold ${tone}`}>{num(g.baseline.value)} → {num(o.value)}</span>
                    <span className={`text-[12px] ${tone}`}>{t(`goalHistory.trend.${o.trend}` as StringKey)}</span>
                  </div>
                ) : (
                  <div className="mt-0.5">
                    <span className="tnum text-[13px] text-ink">{t('goalHistory.baselineOnly', { v: num(g.baseline.value) })}</span>
                    <p className="mt-0.5 text-[12px] leading-4 text-muted">
                      {o.kind === 'insufficient' ? t('goalHistory.insufficient', { n: o.count, needed: o.needed }) : t('goalHistory.unknown')}
                    </p>
                  </div>
                )}
                {!completed && <p className="mt-1 text-[12px] text-muted">{t('goalHistory.replacedNote')}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[11px] leading-[14px] text-muted">{t('goalHistory.note')}</p>
    </section>
  );
}
