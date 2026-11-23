import { useMemo, useState, type ReactNode } from 'react';
import type { Hero } from '../../types';
import type { I18n } from '../../i18n';
import type { StringKey } from '../../i18n/strings';
import type { WinChance } from '../../scoring/winChance';
import { hasRealDraft, type MatchModel, type MatchObjective, type MatchPlayer } from '../../match/model';
import type { Swing, Verdict } from '../../match/analyze/story';
import type { Award, Pos } from '../../match/analyze/players';
import type { BuildReview, BuildRow } from '../../match/analyze/builds';
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

function gpmText(c: RecapCtx, p: MatchPlayer): string {
  const { t } = c.i18n;
  const pct = p.bench.gpm;
  if (pct == null) return t('eco.gpm', { gpm: p.gpm });
  if (pct >= 0.5) return t('eco.gpmPct', { gpm: p.gpm, pct: Math.max(1, Math.round((1 - pct) * 100)) });
  if (pct <= 0.25) return t('eco.gpmLow', { gpm: p.gpm });
  return t('eco.gpm', { gpm: p.gpm });
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
                    <div className={`mt-0.5 truncate text-[11px] leading-[14px] ${p.bench.gpm != null && p.bench.gpm <= 0.25 ? 'text-neg' : p.bench.gpm != null && p.bench.gpm >= 0.75 ? 'text-pos' : 'text-muted'}`}>{gpmText(c, p)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Note>{t('eco.note')}</Note>
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

export function awardsSlide(c: RecapCtx): Slide {
  const { t } = c.i18n;
  const mvp = c.awards.find((a) => a.id === 'mvp');
  const title = mvp ? `${t('award.mvp')}: ${heroName(c, c.m.players[mvp.slot])}` : t('slide.awards');
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
                  <div className="truncate text-[14px] font-semibold text-ink">{heroName(c, p)}{c.me === a.slot ? ` · ${t('match.you')}` : ''}</div>
                  <div className="truncate text-[12px] text-muted">{awardValue(c, a)}</div>
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
        return { hero: c.heroOf(p), title: `${t(`award.${a.id}` as StringKey)} · ${heroName(c, p)}`, sub: awardValue(c, a), tone: 'accent' as const };
      }),
      ...c.card,
    }),
  };
}

export function useSlides(c: RecapCtx | null): Slide[] {
  return useMemo(() => {
    if (!c) return [];
    const list = [coverSlide(c)];
    if (hasRealDraft(c.m)) list.push(draftSlide(c));
    if (c.m.goldAdv) list.push(flowSlide(c));
    list.push(economySlide(c), buildSlide(c), awardsSlide(c));
    return list;
  }, [c]);
}
