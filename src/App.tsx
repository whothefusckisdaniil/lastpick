import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { rankProp, resetOnce, trackOnce } from './analytics';
import { useDraftData } from './data/useDraftData';
import { freshness } from './data/dataset';
import { freshnessText, useI18n } from './i18n';
import type { StringKey } from './i18n/strings';
import { APP_CONFIG, type PositionFilter } from './config';
import type { CandidateScore, Hero } from './types';
import { BanRow, LanguageSwitch, PositionTabs, RankChip, TargetSwitch, TeamSlots, type Target } from './components/Selectors';
import { ShareMenu } from './components/ShareMenu';
import { cardPicks, type CardData } from './share/shareCard';
import { BanSuggestions } from './components/BanSuggestions';
import { ResultsGrid, ResultsSkeleton } from './components/ResultsGrid';
import { ScoreLegend } from './components/CandidateCard';
import { HeroDetailsDrawer } from './components/HeroDetailsDrawer';
import { HeroPool } from './components/HeroPool';
import { TopSupports } from './components/TopSupports';
import { WinChance } from './components/WinChance';
import { BuildPanel } from './components/BuildPanel';
import { PickerSheet } from './components/PickerSheet';
import { DiamondLoader, EmptyDiamonds, Logo } from './components/Brand';
import { ScoringPlayground } from './components/ScoringPlayground';
import { DraftValidation } from './components/DraftValidation';
import { MatchErrorBoundary } from './components/match/MatchErrorBoundary';
import { Avatar, PoolChip, PoolResults } from './components/player/PoolResults';
import { setPoolOn, useMe } from './player/usePlayer';

const SHOW_PLAYGROUND = import.meta.env.DEV;
// Match analysis: its own chunk, the draft page does not download it.
const MatchPage = lazy(() => import('./components/match/MatchPage'));
// Player profile: its own chunk too.
const ProfilePage = lazy(() => import('./components/player/ProfilePage'));

type Page = 'main' | 'about' | 'privacy' | 'match' | 'profile';

/** The page the address points at: `?match…` or `?profile` / `?player=ID`. */
function pageFromUrl(): Page | null {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.has('match')) return 'match';
    if (p.has('profile') || p.has('player')) return 'profile';
  } catch { /* sandboxed */ }
  return null;
}

/** Enter / leave the match or profile page: a flag in the address, a history entry for Back. */
function setPageUrl(page: Page) {
  try {
    const p = new URLSearchParams(window.location.search);
    const want = page === 'match' ? 'match' : page === 'profile' ? 'profile' : null;
    const now = p.has('match') ? 'match' : p.has('profile') || p.has('player') ? 'profile' : null;
    if (want === now) return;
    for (const k of ['match', 'me', 'profile', 'player']) p.delete(k);
    if (want) p.set(want, '');
    const qs = p.toString().replace(/%2C/gi, ',').replace(/(match|profile)=(&|$)/, '$1$2');
    window.history.pushState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  } catch { /* sandboxed */ }
}

const TRY_EXAMPLES = ['Puck', 'Tidehunter', 'Juggernaut'];
const DESKTOP = '(min-width: 1280px)';

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return !!match;
}

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" />
  </svg>
);

export default function App() {
  const me = useMe();
  const d = useDraftData({ poolProfile: me.poolOn ? me.profile : null });
  const i18n = useI18n();
  const { t } = i18n;
  const [view, setView] = useState<'draft' | 'lab' | 'validate'>('draft');
  const [page, setPage] = useState<Page>(() => pageFromUrl() ?? 'main');
  const [details, setDetails] = useState<{ c: CandidateScore; lane: Exclude<PositionFilter, 'all'> } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const isDesktop = useMedia(DESKTOP);

  // Close the analysis whenever the draft changes or the user navigates —
  // otherwise it keeps showing a stale CandidateScore for the previous lineup.
  useEffect(() => setDetails(null), [d.enemies, d.allies, d.bans]);
  useEffect(() => setDetails(null), [page]);
  useEffect(() => {
    const onPop = () => setPage((p) => pageFromUrl() ?? (p === 'match' || p === 'profile' ? 'main' : p));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const heroByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of d.heroes) m.set(h.name.toLowerCase(), h.id);
    return m;
  }, [d.heroes]);

  function go(next: Page) {
    setPageUrl(next);
    setPage(next);
    window.scrollTo({ top: 0 });
  }

  /** Empty slot / search: the desktop grid is always visible, elsewhere the sheet opens. */
  const openPicker = useCallback((target?: Target) => {
    if (target) d.setTarget(target);
    if (window.matchMedia?.(DESKTOP).matches) document.getElementById('pool-search')?.focus();
    else setPickerOpen(true);
  }, [d]);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const pick = useCallback((h: Hero) => {
    d.addHero(h.id, d.target);
    try { navigator.vibrate?.(10); } catch { /* unsupported */ }
  }, [d]);

  const counts = { enemy: d.enemies.length, ally: d.allies.length, ban: d.bans.length, me: d.me ? 1 : 0 };
  const ready = d.loadState.kind === 'ready';
  const hasDraft = d.enemies.length > 0 || d.allies.length > 0;
  const resultsKey = [d.enemies.join(), d.allies.join(), d.bans.join(), d.position, d.rank].join('|');
  const name = (id: number) => { const h = d.heroById.get(id); return h ? i18n.heroName(h) : `#${id}`; };
  const showMain = page === 'main' && !(SHOW_PLAYGROUND && view !== 'draft');

  // Product analytics. A draft counts once its recommendations have been on
  // screen for a moment (picking five heroes in a row is one draft, not five).
  const poolShown = showMain && me.poolOn && !!me.profile && !!d.poolResults && !!d.pool;
  const draftShown = showMain && !!d.results;
  useEffect(() => {
    if (!draftShown) return;
    const timer = window.setTimeout(() => trackOnce(`${resultsKey}|${poolShown}`, 'draft_results_viewed', {
      position: d.position, rank: rankProp(d.rank),
      enemyCount: d.enemies.length, allyCount: d.allies.length, banCount: d.bans.length, pool: poolShown,
    }), 1500);
    return () => window.clearTimeout(timer);
  }, [draftShown, resultsKey, poolShown]); // eslint-disable-line react-hooks/exhaustive-deps
  // "My pool" applied: once per switch-on, when its recommendations are shown
  useEffect(() => {
    if (!me.poolOn) { resetOnce('my_pool_applied', 'on'); return; }
    if (!poolShown || !d.pool) return;
    const n = d.pool.heroes.size;
    trackOnce('on', 'my_pool_applied', {
      position: d.position, rank: rankProp(d.rank),
      poolSize: n < 10 ? '<10' : n < 20 ? '10-19' : n < 40 ? '20-39' : '40+', lowData: d.pool.lowData,
    });
  }, [me.poolOn, poolShown]); // eslint-disable-line react-hooks/exhaustive-deps
  const rankName = d.rank === 'ALL' || d.rankError ? t('rank.all') : t(`rank.${d.rank}` as StringKey);
  const roleName = d.position === 'all' ? t('results.perRole') : t(`pos.${d.position}.long` as StringKey);

  /** Data for the share image, read when the user asks for it. */
  const shareCard = (): CardData => ({
    enemies: d.enemies.flatMap((id) => { const h = d.heroById.get(id); return h ? [{ hero: h, name: i18n.heroName(h) }] : []; }),
    picks: cardPicks(d.results, d.position === 'all', (lane) => t(`lane.${lane}` as StringKey), i18n.heroName),
    context: `${roleName} · ${rankName}`,
    labels: { enemies: t('draft.title'), counters: t('results.title'), slogan: t('app.slogan'), notAffiliated: t('app.notAffiliated') },
    site: window.location.host,
  });

  return (
    <div className="relative min-h-screen bg-bg text-ink">
      <div className="bg-fx" aria-hidden="true">
        <div className="bg-glow a" />
        <div className="bg-glow b" />
        <div className="bg-grid" />
        <i className="bg-spark" /><i className="bg-spark" /><i className="bg-spark" /><i className="bg-spark" /><i className="bg-spark" />
      </div>
      <div className="status-cover" aria-hidden="true" />
      <div className="app-shell relative z-[1] mx-auto w-full max-w-[1360px] pb-28 md:pb-10">
        <header className="site-header flex h-14 items-center justify-between gap-3 md:mb-4 md:h-16" data-scrolled={scrolled}>
          <button type="button" onClick={() => go('main')} className="flex min-h-[44px] items-center" aria-label="LASTPICK">
            <Logo markOnlyNarrow />
          </button>
          <h1 className="sr-only">LASTPICK — {t('app.tagline')}</h1>
          <div className="flex items-center gap-2">
            {SHOW_PLAYGROUND && (
              <select
                value={view}
                onChange={(e) => { setPage('main'); setView(e.target.value as typeof view); }}
                className="hidden h-9 rounded-lg border border-line bg-surface px-2 text-xs text-muted lg:block"
                aria-label="Dev view"
              >
                <option value="draft">Draft</option>
                <option value="validate">Draft validation</option>
                <option value="lab">Scoring lab</option>
              </select>
            )}
            <button type="button" onClick={() => go(page === 'profile' ? 'main' : 'profile')} aria-pressed={page === 'profile'}
              className={`btn btn-sm !min-h-[36px] !px-2.5 ${page === 'profile' ? 'btn-accent' : 'btn-ghost'}`} title={t('nav.profile')}>
              {me.profile ? <Avatar src={me.profile.avatar} name={me.profile.name} size={20} /> : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
                </svg>
              )}
              <span className="hidden lg:inline">{t('nav.profile')}</span>
              <span className="sr-only lg:hidden">{t('nav.profile')}</span>
            </button>
            <button type="button" onClick={() => go(page === 'match' ? 'main' : 'match')} aria-pressed={page === 'match'}
              className={`btn btn-sm !min-h-[36px] !px-2.5 ${page === 'match' ? 'btn-accent' : 'btn-ghost'}`} title={t('nav.match')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 6-7" />
              </svg>
              <span className="hidden lg:inline">{t('nav.match')}</span>
              <span className="sr-only lg:hidden">{t('nav.match')}</span>
            </button>
            {ready && page === 'main' && me.profile && !me.profile.hidden && (
              <span className="hidden sm:inline-flex"><PoolChip profile={me.profile} on={me.poolOn} onToggle={() => setPoolOn(!me.poolWanted)} /></span>
            )}
            {ready && page !== 'match' && <RankChip value={d.rank} options={d.rankOptions} onChange={d.setRank} />}
            <LanguageSwitch />
          </div>
        </header>

        <div key={page} className="page-in">

        {page === 'about' && (
          <section className="panel mx-auto mt-4 max-w-3xl p-6 text-[15px] leading-relaxed text-muted sm:p-8">
            <h2 className="mb-3 font-display text-[20px] font-bold leading-6 text-ink">{t('about.title')}</h2>
            <p className="text-ink">{t('app.slogan')}.</p>
            <p className="mt-3">{t('about.p1')}</p>
            <p className="mt-2">{t('about.p2')}</p>
            <p className="mt-2">{t('about.p3')}</p>
            <p className="mt-2">{t('about.p4')}</p>
            <p className="mt-2">{t('about.p5')}</p>
            <p className="mt-2">{t('about.disclaimer')}</p>
            <p className="mt-2">{t('about.trademark')}</p>
          </section>
        )}
        {page === 'privacy' && (
          <section className="panel mx-auto mt-4 max-w-3xl p-6 text-[15px] leading-relaxed text-muted sm:p-8">
            <h2 className="mb-3 font-display text-[20px] font-bold leading-6 text-ink">{t('privacy.title')}</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t('privacy.noAccount')}</li>
              <li>{t('privacy.noData')}</li>
              <li>{t('privacy.noSteam')}</li>
              <li>{t('privacy.analytics')}</li>
              <li>{t('privacy.match')}</li>
              <li>{t('privacy.player')}</li>
            </ul>
            <p className="mt-3">{t('privacy.note')}</p>
          </section>
        )}

        {page === 'match' && (
          <MatchErrorBoundary text={t('match.crash')} reset={t('match.crashReset')}>
            <Suspense fallback={<div className="mt-10 flex justify-center"><DiamondLoader label={t('match.loading')} /></div>}>
              <MatchPage />
            </Suspense>
          </MatchErrorBoundary>
        )}

        {page === 'profile' && (
          <MatchErrorBoundary text={t('match.crash')} reset={t('match.crashReset')}>
            <Suspense fallback={<div className="mt-10 flex justify-center"><DiamondLoader label={t('profile.loading')} /></div>}>
              <ProfilePage onRank={d.setRank} rankOptions={d.rankOptions} onUsePool={() => go('main')} />
            </Suspense>
          </MatchErrorBoundary>
        )}

        {page === 'main' && SHOW_PLAYGROUND && view === 'lab' && <ScoringPlayground />}
        {page === 'main' && SHOW_PLAYGROUND && view === 'validate' && <DraftValidation />}

        {showMain && d.loadState.kind === 'loading' && (
          <div className="mx-auto mt-10 max-w-xl">
            <div className="flex justify-center"><DiamondLoader label={t('load.loading')} /></div>
            <div className="mt-8"><ResultsSkeleton /></div>
          </div>
        )}
        {showMain && d.loadState.kind === 'error' && (
          <div className="notice mx-auto mt-10 max-w-xl justify-between">
            <span className="text-ink">{t('load.errorTitle')}</span>
            <button type="button" onClick={() => window.location.reload()} className="btn btn-accent btn-sm">{t('load.retry')}</button>
          </div>
        )}

        {showMain && ready && (
          <div className="layout">
            {/* Desktop: the hero grid is always visible — a tap picks, no modal. */}
            <aside className="pool-col rounded-[14px] border border-line bg-surface p-3" style={{ height: 'calc(100vh - 96px)' }} aria-label={t('picker.title')}>
              {isDesktop && (
                <HeroPool
                  heroes={d.heroes}
                  taken={d.taken}
                  onPick={pick}
                  inputId="pool-search"
                  header={<div className="mb-3"><TargetSwitch value={d.target} onChange={d.setTarget} counts={counts} limits={d.limits} /></div>}
                />
              )}
            </aside>

            {/* Draft: sticky strip on phones; a sticky side panel from 768 px. */}
            <section className="draft-col md:rounded-[14px] md:border md:border-line md:bg-surface md:p-4" aria-label={t('draft.title')}>
              <div className="draft-strip">
                <TeamSlots
                  team="enemy"
                  ids={d.enemies}
                  max={d.limits.enemy}
                  heroById={d.heroById}
                  active={d.target === 'enemy'}
                  onRemove={(id) => d.remove(id, 'enemy')}
                  onAdd={openPicker}
                  actions={d.taken.size > 0 ? (
                    <button type="button" onClick={d.clearAll} className="btn btn-ghost btn-sm !min-h-[28px] !px-2.5 md:hidden">{t('draft.clear')}</button>
                  ) : undefined}
                />
              </div>
              <div className="mt-3 grid gap-4 md:mt-5">
                <button type="button" onClick={() => openPicker()} className="search-pill hidden !h-11 !shadow-none md:flex xl:hidden">
                  <SearchIcon /> {t('picker.open')}
                </button>
                <TeamSlots
                  team="ally"
                  ids={d.allies}
                  max={d.limits.ally}
                  heroById={d.heroById}
                  active={d.target === 'ally'}
                  onRemove={(id) => d.remove(id, 'ally')}
                  onAdd={openPicker}
                  me={d.me}
                  meActive={d.target === 'me'}
                  allyPositions={d.allyPositions}
                  onAllyPos={d.setAllyPos}
                  onRemoveMe={() => d.me && d.remove(d.me, 'me')}
                />
                <BanRow
                  ids={d.bans}
                  max={d.limits.ban}
                  heroById={d.heroById}
                  active={d.target === 'ban'}
                  onRemove={(id) => d.remove(id, 'ban')}
                  onAdd={openPicker}
                />
                <div>
                  <h2 className="label mb-2">{t('role.title')}</h2>
                  <PositionTabs value={d.position} onChange={d.setPosition} />
                </div>
                {me.profile && !me.profile.hidden && (
                  <div className="sm:hidden"><PoolChip profile={me.profile} on={me.poolOn} onToggle={() => setPoolOn(!me.poolWanted)} /></div>
                )}
                {d.taken.size > 0 && (
                  <div className="hidden gap-2 md:flex">
                    <ShareMenu card={shareCard} align="left" />
                    <button type="button" onClick={d.clearAll} className="btn btn-ghost btn-sm">{t('draft.clear')}</button>
                  </div>
                )}
              </div>
            </section>

            <main className="results-col mt-5 md:mt-0" aria-live="polite">
              {d.enemies.length > 0 && d.missingTables.length > 0 && (
                <div className="notice mb-4">{t('missing.data', { names: d.missingTables.map(name).join(', ') })}</div>
              )}
              {d.rankError && d.rank !== 'ALL' && <div className="notice mb-4">{t(`rank.${d.rankError}` as StringKey)}</div>}
              {d.synergyUnavailable && <div className="notice mb-4">{t('synergy.unavailable')}</div>}

              {d.draftWin && <WinChance data={d.draftWin} heroById={d.heroById} />}
              {d.draftWinNeedsMe && <div className="notice mb-4">{t('win.needMe')}</div>}
              {d.me && d.heroById.get(d.me) && (
                <BuildPanel
                  hero={d.heroById.get(d.me)!}
                  preferLane={d.position !== 'all' ? d.position : null}
                  onLane={(l) => d.setPosition(l as Exclude<PositionFilter, 'all'>)}
                  enemies={d.enemies.flatMap((id) => { const h = d.heroById.get(id); return h ? [h] : []; })}
                  allies={d.allies.flatMap((id) => { const h = d.heroById.get(id); return h ? [h] : []; })}
                  onClose={() => { if (d.me) d.remove(d.me, 'me'); }}
                />
              )}
              {!hasDraft ? (
                <div className="fade-in">
                  {/* Short prompt: the draft is still the main action. */}
                  <div className="flex flex-col items-center px-4 pb-6 pt-4 text-center md:pt-2">
                    <EmptyDiamonds />
                    <p className="mt-4 font-display text-[16px] font-bold leading-5 text-ink">{t('empty.title')}</p>
                    <p className="mt-1.5 text-[13px] leading-[18px] text-muted">{t('empty.text', { max: APP_CONFIG.ui.maxEnemies })}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      <span className="text-[13px] text-muted">{t('empty.try')}</span>
                      {TRY_EXAMPLES.map((n) => {
                        const id = heroByName.get(n.toLowerCase());
                        const h = id !== undefined ? d.heroById.get(id) : undefined;
                        return (
                          <button key={n} type="button" onClick={() => id !== undefined && d.addHero(id, 'enemy')} className="btn btn-ghost btn-sm">
                            {h ? i18n.heroName(h) : n}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Before any pick: what is strong on pos 4 / 5 in your rank right now. */}
                  <TopSupports
                    stats={d.roleStats}
                    heroes={d.heroes}
                    rank={d.rank}
                    rankOptions={d.rankOptions}
                    onRank={d.setRank}
                    initialPos={d.position === '4' ? 4 : 5}
                  />
                </div>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0">
                      <h2 className="font-display text-[16px] font-bold leading-5 text-ink sm:text-[20px] sm:leading-6">
                        {d.allies.length > 0 && !d.synergyUnavailable
                          ? t(d.enemies.length > 0 ? 'results.titleTeam' : 'results.titleAllies')
                          : t('results.title')}
                      </h2>
                      <p className="mt-0.5 text-[13px] leading-4 text-muted">
                        {roleName} · {rankName}
                      </p>
                    </div>
                    <div className="md:hidden"><ShareMenu card={shareCard} /></div>
                  </div>

                  {d.results && <ScoreLegend />}
                  {me.poolWanted && me.status.kind === 'loading' && <div className="notice mb-3">{t('pool.loading')}</div>}
                  {me.poolWanted && me.status.kind === 'error' && <div className="notice mb-3">{t('pool.error')}</div>}
                  {(d.rankLoading || (d.allies.length > 0 && d.synergyLoading)) && !d.results ? (
                    <ResultsSkeleton />
                  ) : me.poolOn && me.profile && d.poolResults && d.pool ? (
                    <div key={`pool|${resultsKey}`} className="fade-in">
                      <PoolResults
                        results={d.poolResults}
                        overall={d.results}
                        profile={me.profile}
                        lowData={d.pool.lowData}
                        summary={d.position === 'all'}
                        roles={me.roles}
                        onViewDetails={(candidate, lane) => setDetails({ c: candidate, lane })}
                        onOff={() => setPoolOn(false)}
                      />
                    </div>
                  ) : (
                    <div key={resultsKey} className="fade-in">
                      <ResultsGrid
                        results={d.results}
                        heroById={d.heroById}
                        onViewDetails={(candidate, lane) => setDetails({ c: candidate, lane })}
                        summary={d.position === 'all'}
                      />
                    </div>
                  )}

                  <BanSuggestions
                    items={d.banSuggestions}
                    heroById={d.heroById}
                    canBan={d.bans.length < d.limits.ban}
                    onBan={(id) => d.addHero(id, 'ban')}
                  />
                  <p className="mt-6 text-[11px] leading-[14px] text-muted">{t('results.footnote')}</p>
                </>
              )}
            </main>
          </div>
        )}

        </div>

        <footer className="mt-12 border-t border-line pt-6 text-[11px] leading-[16px] text-muted">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Logo compact />
              <span>{t('app.tagline')} · {t('app.notAffiliated')}</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => go('profile')} className={`btn btn-sm !min-h-[36px] !border-0 ${page === 'profile' ? 'text-accent' : 'text-muted hover:text-ink'}`}>{t('nav.profile')}</button>
              <button type="button" onClick={() => go('match')} className={`btn btn-sm !min-h-[36px] !border-0 ${page === 'match' ? 'text-accent' : 'text-muted hover:text-ink'}`}>{t('nav.match')}</button>
              <button type="button" onClick={() => go('about')} className={`btn btn-sm !min-h-[36px] !border-0 ${page === 'about' ? 'text-accent' : 'text-muted hover:text-ink'}`}>{t('nav.about')}</button>
              <button type="button" onClick={() => go('privacy')} className={`btn btn-sm !min-h-[36px] !border-0 ${page === 'privacy' ? 'text-accent' : 'text-muted hover:text-ink'}`}>{t('nav.privacy')}</button>
            </div>
          </div>
          <p className="mt-3">
            {/* Attribution required by the data providers: kept here, small, and nowhere else. */}
            {t('footer.matchups')}{' '}
            <a href="https://stratz.com" target="_blank" rel="noopener" className="underline decoration-line-2 underline-offset-2 hover:text-ink">Powered by STRATZ</a>{' · '}
            <a href="https://www.opendota.com" target="_blank" rel="noopener" className="underline decoration-line-2 underline-offset-2 hover:text-ink">OpenDota</a>
            {ready && d.meta && (
              <> · {freshnessText(freshness(d.meta), i18n)} · {t('footer.patch', { patch: d.meta.latestPatch || t('footer.unknown') })}</>
            )}
          </p>
          <p className="mt-2">{t('footer.trademark')}</p>
        </footer>
      </div>

      {/* The main action sits in the thumb zone on phones. */}
      {showMain && ready && !pickerOpen && !details && (
        <div className="bottom-bar md:hidden">
          <button type="button" onClick={() => openPicker()} className="search-pill" aria-haspopup="dialog">
            <SearchIcon />
            <span className="flex-1 text-left">{t('picker.open')}</span>
            <span className="label !text-[11px] text-accent">
              {t(`target.${d.target}` as StringKey)} <span className="tnum">{counts[d.target]}/{d.limits[d.target]}</span>
            </span>
          </button>
        </div>
      )}

      {pickerOpen && !isDesktop && (
        <PickerSheet
          heroes={d.heroes}
          taken={d.taken}
          target={d.target}
          setTarget={d.setTarget}
          counts={counts}
          limits={d.limits}
          onPick={pick}
          onClose={closePicker}
        />
      )}

      {details && (
        <HeroDetailsDrawer
          candidate={details.c}
          laneName={t(`lane.${details.lane}` as StringKey)}
          enemyIds={d.enemies}
          heroById={d.heroById}
          onClose={() => setDetails(null)}
          onShowBuild={() => {
            d.addHero(details.c.hero.id, 'me');
            // the role tab is the one switch for recommendations and build
            d.setPosition(details.lane);
            setDetails(null);
            window.setTimeout(() => document.getElementById('build-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
          }}
        />
      )}
    </div>
  );
}

