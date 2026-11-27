import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { accountApi } from '../../player/account';
import { deleteServerData, useMe } from '../../player/usePlayer';

const SteamMark = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
    <path d="M12 2a10 10 0 0 0-9.96 9.08l5.36 2.2a2.83 2.83 0 0 1 1.6-.49h.15l2.39-3.45v-.05a3.79 3.79 0 1 1 3.79 3.79h-.09l-3.4 2.43v.13a2.84 2.84 0 0 1-5.64.45L2.37 14.6A10 10 0 1 0 12 2Zm-4.73 15.16-1.23-.5a2.13 2.13 0 1 0 1.17-2.92l1.27.52a1.57 1.57 0 1 1-1.2 2.9Zm9.8-7.82a2.53 2.53 0 1 0-2.53 2.52 2.53 2.53 0 0 0 2.53-2.52Zm-4.42 0a1.9 1.9 0 1 1 1.9 1.9 1.9 1.9 0 0 1-1.9-1.9Z" />
  </svg>
);

/** Steam sent the player back without a valid sign-in: tell once, clean the address. */
function useSigninFailed(): boolean {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has('signin')) {
        setFailed(u.searchParams.get('signin') !== 'ok');
        u.searchParams.delete('signin');
        window.history.replaceState(window.history.state, '', u.pathname + (u.search || '') + u.hash);
      }
    } catch { /* sandboxed */ }
  }, []);
  return failed;
}

const backHere = () => (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/?profile');

/**
 * "Sign in through Steam" with why (signed out only). Hidden while checking
 * and where the server part is not available.
 */
export function SteamAccount({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const me = useMe();
  const failed = useSigninFailed();
  if (me.account.kind !== 'signedOut') return null;
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3'}>
      <a href={accountApi.loginHref(backHere())} className="btn btn-ghost btn-sm"><SteamMark /> {t('steam.signIn')}</a>
      {!compact && <span className="min-w-0 flex-1 text-[12px] leading-4 text-muted">{t('steam.why')}</span>}
      {failed && <p className="w-full text-[12px] text-neg" role="alert">{t('steam.failed')}</p>}
    </div>
  );
}

/** "Signed in through Steam" as a small mark (the profile's top bar). */
export function SteamBadge() {
  const { t } = useI18n();
  const me = useMe();
  if (me.account.kind !== 'signedIn') return null;
  return <span className="flex items-center gap-1.5 text-[12px] text-muted" title={t('steam.signedIn', { id: me.account.accountId })}><SteamMark /> Steam</span>;
}

/**
 * The data kept on the server for a signed-in account, and deleting it —
 * on the privacy page, deliberately away from everyday buttons.
 */
export function SteamDataControls() {
  const { t } = useI18n();
  const me = useMe();
  const [confirm, setConfirm] = useState(false);
  const [deleted, setDeleted] = useState<boolean | null>(null);
  if (me.account.kind !== 'signedIn') return null;
  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <div className="flex items-center gap-1.5 text-[13px] text-ink"><SteamMark /> {t('steam.signedIn', { id: me.account.accountId })}</div>
      <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('steam.deleteAsk')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {confirm ? (
          <>
            <button type="button" onClick={async () => { setDeleted(await deleteServerData()); setConfirm(false); }} className="btn btn-ghost btn-sm !border-neg !text-neg">{t('steam.deleteYes')}</button>
            <button type="button" onClick={() => setConfirm(false)} className="btn btn-ghost btn-sm">{t('goal.cancel')}</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="btn btn-ghost btn-sm">{t('steam.delete')}</button>
        )}
      </div>
      {deleted != null && <p className={`mt-2 text-[12px] ${deleted ? 'text-muted' : 'text-neg'}`}>{t(deleted ? 'steam.deleted' : 'steam.deleteFailed')}</p>}
    </div>
  );
}

/** One line under "Favourite heroes": synced or this browser only. */
export function SyncStatus() {
  const { t } = useI18n();
  const me = useMe();
  if (me.account.kind === 'signedIn') {
    return <p className={`mt-2 text-[12px] ${me.syncError ? 'text-neg' : 'text-pos'}`}>{me.syncError ? t('steam.syncError') : `✓ ${t('steam.synced')}`}</p>;
  }
  if (me.account.kind === 'signedOut') {
    return (
      <p className="mt-2 text-[12px] leading-4 text-muted">
        {t('steam.localOnly')} <a href={accountApi.loginHref(backHere())} className="text-accent underline-offset-2 hover:underline">{t('steam.signIn')}</a>
      </p>
    );
  }
  return null;
}
