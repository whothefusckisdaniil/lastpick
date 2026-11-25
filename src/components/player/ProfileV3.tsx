import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import type { Hero } from '../../types';
import type { Dataset } from '../../data/dataset';
import { APP_CONFIG } from '../../config';
import { parsePlayerInput } from '../../player/parseId';
import { fetchHistory, fetchPatches, fetchPeers, fetchProfile, PlayerError, searchPlayers, type Peer, type PlayerErrorKind, type PlayerProfile, type SearchHit } from '../../player/api';
import { rankInfo } from '../../player/rankBracket';
import { overallWinrate, poolOf, type HeroStat } from '../../player/poolStats';
import { byPatch, comparePools, heroesToLearn, poolOverlap, type PatchRow } from '../../player/v3';
import { HeroPortrait } from '../HeroPortrait';
import { DiamondLoader } from '../Brand';
import { medalSrc } from '../Selectors';
import { Avatar } from './PoolResults';

const pct = (v: number) => Math.round(v);
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

function Portrait({ hero, size = 40 }: { hero: Hero | undefined; size?: number }) {
  return <span className="flex-none overflow-hidden rounded-lg" style={{ width: size, height: size }}>{hero && <HeroPortrait hero={hero} fill />}</span>;
}

/* ───────────── Heroes worth learning ───────────── */

export function LearnSection({ stats, dataset, meta, rankLabel, roles }: {
  stats: HeroStat[]; dataset: Dataset; meta: Map<number, number>; rankLabel: string; roles: string[];
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const picks = useMemo(
    () => heroesToLearn({ stats, heroes: dataset.heroes, positions: dataset.positions, meta, roles }),
    [stats, dataset, meta, roles],
  );
  const name = (id: number) => { const h = dataset.heroById.get(id); return h ? i18n.heroName(h) : `#${id}`; };
  return (
    <section className="panel p-4 sm:p-6">
      <h3 className="font-display text-[16px] font-bold text-ink">{t('profile.learn.title')}</h3>
      <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('profile.learn.text', { rank: rankLabel })}</p>
      {roles.length > 0 && <p className="mt-1 text-[12px] text-muted">{t('profile.learn.roles', { roles: roles.map((r) => t(`lane.${r}` as StringKey)).join(', ') })}</p>}
      {picks.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">{t('profile.learn.none')}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-1.5">
          {picks.map((p) => (
            <li key={p.heroId} className="panel-2 flex items-center gap-3 px-2.5 py-2">
              <Portrait hero={dataset.heroById.get(p.heroId)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-ink">{name(p.heroId)}</div>
                <div className="text-[12px] leading-4 text-muted">
                  {t('profile.learn.like', { heroes: p.like.map(name).join(', ') })}
                  {p.games > 0 && ` · ${t('profile.learn.played', { n: p.games, g: i18n.plural(p.games, 'game') })}`}
                </div>
              </div>
              <div className="flex-none text-right">
                <div className="tnum text-[14px] font-bold text-pos">{p.meta.toFixed(1)}%</div>
                <div className="text-[11px] text-muted">{t('profile.learn.meta')}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-[14px] text-muted">{t('profile.learn.note')}</p>
    </section>
  );
}

/* ───────────── Dynamics by patch ───────────── */

type PatchLoad = { kind: 'loading' } | { kind: 'ready'; rows: PatchRow[] } | { kind: 'error' };

export function PatchSection({ profile, heroById }: { profile: PlayerProfile; heroById: Map<number, Hero> }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [load, setLoad] = useState<PatchLoad>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    (async () => {
      const patches = await fetchPatches();
      const shown = [...patches].sort((a, b) => a.start - b.start).slice(-APP_CONFIG.player.patchCount);
      if (!shown.length) return [];
      const games = await fetchHistory(profile.id, shown[0].start);
      return byPatch(games, patches);
    })()
      .then((rows) => alive && setLoad({ kind: 'ready', rows }))
      .catch(() => alive && setLoad({ kind: 'error' }));
    return () => { alive = false; };
  }, [profile.id]);

  const rows = load.kind === 'ready' ? load.rows : [];
  const max = Math.max(1, ...rows.map((r) => r.games));
  // trim patches before the player's first game in the window (empty tail)
  let end = rows.length;
  while (end > 0 && rows[end - 1].games === 0) end--;
  const shown = rows.slice(0, end);

  return (
    <section className="panel p-4 sm:p-6">
      <h3 className="font-display text-[16px] font-bold text-ink">{t('profile.patches.title')}</h3>
      <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('profile.patches.text')}</p>
      {load.kind === 'loading' && <div className="mt-4"><DiamondLoader label={t('profile.patches.loading')} /></div>}
      {load.kind === 'error' && <p className="mt-3 text-[13px] text-muted">{t('profile.patches.error')}</p>}
      {load.kind === 'ready' && (shown.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">{t('profile.patches.none')}</p>
      ) : (
        <ol className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-1.5">
          {shown.map((r, i) => {
            const prev = shown[i + 1];
            const delta = r.winrate != null && prev?.winrate != null && prev.games >= 30 && r.games >= 30 ? r.winrate - prev.winrate : null;
            return (
              <li key={r.patch} className="panel-2 grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 px-2.5 py-2">
                <span className="font-display text-[15px] font-bold text-ink">{r.patch}</span>
                <div className="min-w-0">
                  <div className="tnum truncate text-[13px] text-ink">
                    {r.games} {i18n.plural(r.games, 'game')}
                    {r.games > 0 && <span className="text-muted"> · {r.heroCount} {i18n.plural(r.heroCount, 'hero')}</span>}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(100 * r.games) / max}%` }} />
                  </div>
                  {r.top.length > 0 && (
                    <div className="mt-1.5 flex gap-1">
                      {r.top.map((h) => {
                        const hero = heroById.get(h.heroId);
                        const label = `${hero ? i18n.heroName(hero) : `#${h.heroId}`}: ${h.games} ${i18n.plural(h.games, 'game')}, ${pct((100 * h.win) / h.games)}%`;
                        return <span key={h.heroId} title={label} aria-label={label}><Portrait hero={hero} size={26} /></span>;
                      })}
                    </div>
                  )}
                </div>
                <div className="flex-none text-right">
                  <div className={`tnum text-[14px] font-bold ${r.winrate == null ? 'text-muted' : r.winrate >= 50 ? 'text-pos' : 'text-neg'}`}>{r.winrate == null ? '—' : `${pct(r.winrate)}%`}</div>
                  {delta != null && Math.abs(delta) >= 1 && <div className={`tnum text-[11px] ${delta > 0 ? 'text-pos' : 'text-neg'}`}>{signed(delta)} {t('profile.patches.pp')}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      ))}
    </section>
  );
}

/* ───────────── Compare with a friend ───────────── */

type FriendLoad = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; profile: PlayerProfile } | { kind: 'error'; error: PlayerErrorKind };

function Side({ p }: { p: PlayerProfile }) {
  const i18n = useI18n();
  const { t } = i18n;
  const r = rankInfo(p.rankTier);
  const wr = overallWinrate(p);
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <Avatar src={p.avatar} name={p.name} size={44} />
      <div className="w-full min-w-0">
        <div className="truncate text-[14px] font-semibold text-ink">{p.name}</div>
        <div className="tnum flex items-center justify-center gap-1 text-[12px] text-muted">
          {r && <img src={medalSrc(r.medal)} alt={t(`medal.${r.medal}` as StringKey)} width={18} height={18} />}
          <span className="truncate">{p.hidden || wr == null ? t('profile.limited') : `${wr.toFixed(1)}% · ${p.win + p.lose} ${i18n.plural(p.win + p.lose, 'game')}`}</span>
        </div>
      </div>
    </div>
  );
}

function StatCell({ s, better }: { s: HeroStat; better: boolean }) {
  const i18n = useI18n();
  return (
    <div className="tnum text-right">
      <div className={`text-[13px] font-bold ${better ? 'text-pos' : 'text-ink'}`}>{pct(s.winrate)}%</div>
      <div className="text-[11px] text-muted">{s.games} {i18n.plural(s.games, 'game')}</div>
    </div>
  );
}

export function CompareSection({ profile, dataset, meta }: { profile: PlayerProfile; dataset: Dataset; meta: Map<number, number> }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [peers, setPeers] = useState<Peer[] | null>(null);
  const [text, setText] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [hint, setHint] = useState<StringKey | null>(null);
  const [friendId, setFriendId] = useState<number | null>(null);
  const [friend, setFriend] = useState<FriendLoad>({ kind: 'idle' });

  useEffect(() => {
    let alive = true;
    setPeers(null); setFriendId(null);
    fetchPeers(profile.id).then((l) => alive && setPeers(l)).catch(() => alive && setPeers([]));
    return () => { alive = false; };
  }, [profile.id]);

  useEffect(() => {
    if (friendId == null) { setFriend({ kind: 'idle' }); return; }
    let alive = true;
    setFriend({ kind: 'loading' });
    fetchProfile(friendId)
      .then(({ profile: p }) => alive && setFriend({ kind: 'ready', profile: p }))
      .catch((e) => alive && setFriend({ kind: 'error', error: e instanceof PlayerError ? e.kind : 'server' }));
    return () => { alive = false; };
  }, [friendId]);

  function pick(id: number) {
    setHits(null);
    setHint(null);
    if (id === profile.id) { setHint('profile.cmp.self'); return; }
    setFriendId(id);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = parsePlayerInput(text);
    setHint(null);
    if (input.kind === 'empty') return;
    if (input.kind === 'vanity') { setHint('profile.vanity'); return; }
    if (input.kind === 'id') { pick(input.id); return; }
    try { setHits(await searchPlayers(input.q, 6)); } catch (err) { setHint(`profile.err.${err instanceof PlayerError ? err.kind : 'server'}` as StringKey); }
  }

  const other = friend.kind === 'ready' ? friend.profile : null;
  const cmp = useMemo(() => {
    if (!other || other.hidden) return null;
    const a = poolOf(profile, meta), b = poolOf(other, meta);
    return { ...comparePools(a, b), overlap: poolOverlap(a, b) };
  }, [profile, other, meta]);
  const together = other ? peers?.find((p) => p.id === other.id) : undefined;
  const name = (id: number) => { const h = dataset.heroById.get(id); return h ? i18n.heroName(h) : `#${id}`; };
  const top = (peers ?? []).filter((p) => p.withGames > 0).slice(0, APP_CONFIG.player.peerCount);

  const onlyList = (list: HeroStat[], who: string) => (
    <div className="min-w-0">
      <div className="label mb-1.5 truncate">{t('profile.cmp.only', { name: who })}</div>
      {list.length === 0 ? <p className="text-[12px] text-muted">—</p> : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
          {list.map((s) => (
            <li key={s.heroId} className="flex items-center gap-2">
              <Portrait hero={dataset.heroById.get(s.heroId)} size={28} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{name(s.heroId)}</span>
              <span className="tnum flex-none text-[12px] text-muted">{pct(s.winrate)}% · {s.games}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <section className="panel p-4 sm:p-6">
      <h3 className="font-display text-[16px] font-bold text-ink">{t('profile.cmp.title')}</h3>
      <p className="mt-1 text-[13px] leading-[18px] text-muted">{t('profile.cmp.text')}</p>

      {top.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">{t('profile.cmp.peers')}</div>
          <div className="flex flex-wrap gap-1.5">
            {top.map((p) => (
              <button key={p.id} type="button" onClick={() => pick(p.id)} aria-pressed={friendId === p.id}
                className={`panel-2 flex max-w-[220px] items-center gap-2 py-1 pl-1 pr-2.5 text-left hover:border-line-2 ${friendId === p.id ? '!border-accent' : ''}`}>
                <Avatar src={p.avatar} name={p.name} size={26} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                  <span className="tnum block text-[11px] text-muted">{p.withGames} {i18n.plural(p.withGames, 'game')}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input value={text} onChange={(e) => { setText(e.target.value); setHint(null); }} placeholder={t('profile.cmp.placeholder')} aria-label={t('profile.cmp.placeholder')}
          autoComplete="off" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-bg-2 px-3 text-[14px] text-ink placeholder:text-muted focus:border-accent focus:outline-none" />
        <button type="submit" className="btn btn-ghost btn-sm">{t('profile.cmp.go')}</button>
      </form>
      {hint && <p className="mt-2 text-[13px] leading-[18px] text-muted" role="alert">{t(hint)}</p>}
      {hits && (hits.length === 0 ? <p className="mt-2 text-[13px] text-muted">{t('profile.searchNone', { q: text.trim() })}</p> : (
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => pick(h.id)} className="panel-2 flex w-full items-center gap-2 px-2 py-1.5 text-left hover:border-line-2">
                <Avatar src={h.avatar} name={h.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{h.name}</span>
                <span className="tnum flex-none text-[11px] text-muted">ID {h.id}</span>
              </button>
            </li>
          ))}
        </ul>
      ))}

      {friend.kind === 'loading' && <div className="mt-4"><DiamondLoader label={t('profile.loading')} /></div>}
      {friend.kind === 'error' && <p className="mt-3 text-[13px] text-neg" role="alert">{t(`profile.err.${friend.error}` as StringKey)}</p>}
      {other && (
        <div className="mt-4 grid gap-4 border-t border-line pt-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <Side p={profile} />
            <span className="text-[12px] font-bold uppercase text-muted">vs</span>
            <Side p={other} />
          </div>
          <p className="tnum text-[13px] text-muted">
            {together && together.withGames > 0
              ? t('profile.cmp.together', { g: together.withGames, games: i18n.plural(together.withGames, 'game'), wr: pct((100 * together.withWin) / together.withGames) })
              : t('profile.cmp.notTogether')}
            {together && together.againstGames > 0 && ` · ${t('profile.cmp.against', { g: together.againstGames, wr: pct((100 * together.againstWin) / together.againstGames) })}`}
          </p>
          {other.hidden ? (
            <p className="text-[13px] text-muted">{t('profile.cmp.hidden', { name: other.name })}</p>
          ) : cmp && (
            <>
              <p className="text-[13px] text-ink">{t('profile.cmp.overlap', { p: Math.round(cmp.overlap * 100) })}</p>
              <div>
                <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_56px_56px] items-end gap-3 px-2.5">
                  <span className="label">{t('profile.cmp.common')}</span>
                  {cmp.common.length > 0 && [profile, other].map((x) => (
                    <span key={x.id} className="flex justify-end" title={x.name}><Avatar src={x.avatar} name={x.name} size={22} /></span>
                  ))}
                </div>
                {cmp.common.length === 0 ? <p className="text-[12px] text-muted">{t('profile.cmp.noCommon')}</p> : (
                  <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                    {cmp.common.map((c) => (
                      <li key={c.heroId} className="panel-2 grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-3 px-2.5 py-1.5">
                        <span className="flex min-w-0 items-center gap-3">
                          <Portrait hero={dataset.heroById.get(c.heroId)} size={32} />
                          <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{name(c.heroId)}</span>
                        </span>
                        <StatCell s={c.a} better={c.a.score > c.b.score + 0.5} />
                        <StatCell s={c.b} better={c.b.score > c.a.score + 0.5} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {onlyList(cmp.onlyA, profile.name)}
                {onlyList(cmp.onlyB, other.name)}
              </div>
              <p className="text-[11px] leading-[14px] text-muted">{t('profile.cmp.note')}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
