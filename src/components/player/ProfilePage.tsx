import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import type { Hero } from '../../types';
import { loadBracketTables, loadDataset, type Dataset } from '../../data/dataset';
import { parsePlayerInput } from '../../player/parseId';
import { loadHeroGames, loadHistory, fetchProfile, fetchRecent, TURBO_GAME_MODE, type PlayMode, PlayerError, searchPlayers, type PlayerErrorKind, type PlayerProfile, type SearchHit } from '../../player/api';
import { rankInfo } from '../../player/rankBracket';
import { daysSince, form, heroLabels, heroStats, overallWinrate, poolOf, poolWidth, sortHeroes, type HeroLabel, type HeroSort, type HeroStat, type RecentGame } from '../../player/poolStats';
import { setMe, setPoolOn, setRoles, useMe, type Role } from '../../player/usePlayer';
import { deliverImages, renderRecapCard, type RecapCard } from '../../share/matchCards';
import type { CardFormat } from '../../share/shareCard';
import { APP_CONFIG } from '../../config';
import { HeroPortrait } from '../HeroPortrait';
import { DiamondLoader } from '../Brand';
import { medalSrc } from '../Selectors';
import { Avatar } from './PoolResults';
import { CompareSection, LearnSection, PatchSection } from './ProfileV3';
import { WeeklyReviewCard, type WeeklyState } from './WeeklyReviewCard';
import { weeklyReview } from '../../player/weeklyReview';
import { ImprovementGoalCard, type GoalProgressState } from '../goals/ImprovementGoalCard';
import { goalProgress, historyOf } from '../../goals/calculations';
import { GoalHistoryCard } from '../goals/GoalHistoryCard';
import { goalActions, useGoals } from '../../goals/useGoals';
import { StatTile, Tabs } from '../ui';
import { FavoritesSection } from './FavoritesSection';

import { trackOnce, trackEvent } from '../../analytics';

type Load =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; profile: PlayerProfile; stale: boolean }
  | { kind: 'error'; error: PlayerErrorKind };

type Search = { kind: 'idle' } | { kind: 'loading'; q: string } | { kind: 'ready'; q: string; hits: SearchHit[] } | { kind: 'error'; error: PlayerErrorKind };

const SORTS: HeroSort[] = ['games', 'strong', 'recent', 'rising'];

type Tab = 'overview' | 'heroes' | 'patches' | 'friend' | 'card';
const TABS: Tab[] = ['overview', 'heroes', 'patches', 'friend', 'card'];
const TAB_KEY = 'lp.profileTab';
const MODE_KEY = 'lp.profileMode';
const savedTab = (): Tab => { try { const v = localStorage.getItem(TAB_KEY) as Tab; return TABS.includes(v) ? v : 'overview'; } catch { return 'overview'; } };

const urlPlayer = (): number | null => {
  try { const v = new URLSearchParams(window.location.search).get('player'); return v && /^\d+$/.test(v) ? Number(v) : null; } catch { return null; }
};

const pct = (v: number) => Math.round(v);

const LABEL_TONE: Record<HeroLabel, string> = { comfort: 'badge-pos', gem: 'badge-warn', under: 'badge-neg', meta: 'badge-pos' };

/** Last 20 matches: a strip of hero portraits, green = win, red = loss (newest first). */
function FormStrip({ games, heroById }: { games: RecentGame[]; heroById: Map<number, Hero> | undefined }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <>
      <p className="text-[12px] leading-4 text-muted">{t('profile.form.hint')}</p>
      <ol className="stagger mt-3 flex flex-wrap gap-1" aria-label={t('profile.form.matches')}>
        {games.map((g) => {
          const h = heroById?.get(g.heroId);
          const label = `${h ? i18n.heroName(h) : `#${g.heroId}`}: ${t(g.win ? 'profile.form.win' : 'profile.form.loss')} ${g.kills}/${g.deaths}/${g.assists}`;
          return (
            <li key={g.matchId} title={label} aria-label={label}>
              <a href={`/?match=${g.matchId}`} className={`block h-9 w-9 overflow-hidden rounded-md border-b-[3px] ${g.win ? 'border-pos' : 'border-neg opacity-80'}`}>
                {h && <HeroPortrait hero={h} fill />}
              </a>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** The first screen: four labelled numbers, each with what it is measured against. */
function Overview({ profile, stats, width, recent, heroById, onTab }: {
  profile: PlayerProfile; stats: HeroStat[]; width: ReturnType<typeof poolWidth> | null; recent: RecentGame[] | null;
  heroById: Map<number, Hero> | undefined; onTab: (t: Tab) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const wr = overallWinrate(profile);
  const best = sortHeroes(stats, 'strong')[0];
  const bestHero = best ? heroById?.get(best.heroId) : undefined;
  const f = recent?.length ? form(recent) : null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      <StatTile label={t('profile.tile.wr')} value={wr == null ? '—' : `${wr.toFixed(1)}%`} tone={wr == null ? 'ink' : wr >= 50 ? 'pos' : 'neg'}
        sub={t('profile.tile.wrSub', { n: i18n.number(profile.win + profile.lose) })} />
      <StatTile label={t('profile.tile.form')} value={f ? `${f.wins}–${f.losses}` : '—'} tone={!f ? 'ink' : f.wins >= f.losses ? 'pos' : 'neg'}
        sub={<>{t('profile.tile.formSub')}{f && Math.abs(f.streak) >= 2 && <span className={f.streak > 0 ? 'text-pos' : 'text-neg'}> · {t(f.streak > 0 ? 'profile.form.streakWin' : 'profile.form.streakLoss', { n: Math.abs(f.streak) })}</span>}</>} />
      <StatTile label={t('profile.tile.pool')} value={width ? t(`profile.width.${width.label}` as StringKey) : '—'}
        sub={width ? <>{t('profile.tile.poolSub', { n: width.heroes, share: Math.round(width.top3Share * 100) })}<span className="mt-1 block text-[11px] leading-[14px] opacity-80">{t('profile.tile.poolScale', { narrow: APP_CONFIG.player.narrowPool, mid: APP_CONFIG.player.widePool - 1, wide: APP_CONFIG.player.widePool })}</span></> : undefined} />
      <button type="button" onClick={() => onTab('heroes')} className="text-left transition-transform hover:-translate-y-0.5">
        <StatTile label={t('profile.tile.best')} value={best ? (bestHero ? i18n.heroName(bestHero) : `#${best.heroId}`) : '—'} tone="accent"
          sub={best ? <>{t('profile.tile.bestSub2', { you: Math.round(best.winrate), meta: best.meta != null ? Math.round(best.meta) : '—', edge: `${best.edge > 0 ? '+' : best.edge < 0 ? '−' : ''}${Math.abs(best.edge).toFixed(1)}`, g: `${best.games} ${i18n.plural(best.games, 'game')}` })} <span className="text-accent">{t('profile.tile.more')}</span></> : undefined} />
      </button>
    </div>
  );
}

function HeroRow({ s, hero, sort, turbo = false }: { s: HeroStat; hero: Hero | undefined; sort: HeroSort; /** Turbo: compared with 50 %, no meta labels. */ turbo?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const games = sort === 'recent' ? s.games90 : s.games;
  const sub = sort === 'recent' && s.winrate90 != null ? t('profile.recentRow', { wr: pct(s.winrate90) })
    : sort === 'rising' && s.winrate90 != null ? t('profile.risingRow', { now: pct(s.winrate90), all: pct(s.winrate) })
      : turbo ? t('profile.vsFifty', { you: pct(s.winrate) })
        : s.meta != null ? t('profile.vsMeta', { you: pct(s.winrate), meta: pct(s.meta) }) : `${pct(s.winrate)}%`;
  const labels = turbo ? [] : heroLabels(s);
  const edge = sort === 'rising' && s.winrate90 != null ? s.winrate90 - s.winrate : sort === 'recent' && s.winrate90 != null && s.meta != null ? s.winrate90 - s.meta : s.edge;
  return (
    <li className="panel-2 flex items-center gap-3 px-2.5 py-2">
      <span className="h-10 w-10 flex-none overflow-hidden rounded-lg">{hero && <HeroPortrait hero={hero} fill />}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">{hero ? i18n.heroName(hero) : `#${s.heroId}`}</div>
        <div className="tnum truncate text-[12px] text-muted">{sub}</div>
        {labels.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {labels.map((l) => <span key={l} className={`badge ${LABEL_TONE[l]} !py-0 !text-[10px]`} title={t(`label.hint.${l}` as StringKey)}>{t(`label.${l}` as StringKey)}</span>)}
          </div>
        )}
      </div>
      <div className="flex-none text-right">
        <div title={t('profile.edge.hint')} className={`tnum text-[14px] font-bold ${edge > 0.5 ? 'text-pos' : edge < -0.5 ? 'text-neg' : 'text-muted'}`}>{edge > 0 ? '+' : edge < 0 ? '−' : ''}{Math.abs(edge).toFixed(1)}</div>
        <div className="text-[10px] leading-3 text-muted">{t(turbo ? 'profile.edge.fifty' : sort === 'rising' ? 'profile.edge.rising' : 'profile.edge.meta')}</div>
        <div className="tnum mt-0.5 text-[11px] text-muted">{games} {i18n.plural(games, 'game')}</div>
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
  /** How the shown profile was opened (analytics only). */
  const openedVia = useRef<'saved' | 'input' | 'search' | 'link'>(urlPlayer() != null ? 'link' : 'saved');
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [search, setSearch] = useState<Search>({ kind: 'idle' });
  const [sort, setSort] = useState<HeroSort>('games');
  const [tab, setTabState] = useState<Tab>(savedTab);
  /** Normal games or Turbo: never mixed (Turbo's economy is faster). Remembered in this browser. */
  const [mode, setModeState] = useState<PlayMode>(() => { try { return localStorage.getItem(MODE_KEY) === 'turbo' ? 'turbo' : 'normal'; } catch { return 'normal'; } });
  const setMode = (m: PlayMode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* not remembered */ } };
  const turbo = mode === 'turbo';
  const setTab = (v: Tab) => { setTabState(v); try { localStorage.setItem(TAB_KEY, v); } catch { /* not remembered */ } };
  const [nonce, setNonce] = useState(0);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [meta, setMeta] = useState<{ base: Map<number, number>; rank: string } | null>(null);
  const [recent, setRecent] = useState<{ kind: 'loading' } | { kind: 'ready'; games: RecentGame[] } | { kind: 'error' } | null>(null);
  const [weekly, setWeekly] = useState<WeeklyState | null>(null);
  const [goalState, setGoalState] = useState<GoalProgressState | null>(null);
  const goals = useGoals();
  const [hideName, setHideName] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [share, setShare] = useState<'idle' | 'making' | 'failed' | 'copied' | 'warnMe' | 'copiedMe'>('idle');

  useEffect(() => { loadDataset().then(setDataset).catch(() => setDataset(null)); }, []);
  useEffect(() => { document.title = `${t('profile.title')} — LASTPICK`; }, [t]);

  useEffect(() => {
    if (viewId == null) { setLoad({ kind: 'idle' }); return; }
    let alive = true;
    setLoad({ kind: 'loading' });
    fetchProfile(viewId, { fresh: nonce > 0, mode })
      .then(({ profile, stale }) => {
        if (!alive) return;
        setLoad({ kind: 'ready', profile, stale });
        // once per profile per visit: a refresh is not a new profile view
        trackOnce(String(profile.id), 'player_profile_loaded', {
          visibility: profile.hidden ? 'limited' : 'open', rank: rankInfo(profile.rankTier)?.medal ?? 'none',
          isMe: me.id === profile.id, stale, source: openedVia.current,
        });
      })
      .catch((e) => alive && setLoad({ kind: 'error', error: e instanceof PlayerError ? e.kind : 'server' }));
    return () => { alive = false; };
  }, [viewId, nonce, mode]);

  const profile = load.kind === 'ready' ? load.profile : null;
  const rank = rankInfo(profile?.rankTier);

  // form: the last 20 matches, once the profile is open
  useEffect(() => {
    if (!profile || profile.hidden) { setRecent(null); return; }
    let alive = true;
    setRecent({ kind: 'loading' });
    fetchRecent(profile.id, { fresh: nonce > 0 })
      .then((games) => alive && setRecent({ kind: 'ready', games }))
      .catch(() => alive && setRecent({ kind: 'error' }));
    return () => { alive = false; };
  }, [profile, nonce]);

  // weekly review: two weeks of history (one request, cached; shared with the patch dynamics)
  useEffect(() => {
    if (!profile || profile.hidden) { setWeekly(null); return; }
    let alive = true;
    const now = Date.now();
    const days = APP_CONFIG.player.weekly.days;
    setWeekly({ kind: 'loading' });
    loadHistory(profile.id, now / 1000 - 2 * days * 86400, { fresh: nonce > 0, now, mode })
      .then((h) => alive && setWeekly({ kind: 'ready', review: weeklyReview(h.games, now), stale: h.stale, fetchedAt: h.fetchedAt }))
      .catch(() => alive && setWeekly({ kind: 'error' }));
    return () => { alive = false; };
  }, [profile, nonce]);

  // the active improvement goal of this player: its hero's games (the match review's own loader and cache)
  const goal = profile && goals.active?.accountId === profile.id ? goals.active : null;
  useEffect(() => {
    if (!goal) { setGoalState(null); return; }
    let alive = true;
    setGoalState({ kind: 'loading' });
    loadHeroGames(goal.accountId, goal.heroId, goal.gameMode, { fresh: nonce > 0 })
      .then((games) => alive && setGoalState({ kind: 'ready', progress: goalProgress(goal, games) }))
      .catch(() => alive && setGoalState({ kind: 'error' }));
    return () => { alive = false; };
  }, [goal, nonce]);

  // meta win rates: the player's rank group, else all ranks
  useEffect(() => {
    if (!dataset || !profile) return;
    // Turbo: the meta is of normal games — compare with 50 % instead
    if (turbo) { setMeta({ base: new Map(dataset.heroes.map((h) => [h.id, 50])), rank: 'TURBO' }); return; }
    let alive = true;
    const want = rank && rankOptions.includes(rank.bracket) ? rank.bracket : null;
    if (!want) { setMeta({ base: dataset.baseWinrates, rank: 'ALL' }); return; }
    loadBracketTables(new Set(dataset.heroes.map((h) => h.id)))
      .then((tables) => { if (alive) { const b = tables?.get(want); setMeta(b ? { base: b.baseWinrates, rank: want } : { base: dataset.baseWinrates, rank: 'ALL' }); } })
      .catch(() => alive && setMeta({ base: dataset.baseWinrates, rank: 'ALL' }));
    return () => { alive = false; };
  }, [dataset, profile, rank?.bracket, rankOptions, turbo]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => (profile && meta ? heroStats(profile, meta.base) : []), [profile, meta]);
  /** The last matches of the chosen mode only (OpenDota's recent list mixes them). */
  const recentGames = useMemo(() => (recent?.kind === 'ready' ? recent.games.filter((g) => (g.gameMode === TURBO_GAME_MODE) === turbo) : null), [recent, turbo]);
  const sorted = useMemo(() => sortHeroes(stats, sort).slice(0, 10), [stats, sort]);
  const pool = useMemo(() => (profile && meta ? poolOf(profile, meta.base) : null), [profile, meta]);
  const width = profile ? poolWidth(profile) : null;
  const isMe = profile != null && me.id === profile.id;

  // the card tab shows the post-size card as it will be saved
  useEffect(() => {
    if (tab !== 'card' || !profile || profile.hidden || !meta) return;
    let alive = true;
    let url: string | null = null;
    const id = window.setTimeout(() => {
      renderRecapCard('post', card())
        .then((blob) => { if (alive) { url = URL.createObjectURL(blob); setPreview(url); } })
        .catch(() => alive && setPreview(null));
    }, 60);
    return () => { alive = false; window.clearTimeout(id); if (url) URL.revokeObjectURL(url); };
  }, [tab, profile, meta, hideName, recent, i18n.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = parsePlayerInput(text);
    setHint(null);
    if (input.kind === 'empty') return;
    if (input.kind === 'vanity') { setHint('vanity'); return; }
    if (input.kind === 'id') { setSearch({ kind: 'idle' }); openedVia.current = 'input'; setViewId(input.id); return; }
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
    // the draft's "My pool" is built from normal games: a Turbo profile is not stored as "me"
    setMe(profile.id, turbo ? undefined : profile);
    // the rank selector follows the profile (it can still be changed by hand)
    if (rank && rankOptions.includes(rank.bracket)) onRank(rank.bracket);
  }

  /** The share card: rank, top 3 strongest heroes, pool width, form. */
  function card(): RecapCard {
    const p = profile!;
    const record = p.hidden ? '' : ` · ${p.win}–${p.lose}`;
    const top = sortHeroes(stats, 'strong').slice(0, 3);
    const top3 = top.length ? top : sortHeroes(stats, 'games').slice(0, 3);
    const rows: RecapCard['rows'] = top3.map((x) => {
      const h = dataset?.heroById.get(x.heroId);
      const lb = heroLabels(x)[0];
      return {
        hero: h, title: `${h ? i18n.heroName(h) : `#${x.heroId}`}${lb ? ` · ${t(`label.${lb}` as StringKey)}` : ''}`,
        sub: t('card.profile.hero', { g: `${x.games} ${i18n.plural(x.games, 'game')}`, wr: pct(x.winrate), meta: x.meta != null ? pct(x.meta) : '—' }),
        value: `${x.edge > 0 ? '+' : x.edge < 0 ? '−' : ''}${Math.abs(x.edge).toFixed(1)}`, tone: x.edge > 0.5 ? 'pos' : x.edge < -0.5 ? 'neg' : 'muted',
      };
    });
    if (width && width.heroes > 0) rows.push({ title: t(`profile.width.${width.label}` as StringKey), sub: t('profile.width.text', { n: width.heroes, share: Math.round(width.top3Share * 100) }) });
    if (recentGames?.length) {
      const f = form(recentGames);
      rows.push({ title: t('card.profile.form'), sub: t('profile.form.text', { w: f.wins, l: f.losses, n: recentGames.length }), value: `${f.wins}–${f.losses}`, tone: f.wins >= f.losses ? 'pos' : 'neg' });
    }
    return {
      kicker: t('card.profile.kicker'),
      title: hideName ? t('card.profile.anon') : p.name,
      subtitle: (turbo ? `${t('profile.mode.turbo')} · ` : '') + t('card.profile.sub', { rank: rank ? `${t(`medal.${rank.medal}` as StringKey)}${rank.stars ? ` ${rank.stars}` : ''}` : t('rank.all'), record, wr: wr != null ? wr.toFixed(1) : '—' }),
      avatar: { src: hideName ? null : p.avatar, letter: hideName ? '' : (p.name.trim()[0] ?? '?').toUpperCase(), medal: rank ? medalSrc(rank.medal) : null },
      rows,
      footer: t('card.profile.footer'),
      site: window.location.host,
      notAffiliated: t('app.notAffiliated'),
    };
  }

  async function exportCard(format: CardFormat) {
    if (!profile) return;
    setShare('making');
    try {
      const blob = await renderRecapCard(format, card());
      const result = await deliverImages([new File([blob], `lastpick-profile-${format}.png`, { type: 'image/png' })], `${window.location.origin}/`);
      setShare('idle');
      if (result !== 'cancelled') trackEvent('share_created', { surface: 'profile', kind: 'image', format });
    } catch (e) {
      console.error(e);
      setShare('failed');
    }
  }

  async function copy(text: string, ok: 'copied' | 'copiedMe') {
    try {
      await navigator.clipboard.writeText(text);
      setShare(ok);
      trackEvent('share_created', { surface: 'profile', kind: 'link', format: 'none' });
    } catch { setShare('failed'); }
  }

  const days = daysSince(profile?.lastPlayed ?? null);
  const wr = profile ? overallWinrate(profile) : null;
  const date = (unix: number) => new Date(unix).toLocaleDateString(i18n.lang === 'ru' ? 'ru-RU' : 'en-US');

  return (
    <div className="mx-auto max-w-3xl">
      <section className="panel p-4 sm:p-6">
        <h2 className="font-display text-[20px] font-bold leading-6 text-ink">{t('profile.title')}</h2>
        {!profile && <p className="mt-1 text-[14px] leading-5 text-muted">{t('profile.lead')}</p>}
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
                  <button type="button" onClick={() => { openedVia.current = 'search'; setViewId(h.id); setSearch({ kind: 'idle' }); }} className="panel-2 flex w-full items-center gap-2.5 px-2.5 py-2 text-left hover:border-line-2">
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
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4">
          {load.kind === 'ready' && load.stale && <div className="notice">{t('profile.stale', { date: date(profile.fetchedAt) })}</div>}

          <section className="panel glass relative overflow-hidden p-4 sm:p-6">
            <div className="profile-glow" aria-hidden="true" />
            <div className="relative flex flex-wrap items-center gap-3 sm:gap-4">
              <Avatar src={profile.avatar} name={profile.name} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-display text-[20px] font-bold leading-6 text-ink">{profile.name}</h3>
                  <span className={`badge ${profile.hidden ? 'badge-warn' : 'badge-pos'}`}>{t(profile.hidden ? 'profile.limited' : 'profile.open')}</span>
                  {isMe && <span className="badge badge-pos">{t('profile.isMe')}</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                  {rank ? (
                    <span className="flex items-center gap-1 text-ink">
                      <img src={medalSrc(rank.medal)} alt="" width={24} height={24} aria-hidden="true" />
                      {t(`medal.${rank.medal}` as StringKey)}{rank.stars ? ` ${rank.stars}` : ''}
                      {profile.leaderboard ? <span className="text-muted"> · {t('profile.leaderboard', { n: profile.leaderboard })}</span> : null}
                    </span>
                  ) : <span>{t('profile.noRankShort')}</span>}
                  {days != null && <span>{days === 0 ? t('profile.lastGameToday') : t('profile.lastGame', { n: days })}</span>}
                  <span className="tnum">ID {profile.id}</span>
                </div>
              </div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                {isMe ? (
                  <button type="button" onClick={() => setMe(null)} className="btn btn-ghost btn-sm">{t('profile.notMe')}</button>
                ) : (
                  <button type="button" onClick={makeMe} className="btn btn-accent btn-sm">{t('profile.me')}</button>
                )}
                <button type="button" onClick={() => setNonce((n) => n + 1)} className="btn btn-ghost btn-sm" aria-label={t('profile.refresh')} title={t('profile.refresh')}>↻ <span className="sm:hidden">{t('profile.refresh')}</span></button>
              </div>
            </div>
            {!rank && <p className="relative mt-3 text-[12px] text-muted">{t('profile.noRank')}</p>}
          </section>

          {profile.hidden ? (
            <section className="panel p-4 sm:p-6">
              <h3 className="font-display text-[16px] font-bold text-ink">{t('profile.hidden.title')}</h3>
              <p className="mt-2 text-[14px] leading-5 text-muted">{t('profile.hidden.text')}</p>
              <p className="mt-2 text-[13px] leading-[18px] text-muted">{t('weekly.hidden')}</p>
            </section>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="seg seg-sm" role="radiogroup" aria-label={t('profile.mode.label')}>
                  {(['normal', 'turbo'] as PlayMode[]).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`seg-btn ${mode === m ? 'is-active' : ''}`}>{t(`profile.mode.${m}` as StringKey)}</button>
                  ))}
                </div>
                <span className="text-[12px] text-muted">{t(turbo ? 'profile.mode.turboHint' : 'profile.mode.normalHint')}</span>
              </div>
              {turbo && profile.win + profile.lose === 0 && <div className="notice">{t('profile.mode.turboNone')}</div>}
              <Tabs items={TABS.map((id) => ({ id, label: t(`profile.tab.${id}` as StringKey) }))} value={tab} onChange={setTab} label={t('profile.title')} />
              <div key={tab} className="tab-in grid grid-cols-[minmax(0,1fr)] gap-4" role="tabpanel">
                {tab === 'overview' && (
                  <>
              {pool?.lowData && <div className="notice">{t('profile.lowData', { n: profile.win + profile.lose })}</div>}
              {days != null && days > APP_CONFIG.player.staleDays && <div className="notice">{t('profile.oldPool', { n: days })}</div>}
                    {goal && goalState && <ImprovementGoalCard goal={goal} state={goalState} hero={dataset?.heroById.get(goal.heroId)} onComplete={() => goalActions.complete()} />}
                    {profile && historyOf(goals, profile.id).length > 0 && <GoalHistoryCard goals={historyOf(goals, profile.id)} heroById={dataset?.heroById} />}
                    {weekly && <WeeklyReviewCard state={weekly} isMe={isMe} heroById={dataset?.heroById} />}
                    <Overview profile={profile} stats={stats} width={width} recent={recentGames} heroById={dataset?.heroById} onTab={setTab} />
              {isMe && !me.poolWanted && (
                <section className="panel flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[16px] font-bold text-ink">{t('profile.pool.cta')}</div>
                    <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('profile.pool.text')}</p>
                  </div>
                  <button type="button" onClick={() => { setPoolOn(true); onUsePool(); }} className="btn btn-accent">{t('profile.pool.cta')} →</button>
                </section>
              )}
              <section className="panel p-4 sm:p-5">
                <h3 className="font-display text-[16px] font-bold text-ink">{t('profile.form.matches')}</h3>
                <div className="mt-2">
                  {recent?.kind === 'loading' && <p className="text-[13px] text-muted">{t('profile.form.loading')}</p>}
                  {recent?.kind === 'error' && <p className="text-[13px] text-muted">{t('profile.form.error')}</p>}
                  {recent?.kind === 'ready' && (recentGames?.length ? <FormStrip games={recentGames} heroById={dataset?.heroById} /> : <p className="text-[13px] text-muted">{t(turbo ? 'profile.form.noneTurbo' : 'profile.form.none')}</p>)}
                </div>
              </section>
              {isMe && (
                <section className="panel p-4 sm:p-5">
                  <h3 className="font-display text-[16px] font-bold text-ink">{t('profile.roles.title')}</h3>
                  <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('profile.roles.text')}</p>
                  <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('profile.roles.title')}>
                    {(['1', '2', '3', '4', '5'] as Role[]).map((r) => {
                      const on = me.roles.includes(r);
                      return (
                        <button key={r} type="button" aria-pressed={on} onClick={() => setRoles(on ? me.roles.filter((x) => x !== r) : [...me.roles, r])}
                          className={`btn btn-sm ${on ? 'btn-accent' : 'btn-ghost'}`}>
                          {r} · {t(`lane.${r}` as StringKey)}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
              {isMe && !turbo && dataset && <FavoritesSection favorites={me.favorites} heroes={dataset.heroes} heroById={dataset.heroById} />}
                  </>
                )}
                {tab === 'heroes' && (
                  <>
              <section className="panel p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-[16px] font-bold text-ink">{t('profile.heroes')}</h3>
                  <div className="seg seg-sm grid w-full grid-cols-2 sm:flex sm:w-auto" role="tablist" aria-label={t('profile.heroes')}>
                    {SORTS.map((k) => (
                      <button key={k} type="button" role="tab" aria-selected={sort === k} onClick={() => setSort(k)} className={`seg-btn ${sort === k ? 'is-active' : ''}`}>{t(`profile.sort.${k}` as StringKey)}</button>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-[12px] leading-4 text-muted">{t(`profile.sortHint.${sort}` as StringKey)}</p>
                <p className="mt-1.5 rounded-lg border border-dashed border-line-2 px-2.5 py-1.5 text-[12px] leading-4 text-muted">{t(turbo ? 'profile.edge.explainTurbo' : 'profile.edge.explain')}</p>
                {!meta ? <div className="mt-4"><DiamondLoader label={t('profile.loading')} /></div> : sorted.length === 0 ? (
                  <p className="mt-3 text-[13px] text-muted">{t('profile.none')}</p>
                ) : (
                  <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-1.5">
                    {sorted.map((s) => <HeroRow key={s.heroId} s={s} hero={dataset?.heroById.get(s.heroId)} sort={sort} turbo={turbo} />)}
                  </ul>
                )}
                {meta && !turbo && (
                  <dl className="mt-3 grid gap-1 text-[12px] leading-4 sm:grid-cols-2">
                    {(['comfort', 'gem', 'under', 'meta'] as HeroLabel[]).map((l) => (
                      <div key={l} className="flex items-start gap-2">
                        <dt className={`badge ${LABEL_TONE[l]} flex-none !py-0 !text-[10px]`}>{t(`label.${l}` as StringKey)}</dt>
                        <dd className="text-muted">{t(`label.hint.${l}` as StringKey)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {meta && <p className="mt-3 text-[11px] leading-[14px] text-muted">{turbo ? t('profile.metaTurbo') : <>{t('profile.meta', { rank: meta.rank === 'ALL' ? t('rank.all') : t(`rank.${meta.rank}` as StringKey) })} {t('profile.labelsNote')}</>}</p>}
              </section>
              {meta && dataset && stats.length > 0 && !turbo && (
                <LearnSection stats={stats} dataset={dataset} meta={meta.base} roles={isMe ? me.roles : []}
                  rankLabel={meta.rank === 'ALL' ? t('rank.all') : t(`rank.${meta.rank}` as StringKey)} />
              )}
                  </>
                )}
                {tab === 'patches' && (
                  <>
              {dataset && <PatchSection profile={profile} heroById={dataset.heroById} mode={mode} />}
                  </>
                )}
                {tab === 'friend' && (
                  <>
              {dataset && meta && <CompareSection profile={profile} dataset={dataset} meta={meta.base} mode={mode} />}
                  </>
                )}
                {tab === 'card' && (
                  <>
              <section className="panel p-4 sm:p-5">
                <h3 className="font-display text-[16px] font-bold text-ink">{t('profile.share.title')}</h3>
                <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('profile.share.text')}</p>
                <div className="card-preview mt-4">
                  {preview ? <img src={preview} alt={t('profile.share.preview')} className="fade-in block w-full" /> : <div className="aspect-[1200/630] w-full animate-pulse bg-surface-2" />}
                </div>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" checked={hideName} onChange={(e) => setHideName(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
                  {t('profile.share.hideName')}
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={share === 'making' || !meta} onClick={() => exportCard('story')} className="btn btn-accent btn-sm">{t('profile.share.story')}</button>
                  <button type="button" disabled={share === 'making' || !meta} onClick={() => exportCard('post')} className="btn btn-ghost btn-sm">{t('profile.share.post')}</button>
                  <button type="button" onClick={() => copy(`${window.location.origin}/${i18n.lang === 'ru' ? '?lang=ru' : ''}`, 'copied')} className="btn btn-ghost btn-sm">{t('profile.share.link')}</button>
                  <button type="button" onClick={() => setShare('warnMe')} className="btn btn-ghost btn-sm">{t('profile.share.linkMe')}</button>
                </div>
                <div aria-live="polite">
                  {share === 'making' && <p className="mt-2 text-[13px] text-muted">{t('profile.share.making')}</p>}
                  {share === 'failed' && <p className="mt-2 text-[13px] text-neg">{t('profile.share.failed')}</p>}
                  {(share === 'copied' || share === 'copiedMe') && <p className="mt-2 text-[13px] text-accent">{t('profile.share.copied')}</p>}
                  {share === 'warnMe' && (
                    <div className="notice mt-3 flex-col !items-start gap-2">
                      <span className="text-ink">{t('profile.share.linkMeWarn')}</span>
                      <button type="button" onClick={() => copy(`${window.location.origin}/?player=${profile.id}${i18n.lang === 'ru' ? '&lang=ru' : ''}`, 'copiedMe')} className="btn btn-accent btn-sm">{t('profile.share.linkMe')}</button>
                    </div>
                  )}
                </div>
              </section>
                  </>
                )}
              </div>
            </>
          )}
          <p className="text-[11px] leading-[14px] text-muted">
            {t('profile.source')}
          </p>
        </div>
      )}
    </div>
  );
}
