import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import type { Hero } from '../../types';
import type { PersonalReview } from '../../match/review';
import { goalFromReview } from '../../goals/calculations';
import { sameFocus } from '../../goals/model';
import { goalActions, useGoals } from '../../goals/useGoals';

/**
 * "Track this focus" under a personal match review. One active goal: if
 * another one is active, ask before replacing it.
 */
export function TrackFocusButton({ review, accountId, gameMode, matchId, heroById }: {
  review: PersonalReview;
  accountId: number;
  gameMode: number;
  matchId: number;
  heroById: Map<number, Hero> | undefined;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { active } = useGoals();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!review.improve) return null;
  const candidate = goalFromReview(review, { accountId, gameMode, matchId, now: Date.now() });
  if (!candidate) return null;
  const heroName = (id: number) => { const h = heroById?.get(id); return h ? i18n.heroName(h) : `#${id}`; };
  const profileHref = `/?player=${accountId}${i18n.lang === 'ru' ? '&lang=ru' : ''}`;

  if (active && sameFocus(active, candidate)) {
    return (
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/40 bg-accent/5 px-3 py-2">
        <span className="text-[13px] text-ink">✓ {t('goal.tracking')}</span>
        <a href={profileHref} className="btn btn-ghost btn-sm">{t('goal.openProfile')}</a>
      </div>
    );
  }

  // replacing freezes the old goal's result first (it may need its matches), hence async
  const start = async () => {
    setBusy(true);
    try { await goalActions.start(goalFromReview(review, { accountId, gameMode, matchId, now: Date.now() })!); } finally { setBusy(false); setAsk(false); }
  };

  if (ask && active) {
    return (
      <div className="notice mt-2 flex-col !items-start gap-2" role="alertdialog" aria-label={t('goal.replaceTitle')}>
        <span className="text-ink">{t('goal.replaceAsk', { title: t(`goal.title.${active.metric}` as StringKey), hero: heroName(active.heroId) })}</span>
        <div className="flex gap-2">
          <button type="button" onClick={start} disabled={busy} className="btn btn-accent btn-sm">{busy ? t('goal.saving') : t('goal.replace')}</button>
          <button type="button" onClick={() => setAsk(false)} className="btn btn-ghost btn-sm">{t('goal.cancel')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={() => (active ? setAsk(true) : void start())} disabled={busy} className="btn btn-accent btn-sm">{t('goal.track')}</button>
      <span className="text-[12px] leading-4 text-muted">{t('goal.trackHint')}</span>
    </div>
  );
}
