import { useMemo, useState, type ReactNode } from 'react';
import type { Hero } from '../../types';
import type { I18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import type { WinChance } from '../../scoring/winChance';
import { hasRealDraft, type MatchModel, type MatchObjective, type MatchPlayer } from '../../match/model';
import type { Swing, Verdict } from '../../match/analyze/story';
import type { Award, Pos } from '../../match/analyze/players';
import type { BuildReview, BuildRow } from '../../match/analyze/builds';
import { fightScore, type FightSummary } from '../../match/analyze/fights';
import type { Laning, LaneResult } from '../../match/analyze/lanes';
import type { DeathCost, DeathsSummary } from '../../match/analyze/deaths';
import { inPhase, lifetime, WARD_PHASES, type WardSummary } from '../../match/analyze/wards';
import { compareToNorm, normAt, type NormCompare, type NormFile } from '../../match/norms';
import { HeroPortrait } from '../HeroPortrait';
import { DiamondLoader } from '../Brand';
import type { RecapCard, RecapCardRow } from '../../share/matchCards';

const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react';
const itemImg = (key: string) => `${CDN}/items/${key}.png`;

export type Loadable<T> = { status: 'loading' } | { status: 'none' } | { status: 'error' } | { status: 'ready'; value: T };

export interface DraftInfo {
  /** Radiant's point of view. */
  win: WinChance;
  bracket: string | null;
  nowPatch: string | null;
  thenPatch: string | null;
}

export interface BuildInfo { review: BuildReview; pos: Pos; itemName: (key: string) => string }

export interface RecapCtx {
  m: MatchModel;
  i18n: I18n;
  heroOf: (p: MatchPlayer) => Hero | undefined;
  heroById: Map<number, Hero>;
  me: number | null;
  pos: Map<number, Pos>;
  posGuessed: boolean;
  verdict: Verdict;
  swings: Swing[];
  economy: { radiant: { netWorth: number; share: Map<number, number> }; dire: { netWorth: number; share: Map<number, number> }; leader: MatchPlayer; carried: MatchPlayer };
  awards: Award[];
  fights: FightSummary[];
  laning: Laning | null;
  deaths: DeathsSummary | null;
  wards: WardSummary | null;
  /** STRATZ norm file for a player's hero / position (lobby rank, else all ranks). */
  norms: Loadable<(p: MatchPlayer) => { file: NormFile; rank: string } | null>;
  draft: Loadable<DraftInfo>;
  build: Loadable<BuildInfo>;
  buildSlot: number;
  setBuildSlot: (slot: number) => void;
  onOpenDraft: (() => void) | null;
  patchName: string | null;
  card: { site: string; notAffiliated: string; footer: string };
}

export interface Slide { id: string; title: string; node: ReactNode; card: () => RecapCard }

/* ---------- small helpers ---------- */

export const kGold = (v: number, lang: string) => `${(Math.abs(v) / 1000).toFixed(1).replace('.', lang === 'ru' ? ',' : '.')}k`;
const teamName = (c: RecapCtx, radiant: boolean) => c.i18n.t(radiant ? 'match.radiant' : 'match.dire');
const heroName = (c: RecapCtx, p: MatchPlayer) => { const h = c.heroOf(p); return h ? c.i18n.heroName(h) : `#${p.heroId}`; };
const teamHeroes = (c: RecapCtx, radiant: boolean) => c.m.players.filter((p) => p.radiant === radiant).flatMap((p) => { const h = c.heroOf(p); return h ? [h] : []; });
const meHeroId = (c: RecapCtx) => (c.me != null ? c.m.players[c.me]?.heroId ?? null : null);

function Portrait({ c, p, size = 40, ring }: { c: RecapCtx; p: MatchPlayer; size?: number; ring?: boolean }) {
  const h = c.heroOf(p);
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden rounded-lg ${ring ? 'ring-2 ring-accent' : ''}`} style={{ width: size, height: size }}>
      {h ? <HeroPortrait hero={h} fill /> : null}
    </span>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <div className="label text-accent">{children}</div>;
}

function Headline({ children }: { children: ReactNode }) {
  return <h3 className="mt-1 font-display text-[20px] font-bold leading-[26px] text-ink sm:text-[26px] sm:leading-[32px]">{children}</h3>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[11px] leading-[15px] text-muted">{children}</p>;
}

/* ---------- 1. cover ---------- */

export function coverHeadline(c: RecapCtx): string {
  const { t, lang } = c.i18n;
  const v = c.verdict;
  const vars = { team: teamName(c, v.radiantWin), min: v.minute, gold: v.kind === 'comeback' ? `−${kGold(v.deficit ?? 0, lang)}` : kGold(v.maxLead ?? 0, lang) };
  const key: StringKey = v.kind === 'comeback' ? (v.deficit == null ? 'cover.comebackScore' : 'cover.comeback')
    : v.kind === 'stomp' ? (v.maxLead == null ? 'cover.stompScore' : 'cover.stomp')
      : v.kind === 'close' ? 'cover.close' : 'cover.steady';
  return t(key, vars);
}

function meLine(c: RecapCtx): string | null {
  if (c.me == null) return null;
  const p = c.m.players[c.me];
  return c.i18n.t('cover.me', { hero: heroName(c, p), result: c.i18n.t(p.radiant === c.m.radiantWin ? 'match.win' : 'match.loss') });
}

export function metaLine(c: RecapCtx): string {
  const { t, lang } = c.i18n;
  const modeKey = [1, 2, 22, 23].includes(c.m.gameMode) ? `match.mode.${c.m.gameMode}` : 'match.mode.other';
  const date = new Date(c.m.startTime * 1000).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  const base = t('match.meta', { id: c.m.id, mode: t(modeKey as StringKey), date });
  return c.patchName ? `${base} · ${t('match.patch', { patch: c.patchName })}` : base;
}

function TeamLine({ c, radiant }: { c: RecapCtx; radiant: boolean }) {
  const win = radiant === c.m.radiantWin;
  const ps = c.m.players.filter((p) => p.radiant === radiant);
  return (
    <div>
      <div className={`label mb-1.5 ${win ? (radiant ? 'text-pos' : 'text-neg') : ''}`}>
        {teamName(c, radiant)}{win ? ` · ${c.i18n.t('match.win')}` : ''}
      </div>
      <ul className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {ps.map((p) => (
          <li key={p.slot} className="min-w-0">
            <span className={`block aspect-square overflow-hidden rounded-lg border-b-4 ${radiant ? 'border-pos' : 'border-neg'} ${c.me === p.slot ? 'ring-2 ring-accent' : ''}`}>
              {c.heroOf(p) && <HeroPortrait hero={c.heroOf(p)!} fill />}
            </span>
            <span className="mt-1 block truncate text-center text-[11px] leading-[14px] text-muted">{heroName(c, p)}</span>
            <span className="tnum block text-center text-[11px] font-semibold leading-[14px] text-ink">{p.kills}/{p.deaths}/{p.assists}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function coverSlide(c: RecapCtx): Slide {
  const { t } = c.i18n;
  const me = meLine(c);
  const head = coverHeadline(c);
  return {
    id: 'cover',
    title: t('slide.cover'),
    node: (
      <div>
        <Kicker>{metaLine(c)}</Kicker>
        <Headline>{me ?? head}</Headline>
        {me && <p className="mt-1 text-[14px] leading-5 text-muted">{head}</p>}
        <div className="mt-4 flex items-baseline justify-center gap-4 font-display font-bold">
          <span className={`tnum text-[40px] leading-none ${c.m.radiantWin ? 'text-pos' : 'text-muted'}`}>{c.m.radiantScore}</span>
          <span className="text-[14px] text-muted">{t('match.min', { n: c.verdict.minute })}</span>
          <span className={`tnum text-[40px] leading-none ${!c.m.radiantWin ? 'text-neg' : 'text-muted'}`}>{c.m.direScore}</span>
        </div>
        <div className="mt-5 grid gap-5">
          <TeamLine c={c} radiant />
          <TeamLine c={c} radiant={false} />
        </div>
      </div>
    ),
    card: () => ({
      kicker: metaLine(c),
      title: me ?? head,
      subtitle: me ? head : undefined,
      teams: { top: teamHeroes(c, true), bottom: teamHeroes(c, false), topLabel: teamName(c, true), bottomLabel: teamName(c, false), topWin: c.m.radiantWin, highlight: meHeroId(c) },
      score: { left: c.m.radiantScore, right: c.m.direScore, mid: t('match.min', { n: c.verdict.minute }), leftWin: c.m.radiantWin },
      ...c.card,
    }),
  };
}

/* ---------- 2. draft ---------- */

function draftSentence(c: RecapCtx, w: WinChance): string {
  const { t } = c.i18n;
  const r = Math.round(w.chance * 100);
  if (Math.abs(r - 50) <= 2) return t('draft.even', { a: r, b: 100 - r });
  const favRadiant = r > 50;
  const head = t('draft.fav', { team: teamName(c, favRadiant), a: Math.max(r, 100 - r), b: Math.min(r, 100 - r) });
  return `${head} — ${favRadiant === c.m.radiantWin ? t('draft.held') : t('draft.upset', { team: teamName(c, c.m.radiantWin) })}`;
}

const toPts = (delta: number) => delta * 0.0345 * 25;
const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

function edgeRows(c: RecapCtx, w: WinChance, radiant: boolean) {
  const byHero = new Map(c.m.players.map((p) => [p.heroId, p]));
  const list = radiant ? w.pairs.filter((x) => x.delta > 0.5).slice(0, 3) : [...w.pairs].reverse().filter((x) => x.delta < -0.5).slice(0, 3);
  return list.flatMap((x) => {
    const a = byHero.get(radiant ? x.a : x.b);
    const b = byHero.get(radiant ? x.b : x.a);
    return a && b ? [{ a, b, pts: Math.abs(toPts(x.delta)) }] : [];
  });
}

function DraftBody({ c }: { c: RecapCtx }) {
  const { t, i18n } = { t: c.i18n.t, i18n: c.i18n };
  if (!hasRealDraft(c.m)) return <p className="notice mt-4">{t('match.noDraft')}</p>;
  if (c.draft.status === 'loading') return <div className="mt-6"><DiamondLoader label={t('draft.loading')} /></div>;
  if (c.draft.status !== 'ready') return <p className="notice mt-4">{t('draft.unavailable')}</p>;
  const d = c.draft.value;
  const r = Math.round(d.win.chance * 100);
  const rankName = d.bracket ? t(`rank.${d.bracket}` as StringKey) : t('rank.all');
  const picks = c.m.picksBans;
  const hero = (id: number) => c.m.players.find((p) => p.heroId === id);
  return (
    <>
      <Headline>{draftSentence(c, d.win)}</Headline>
      <div className="mt-4 flex items-end justify-between">
        <div><div className="text-[11px] text-pos">{teamName(c, true)}</div><div className="tnum font-display text-[30px] font-bold leading-9 text-pos">{r}%</div></div>
        <div className="text-right"><div className="text-[11px] text-neg">{teamName(c, false)}</div><div className="tnum font-display text-[30px] font-bold leading-9 text-neg">{100 - r}%</div></div>
      </div>
      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${r}% — ${100 - r}%`}>
        <i className="block h-full bg-pos" style={{ width: `${r}%` }} />
        <i className="block h-full flex-1 bg-neg" />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {[true, false].map((radiant) => {
          const rows = edgeRows(c, d.win, radiant);
          if (!rows.length) return null;
          return (
            <div key={String(radiant)}>
              <h4 className="label mb-2">{t('draft.edges', { team: teamName(c, radiant) })}</h4>
              <ul className="grid gap-1.5">
                {rows.map((x) => (
                  <li key={`${x.a.slot}-${x.b.slot}`} className="panel-2 flex items-center gap-2 px-2 py-1.5">
                    <Portrait c={c} p={x.a} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{heroName(c, x.a)} <span className="text-muted">vs</span> {heroName(c, x.b)}</span>
                    <Portrait c={c} p={x.b} size={28} />
                    <span className={`tnum w-12 text-right text-[13px] font-semibold ${radiant ? 'text-pos' : 'text-neg'}`}>+{x.pts.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {picks.length > 0 && (
        <div className="mt-4">
          <h4 className="label mb-2">{t('draft.order')} · {t('draft.bans')}</h4>
          <ol className="flex flex-wrap gap-1">
            {picks.map((x) => {
              const p = hero(x.heroId);
              const h = p ? c.heroOf(p) : undefined;
              const hh = h ?? c.heroById.get(x.heroId);
              const name = hh ? i18n.heroName(hh) : `#${x.heroId}`;
              return (
                <li key={`${x.order}-${x.heroId}`} title={`${x.order + 1}. ${name}${x.pick ? '' : ` (${t('draft.bans').toLowerCase()})`}`}
                  className={`relative h-8 w-8 overflow-hidden rounded-md border-b-2 ${x.radiant ? 'border-pos' : 'border-neg'} ${x.pick ? '' : 'opacity-35 grayscale'}`}>
                  {p && c.heroOf(p) ? <HeroPortrait hero={c.heroOf(p)!} fill /> : <BanPortrait c={c} id={x.heroId} />}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {c.onOpenDraft ? (
        <div className="panel-2 mt-4 p-3">
          <div className="text-[14px] font-semibold text-ink">{t('draft.try')}</div>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted">{t('draft.tryText')}</p>
          <button type="button" onClick={c.onOpenDraft} className="btn btn-accent btn-sm mt-2">{t('draft.tryGo')} <span aria-hidden="true">→</span></button>
        </div>
      ) : (
        <p className="mt-4 text-[13px] leading-[18px] text-muted">{t('draft.try')} {t('draft.tryNeedMe')}</p>
      )}
      <Note>{d.thenPatch && d.nowPatch && d.thenPatch !== d.nowPatch
        ? t('draft.note', { now: d.nowPatch, rank: rankName, then: d.thenPatch })
        : t('draft.noteSame', { now: d.nowPatch ?? '—', rank: rankName })}</Note>
    </>
  );
}

/** Banned heroes are not in the match: their portrait comes from the hero list. */
function BanPortrait({ c, id }: { c: RecapCtx; id: number }) {
  const h = c.heroById.get(id);
  return h ? <HeroPortrait hero={h} fill /> : null;
}

export function draftSlide(c: RecapCtx): Slide {
  const { t } = c.i18n;
  return {
    id: 'draft',
    title: t('slide.draft'),
    node: <div><Kicker>{t('slide.draft')}</Kicker><DraftBody c={c} /></div>,
    card: () => {
      const d = c.draft.status === 'ready' ? c.draft.value : null;
      const rows: RecapCardRow[] = d ? [true, false].flatMap((radiant) => edgeRows(c, d.win, radiant).slice(0, 2).map((x) => ({
        hero: c.heroOf(x.a), title: `${heroName(c, x.a)} vs ${heroName(c, x.b)}`, value: `+${x.pts.toFixed(1)}%`, tone: (radiant ? 'pos' : 'neg') as 'pos' | 'neg',
      }))) : [];
      return {
        kicker: t('slide.draft'),
        title: d ? draftSentence(c, d.win) : t('slide.draft'),
        subtitle: d ? `${teamName(c, true)} ${Math.round(d.win.chance * 100)}% — ${100 - Math.round(d.win.chance * 100)}% ${teamName(c, false)}` : undefined,
        teams: { top: teamHeroes(c, true), bottom: teamHeroes(c, false), topLabel: teamName(c, true), bottomLabel: teamName(c, false), topWin: c.m.radiantWin, highlight: meHeroId(c) },
        rows,
        ...c.card,
      };
    },
  };
}

/* ---------- 3. game flow ---------- */

const OBJ_LABEL: Record<MatchObjective['kind'], StringKey | null> = { roshan: 'flow.roshan', tower: null, barracks: null, firstblood: null, ancient: null };

function swingText(c: RecapCtx, s: Swing): string {
  const { t, lang } = c.i18n;
  const parts: string[] = [];
  if (s.fight) parts.push(t('flow.fight', s.delta > 0 ? { a: s.fight.direDeaths, b: s.fight.radiantDeaths } : { a: s.fight.radiantDeaths, b: s.fight.direDeaths }));
  if (s.roshan) parts.push(t('flow.roshan'));
  if (s.towers) parts.push(t('flow.towers', { n: s.towers }));
  if (s.barracks) parts.push(t('flow.rax', { n: s.barracks }));
  const what = parts.length ? parts.join(' + ') : t('flow.pressure');
  return `${s.from}:00–${s.to}:00 — ${what}: ${teamName(c, s.delta > 0)} +${kGold(s.delta, lang)}`;
}

function GoldChart({ c, values }: { c: RecapCtx; values: number[] }) {
  const { t, lang } = c.i18n;
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 220, PADL = 44, PADB = 22;
  const iw = W - PADL - 8, ih = H - PADB - 8;
  const max = Math.max(1000, ...values.map(Math.abs));
  const x = (i: number) => PADL + (i / Math.max(1, values.length - 1)) * iw;
  const y = (v: number) => 8 + ih / 2 - (v / max) * (ih / 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(values.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const objs = c.m.objectives.filter((o) => o.kind !== 'firstblood' && o.time >= 0);
  const ticks = values.map((_, i) => i).filter((i) => i > 0 && i % 10 === 0);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PADL) / iw) * (values.length - 1));
    setHover(Math.max(0, Math.min(values.length - 1, i)));
  };
  const hv = hover != null ? values[hover] : null;
  return (
    <div className="relative mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={t('flow.tableTitle')}>
        <defs>
          <clipPath id="gc-top"><rect x={PADL} y={0} width={iw} height={y(0)} /></clipPath>
          <clipPath id="gc-bot"><rect x={PADL} y={y(0)} width={iw} height={H} /></clipPath>
        </defs>
        {[max, 0, -max].map((v) => (
          <g key={v}>
            <line x1={PADL} x2={W - 8} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={v === 0 ? 1.5 : 1} strokeDasharray={v === 0 ? undefined : '3 4'} />
            <text x={PADL - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">{v === 0 ? '0' : `${v > 0 ? '+' : '−'}${kGold(v, lang)}`}</text>
          </g>
        ))}
        {ticks.map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-muted)">{i}′</text>)}
        <path d={area} fill="var(--color-pos)" fillOpacity="0.22" clipPath="url(#gc-top)" />
        <path d={area} fill="var(--color-neg)" fillOpacity="0.22" clipPath="url(#gc-bot)" />
        <path d={line} fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" />
        {objs.map((o, k) => (
          <circle key={k} cx={x(o.time / 60)} cy={o.radiant ? 14 : H - PADB - 6} r={o.kind === 'roshan' ? 5 : o.kind === 'tower' ? 3 : 4}
            fill={o.kind === 'roshan' ? 'var(--color-accent)' : o.radiant ? 'var(--color-pos)' : 'var(--color-neg)'} stroke="var(--color-surface)" strokeWidth="2">
            <title>{`${Math.floor(o.time / 60)}:${String(o.time % 60).padStart(2, '0')} ${teamName(c, o.radiant)} · ${OBJ_LABEL[o.kind] ? t(OBJ_LABEL[o.kind]!) : o.kind}`}</title>
          </circle>
        ))}
        {hover != null && hv != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={8} y2={H - PADB} stroke="var(--color-muted)" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(hv)} r="4.5" fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover != null && hv != null && (
        <div className="pointer-events-none absolute top-0 rounded-md border border-line bg-bg px-2 py-1 text-[12px] text-ink shadow-lg"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > values.length / 2 ? '-105%' : '5%'})` }}>
          {t('flow.at', { min: hover, team: teamName(c, hv >= 0), gold: kGold(hv, lang) })}
        </div>
      )}
      <div className="mt-1 flex justify-between text-[11px]">
        <span className="text-pos">▲ {t('flow.ahead', { team: teamName(c, true) })}</span>
        <span className="text-neg">▼ {t('flow.ahead', { team: teamName(c, false) })}</span>
      </div>
      <table className="sr-only">
        <caption>{t('flow.tableTitle')}</caption>
        <tbody>{values.map((v, i) => <tr key={i}><td>{i}</td><td>{v}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function FlowBody({ c }: { c: RecapCtx }) {
  const { t } = c.i18n;
  const [kind, setKind] = useState<'gold' | 'xp'>('gold');
  const values = kind === 'gold' ? c.m.goldAdv : c.m.xpAdv;
  if (!c.m.goldAdv) return <p className="notice mt-4">{t('flow.unparsed')}</p>;
  return (
    <>
      <Headline>{coverHeadline(c)}</Headline>
      <div className="seg seg-sm mt-3 w-fit" role="tablist">
        {(['gold', 'xp'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`seg-btn ${kind === k ? 'is-active' : ''}`}>{t(k === 'gold' ? 'flow.gold' : 'flow.xp')}</button>
        ))}
      </div>
      {values && <GoldChart c={c} values={values} />}
      <h4 className="label mb-2 mt-4">{t('flow.swings')}</h4>
      {c.swings.length ? (
        <ul className="grid gap-1.5">
          {c.swings.map((s) => (
            <li key={s.from} className="panel-2 flex items-start gap-2 px-3 py-2 text-[13px] leading-[18px] text-ink">
              <span className={`mt-1 h-2 w-2 flex-none rounded-full ${s.delta > 0 ? 'bg-pos' : 'bg-neg'}`} aria-hidden="true" />
              {swingText(c, s)}
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted">{t('flow.noSwings')}</p>}
    </>
  );
}

export function flowSlide(c: RecapCtx): Slide {
  const { t } = c.i18n;
  return {
    id: 'flow',
    title: t('slide.flow'),
    node: <div><Kicker>{t('slide.flow')}</Kicker><FlowBody c={c} /></div>,
    card: () => ({
      kicker: t('slide.flow'),
      title: coverHeadline(c),
      subtitle: c.swings[0] ? swingText(c, [...c.swings].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]) : undefined,
      chart: c.m.goldAdv ? { values: c.m.goldAdv, topLabel: t('flow.ahead', { team: teamName(c, true) }), bottomLabel: t('flow.ahead', { team: teamName(c, false) }) } : undefined,
      rows: c.swings.map((s) => ({ title: swingText(c, s).split(' — ')[1] ?? '', sub: `${s.from}:00–${s.to}:00`, value: `${s.delta > 0 ? '▲' : '▼'} ${kGold(s.delta, c.i18n.lang)}`, tone: (s.delta > 0 ? 'pos' : 'neg') as 'pos' | 'neg' })),
      ...c.card,
    }),
  };
}

/* ---------- 6. economy ---------- */

/** Net worth against the STRATZ norm at the end minute, or null without one. */
function nwNorm(c: RecapCtx, p: MatchPlayer): NormCompare | null {
  if (c.norms.status !== 'ready') return null;
  const n = c.norms.value(p);
  const pos = c.pos.get(p.slot);
  if (!n || !pos) return null;
  return compareToNorm(c.m, p, pos, n.file).find((x) => x.key === 'nw') ?? null;
}

const pctText = (diff: number) => `${diff >= 0 ? '+' : '−'}${Math.abs(Math.round(diff * 100))}%`;

function gpmText(c: RecapCtx, p: MatchPlayer): string {
  const { t } = c.i18n;
  const n = nwNorm(c, p);
  if (n) return `${t('eco.gpm', { gpm: p.gpm })} · ${n.even ? t('eco.normEven') : t('eco.vsNorm', { pct: pctText(n.diff) })}`;
  const pct = p.bench.gpm;
  if (pct == null) return t('eco.gpm', { gpm: p.gpm });
  if (pct >= 0.5) return t('eco.gpmPct', { gpm: p.gpm, pct: Math.max(1, Math.round((1 - pct) * 100)) });
  if (pct <= 0.25) return t('eco.gpmLow', { gpm: p.gpm });
  return t('eco.gpm', { gpm: p.gpm });
}

function ecoTone(c: RecapCtx, p: MatchPlayer): string {
  const n = nwNorm(c, p);
  if (n) return n.even ? 'text-muted' : n.good ? 'text-pos' : 'text-neg';
  return p.bench.gpm != null && p.bench.gpm <= 0.25 ? 'text-neg' : p.bench.gpm != null && p.bench.gpm >= 0.75 ? 'text-pos' : 'text-muted';
}

function ecoLines(c: RecapCtx): string[] {
  const { t, lang } = c.i18n;
  const e = c.economy;
  const share = (c.m.radiantWin ? e.radiant.share : e.dire.share).get(e.carried.slot) ?? 0;
  return [
    t('eco.carried', { hero: heroName(c, e.carried), pct: Math.round(share * 100) }),
    t('eco.leader', { hero: heroName(c, e.leader), nw: kGold(e.leader.netWorth, lang) }),
  ];
}

function EconomyBody({ c }: { c: RecapCtx }) {
  const { t, lang } = c.i18n;
  const e = c.economy;
  const maxNw = Math.max(...c.m.players.map((p) => p.netWorth), 1);
  const total = e.radiant.netWorth + e.dire.netWorth || 1;
  const [l1, l2] = ecoLines(c);
  return (
    <>
      <Headline>{l1}</Headline>
      <p className="mt-1 text-[14px] leading-5 text-muted">{l2}</p>
      <div className="mt-3 text-[12px] text-muted">{t('eco.teamShare', { a: kGold(e.radiant.netWorth, lang), b: kGold(e.dire.netWorth, lang) })}</div>
      <div className="mt-1 flex h-2 gap-[2px] overflow-hidden rounded-full">
        <i className="block h-full rounded-l-full bg-pos" style={{ width: `${(e.radiant.netWorth / total) * 100}%` }} />
        <i className="block h-full flex-1 rounded-r-full bg-neg" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {[true, false].map((radiant) => (
          <div key={String(radiant)}>
            <h4 className={`label mb-2 ${radiant ? 'text-pos' : 'text-neg'}`}>{teamName(c, radiant)}</h4>
            <ul className="grid gap-1.5">
              {c.m.players.filter((p) => p.radiant === radiant).sort((a, b) => b.netWorth - a.netWorth).map((p) => (
                <li key={p.slot} className={`panel-2 flex items-center gap-2 px-2 py-1.5 ${c.me === p.slot ? '!border-accent' : ''}`}>
                  <Portrait c={c} p={p} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-ink">{heroName(c, p)}{p.name ? <span className="font-normal text-muted"> · {p.name}</span> : null}</span>
                      <span className="tnum text-[13px] font-semibold text-ink">{kGold(p.netWorth, lang)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                      <i className={`block h-full rounded-full ${radiant ? 'bg-pos' : 'bg-neg'}`} style={{ width: `${(p.netWorth / maxNw) * 100}%` }} />
                    </div>
                    <div className={`mt-0.5 truncate text-[11px] leading-[14px] ${ecoTone(c, p)}`}>{gpmText(c, p)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Note>{c.norms.status === 'ready' && c.m.players.some((p) => nwNorm(c, p)) ? t('eco.noteNorm') : t('eco.note')}</Note>
    </>
  );
}

export function economySlide(c: RecapCtx): Slide {
  const { t, lang } = c.i18n;
  return {
    id: 'economy',
    title: t('slide.economy'),
    node: <div><Kicker>{t('slide.economy')}</Kicker><EconomyBody c={c} /></div>,
    card: () => ({
      kicker: t('slide.economy'),
      title: ecoLines(c)[0],
      subtitle: t('eco.teamShare', { a: kGold(c.economy.radiant.netWorth, lang), b: kGold(c.economy.dire.netWorth, lang) }),
      rows: [...c.m.players].sort((a, b) => b.netWorth - a.netWorth).slice(0, 6).map((p) => ({
        hero: c.heroOf(p), title: heroName(c, p), sub: gpmText(c, p), value: kGold(p.netWorth, lang), tone: (p.radiant ? 'pos' : 'neg') as 'pos' | 'neg',
      })),
      ...c.card,
    }),
  };
}

/* ---------- 7. items ---------- */

function verdictText(c: RecapCtx, r: BuildRow): string {
  const { t } = c.i18n;
  if (r.verdict === 'late') return t('bs.late', { n: (r.bought ?? 0) - r.typical });
  return t(`bs.${r.verdict}` as StringKey);
}
const verdictTone = (r: BuildRow) => (r.verdict === 'late' || r.verdict === 'missing' ? 'text-neg' : r.verdict === 'early' ? 'text-pos' : r.verdict === 'onTime' ? 'text-ink' : 'text-muted');

function PlayerPicker({ c, value, onChange, label }: { c: RecapCtx; value: number; onChange: (slot: number) => void; label: string }) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
        {c.m.players.map((p) => (
          <button key={p.slot} type="button" role="radio" aria-checked={value === p.slot} onClick={() => onChange(p.slot)} title={heroName(c, p)}
            className={`h-9 w-9 overflow-hidden rounded-md border-b-2 ${p.radiant ? 'border-pos' : 'border-neg'} ${value === p.slot ? 'ring-2 ring-accent' : 'opacity-60 hover:opacity-100'}`}>
            {c.heroOf(p) && <HeroPortrait hero={c.heroOf(p)!} fill />}
          </button>
        ))}
      </div>
    </div>
  );
}

function BuildBody({ c }: { c: RecapCtx }) {
  const { t } = c.i18n;
  const p = c.m.players[c.buildSlot];
  const pos = c.pos.get(p.slot);
  return (
    <>
      {c.me == null && <div className="mt-3"><PlayerPicker c={c} value={c.buildSlot} onChange={c.setBuildSlot} label={t('bs.pick')} /></div>}
      <div className="mt-3 flex items-center gap-3">
        <Portrait c={c} p={p} size={44} />
        <div className="min-w-0">
          <Headline>{t('bs.title', { hero: heroName(c, p) })}</Headline>
          {pos && <div className="text-[12px] text-muted">{t('bs.pos', { n: pos })}{c.posGuessed ? ` (${t('match.posGuess')})` : ''}</div>}
        </div>
      </div>
      {c.build.status === 'loading' && <div className="mt-5"><DiamondLoader label={t('bs.loading')} /></div>}
      {(c.build.status === 'none' || c.build.status === 'error') && <p className="notice mt-4">{t('bs.none')}</p>}
      {c.build.status === 'ready' && (
        <>
          <ul className="mt-3 grid gap-1.5">
            {c.build.value.review.rows.map((r) => (
              <li key={r.key} className="panel-2 flex items-center gap-2.5 px-2 py-1.5">
                <span className={`h-[30px] w-[41px] flex-none overflow-hidden rounded ${r.verdict === 'missing' ? 'opacity-40 grayscale' : ''}`}>
                  <img src={itemImg(r.key)} alt="" width={41} height={30} loading="lazy" className="h-full w-full object-cover" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-ink">
                    {c.build.status === 'ready' ? c.build.value.itemName(r.key) : r.key}
                    {r.kind === 'draft' && <span className="ml-1.5 text-[11px] font-semibold text-accent">{t('bs.counter')}</span>}
                  </div>
                  <div className="tnum text-[11px] leading-[14px] text-muted">
                    {t('bs.usual', { n: r.typical })}{r.bought != null ? ` · ${t('bs.at', { n: r.bought })}` : ''}
                  </div>
                </div>
                <span className={`flex-none text-[12px] font-semibold ${verdictTone(r)}`}>{verdictText(c, r)}</span>
              </li>
            ))}
          </ul>
          {c.build.value.review.extra.length > 0 && (
            <div className="mt-3">
              <div className="label mb-1.5">{t('bs.extra')}</div>
              <ul className="flex flex-wrap gap-1.5">
                {c.build.value.review.extra.map((k) => (
                  <li key={k} title={c.build.status === 'ready' ? c.build.value.itemName(k) : k} className="h-[30px] w-[41px] overflow-hidden rounded bg-surface-2">
                    <img src={itemImg(k)} alt={c.build.status === 'ready' ? c.build.value.itemName(k) : k} width={41} height={30} loading="lazy" className="h-full w-full object-cover" />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!c.build.value.review.timed && <Note>{t('bs.noTimes')}</Note>}
          <Note>{t('bs.note')}</Note>
        </>
      )}
    </>
  );
}

export function buildSlide(c: RecapCtx): Slide {
  const { t } = c.i18n;
  const p = c.m.players[c.buildSlot];
  return {
    id: 'build',
    title: t('slide.build'),
    node: <div><Kicker>{t('slide.build')}</Kicker><BuildBody c={c} /></div>,
    card: () => {
      const rows: RecapCardRow[] = c.build.status === 'ready' ? c.build.value.review.rows.slice(0, 7).map((r) => ({
        title: c.build.status === 'ready' ? c.build.value.itemName(r.key) : r.key,
        sub: `${t('bs.usual', { n: r.typical })}${r.bought != null ? ` · ${t('bs.at', { n: r.bought })}` : ''}`,
        value: verdictText(c, r),
        tone: r.verdict === 'late' || r.verdict === 'missing' ? 'neg' : r.verdict === 'early' ? 'pos' : 'muted',
      })) : [];
      return { kicker: t('slide.build'), title: t('bs.title', { hero: heroName(c, p) }), subtitle: t('bs.note'), rows: [{ hero: c.heroOf(p), title: heroName(c, p), sub: c.pos.get(p.slot) ? t('bs.pos', { n: c.pos.get(p.slot)! }) : undefined }, ...rows], ...c.card };
    },
  };
}

/* ---------- 9. awards ---------- */

function awardValue(c: RecapCtx, a: Award): string {
  const { t, number } = c.i18n;
  if (a.id === 'mvp') return t('award.mvp.v');
  const v = a.id === 'team' ? Math.round(a.value * 100) : a.id === 'control' ? Math.round(a.value) : number(Math.round(a.value));
  return t(`award.${a.id}.v` as StringKey, { v });
}

/** The player's nickname; the hero for a hidden profile. */
const playerName = (c: RecapCtx, p: MatchPlayer) => p.name?.trim() || heroName(c, p);
/** "value · Hero" when the nickname is shown, so the hero is still named. */
const awardSub = (c: RecapCtx, a: Award, p: MatchPlayer) => (p.name?.trim() ? `${awardValue(c, a)} · ${heroName(c, p)}` : awardValue(c, a));

export function awardsSlide(c: RecapCtx): Slide {
  const { t } = c.i18n;
  const mvp = c.awards.find((a) => a.id === 'mvp');
  const title = mvp ? `${t('award.mvp')}: ${playerName(c, c.m.players[mvp.slot])}` : t('slide.awards');
  return {
    id: 'awards',
    title: t('slide.awards'),
    node: (
      <div>
        <Kicker>{t('slide.awards')}</Kicker>
        <Headline>{title}</Headline>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {c.awards.map((a) => {
            const p = c.m.players[a.slot];
            return (
              <li key={a.id} className={`panel-2 flex items-center gap-3 p-2.5 ${a.id === 'mvp' ? '!border-accent sm:col-span-2' : ''} ${c.me === a.slot ? 'ring-1 ring-accent' : ''}`}>
                <Portrait c={c} p={p} size={a.id === 'mvp' ? 52 : 40} />
                <div className="min-w-0">
                  <div className={`text-[12px] font-semibold uppercase tracking-[0.06em] ${a.id === 'mvp' ? 'text-accent' : 'text-muted'}`}>{t(`award.${a.id}` as StringKey)}</div>
                  <div className="truncate text-[14px] font-semibold text-ink">{playerName(c, p)}{c.me === a.slot ? ` · ${t('match.you')}` : ''}</div>
                  <div className="truncate text-[12px] text-muted">{awardSub(c, a, p)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    ),
    card: () => ({
      kicker: t('slide.awards'),
      title,
      rows: c.awards.slice(0, 7).map((a) => {
        const p = c.m.players[a.slot];
        return { hero: c.heroOf(p), title: `${t(`award.${a.id}` as StringKey)} · ${playerName(c, p)}`, sub: awardSub(c, a, p), tone: 'accent' as const };
      }),
      ...c.card,
    }),
  };
}

/* ---------- shared bits for v2 ---------- */

const clock = (sec: number) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.max(0, Math.round(sec)) % 60).padStart(2, '0')}`;
const names = (c: RecapCtx, slots: number[]) => slots.map((s) => heroName(c, c.m.players[s])).join(', ');

function Faces({ c, slots, size = 28, dim }: { c: RecapCtx; slots: number[]; size?: number; dim?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1">
      {slots.map((s) => (
        <span key={s} title={heroName(c, c.m.players[s])} className={`overflow-hidden rounded-md border-b-2 ${c.m.players[s].radiant ? 'border-pos' : 'border-neg'} ${dim ? 'opacity-60 grayscale' : ''} ${c.me === s ? 'ring-2 ring-accent' : ''}`} style={{ width: size, height: size }}>
          {c.heroOf(c.m.players[s]) && <HeroPortrait hero={c.heroOf(c.m.players[s])!} fill />}
        </span>
      ))}
    </span>
  );
}

/* ---------- 3. laning ---------- */

function lanesHead(c: RecapCtx, l: Laning): string {
  const { t } = c.i18n;
  const r = l.lanes.filter((x) => x.winner === 'radiant').length;
  const d = l.lanes.filter((x) => x.winner === 'dire').length;
  if (r === d) return t('lanes.headEven', { r, d });
  return t('lanes.head', { team: teamName(c, r > d), n: Math.max(r, d), total: l.lanes.length });
}

function laneVerdict(c: RecapCtx, x: LaneResult): string {
  return x.winner === 'even' ? c.i18n.t('lanes.even') : c.i18n.t('lanes.won', { team: teamName(c, x.winner === 'radiant') });
}

function cs10Norm(c: RecapCtx, slot: number): number | null {
  if (c.norms.status !== 'ready') return null;
  const p = c.m.players[slot];
  const n = c.norms.value(p);
  const pos = c.pos.get(slot);
  return n && pos ? normAt(n.file, p.heroId, pos, 'cs', 10) : null;
}

function LaneSide({ c, ps, radiant }: { c: RecapCtx; ps: LaneResult['radiant']; radiant: boolean }) {
  const { t, number } = c.i18n;
  if (!ps.length) return <div className="text-[12px] text-muted">{t('lanes.empty')}</div>;
  return (
    <ul className="grid gap-1">
      {ps.map((p) => (
        <li key={p.slot} className={`flex items-center gap-2 ${radiant ? '' : 'flex-row-reverse text-right'}`}>
          <Portrait c={c} p={c.m.players[p.slot]} size={30} ring={c.me === p.slot} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink">{heroName(c, c.m.players[p.slot])}</div>
            <div className="tnum text-[11px] leading-[14px] text-muted">{number(p.gold)} · {p.lh}/{p.dn}{p.eff != null && <span className="hidden sm:inline"> · {t('lanes.eff', { pct: Math.round(p.eff * 100) })}</span>}</div>
            {cs10Norm(c, p.slot) != null && (() => {
              const n = cs10Norm(c, p.slot)!;
              const tone = Math.abs(p.lh / n - 1) < 0.1 ? 'text-muted' : p.lh > n ? 'text-pos' : 'text-neg';
              return <div className={`tnum text-[11px] leading-[14px] ${tone}`}>{t('lanes.norm', { n: Math.round(n) })}</div>;
            })()}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function lanesSlide(c: RecapCtx, l: Laning): Slide {
  const { t } = c.i18n;
  return {
    id: 'lanes',
    title: t('slide.lanes'),
    node: (
      <div>
        <Kicker>{t('slide.lanes')}</Kicker>
        <Headline>{lanesHead(c, l)}</Headline>
        <p className="mt-1 text-[12px] text-muted">{t('lanes.cols', { min: l.minute })}</p>
        <ul className="mt-3 grid gap-2">
          {l.lanes.map((x) => (
            <li key={x.lane} className="panel-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="label">{t(`lanes.${x.lane}` as StringKey)}</span>
                <span className={`text-[12px] font-semibold ${x.winner === 'radiant' ? 'text-pos' : x.winner === 'dire' ? 'text-neg' : 'text-muted'}`}>{laneVerdict(c, x)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <LaneSide c={c} ps={x.radiant} radiant />
                <LaneSide c={c} ps={x.dire} radiant={false} />
              </div>
            </li>
          ))}
        </ul>
        {l.roamers.length > 0 && <p className="mt-3 text-[13px] text-muted">{t('lanes.roam', { names: names(c, l.roamers) })}</p>}
        <Note>{t('lanes.note', { min: l.minute })}</Note>
      </div>
    ),
    card: () => ({
      kicker: t('slide.lanes'),
      title: lanesHead(c, l),
      subtitle: t('lanes.cols', { min: l.minute }),
      rows: l.lanes.map((x) => {
        const core = (ps: LaneResult['radiant']) => [...ps].sort((a, b) => b.gold - a.gold)[0];
        const r = core(x.radiant);
        const d = core(x.dire);
        return {
          hero: r ? c.heroOf(c.m.players[r.slot]) : d ? c.heroOf(c.m.players[d.slot]) : undefined,
          title: `${t(`lanes.${x.lane}` as StringKey)}: ${x.radiant.length ? names(c, x.radiant.map((p) => p.slot)) : '—'} vs ${x.dire.length ? names(c, x.dire.map((p) => p.slot)) : '—'}`,
          sub: `${r ? `${c.i18n.number(r.gold)} · ${r.lh}/${r.dn}` : '—'}  vs  ${d ? `${c.i18n.number(d.gold)} · ${d.lh}/${d.dn}` : '—'}`,
          value: x.winner === 'even' ? '=' : x.winner === 'radiant' ? '▲' : '▼',
          tone: (x.winner === 'radiant' ? 'pos' : x.winner === 'dire' ? 'neg' : 'muted') as 'pos' | 'neg' | 'muted',
        };
      }),
      ...c.card,
    }),
  };
}

/* ---------- 5. teamfights ---------- */

function fightsHead(c: RecapCtx): string {
  const { t } = c.i18n;
  const s = fightScore(c.fights);
  if (s.radiant === s.dire) return t('fights.headEven', { a: s.radiant, b: s.dire });
  return t('fights.head', { team: teamName(c, s.radiant > s.dire), n: Math.max(s.radiant, s.dire), total: c.fights.length });
}

function fightScoreText(f: FightSummary): string {
  // the winner's kills first
  return f.radiantWon === false ? `${f.radiantDeaths}:${f.direDeaths}` : `${f.direDeaths}:${f.radiantDeaths}`;
}

function FightRow({ c, f }: { c: RecapCtx; f: FightSummary }) {
  const { t, lang } = c.i18n;
  const [open, setOpen] = useState(false);
  const tone = f.radiantWon === true ? 'bg-pos' : f.radiantWon === false ? 'bg-neg' : 'bg-line-2';
  return (
    <li className={`panel-2 overflow-hidden ${f.decisive ? '!border-accent' : ''}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        <span className={`h-2.5 w-2.5 flex-none rounded-full ${tone}`} aria-hidden="true" />
        <span className="tnum w-11 flex-none text-[13px] text-muted">{clock(f.start)}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
          {f.radiantWon == null ? t('fights.trade') : teamName(c, f.radiantWon)} <span className="tnum font-semibold">{fightScoreText(f)}</span>
          {f.decisive && <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">{t('fights.decisive')}</span>}
        </span>
        <span className={`tnum flex-none text-[13px] font-semibold ${f.goldSwing > 0 ? 'text-pos' : f.goldSwing < 0 ? 'text-neg' : 'text-muted'}`}>{f.goldSwing >= 0 ? '▲' : '▼'} {kGold(f.goldSwing, lang)}</span>
        <span className={`flex-none text-muted transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="grid gap-2 border-t border-line px-3 py-2.5 text-[12px] text-muted">
          {f.dead.length > 0 && <div><div className="mb-1">{t('fights.dead')}</div><Faces c={c} slots={f.dead} dim /></div>}
          {f.killers.length > 0 && <div><div className="mb-1">{t('fights.kills')}</div><Faces c={c} slots={f.killers.map((k) => k.slot)} /></div>}
          {f.topDamage != null && <div>{t('fights.damage', { hero: heroName(c, c.m.players[f.topDamage]) })}</div>}
          {f.buybacks.length > 0 && <div>{t('fights.buyback', { names: names(c, f.buybacks) })}</div>}
        </div>
      )}
    </li>
  );
}

export function fightsSlide(c: RecapCtx): Slide {
  const { t, lang } = c.i18n;
  const s = fightScore(c.fights);
  return {
    id: 'fights',
    title: t('slide.fights'),
    node: (
      <div>
        <Kicker>{t('slide.fights')}</Kicker>
        {c.fights.length === 0 ? <p className="notice mt-3">{t('fights.none')}</p> : (
          <>
            <Headline>{fightsHead(c)}</Headline>
            <div className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${s.radiant}:${s.dire}`}>
              {c.fights.map((f, k) => (
                <i key={k} className={`block h-full flex-1 ${f.radiantWon === true ? 'bg-pos' : f.radiantWon === false ? 'bg-neg' : 'bg-line-2'} ${f.decisive ? 'ring-1 ring-accent' : ''}`} />
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted">{t('fights.tap')}</p>
            <ul className="mt-2 grid gap-1.5">{c.fights.map((f) => <FightRow key={f.start} c={c} f={f} />)}</ul>
            <Note>{t('fights.note')}</Note>
          </>
        )}
      </div>
    ),
    card: () => {
      const top = [...c.fights].sort((a, b) => Number(b.decisive) - Number(a.decisive) || Math.abs(b.goldSwing) - Math.abs(a.goldSwing)).slice(0, 3).sort((a, b) => a.start - b.start);
      return {
        kicker: t('slide.fights'),
        title: c.fights.length ? fightsHead(c) : t('fights.none'),
        chart: c.m.goldAdv ? { values: c.m.goldAdv, topLabel: t('flow.ahead', { team: teamName(c, true) }), bottomLabel: t('flow.ahead', { team: teamName(c, false) }) } : undefined,
        rows: top.map((f) => ({
          title: `${clock(f.start)} · ${f.radiantWon == null ? t('fights.trade') : teamName(c, f.radiantWon)} ${fightScoreText(f)}${f.decisive ? ` · ${t('fights.decisive')}` : ''}`,
          sub: f.dead.length ? `${t('fights.dead')}: ${names(c, f.dead)}` : undefined,
          value: `${f.goldSwing >= 0 ? '▲' : '▼'} ${kGold(f.goldSwing, lang)}`,
          tone: (f.goldSwing >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
        })),
        ...c.card,
      };
    },
  };
}

/* ---------- 8. deaths and buybacks ---------- */

function tookText(c: RecapCtx, d: DeathCost): string {
  const { t } = c.i18n;
  const parts: string[] = [];
  if (d.took.ancient) parts.push(t('deaths.ancient'));
  if (d.took.roshan) parts.push(t('flow.roshan'));
  if (d.took.barracks) parts.push(t('flow.rax', { n: d.took.barracks }));
  if (d.took.tower) parts.push(t('flow.towers', { n: d.took.tower }));
  return parts.join(' + ');
}

function costText(c: RecapCtx, d: DeathCost): string {
  return c.i18n.t('deaths.cost', { time: clock(d.time), hero: names(c, d.group), what: tookText(c, d) });
}

function deathsHead(c: RecapCtx, d: DeathsSummary): string {
  const { t } = c.i18n;
  if (!d.mostDead) return t('deaths.noneCostly');
  const hero = heroName(c, c.m.players[d.mostDead.slot]);
  return d.mostDead.deadSeconds != null
    ? t('deaths.head', { hero, n: d.mostDead.deaths, min: Math.round(d.mostDead.deadSeconds / 60) })
    : t('deaths.headShort', { hero, n: d.mostDead.deaths });
}

function DeathTimeline({ c, d }: { c: RecapCtx; d: DeathsSummary }) {
  const { t } = c.i18n;
  const W = 640, H = 92, L = 8, R = 8;
  const end = Math.max(60, c.m.duration);
  const x = (sec: number) => L + (Math.max(0, sec) / end) * (W - L - R);
  const rowY = (radiant: boolean) => (radiant ? 22 : 56);
  const ticks = Array.from({ length: Math.floor(end / 600) }, (_, k) => (k + 1) * 600).filter((s) => s < end);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block w-full" role="img" aria-label={t('deaths.timeline')}>
      {[true, false].map((r) => <line key={String(r)} x1={L} x2={W - R} y1={rowY(r)} y2={rowY(r)} stroke="var(--color-line)" strokeWidth="1" />)}
      {ticks.map((s) => <text key={s} x={x(s)} y={H - 4} textAnchor="middle" fontSize="13" fill="var(--color-muted)">{s / 60}′</text>)}
      {d.all.map((e, k) => {
        const p = c.m.players[e.slot];
        return (
          <circle key={k} cx={x(e.time)} cy={rowY(p.radiant)} r={c.me === e.slot ? 8 : 6}
            fill={p.radiant ? 'var(--color-pos)' : 'var(--color-neg)'} stroke={c.me === e.slot ? 'var(--color-accent)' : 'var(--color-surface)'} strokeWidth="2">
            <title>{`${clock(e.time)} · ${heroName(c, p)}`}</title>
          </circle>
        );
      })}
      {d.buybacks.map((b, k) => {
        const p = c.m.players[b.slot];
        const cx = x(b.time), cy = rowY(p.radiant) - 15;
        return (
          <path key={`b${k}`} d={`M${cx},${cy - 7}L${cx + 7},${cy}L${cx},${cy + 7}L${cx - 7},${cy}Z`} fill="var(--color-accent)">
            <title>{`${clock(b.time)} · ${heroName(c, p)} · ${t('deaths.buybackMark')}`}</title>
          </path>
        );
      })}
    </svg>
  );
}

export function deathsSlide(c: RecapCtx, d: DeathsSummary): Slide {
  const { t } = c.i18n;
  return {
    id: 'deaths',
    title: t('slide.deaths'),
    node: (
      <div>
        <Kicker>{t('slide.deaths')}</Kicker>
        <Headline>{deathsHead(c, d)}</Headline>
        <h4 className="label mb-1 mt-4">{t('deaths.timeline')}</h4>
        <DeathTimeline c={c} d={d} />
        <div className="flex justify-between text-[11px]">
          <span className="text-pos">● {teamName(c, true)}</span>
          <span className="text-accent">◆ {t('deaths.buybackMark')}</span>
          <span className="text-neg">● {teamName(c, false)}</span>
        </div>
        <h4 className="label mb-2 mt-4">{t('deaths.costly')}</h4>
        {d.costly.length ? (
          <ul className="grid gap-1.5">
            {d.costly.map((x) => (
              <li key={`${x.slot}-${x.time}`} className="panel-2 flex items-center gap-2.5 px-2.5 py-2">
                <Faces c={c} slots={x.group} size={30} />
                <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">{costText(c, x)}</span>
                {x.noBuyback && <span className="flex-none text-[11px] font-semibold uppercase tracking-[0.06em] text-neg">{t('deaths.noBuyback')}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-muted">{t('deaths.noneCostly')}</p>}
        <h4 className="label mb-2 mt-4">{t('deaths.buybacks')}</h4>
        {d.buybacks.length ? (
          <ul className="grid gap-1.5">
            {d.buybacks.map((b) => (
              <li key={`${b.slot}-${b.time}`} className="panel-2 flex items-center gap-2.5 px-2.5 py-2 text-[13px] text-ink">
                <Portrait c={c} p={c.m.players[b.slot]} size={30} ring={c.me === b.slot} />
                <span className="tnum text-muted">{clock(b.time)}</span>
                <span className="min-w-0 flex-1 truncate">{heroName(c, c.m.players[b.slot])}</span>
                {b.paidOff && <span className="flex-none text-[12px] text-pos">{t('deaths.paidOff')}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-muted">{t('deaths.noBb')}</p>}
        <Note>{t('deaths.note')}</Note>
      </div>
    ),
    card: () => ({
      kicker: t('slide.deaths'),
      title: deathsHead(c, d),
      subtitle: d.costly.length ? t('deaths.costly') : t('deaths.noneCostly'),
      rows: [
        ...d.costly.map((x) => ({ hero: c.heroOf(c.m.players[x.slot]), title: `${clock(x.time)} · ${names(c, x.group)}`, sub: tookText(c, x), value: x.noBuyback ? t('deaths.noBuyback') : undefined, tone: 'neg' as const })),
        ...d.buybacks.slice(0, 3).map((b) => ({ hero: c.heroOf(c.m.players[b.slot]), title: `${clock(b.time)} · ${heroName(c, c.m.players[b.slot])}`, sub: t('deaths.buybackMark'), value: '◆', tone: 'accent' as const })),
      ],
      ...c.card,
    }),
  };
}

/* ---------- vision (ward map) ---------- */

const phaseLabel = (c: RecapCtx, id: string) => (id === 'all' ? c.i18n.t('wards.all') : `${id.replace('-', '–')}′`);

/** Our own schematic of the map (no game art): bases, lanes, river. y is up. */
function MapBase({ size = 100 }: { size?: number }) {
  const s = (v: number) => v * size;
  const P = (pts: [number, number][]) => pts.map(([x, y], k) => `${k ? 'L' : 'M'}${s(x)},${s(1 - y)}`).join('');
  return (
    <g>
      <rect x="0" y="0" width={size} height={size} rx={s(0.03)} fill="var(--color-bg-2)" />
      <path d={P([[0, 0.62], [0.3, 0.55], [0.5, 0.5], [0.7, 0.45], [1, 0.38]])} stroke="var(--color-ally)" strokeOpacity="0.16" strokeWidth={s(0.07)} fill="none" strokeLinecap="round" />
      <g stroke="var(--color-line-2)" strokeWidth={s(0.012)} fill="none" strokeLinecap="round">
        <path d={P([[0.09, 0.2], [0.09, 0.91], [0.8, 0.91]])} />
        <path d={P([[0.17, 0.17], [0.83, 0.83]])} />
        <path d={P([[0.2, 0.09], [0.91, 0.09], [0.91, 0.8]])} />
      </g>
      <rect x={s(0.02)} y={s(0.78)} width={s(0.2)} height={s(0.2)} rx={s(0.03)} fill="var(--color-pos)" fillOpacity="0.14" stroke="var(--color-pos)" strokeOpacity="0.4" />
      <rect x={s(0.78)} y={s(0.02)} width={s(0.2)} height={s(0.2)} rx={s(0.03)} fill="var(--color-neg)" fillOpacity="0.14" stroke="var(--color-neg)" strokeOpacity="0.4" />
    </g>
  );
}

function WardMap({ c, wards }: { c: RecapCtx; wards: WardSummary['wards'] }) {
  const { t } = c.i18n;
  const S = 100;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="block aspect-square w-full max-w-[460px]" role="img" aria-label={t('slide.wards')}>
      <MapBase size={S} />
      {wards.map((w, k) => {
        const cx = w.x * S, cy = (1 - w.y) * S;
        const color = w.radiant ? 'var(--color-pos)' : 'var(--color-neg)';
        const mine = c.me === w.slot;
        const who = heroName(c, c.m.players[w.slot]);
        const tip = [
          `${clock(w.time)} · ${who} · ${t(w.kind === 'obs' ? 'wards.obs' : 'wards.sen')}`,
          t('wards.lived', { t: clock(lifetime(w, c.m.duration)) }),
          w.killedBy != null ? t('wards.by', { hero: heroName(c, c.m.players[w.killedBy]) }) : '',
        ].filter(Boolean).join(' · ');
        return (
          <g key={k}>
            <title>{tip}</title>
            {w.kind === 'obs'
              ? <circle cx={cx} cy={cy} r={mine ? 2.4 : 1.8} fill={color} fillOpacity="0.85" stroke={mine ? 'var(--color-accent)' : 'var(--color-bg)'} strokeWidth={mine ? 0.7 : 0.4} />
              : <rect x={cx - 1.4} y={cy - 1.4} width="2.8" height="2.8" transform={`rotate(45 ${cx} ${cy})`} fill="none" stroke={mine ? 'var(--color-accent)' : color} strokeWidth="0.6" />}
            {w.killedBy != null && <path d={`M${cx - 1.6},${cy - 1.6}L${cx + 1.6},${cy + 1.6}M${cx + 1.6},${cy - 1.6}L${cx - 1.6},${cy + 1.6}`} stroke="var(--color-ink)" strokeWidth="0.5" />}
          </g>
        );
      })}
    </svg>
  );
}

function WardsBody({ c, w }: { c: RecapCtx; w: WardSummary }) {
  const { t } = c.i18n;
  const [phase, setPhase] = useState('all');
  const [side, setSide] = useState<'both' | 'radiant' | 'dire'>('both');
  const ph = WARD_PHASES.find((x) => x.id === phase)!;
  const shown = w.wards.filter((x) => inPhase(x, ph) && (side === 'both' || x.radiant === (side === 'radiant')));
  return (
    <>
      <Headline>{t('wards.head', { a: w.radiant.obs, b: w.dire.obs, c: w.radiant.dewards, d: w.dire.dewards })}</Headline>
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="seg seg-sm" role="tablist">
          {WARD_PHASES.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={phase === x.id} onClick={() => setPhase(x.id)} className={`seg-btn ${phase === x.id ? 'is-active' : ''}`}>{phaseLabel(c, x.id)}</button>
          ))}
        </div>
        <div className="seg seg-sm" role="tablist">
          {(['both', 'radiant', 'dire'] as const).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={side === x} onClick={() => setSide(x)} className={`seg-btn ${side === x ? 'is-active' : ''}`}>
              {x === 'both' ? t('wards.both') : teamName(c, x === 'radiant')}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <WardMap c={c} wards={shown} />
          {shown.length === 0 && <p className="mt-2 text-[13px] text-muted">{t('wards.none')}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            <span>● {t('wards.obs')}</span><span>◇ {t('wards.sen')}</span><span>✕ {t('wards.killed')}</span>
            <span className="text-pos">■ {teamName(c, true)}</span><span className="text-neg">■ {teamName(c, false)}</span>
            {c.me != null && <span className="text-accent">○ {t('match.you')}</span>}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
          {[true, false].map((r) => {
            const v = r ? w.radiant : w.dire;
            return (
              <div key={String(r)} className="panel-2 p-2.5 text-[12px] leading-[16px]">
                <div className={`label mb-1 ${r ? 'text-pos' : 'text-neg'}`}>{teamName(c, r)}</div>
                <div className="tnum text-ink">{t('wards.row', { obs: v.obs, sen: v.sen, dw: v.dewards })}</div>
                {v.obsLife != null && <div className="text-muted">{t('wards.obsLife', { t: clock(v.obsLife) })}</div>}
              </div>
            );
          })}
          <div>
            <div className="label mb-1.5">{t('wards.players')}</div>
            <ul className="grid gap-1">
              {w.players.slice(0, 6).map((x) => (
                <li key={x.slot} className="flex items-center gap-2 text-[12px]">
                  <Portrait c={c} p={c.m.players[x.slot]} size={24} ring={c.me === x.slot} />
                  <span className="tnum min-w-0 flex-1 truncate text-muted">{t('wards.row', { obs: x.obs, sen: x.sen, dw: x.dewards })}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <Note>{t('wards.note')}</Note>
    </>
  );
}

export function wardsSlide(c: RecapCtx, w: WardSummary): Slide {
  const { t } = c.i18n;
  return {
    id: 'wards',
    title: t('slide.wards'),
    node: <div><Kicker>{t('slide.wards')}</Kicker><WardsBody c={c} w={w} /></div>,
    card: () => ({
      kicker: t('slide.wards'),
      title: t('wards.head', { a: w.radiant.obs, b: w.dire.obs, c: w.radiant.dewards, d: w.dire.dewards }),
      map: { wards: w.wards.map((x) => ({ x: x.x, y: x.y, radiant: x.radiant, obs: x.kind === 'obs', dead: x.killedBy != null, mine: c.me === x.slot })) },
      ...c.card,
    }),
  };
}

/* ---------- against the norm ---------- */

// full class names: Tailwind only generates the ones it finds in the source
const TONE_TEXT = { pos: 'text-pos', neg: 'text-neg', muted: 'text-muted' } as const;
const TONE_BG = { pos: 'bg-pos', neg: 'bg-neg', muted: 'bg-line-2' } as const;

function normValue(c: RecapCtx, x: NormCompare, v: number): string {
  const { lang } = c.i18n;
  if (x.key === 'nw' || x.key === 'hd' || x.key === 'xp10') return kGold(v, lang);
  if (x.key === 'k' || x.key === 'd' || x.key === 'a') return v % 1 ? v.toFixed(1).replace('.', lang === 'ru' ? ',' : '.') : String(v);
  return String(Math.round(v));
}

function normData(c: RecapCtx) {
  if (c.norms.status !== 'ready') return null;
  const p = c.m.players[c.buildSlot];
  const pos = c.pos.get(p.slot);
  const n = c.norms.value(p);
  if (!n || !pos) return { p, pos, n: null, list: [] as NormCompare[] };
  return { p, pos, n, list: compareToNorm(c.m, p, pos, n.file) };
}

function normHead(c: RecapCtx, d: NonNullable<ReturnType<typeof normData>>): string {
  const good = d.list.filter((x) => !x.even && x.good).length;
  return c.i18n.t('norm.head', { hero: heroName(c, d.p), n: good, total: d.list.length });
}

function normSub(c: RecapCtx, d: NonNullable<ReturnType<typeof normData>>): string {
  const { t } = c.i18n;
  if (!d.n || !d.pos) return '';
  const rank = d.n.rank === 'ALL' ? t('rank.all') : t(`rank.${d.n.rank}` as StringKey);
  return t('norm.sub', { hero: heroName(c, d.p), pos: d.pos, rank, min: Math.round(c.m.duration / 60), patch: d.n.file.patch });
}

function NormBody({ c }: { c: RecapCtx }) {
  const { t } = c.i18n;
  if (c.norms.status === 'loading') return <div className="mt-5"><DiamondLoader label={t('norm.loading')} /></div>;
  const d = normData(c);
  return (
    <>
      {c.me == null && <div className="mt-3"><PlayerPicker c={c} value={c.buildSlot} onChange={c.setBuildSlot} label={t('bs.pick')} /></div>}
      {!d || !d.n || !d.list.length ? <p className="notice mt-4">{t('norm.none')}</p> : (
        <>
          <div className="mt-3 flex items-center gap-3">
            <Portrait c={c} p={d.p} size={44} ring={c.me === d.p.slot} />
            <div className="min-w-0"><Headline>{normHead(c, d)}</Headline></div>
          </div>
          <p className="mt-1 text-[12px] leading-[16px] text-muted">{normSub(c, d)}</p>
          <ul className="mt-3 grid gap-1.5">
            {d.list.map((x) => {
              const clamp = Math.max(-1, Math.min(1, x.diff / 0.5));
              const tone = x.even ? 'muted' : x.good ? 'pos' : 'neg';
              return (
                <li key={x.key} className="panel-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-ink">{t(`norm.m.${x.key}` as StringKey)}</div>
                    <div className="tnum text-[11px] leading-[14px] text-muted">{normValue(c, x, x.value)} · {t('norm.usual', { v: normValue(c, x, Math.round(x.norm * 10) / 10) })}</div>
                  </div>
                  <span className={`tnum text-[13px] font-semibold ${TONE_TEXT[tone]}`}>{x.even ? t('norm.even') : pctText(x.diff)}</span>
                  {/* diverging bar around the norm: ±50% fills a half */}
                  <div className="relative col-span-2 h-1.5 rounded-full bg-surface" aria-hidden="true">
                    <i className="absolute left-1/2 top-[-2px] h-[10px] w-px bg-line-2" />
                    <i className={`absolute top-0 h-full rounded-full ${TONE_BG[tone]}`} style={clamp >= 0 ? { left: '50%', width: `${clamp * 50}%` } : { right: '50%', width: `${-clamp * 50}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <Note>{t('norm.note')}</Note>
        </>
      )}
    </>
  );
}

export function normSlide(c: RecapCtx): Slide {
  const { t } = c.i18n;
  return {
    id: 'norm',
    title: t('slide.norm'),
    node: <div><Kicker>{t('slide.norm')}</Kicker><NormBody c={c} /></div>,
    card: () => {
      const d = normData(c);
      return {
        kicker: t('slide.norm'),
        title: d && d.list.length ? normHead(c, d) : t('norm.title', { hero: heroName(c, c.m.players[c.buildSlot]) }),
        subtitle: d ? normSub(c, d) : undefined,
        rows: (d?.list ?? []).map((x) => ({
          title: t(`norm.m.${x.key}` as StringKey),
          sub: `${normValue(c, x, x.value)} · ${t('norm.usual', { v: normValue(c, x, Math.round(x.norm * 10) / 10) })}`,
          value: x.even ? '≈' : pctText(x.diff),
          tone: (x.even ? 'muted' : x.good ? 'pos' : 'neg') as 'muted' | 'pos' | 'neg',
        })),
        ...c.card,
      };
    },
  };
}

export function useSlides(c: RecapCtx | null): Slide[] {
  return useMemo(() => {
    if (!c) return [];
    // the order of the game: draft → lanes → the middle game → fights → result
    const list = [coverSlide(c)];
    if (hasRealDraft(c.m)) list.push(draftSlide(c));
    if (c.laning) list.push(lanesSlide(c, c.laning));
    if (c.m.goldAdv) list.push(flowSlide(c));
    if (c.m.parsed) list.push(fightsSlide(c));
    if (c.wards) list.push(wardsSlide(c, c.wards));
    list.push(economySlide(c), normSlide(c));
    if (c.deaths) list.push(deathsSlide(c, c.deaths));
    list.push(buildSlide(c), awardsSlide(c));
    return list;
  }, [c]);
}
