import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import type { Hero } from '../../types';
import type { GoalProgress } from '../../goals/calculations';
import { METRIC_DECIMALS, type ImprovementGoal } from '../../goals/model';
import { HeroPortrait } from '../HeroPortrait';

export type GoalProgressState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; progress: GoalProgress };

/** The active improvement goal in the profile: display only — progress comes ready from goals/calculations.ts. */
export function ImprovementGoalCard({ goal, state, hero, onComplete }: {
  goal: ImprovementGoal;
  state: GoalProgressState;
  hero: Hero | undefined;
  onComplete: () => Promise<void>;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const locale = i18n.lang === 'ru' ? 'ru-RU' : 'en-US';
  const d = METRIC_DECIMALS[goal.metric];
  const num = (v: number) => v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  const heroName = hero ? i18n.heroName(hero) : `#${goal.heroId}`;
  const modeKey = [1, 2, 22, 23].includes(goal.gameMode) ? `match.mode.${goal.gameMode}` : 'match.mode.other';
  const unit = t(`review.unit.${goal.metric}` as StringKey);
  const started = new Date(goal.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  return (
    <section className="panel relative overflow-hidden p-4 sm:p-6" aria-labelledby="goal-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="goal-title" className="label text-accent">{t('goal.current')}</h3>
        <span className="badge badge-pos">{t('goal.active')}</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="h-11 w-11 flex-none overflow-hidden rounded-lg">{hero && <HeroPortrait hero={hero} fill />}</span>
        <div className="min-w-0">
          <div className="font-display text-[17px] font-bold leading-[22px] text-ink">{t(`goal.title.${goal.metric}` as StringKey)}</div>
          <div className="truncate text-[12px] text-muted">{t('goal.sub', { hero: heroName, mode: t(modeKey as StringKey), date: started })}</div>
        </div>
      </div>

      <div className="mt-4">
        {state.kind === 'loading' && <div className="skeleton h-[72px] !rounded-xl" aria-label={t('goal.loading')} />}
        {state.kind === 'error' && <p className="text-[13px] text-muted">{t('goal.error')}</p>}
        {state.kind === 'ready' && state.progress.kind === 'waiting' && (
          <div className="rounded-xl border border-dashed border-line-2 px-4 py-3">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {Array.from({ length: state.progress.needed }, (_, i) => (
                <i key={i} className={`h-1.5 flex-1 rounded-full ${i < (state.progress as { count: number }).count ? 'bg-accent' : 'bg-line-2'}`} />
              ))}
            </div>
            <p className="mt-2 text-[13px] leading-[18px] text-ink">{t('goal.waiting', { n: state.progress.count, needed: state.progress.needed, hero: heroName })}</p>
          </div>
        )}
        {state.kind === 'ready' && state.progress.kind === 'progress' && (() => {
          const p = state.progress;
          const tone = p.trend === 'better' ? 'text-pos' : p.trend === 'worse' ? 'text-neg' : 'text-muted';
          const arrow = p.change < 0 ? '↓' : p.change > 0 ? '↑' : '→';
          return (
            <div>
              <div className="label">{unit}</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <span className={`tnum font-display text-[32px] font-bold leading-[38px] ${tone}`}>{num(p.current)}</span>
                <span className={`tnum text-[14px] font-semibold ${tone}`}>{arrow} {t('goal.from', { v: num(goal.baseline.value) })}</span>
              </div>
              <p className="mt-1 text-[13px] text-ink">{t(`goal.trend.${p.trend}` as StringKey)}</p>
              <p className="tnum mt-0.5 text-[12px] text-muted">{t('goal.count', { n: p.count })}</p>
            </div>
          );
        })()}
      </div>

      <p className="tnum mt-3 text-[12px] leading-4 text-muted">{t('goal.baseline', { v: num(goal.baseline.value), unit, n: goal.baseline.sample })}</p>

      <div className="mt-4">
        {confirm ? (
          <div className="notice flex-col !items-start gap-2">
            <span className="text-ink">{t('goal.completeAsk')}</span>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onComplete(); } finally { setBusy(false); setConfirm(false); } }} className="btn btn-accent btn-sm">{busy ? t('goal.saving') : t('goal.completeYes')}</button>
              <button type="button" onClick={() => setConfirm(false)} className="btn btn-ghost btn-sm">{t('goal.cancel')}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="btn btn-ghost btn-sm">{t('goal.complete')}</button>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-[14px] text-muted">{t('goal.note')}</p>
    </section>
  );
}
