import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { Hero, MatchupRow } from '../../types';
import {
  chooseBuild, loadBracketTables, loadBuildIndex, loadDataset, loadHeroBuild, loadSynergy, loadSynergyByBracket,
  type BuildIndex, type Dataset,
} from '../../data/dataset';
import { buildDraftSearch } from '../../data/draftUrl';
import { winChance } from '../../scoring/winChance';
import { cachedMatch, fetchMatch, loadItemIds, loadPatches, MatchError, requestParse, waitForParse, type MatchErrorKind } from '../../match/api';
import { parseMatchInput } from '../../match/normalize';
import { hasRealDraft, type MatchModel } from '../../match/model';
import { swings as findSwings, verdict as findVerdict } from '../../match/analyze/story';
import { awards as findAwards, economy as findEconomy, lobbyBracket, positions as findPositions } from '../../match/analyze/players';
import { reviewBuild } from '../../match/analyze/builds';
import { fights as findFights } from '../../match/analyze/fights';
import { laning as findLaning } from '../../match/analyze/lanes';
import { deaths as findDeaths } from '../../match/analyze/deaths';
import { wardSummary } from '../../match/analyze/wards';
import { loadNorms, normGames, type NormFile } from '../../match/norms';
import type { MatchPlayer } from '../../match/model';
import { HeroPortrait } from '../HeroPortrait';
import { DiamondLoader } from '../Brand';
import { RecapPlayer } from './RecapPlayer';
import { useSlides, type BuildInfo, type DraftInfo, type Loadable, type RecapCtx } from './slides';

const ME_KEY = 'lp.dotaId';

type LoadStatus = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; error: MatchErrorKind } | { kind: 'ready'; model: MatchModel };
type ParseStatus = { kind: 'idle' } | { kind: 'polling'; attempt: number } | { kind: 'timeout' } | { kind: 'failed' };

function readParams() {
  const p = new URLSearchParams(window.location.search);
  return { id: parseMatchInput(p.get('match') ?? ''), me: p.get('me') };
}

function writeParams(id: number | null, me: string | null) {
  try {
    const p = new URLSearchParams(window.location.search);
    if (id) p.set('match', String(id)); else p.set('match', '');
    if (me) p.set('me', me); else p.delete('me');
    const qs = p.toString().replace(/match=(&|$)/, 'match$1');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${qs}${window.location.hash}`);
  } catch { /* sandboxed */ }
}

function storedMe(): string | null {
  try { return localStorage.getItem(ME_KEY); } catch { return null; }
}

/** `me` from the link: an account id, or `p<slot>` for a private profile. */
function resolveMe(m: MatchModel, me: string | null): number | null {
  if (!me) return null;
  const slot = /^p(\d)$/.exec(me);
  if (slot) return Number(slot[1]) < m.players.length ? Number(slot[1]) : null;
  const id = Number(me);
  const p = m.players.find((x) => x.accountId != null && x.accountId === id);
  return p ? p.slot : null;
}

const prettyItem = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function MatchPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const initial = useMemo(readParams, []);
  const [text, setText] = useState(initial.id ? String(initial.id) : '');
  const [inputError, setInputError] = useState(false);
  const [id, setId] = useState<number | null>(initial.id);
  const [meParam, setMeParam] = useState<string | null>(initial.me ?? storedMe());
  const [load, setLoad] = useState<LoadStatus>({ kind: 'idle' });
  const [parse, setParse] = useState<ParseStatus>({ kind: 'idle' });
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [patches, setPatches] = useState<{ id: number; name: string }[] | null>(null);
  const [draft, setDraft] = useState<Loadable<DraftInfo>>({ status: 'loading' });
  const [build, setBuild] = useState<Loadable<BuildInfo>>({ status: 'loading' });
  const [pickedSlot, setPickedSlot] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { loadDataset().then(setDataset).catch(() => setDataset(null)); }, []);
  useEffect(() => { loadPatches().then(setPatches); }, []);

  const heroById = dataset?.heroById;
  const keyOf = useMemo(() => (heroId: number) => heroById?.get(heroId)?.key, [heroById]);

  // load the match
  useEffect(() => {
    if (!id || !heroById) return;
    abortRef.current?.abort();
    setParse({ kind: 'idle' });
    const cached = cachedMatch(id);
    setLoad(cached ? { kind: 'ready', model: cached } : { kind: 'loading' });
    let alive = true;
    fetchMatch(id, keyOf)
      .then((model) => alive && setLoad({ kind: 'ready', model }))
      .catch((e) => alive && !cached && setLoad({ kind: 'error', error: e instanceof MatchError ? e.kind : 'network' }));
    return () => { alive = false; };
  }, [id, heroById, keyOf, nonce]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const model = load.kind === 'ready' ? load.model : null;
  const me = model ? resolveMe(model, meParam) : null;

  useEffect(() => {
    writeParams(id, model && me != null ? meParam : initial.me);
    document.title = id ? `${t('match.title')} ${id} — LASTPICK` : `${t('match.title')} — LASTPICK`;
  }, [id, model, me, meParam, initial.me, t]);

  const analysis = useMemo(() => {
    if (!model) return null;
    const pos = findPositions(model);
    return {
      verdict: findVerdict(model), swings: findSwings(model), economy: findEconomy(model), awards: findAwards(model), pos,
      fights: findFights(model), laning: findLaning(model), deaths: findDeaths(model), wards: wardSummary(model),
    };
  }, [model]);

  // STRATZ norms: the lobby's rank, all ranks for a hero / position it lacks
  const [normFiles, setNormFiles] = useState<{ lobby: NormFile | null; all: NormFile | null; rank: string } | null | undefined>(undefined);
  useEffect(() => {
    if (!model) return;
    let alive = true;
    setNormFiles(undefined);
    const rank = lobbyBracket(model) ?? 'ALL';
    Promise.all([rank === 'ALL' ? Promise.resolve(null) : loadNorms(rank), loadNorms('ALL')])
      .then(([lobby, all]) => alive && setNormFiles(lobby || all ? { lobby, all, rank } : null));
    return () => { alive = false; };
  }, [model]);
  const norms = useMemo<Loadable<(p: MatchPlayer) => { file: NormFile; rank: string } | null>>(() => {
    if (normFiles === undefined) return { status: 'loading' };
    if (!normFiles || !analysis) return { status: 'none' };
    return {
      status: 'ready',
      value: (p) => {
        const pos = analysis.pos.bySlot.get(p.slot);
        if (!pos) return null;
        if (normFiles.lobby && normGames(normFiles.lobby, p.heroId, pos) > 0) return { file: normFiles.lobby, rank: normFiles.rank };
        if (normFiles.all && normGames(normFiles.all, p.heroId, pos) > 0) return { file: normFiles.all, rank: 'ALL' };
        return null;
      },
    };
  }, [normFiles, analysis]);

  // whose build: you, else the one picked, else the MVP
  const mvpSlot = analysis?.awards.find((a) => a.id === 'mvp')?.slot ?? 0;
  const buildSlot = me ?? pickedSlot ?? mvpSlot;

  // draft verdict with today's tables for the lobby's rank
  useEffect(() => {
    if (!model || !dataset || !hasRealDraft(model)) return;
    let alive = true;
    setDraft({ status: 'loading' });
    const ids = new Set(dataset.heroes.map((h) => h.id));
    const bracket = lobbyBracket(model);
    (async () => {
      let matchups = dataset.matchups;
      let base = dataset.baseWinrates;
      let synergy: Map<number, MatchupRow[]> | null = await loadSynergy(ids);
      let usedBracket: string | null = null;
      if (bracket) {
        const [tables, synBy] = await Promise.all([loadBracketTables(ids).catch(() => null), loadSynergyByBracket(ids).catch(() => null)]);
        const bt = tables?.get(bracket);
        if (bt) { matchups = bt.matchups; base = bt.baseWinrates; usedBracket = bracket; synergy = synBy?.get(bracket) ?? synergy; }
      }
      const team = model.players.filter((p) => p.radiant).map((p) => p.heroId);
      const enemies = model.players.filter((p) => !p.radiant).map((p) => p.heroId);
      const win = winChance({ team, enemies, matchupByEnemy: matchups, synergyByHero: synergy, baseWinrates: base });
      const then = patches?.find((p) => p.id === model.patchId)?.name ?? null;
      if (alive) setDraft({ status: 'ready', value: { win, bracket: usedBracket, nowPatch: dataset.meta.latestPatch || null, thenPatch: then } });
    })().catch(() => alive && setDraft({ status: 'error' }));
    return () => { alive = false; };
  }, [model, dataset, patches]);

  // the build review of one player
  useEffect(() => {
    if (!model || !dataset || !analysis) return;
    const p = model.players[buildSlot];
    const hero = dataset.heroById.get(p.heroId);
    const pos = analysis.pos.bySlot.get(p.slot);
    if (!hero || !pos) { setBuild({ status: 'none' }); return; }
    let alive = true;
    setBuild({ status: 'loading' });
    Promise.all([loadBuildIndex(), loadHeroBuild(p.heroId), loadItemIds()])
      .then(([ix, hb, itemIds]: [BuildIndex | null, Awaited<ReturnType<typeof loadHeroBuild>>, Record<string, string> | null]) => {
        if (!alive) return;
        const { build: b } = chooseBuild(hb?.positions[pos]);
        if (!ix || !b) { setBuild({ status: 'none' }); return; }
        const byKey = new Map(Object.values(ix.items).map((v) => [v[0], v[1]]));
        const keyOfId = (itemId: number) => itemIds?.[itemId] ?? ix.items[itemId]?.[0];
        const heroes = (radiant: boolean, skip?: number) => model.players.filter((x) => x.radiant === radiant && x.slot !== skip).flatMap((x) => { const h = dataset.heroById.get(x.heroId); return h ? [h] : []; });
        const review = reviewBuild({
          player: p, hero, pos, build: b, itemOf: (itemId) => ix.items[itemId], keyOfId,
          enemies: heroes(!p.radiant), allies: heroes(p.radiant, p.slot),
          available: new Set(byKey.keys()),
        });
        setBuild({ status: 'ready', value: { review, pos, itemName: (k) => byKey.get(k) ?? prettyItem(k) } });
      })
      .catch(() => alive && setBuild({ status: 'error' }));
    return () => { alive = false; };
  }, [model, dataset, analysis, buildSlot]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = parseMatchInput(text);
    setInputError(!next);
    if (!next) return;
    setPickedSlot(null);
    if (next === id) setNonce((n) => n + 1); else setId(next);
  }

  function chooseMe(slot: number | null) {
    if (!model) return;
    if (slot == null) { setMeParam(null); try { localStorage.removeItem(ME_KEY); } catch { /* ignore */ } return; }
    const p = model.players[slot];
    const value = p.accountId ? String(p.accountId) : `p${slot}`;
    setMeParam(value);
    if (p.accountId) { try { localStorage.setItem(ME_KEY, value); } catch { /* ignore */ } }
  }

  async function askParse() {
    if (!id) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setParse({ kind: 'polling', attempt: 0 });
    try {
      await requestParse(id);
      const m = await waitForParse(id, keyOf, ac.signal, (attempt) => setParse({ kind: 'polling', attempt: attempt + 1 }));
      if (ac.signal.aborted) return;
      if (m) { setLoad({ kind: 'ready', model: m }); setParse({ kind: 'idle' }); } else setParse({ kind: 'timeout' });
    } catch {
      if (!ac.signal.aborted) setParse({ kind: 'failed' });
    }
  }

  const heroOf = useMemo(() => (p: { heroId: number }) => heroById?.get(p.heroId), [heroById]);
  const site = typeof window !== 'undefined' ? window.location.host : 'lastpick';
  const shareUrl = id ? `${window.location.origin}/?match=${id}${me != null && meParam ? `&me=${meParam}` : ''}${i18n.lang === 'ru' ? '&lang=ru' : ''}` : '';

  const openDraft = useMemo(() => {
    if (!model || me == null || !analysis || !hasRealDraft(model)) return null;
    const p = model.players[me];
    const pos = analysis.pos.bySlot.get(me);
    return () => {
      const search = buildDraftSearch('', {
        enemies: model.players.filter((x) => x.radiant !== p.radiant).map((x) => x.heroId),
        allies: model.players.filter((x) => x.radiant === p.radiant && x.slot !== me).map((x) => x.heroId),
        position: pos ? (String(pos) as '1') : 'all',
        rank: lobbyBracket(model) ?? 'ALL',
        lang: i18n.lang,
      });
      window.location.assign(`/${search}`);
    };
  }, [model, me, analysis, i18n.lang]);

  const ctx = useMemo<RecapCtx | null>(() => {
    if (!model || !analysis || !heroById) return null;
    return {
      m: model, i18n, heroOf, heroById, me, pos: analysis.pos.bySlot, posGuessed: analysis.pos.guessed,
      verdict: analysis.verdict, swings: analysis.swings, economy: analysis.economy, awards: analysis.awards,
      fights: analysis.fights, laning: analysis.laning, deaths: analysis.deaths, wards: analysis.wards, norms,
      draft, build, buildSlot, setBuildSlot: setPickedSlot, onOpenDraft: openDraft,
      patchName: patches?.find((p) => p.id === model.patchId)?.name ?? null,
      card: { site, notAffiliated: t('app.notAffiliated'), footer: `${t('match.meta', { id: model.id, mode: '', date: '' }).split(' · ')[0]} · ${t('match.source')}` },
    };
  }, [model, analysis, heroById, i18n, heroOf, me, draft, build, buildSlot, openDraft, patches, site, t, norms]);
  const slides = useSlides(ctx);

  return (
    <div className="mx-auto max-w-3xl">
      <section className="panel p-4 sm:p-6">
        <h2 className="font-display text-[20px] font-bold leading-6 text-ink">{t('match.title')}</h2>
        <p className="mt-1 text-[14px] leading-5 text-muted">{t('match.lead')}</p>
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); setInputError(false); }}
            placeholder={t('match.placeholder')}
            inputMode="text"
            autoComplete="off"
            aria-label={t('match.placeholder')}
            aria-invalid={inputError}
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg-2 px-3 text-[15px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button type="submit" className="btn btn-accent">{t('match.go')}</button>
        </form>
        {inputError && <p className="mt-2 text-[13px] text-neg" role="alert">{t('match.badInput')}</p>}
      </section>

      {(load.kind === 'loading' || (id && !heroById && load.kind !== 'error')) && (
        <div className="mt-8 flex justify-center"><DiamondLoader label={t('match.loading')} /></div>
      )}
      {load.kind === 'error' && (
        <div className="notice mt-4 justify-between gap-3" role="alert">
          <span className="text-ink">{t(`match.err.${load.error}`)}</span>
          {load.error !== 'notFound' && <button type="button" onClick={() => setNonce((n) => n + 1)} className="btn btn-ghost btn-sm">{t('match.retry')}</button>}
        </div>
      )}

      {model && ctx && (
        <div className="mt-4">
          {!model.parsed && (
            <div className="notice mb-4 flex-col !items-start gap-2">
              <span className="text-ink">{t('match.unparsed')}</span>
              {parse.kind === 'polling' ? (
                <span className="flex items-center gap-2 text-[13px] text-muted" aria-live="polite">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
                  {t('match.parsing', { n: parse.attempt })}
                </span>
              ) : (
                <button type="button" onClick={askParse} className="btn btn-accent btn-sm">{t('match.requestParse')}</button>
              )}
              {parse.kind === 'timeout' && <span className="text-[13px] text-muted">{t('match.parseTimeout')}</span>}
              {parse.kind === 'failed' && <span className="text-[13px] text-neg">{t('match.parseFailed')}</span>}
            </div>
          )}

          <div className="mb-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="label">{t('match.who')} <span className="hidden normal-case tracking-normal text-muted sm:inline">· {t('match.whoHint')}</span></h3>
              <button type="button" role="radio" aria-checked={me == null} onClick={() => chooseMe(null)}
                className={`btn btn-sm !min-h-[32px] ${me == null ? 'btn-accent' : 'btn-ghost'}`}>{t('match.everyone')}</button>
            </div>
            <div className="mt-1.5 flex items-center gap-[3px] sm:gap-1" role="radiogroup" aria-label={t('match.who')}>
              {model.players.map((p) => {
                const h: Hero | undefined = heroById?.get(p.heroId);
                const name = h ? i18n.heroName(h) : `#${p.heroId}`;
                return (
                  <button key={p.slot} type="button" role="radio" aria-checked={me === p.slot} onClick={() => chooseMe(p.slot)}
                    title={p.name ? `${name} · ${p.name}` : name} aria-label={name}
                    className={`h-8 w-8 flex-none overflow-hidden rounded-md border-b-2 sm:h-10 sm:w-10 ${p.radiant ? 'border-pos' : 'border-neg'} ${me === p.slot ? 'ring-2 ring-accent' : me == null ? '' : 'opacity-50 hover:opacity-100'} ${p.slot === 5 ? 'ml-2 sm:ml-3' : ''}`}>
                    {h && <HeroPortrait hero={h} fill />}
                  </button>
                );
              })}
            </div>
          </div>

          <RecapPlayer slides={slides} matchId={model.id} shareUrl={shareUrl} />
          <p className="mt-4 text-[11px] leading-[14px] text-muted">
            {t('match.source')} · <a href={`https://www.opendota.com/matches/${model.id}`} target="_blank" rel="noopener" className="underline hover:text-ink">opendota.com/matches/{model.id}</a>
          </p>
        </div>
      )}
    </div>
  );
}
