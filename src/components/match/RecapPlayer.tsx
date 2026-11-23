import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { CardFormat } from '../../share/shareCard';
import { deliverImages, renderRecapCard } from '../../share/matchCards';
import type { Slide } from './slides';

const MODE_KEY = 'lp.recapMode';
export const AUTOPLAY_MS = 6000;

type ShareStatus = 'idle' | 'making' | 'copied' | 'failed';

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * Story-style player: one idea per slide, swipe / arrows / keys, a progress
 * bar on top, optional autoplay (for screen recordings), or everything on one
 * page. Every slide can be exported as an image.
 */
export function RecapPlayer({ slides, matchId, shareUrl }: { slides: Slide[]; matchId: number; shareUrl: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'slides' | 'page'>(() => {
    try { return localStorage.getItem(MODE_KEY) === 'page' ? 'page' : 'slides'; } catch { return 'slides'; }
  });
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState(false);
  const [status, setStatus] = useState<ShareStatus>('idle');
  const touch = useRef<{ x: number; y: number } | null>(null);
  /** Direction of the last move, for the slide-in animation. */
  const prevIndex = useRef(0);
  const count = slides.length;
  const i = Math.min(index, count - 1);
  const dirRef = useRef(1);
  if (i !== prevIndex.current) { dirRef.current = i > prevIndex.current ? 1 : -1; prevIndex.current = i; }
  const dir = dirRef.current;

  const go = useCallback((d: number) => setIndex((x) => Math.max(0, Math.min(count - 1, x + d))), [count]);

  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ } }, [mode]);
  useEffect(() => setIndex(0), [matchId]);


  // keyboard: arrows (not while typing), space toggles autoplay
  useEffect(() => {
    if (mode !== 'slides') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'ArrowRight') { go(1); setPlaying(false); }
      else if (e.key === 'ArrowLeft') { go(-1); setPlaying(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, mode]);

  // autoplay: next slide every 6 s, stops on the last one
  useEffect(() => {
    if (!playing || mode !== 'slides') return;
    if (i >= count - 1) { setPlaying(false); return; }
    const id = window.setTimeout(() => go(1), AUTOPLAY_MS);
    return () => window.clearTimeout(id);
  }, [playing, i, count, go, mode]);

  useEffect(() => {
    if (status === 'idle' || status === 'making') return;
    const id = window.setTimeout(() => setStatus('idle'), 2200);
    return () => window.clearTimeout(id);
  }, [status]);

  async function exportCards(list: Slide[], format: CardFormat) {
    setMenu(false);
    setStatus('making');
    try {
      const files: File[] = [];
      for (const s of list) {
        const blob = await renderRecapCard(format, s.card());
        files.push(new File([blob], `lastpick-${matchId}-${s.id}-${format}.png`, { type: 'image/png' }));
      }
      await deliverImages(files, shareUrl);
      setStatus('idle');
    } catch (e) {
      console.error(e);
      setStatus('failed');
    }
  }

  const onTouchStart = (e: React.TouchEvent) => { const p = e.touches[0]; touch.current = { x: p.clientX, y: p.clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { go(dx < 0 ? 1 : -1); setPlaying(false); }
  };

  const shareLabel = status === 'making' ? t('recap.making') : status === 'copied' ? t('recap.copied') : status === 'failed' ? t('recap.failed') : t('recap.share');

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="seg seg-sm" role="tablist" aria-label={t('recap.slides')}>
        {(['slides', 'page'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setPlaying(false); }} className={`seg-btn ${mode === m ? 'is-active' : ''}`}>
            {t(m === 'slides' ? 'recap.slides' : 'recap.page')}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {mode === 'slides' && (
          <button type="button" onClick={() => { if (i >= count - 1) setIndex(0); setPlaying((v) => !v); }} className="btn btn-ghost btn-sm" aria-pressed={playing}>
            {playing ? '❚❚' : '▶'} {t(playing ? 'recap.pause' : 'recap.play')}
          </button>
        )}
        <div className="relative">
          <button type="button" onClick={() => setMenu((v) => !v)} disabled={status === 'making'} aria-haspopup="menu" aria-expanded={menu} aria-live="polite"
            className={`btn btn-ghost btn-sm ${status === 'copied' ? '!text-accent' : ''}`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>
            {shareLabel}
          </button>
          {menu && (
            <div className="menu !w-[300px]" role="menu">
              <button type="button" role="menuitem" className="menu-item" onClick={async () => { setMenu(false); setStatus((await copyText(shareUrl)) ? 'copied' : 'failed'); }}>{t('recap.link')}</button>
              {mode === 'slides' && <button type="button" role="menuitem" className="menu-item" onClick={() => exportCards([slides[i]], 'story')}>{t('recap.shareSlide')} · 1080×1920</button>}
              {mode === 'slides' && <button type="button" role="menuitem" className="menu-item" onClick={() => exportCards([slides[i]], 'post')}>{t('recap.shareSlide')} · 1200×630</button>}
              <button type="button" role="menuitem" className="menu-item" onClick={() => exportCards(slides, 'story')}>{t('recap.shareAll')} · 1080×1920</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (mode === 'page') {
    return (
      <div>
        {toolbar}
        <div className="mt-4 grid gap-4">
          {slides.map((s) => <section key={s.id} className="panel p-4 sm:p-6" aria-label={s.title}>{s.node}</section>)}
        </div>
      </div>
    );
  }

  const slide = slides[i];
  return (
    <div>
      {toolbar}
      {/* progress: one segment per slide, the current one fills during autoplay */}
      <div className="mt-3 flex gap-1" role="tablist" aria-label={t('recap.slides')}>
        {slides.map((s, k) => (
          <button key={s.id} type="button" role="tab" aria-selected={k === i} aria-label={s.title} title={s.title}
            onClick={() => { setIndex(k); setPlaying(false); }} className="group flex h-6 flex-1 items-center">
            <span className="block h-1 w-full overflow-hidden rounded-full bg-surface-2 group-hover:bg-line-2">
              <span key={`${k}-${i}-${playing}`} className={`block h-full rounded-full bg-accent ${k < i ? 'w-full' : k === i ? (playing ? 'recap-fill' : 'w-full opacity-60') : 'w-0'}`}
                style={k === i && playing ? { animationDuration: `${AUTOPLAY_MS}ms` } : undefined} />
            </span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => { go(-1); setPlaying(false); }} disabled={i === 0} className="btn btn-ghost btn-sm min-w-0 disabled:opacity-40" aria-label={t('recap.prev')}>
          <span aria-hidden="true">←</span> <span className="hidden truncate sm:inline">{i > 0 ? slides[i - 1].title : ''}</span>
        </button>
        <span className="tnum shrink-0 text-[12px] text-muted">{t('recap.of', { n: i + 1, total: count })}</span>
        <button type="button" onClick={() => { go(1); setPlaying(false); }} disabled={i === count - 1} className="btn btn-ghost btn-sm min-w-0 disabled:opacity-40" aria-label={t('recap.next')}>
          <span className="hidden truncate sm:inline">{i < count - 1 ? slides[i + 1].title : ''}</span> <span aria-hidden="true">→</span>
        </button>
      </div>
      <div className="relative mt-2 overflow-x-clip" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <section key={slide.id} className={`panel p-4 sm:p-6 ${dir < 0 ? 'recap-in-prev' : 'recap-in-next'}`} aria-roledescription="slide" aria-label={`${slide.title} · ${t('recap.of', { n: i + 1, total: count })}`}>
          {slide.node}
        </section>
      </div>
    </div>
  );
}
