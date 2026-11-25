import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import type { Hero } from '../../types';
import { loadBracketTables, loadDataset, type Dataset } from '../../data/dataset';
import { parsePlayerInput } from '../../player/parseId';
import { fetchProfile, PlayerError, searchPlayers, type PlayerErrorKind, type PlayerProfile, type SearchHit } from '../../player/api';
import { rankInfo } from '../../player/rankBracket';
import { daysSince, heroStats, overallWinrate, poolOf, poolWidth, sortHeroes, type HeroSort, type HeroStat } from '../../player/poolStats';
import { setMe, setPoolOn, useMe } from '../../player/usePlayer';
import { APP_CONFIG } from '../../config';
import { HeroPortrait } from '../HeroPortrait';
import { DiamondLoader } from '../Brand';
import { medalSrc } from '../Selectors';
import { Avatar } from './PoolResults';

type Load =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; profile: PlayerProfile; stale: boolean }
  | { kind: 'error'; error: PlayerErrorKind };

type Search = { kind: 'idle' } | { kind: 'loading'; q: string } | { kind: 'ready'; q: string; hits: SearchHit[] } | { kind: 'error'; error: PlayerErrorKind };

const SORTS: HeroSort[] = ['games', 'strong', 'recent', 'rising'];

const urlPlayer = (): number | null => {
  try { const v = new URLSearchParams(window.location.search).get('player'); return v && /^\d+$/.test(v) ? Number(v) : null; } catch { return null; }
};

const pct = (v: number) => Math.round(v);

function HeroRow({ s, hero, sort }: { s: HeroStat; hero: Hero | undefined; sort: HeroSort }) {
  const i18n = useI18n();
  const { t } = i18n;
  const games = sort === 'recent' ? s.games90 : s.games;
  const sub = sort === 'recent' && s.winrate90 != null ? t('profile.recentRow', { wr: pct(s.winrate90) })
    : sort === 'rising' && s.winrate90 != null ? t('profile.risingRow', { now: pct(s.winrate90), all: pct(s.winrate) })
      : s.meta != null ? t('profile.vsMeta', { you: pct(s.winrate), meta: pct(s.meta) }) : `${pct(s.winrate)}%`;
  const edge = sort === 'rising' && s.winrate90 != null ? s.winrate90 - s.winrate : sort === 'recent' && s.winrate90 != null && s.meta != null ? s.winrate90 - s.meta : s.edge;
  return (
    <li className="panel-2 flex items-center gap-3 px-2.5 py-2">
      <span className="h-10 w-10 flex-none overflow-hidden rounded-lg">{hero && <HeroPortrait hero={hero} fill />}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">{hero ? i18n.heroName(hero) : `#${s.heroId}`}</div>
        <div className="tnum truncate text-[12px] text-muted">{sub}</div>
      </div>
      <div className="flex-none text-right">
        <div className={`tnum text-[14px] font-bold ${edge > 0.5 ? 'text-pos' : edge < -0.5 ? 'text-neg' : 'text-muted'}`}>{edge > 0 ? '+' : edge < 0 ? '−' : ''}{Math.abs(edge).toFixed(1)}</div>
        <div className="tnum text-[11px] text-muted">{games} {i18n.plural(games, 'game')}</div>
      </div>
    </li>
  );
}

/**
 * Player profile ("who you are on the stage"): Dota ID / Steam64 / link /
 * nickname → OpenDota → header, heroes against the meta of the player's rank,
 * pool width, and the switch for "My pool" in the draft.
 */
export default function ProfilePage({ onRank, rankOptions, onUsePool }: { onRank: (bracket: string) => void; rankOptions: string[]; onUsePool: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const me = useMe();
  const [text, setText] = useState('');
  const [hint, setHint] = useState<'vanity' | null>(null);
  const [viewId, setViewId] = useState<number | null>(() => urlPlayer() ?? me.id);
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [search, setSearch] = useState<Search>({ kind: 'idle' });
  const [sort, setSort] = useState<HeroSort>('games');
  const [nonce, setNonce] = useState(0);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [meta, setMeta] = useState<{ base: Map<number, number>; rank: string } | null>(null);

  useEffect(() => { loadDataset().then(setDataset).catch(() => setDataset(null)); }, []);
  useEffect(() => { document.title = `${t('profile.title')} — LASTPICK`; }, [t]);

  useEffect(() => {
    if (viewId == null) { setLoad({ kind: 'idle' }); return; }
    let alive = true;
    setLoad({ kind: 'loading' });
    fetchProfile(viewId, { fresh: nonce > 0 })
      .then(({ profile, stale }) => alive && setLoad({ kind: 'ready', profile, stale }))
      .catch((e) => alive && setLoad({ kind: 'error', error: e instanceof PlayerError ? e.kind : 'server' }));
    return () => { alive = false; };
  }, [viewId, nonce]);

  const profile = load.kind === 'ready' ? load.profile : null;
  const rank = rankInfo(profile?.rankTier);

  // meta win rates: the player's rank group, else all ranks
  useEffect(() => {
    if (!dataset || !profile) return;
    let alive = true;
    const want = rank && rankOptions.includes(rank.bracket) ? rank.bracket : null;
    if (!want) { setMeta({ base: dataset.baseWinrates, rank: 'ALL' }); return; }
    loadBracketTables(new Set(dataset.heroes.map((h) => h.id)))
      .then((tables) => { if (alive) { const b = tables?.get(want); setMeta(b ? { base: b.baseWinrates, rank: want } : { base: dataset.baseWinrates, rank: 'ALL' }); } })
      .catch(() => alive && setMeta({ base: dataset.baseWinrates, rank: 'ALL' }));
    return () => { alive = false; };
  }, [dataset, profile, rank?.bracket, rankOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => (profile && meta ? heroStats(profile, meta.base) : []), [profile, meta]);
  const sorted = useMemo(() => sortHeroes(stats, sort).slice(0, 10), [stats, sort]);
  const pool = useMemo(() => (profile && meta ? poolOf(profile, meta.base) : null), [profile, meta]);
  const width = profile ? poolWidth(profile) : null;
  const isMe = profile != null && me.id === profile.id;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = parsePlayerInput(text);
    setHint(null);
    if (input.kind === 'empty') return;
    if (input.kind === 'vanity') { setHint('vanity'); return; }
    if (input.kind === 'id') { setSearch({ kind: 'idle' }); setViewId(input.id); return; }
    setSearch({ kind: 'loading', q: input.q });
    try {
      const hits = await searchPlayers(input.q);
      setSearch({ kind: 'ready', q: input.q, hits });
    } catch (err) {
      setSearch({ kind: 'error', error: err instanceof PlayerError ? err.kind : 'server' });
    }
  }

  function makeMe() {
    if (!profile) return;
    setMe(profile.id, profile);
    // the rank selector follows the profile (it can still be changed by hand)
    if (rank && rankOptions.includes(rank.bracket)) onRank(rank.bracket);
  }

  const days = daysSince(profile?.lastPlayed ?? null);
  const wr = profile ? overallWinrate(profile) : null;
  const date = (unix: number) => new Date(unix).toLocaleDateString(i18n.lang === 'ru' ? 'ru-RU' : 'en-US');

  return (
    <div className="mx-auto max-w-3xl">
      <section className="panel p-4 sm:p-6">
        <h2 className="font-display text-[20px] font-bold leading-6 text-ink">{t('profile.title')}</h2>
        <p className="mt-1 text-[14px] leading-5 text-muted">{t('profile.lead')}</p>
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input value={text} onChange={(e) => { setText(e.target.value); setHint(null); }} placeholder={t('profile.placeholder')} aria-label={t('profile.placeholder')}
            autoComplete="off" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg-2 px-3 text-[15px] text-ink placeholder:text-muted focus:border-accent focus:outline-none" />
          <button type="submit" className="btn btn-accent">{t('profile.go')}</button>
        </form>
        {hint === 'vanity' && <p className="mt-2 text-[13px] leading-[18px] text-muted" role="alert">{t('profile.vanity')}</p>}
        {search.kind === 'loading' && <p className="mt-3 text-[13px] text-muted">{t('profile.searching')}</p>}
        {search.kind === 'error' && <p className="mt-3 text-[13px] text-neg" role="alert">{t(`profile.err.${search.error}` as StringKey)}</p>}
        {search.kind === 'ready' && (search.hits.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted">{t('profile.searchNone', { q: search.q })}</p>
        ) : (
          <div className="mt-3">
            <div className="label mb-1.5">{t('profile.searchPick')}</div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {search.hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => { setViewId(h.id); setSearch({ kind: 'idle' }); }} className="panel-2 flex w-full items-center gap-2.5 px-2.5 py-2 text-left hover:border-line-2">
                    <Avatar src={h.avatar} name={h.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-ink">{h.name}</span>
                      <span className="tnum block truncate text-[11px] text-muted">ID {h.id}{h.lastMatch ? ` · ${t('profile.lastMatch', { date: date(Date.parse(h.lastMatch)) })}` : ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {load.kind === 'loading' && <div className="mt-8 flex justify-center"><DiamondLoader label={t('profile.loading')} /></div>}
      {load.kind === 'error' && (
        <div className="notice mt-4 justify-between gap-3" role="alert">
          <span className="text-ink">{t(`profile.err.${load.error}` as StringKey)}</span>
          {load.error !== 'notFound' && <button type="button" onClick={() => setNonce((n) => n + 1)} className="btn btn-ghost btn-sm">{t('profile.retry')}</button>}
        </div>
      )}

      {profile && (
        <div className="mt-4 grid gap-4">
          {load.kind === 'ready' && load.stale && <div className="notice">{t('profile.stale', { date: date(profile.fetchedAt) })}</div>}

          <section className="panel p-4 sm:p-6">
            <div className="flex items-center gap-3 sm:gap-4">
              <Avatar src={profile.avatar} name={profile.name} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-display text-[20px] font-bold leading-6 text-ink">{profile.name}</h3>
                  <span className={`badge ${profile.hidden ? 'badge-warn' : 'badge-pos'}`}>{t(profile.hidden ? 'profile.limited' : 'profile.open')}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                  {rank && (
                    <span className="flex items-center gap-1 text-ink">
                      <img src={medalSrc(rank.medal)} alt="" width={24} height={24} aria-hidden="true" />
                      {t(`medal.${rank.medal}` as StringKey)}{rank.stars ? ` ${rank.stars}` : ''}
                      {profile.leaderboard ? <span className="text-muted"> · {t('profile.leaderboard', { n: profile.leaderboard })}</span> : null}
                    </span>
                  )}
                  {!profile.hidden && wr != null && (
                    <span className="tnum"><span className="text-pos">{profile.win}</span>–<span className="text-neg">{profile.lose}</span> · {t('profile.winrate', { v: wr.toFixed(1) })} · {profile.win + profile.lose} {i18n.plural(profile.win + profile.lose, 'game')}</span>
                  )}
                  {days != null && <span>{days === 0 ? t('profile.lastGameToday') : t('profile.lastGame', { n: days })}</span>}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {isMe ? (
                <>
                  <span className="badge badge-pos">{t('profile.isMe')}</span>
                  <button type="button" onClick={() => setMe(null)} className="btn btn-ghost btn-sm">{t('profile.notMe')}</button>
                </>
              ) : (
                <button type="button" onClick={makeMe} className="btn btn-accent btn-sm">{t('profile.me')}</button>
              )}
              <button type="button" onClick={() => setNonce((n) => n + 1)} className="btn btn-ghost btn-sm">{t('profile.refresh')}</button>
            </div>
            {!rank && <p className="mt-3 text-[12px] text-muted">{t('profile.noRank')}</p>}
          </section>

          {profile.hidden ? (
            <section className="panel p-4 sm:p-6">
              <h3 className="font-display text-[16px] font-bold text-ink">{t('profile.hidden.title')}</h3>
              <p className="mt-2 text-[14px] leading-5 text-muted">{t('profile.hidden.text')}</p>
              <a href={`https://www.opendota.com/players/${profile.id}`} target="_blank" rel="noopener" className="btn btn-ghost btn-sm mt-3">opendota.com/players/{profile.id} ↗</a>
            </section>
          ) : (
            <>
              {pool?.lowData && <div className="notice">{t('profile.lowData', { n: profile.win + profile.lose })}</div>}
              {days != null && days > APP_CONFIG.player.staleDays && <div className="notice">{t('profile.oldPool', { n: days })}</div>}

              {isMe && (
                <section className="panel flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[16px] font-bold text-ink">{t(me.poolWanted ? 'profile.pool.on' : 'profile.pool.cta')}</div>
                    <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('profile.pool.text')}</p>
                  </div>
                  <button type="button" onClick={() => { setPoolOn(true); onUsePool(); }} className="btn btn-accent">{t('profile.pool.cta')} →</button>
                </section>
              )}

              <section className="panel p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-[16px] font-bold text-ink">{t('profile.heroes')}</h3>
                  <div className="seg seg-sm" role="tablist" aria-label={t('profile.heroes')}>
                    {SORTS.map((k) => (
                      <button key={k} type="button" role="tab" aria-selected={sort === k} onClick={() => setSort(k)} className={`seg-btn ${sort === k ? 'is-active' : ''}`}>{t(`profile.sort.${k}` as StringKey)}</button>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-[12px] leading-4 text-muted">{t(`profile.sortHint.${sort}` as StringKey)}</p>
                {!meta ? <div className="mt-4"><DiamondLoader label={t('profile.loading')} /></div> : sorted.length === 0 ? (
                  <p className="mt-3 text-[13px] text-muted">{t('profile.none')}</p>
                ) : (
                  <ul className="mt-3 grid gap-1.5">
                    {sorted.map((s) => <HeroRow key={s.heroId} s={s} hero={dataset?.heroById.get(s.heroId)} sort={sort} />)}
                  </ul>
                )}
                {meta && <p className="mt-3 text-[11px] leading-[14px] text-muted">{t('profile.meta', { rank: meta.rank === 'ALL' ? t('rank.all') : t(`rank.${meta.rank}` as StringKey) })}</p>}
              </section>

              {width && width.heroes > 0 && (
                <section className="panel p-4 sm:p-5">
                  <div className="label">{t('profile.width.title')}</div>
                  <div className="mt-1 font-display text-[16px] font-bold text-ink">{t(`profile.width.${width.label}` as StringKey)}</div>
                  <p className="tnum mt-1 text-[13px] text-muted">{t('profile.width.text', { n: width.heroes, share: Math.round(width.top3Share * 100) })}</p>
                </section>
              )}
            </>
          )}
          <p className="text-[11px] leading-[14px] text-muted">
            {t('profile.source')} · <a href={`https://www.opendota.com/players/${profile.id}`} target="_blank" rel="noopener" className="underline hover:text-ink">opendota.com/players/{profile.id}</a>
          </p>
        </div>
      )}
    </div>
  );
}
