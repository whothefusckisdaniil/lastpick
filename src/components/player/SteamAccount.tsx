import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { accountApi } from '../../player/account';
import { deleteServerData, signOut, useMe } from '../../player/usePlayer';

const SteamMark = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
    <path d="M12 2a10 10 0 0 0-9.96 9.08l5.36 2.2a2.83 2.83 0 0 1 1.6-.49h.15l2.39-3.45v-.05a3.79 3.79 0 1 1 3.79 3.79h-.09l-3.4 2.43v.13a2.84 2.84 0 0 1-5.64.45L2.37 14.6A10 10 0 1 0 12 2Zm-4.73 15.16-1.23-.5a2.13 2.13 0 1 0 1.17-2.92l1.27.52a1.57 1.57 0 1 1-1.2 2.9Zm9.8-7.82a2.53 2.53 0 1 0-2.53 2.52 2.53 2.53 0 0 0 2.53-2.52Zm-4.42 0a1.9 1.9 0 1 1 1.9 1.9 1.9 1.9 0 0 1-1.9-1.9Z" />
  </svg>
);

/**
 * Steam sign-in in the profile: signed out → a button and why; signed in →
 * who, sign out, delete the data kept on the server. Hidden where the
 * server part is not available (local dev, not configured).
 */
export function SteamAccount({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const me = useMe();
  const [failed, setFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);

  // Steam sent the player back without a valid sign-in: say so once, clean the address
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

  if (me.account.kind === 'checking' || me.account.kind === 'unavailable') return null;
  const back = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/?profile';

  if (me.account.kind === 'signedOut') {
    return (
      <div className={compact ? 'mt-2' : 'mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3'}>
        <a href={accountApi.loginHref(back)} className="btn btn-ghost btn-sm"><SteamMark /> {t('steam.signIn')}</a>
        {!compact && <span className="min-w-0 flex-1 text-[12px] leading-4 text-muted">{t('steam.why')}</span>}
        {failed && <p className="w-full text-[12px] text-neg" role="alert">{t('steam.failed')}</p>}
      </div>
    );
  }

  return (
    <div className={compact ? 'mt-2' : 'mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3'}>
      <span className="flex items-center gap-1.5 text-[12px] text-ink"><SteamMark /> {t('steam.signedIn', { id: me.account.accountId })}</span>
      {!compact && (
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => void signOut()} className="btn btn-ghost btn-sm">{t('steam.signOut')}</button>
          {confirmDelete ? (
            <>
              <button type="button" onClick={async () => { setDeleted(await deleteServerData()); setConfirmDelete(false); }} className="btn btn-ghost btn-sm !text-neg">{t('steam.deleteYes')}</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="btn btn-ghost btn-sm">{t('goal.cancel')}</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="btn btn-ghost btn-sm">{t('steam.delete')}</button>
          )}
        </span>
      )}
      {!compact && confirmDelete && <p className="w-full text-[12px] text-muted">{t('steam.deleteAsk')}</p>}
      {!compact && deleted && <p className="w-full text-[12px] text-muted">{t('steam.deleted')}</p>}
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
    const back = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/?profile';
    return (
      <p className="mt-2 text-[12px] leading-4 text-muted">
        {t('steam.localOnly')} <a href={accountApi.loginHref(back)} className="text-accent underline-offset-2 hover:underline">{t('steam.signIn')}</a>
      </p>
    );
  }
  return null;
}
