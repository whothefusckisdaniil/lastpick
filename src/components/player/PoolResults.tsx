import { useState } from 'react';
import type { PositionFilter } from '../../config';
import type { CandidateScore } from '../../types';
import type { PoolCandidate, PoolResult } from '../../scoring/poolScoring';
import type { PlayerProfile } from '../../player/api';
import { rankInfo } from '../../player/rankBracket';
import { APP_CONFIG } from '../../config';
import { daysSince } from '../../player/poolStats';
import { useI18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import { HeroPortrait } from '../HeroPortrait';
import { MatchBar, ResultRow, scoreText, scoreTone } from '../CandidateCard';
import { medalSrc } from '../Selectors';

type Lane = Exclude<PositionFilter, 'all'>;

/** Round avatar from Steam, a letter when it fails to load. */
export function Avatar({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="inline-flex flex-none items-center justify-center overflow-hidden rounded-full bg-surface-2 font-semibold text-muted" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {src && !broken ? <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" /> : (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/** Header chip: "My pool" on / off (shown once a profile is saved). */
export function PoolChip({ profile, on, onToggle }: { profile: PlayerProfile; on: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const r = rankInfo(profile.rankTier);
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} title={t('pool.chipTitle', { name: profile.name })}
      className={`chip ${on ? '!border-accent text-ink' : 'text-muted'}`}>
      <Avatar src={profile.avatar} name={profile.name} size={28} />
      {r && <img src={medalSrc(r.medal)} alt="" width={22} height={22} className="-ml-2.5 max-[399px]:hidden" aria-hidden="true" />}
      <span className={`text-[13px] font-semibold ${on ? 'text-accent' : ''}`}>{t('pool.chip')}</span>
      <span className={`h-2 w-2 rounded-full ${on ? 'bg-accent' : 'bg-line-2'}`} aria-hidden="true" />
    </button>
  );
}

function PoolRow({ x, rank, lowData, tag, onOpen, favorite = false }: { x: PoolCandidate; rank?: number; lowData: boolean; tag?: string; onOpen: () => void; /** One of the player's favourite heroes. */ favorite?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const name = i18n.heroName(x.c.hero);
  const games = `${x.stat.games} ${i18n.plural(x.stat.games, 'game')}`;
  return (
    <button type="button" onClick={onOpen} className="result-row !items-start !py-2.5" aria-label={t('card.viewFor', { name, rank: rank ?? 1 })}>
      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg"><HeroPortrait hero={x.c.hero} fill variant="large" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          {tag ? <span className="label shrink-0 !text-[11px] text-accent">{tag}</span>
            : rank != null ? <span aria-hidden="true" className="tnum shrink-0 text-[11px] font-semibold text-muted">#{rank}</span> : null}
          <span className="truncate text-[15px] font-semibold leading-5 text-ink">{name}</span>
          {favorite && <span className="flex-none text-[13px] text-accent" title={t('fav.badge')} aria-label={t('fav.badge')}>★</span>}
        </span>
        <span className="tnum mt-0.5 block text-[12px] leading-4 text-muted">
          {x.stat.games === 0 ? t('fav.noGames') : t('pool.personal', { wr: Math.round(x.stat.winrate), g: games })}
          {x.stat.games > 0 && (lowData || x.stat.games < APP_CONFIG.player.minGamesAll) && <span className="badge badge-warn ml-1.5 !py-0 !text-[10px]">{t('pool.lowData')}</span>}
        </span>
        <span className="tnum mt-0.5 block text-[12px] leading-4">
          <span className={scoreTone(x.c.finalScore)}>{t('pool.counter', { v: scoreText(x.c.finalScore) })}</span>
          <span className="text-muted"> · </span>
          <span className={scoreTone(x.comfortPoints)}>{t('pool.comfort', { v: scoreText(x.comfortPoints) })}</span>
        </span>
        <MatchBar c={x.c} className="mt-1.5 max-w-[160px]" />
      </span>
      <span className={`tnum shrink-0 font-display text-[16px] font-bold ${scoreTone(x.score)}`}>{scoreText(x.score)}</span>
    </button>
  );
}

/** "Best counter overall: Lion (+6.2). Best from your pool: Pudge (+3.9)." */
function VsOverall({ r }: { r: PoolResult }) {
  const i18n = useI18n();
  const { t } = i18n;
  const best = r.bestOverall;
  const top = r.list[0];
  if (!best || !top) return null;
  const text = best.hero.id === top.c.hero.id
    ? t('pool.bestIsPool', { hero: i18n.heroName(best.hero) })
    : t('pool.vsOverall', { hero: i18n.heroName(best.hero), v: scoreText(best.finalScore), pool: i18n.heroName(top.c.hero), pv: scoreText(top.c.finalScore) });
  return <p className="notice mt-3 !text-[13px] !leading-[18px] text-ink">{text}</p>;
}

/**
 * "My pool" results: per role the best of the player's heroes (all roles), or
 * the top 5 with the comparison line (one role). A role with no pool hero
 * falls back to the best heroes overall.
 */
export function PoolResults({ results, overall, profile, lowData, summary, roles = [], favorites = new Set<number>(), onViewDetails, onOff }: {
  /** The player's favourite heroes (always in the pool). */
  favorites?: Set<number>;
  results: Map<Lane, PoolResult>;
  overall: Map<Lane, CandidateScore[]> | null;
  profile: PlayerProfile;
  lowData: boolean;
  summary: boolean;
  /** "My roles": with all roles, only these are shown (empty = all). */
  roles?: string[];
  onViewDetails: (c: CandidateScore, lane: Lane) => void;
  onOff: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const r = rankInfo(profile.rankTier);
  const days = daysSince(profile.lastPlayed);
  const title = (lane: Lane) => t(`lane.${lane}` as StringKey);
  const entries = [...results.entries()];
  const shown = summary && roles.length ? entries.filter(([lane]) => roles.includes(lane)) : entries;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Avatar src={profile.avatar} name={profile.name} size={24} />
        <span className="font-semibold text-ink">{profile.name}</span>
        {r && <span>· {t(`medal.${r.medal}` as StringKey)}{r.stars ? ` ${r.stars}` : ''}</span>}
        {lowData && <span className="badge badge-warn">{t('pool.lowData')}</span>}
        {days != null && days > APP_CONFIG.player.staleDays && <span className="badge badge-warn">{t('profile.lastGame', { n: days })}</span>}
        <button type="button" onClick={onOff} className="btn btn-ghost btn-sm !min-h-[28px] ml-auto">{t('pool.off')}</button>
      </div>

      {summary && roles.length > 0 && shown.length < entries.length && (
        <p className="mb-2 text-[12px] text-muted">{t('pool.rolesOnly', { roles: roles.map((r) => title(r as Lane)).join(', ') })}</p>
      )}
      {summary ? (
        <div className="stagger grid gap-2">
          {shown.map(([lane, res], i) => {
            const top = res.list[0];
            if (top) return <div key={lane} style={{ '--i': i } as React.CSSProperties}><PoolRow x={top} tag={title(lane)} lowData={lowData} favorite={favorites.has(top.c.hero.id)} onOpen={() => onViewDetails(top.c, lane)} /></div>;
            const best = overall?.get(lane)?.[0];
            return best ? (
              <ResultRow key={lane} c={best} tag={`${title(lane)} · ${t('pool.overallTag')}`} style={{ '--i': i } as React.CSSProperties} onViewDetails={(c) => onViewDetails(c, lane)} />
            ) : (
              <div key={lane} className="result-row !cursor-default" style={{ '--i': i } as React.CSSProperties}>
                <span className="min-w-0"><span className="label block text-accent">{title(lane)}</span><span className="block text-[13px] text-muted">{t('results.noDataRole')}</span></span>
              </div>
            );
          })}
          {(() => {
            // favourites that are not already a lane's top pick, each on its best lane
            const tops = new Set(shown.map(([, res]) => res.list[0]?.c.hero.id));
            const best = new Map<number, { x: PoolCandidate; lane: Lane }>();
            for (const [lane, res] of shown) for (const x of res.list) {
              const id = x.c.hero.id;
              if (!favorites.has(id) || tops.has(id)) continue;
              const cur = best.get(id);
              if (!cur || x.score > cur.x.score) best.set(id, { x, lane });
            }
            const list = [...best.values()].sort((a, b) => b.x.score - a.x.score);
            return list.length ? (
              <div className="mt-3">
                <h3 className="label mb-2">★ {t('fav.inPool')}</h3>
                <div className="grid gap-2">
                  {list.map(({ x, lane }) => <PoolRow key={x.c.hero.id} x={x} tag={title(lane)} lowData={lowData} favorite onOpen={() => onViewDetails(x.c, lane)} />)}
                </div>
              </div>
            ) : null;
          })()}
        </div>
      ) : (
        [...results.entries()].map(([lane, res]) => (
          <section key={lane} aria-label={title(lane)}>
            <h3 className="label mb-2">{t('pool.title')}</h3>
            {res.list.length === 0 ? (
              <>
                <div className="notice">{t('pool.noneLane')}</div>
                <div className="stagger mt-2 grid gap-2">
                  {(overall?.get(lane) ?? []).slice(0, 5).map((c, i) => (
                    <ResultRow key={c.hero.id} c={c} rank={i + 1} style={{ '--i': i } as React.CSSProperties} onViewDetails={(cc) => onViewDetails(cc, lane)} />
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="stagger grid gap-2">
                  {res.list.slice(0, 5).map((x, i) => (
                    <div key={x.c.hero.id} style={{ '--i': i } as React.CSSProperties}>
                      <PoolRow x={x} rank={i + 1} lowData={lowData} favorite={favorites.has(x.c.hero.id)} onOpen={() => onViewDetails(x.c, lane)} />
                    </div>
                  ))}
                </div>
                {(() => {
                  const favs = res.list.map((x, i) => ({ x, place: i + 1 })).filter(({ x, place }) => place > 5 && favorites.has(x.c.hero.id));
                  return favs.length ? (
                    <div className="mt-4">
                      <h3 className="label">★ {t('fav.inPool')}</h3>
                      <p className="mb-2 mt-0.5 text-[12px] text-muted">{t('fav.belowTop')}</p>
                      <div className="grid gap-2">
                        {favs.map(({ x, place }) => <PoolRow key={x.c.hero.id} x={x} rank={place} lowData={lowData} favorite onOpen={() => onViewDetails(x.c, lane)} />)}
                      </div>
                    </div>
                  ) : null;
                })()}
                <VsOverall r={res} />
                {res.avoid.filter((x) => !favorites.has(x.c.hero.id)).length > 0 && (
                  <div className="mt-5">
                    <h3 className="label">{t('pool.avoid')}</h3>
                    <p className="mb-2 mt-0.5 text-[12px] text-muted">{t('pool.avoidHint')}</p>
                    <div className="grid gap-2">
                      {res.avoid.filter((x) => !favorites.has(x.c.hero.id)).map((x) => <PoolRow key={x.c.hero.id} x={x} lowData={lowData} onOpen={() => onViewDetails(x.c, lane)} />)}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        ))
      )}
      <p className="mt-4 text-[11px] leading-[14px] text-muted">{t('pool.note')}</p>
    </div>
  );
}
