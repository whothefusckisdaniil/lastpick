import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A number that explains itself: what it is (label), the value, and what it
 * is measured against (sub). Used wherever a bare figure would leave people
 * guessing.
 */
export function StatTile({ label, value, sub, tone = 'ink', icon, title }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'ink' | 'pos' | 'neg' | 'accent';
  icon?: ReactNode;
  title?: string;
}) {
  const color = tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : tone === 'accent' ? 'text-accent' : 'text-ink';
  return (
    <div className="stat-tile" title={title}>
      <div className="label flex items-center gap-1.5">{icon}{label}</div>
      <div className={`tnum mt-1.5 font-display text-[17px] font-bold leading-[22px] [overflow-wrap:anywhere] sm:text-[20px] sm:leading-6 ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-[12px] leading-4 text-muted">{sub}</div>}
    </div>
  );
}

export interface TabItem<T extends string> { id: T; label: string; badge?: ReactNode }

/** Tabs with a sliding highlight; scrolls horizontally on narrow screens. */
export function Tabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = wrap.current?.querySelector<HTMLButtonElement>(`[data-tab="${value}"]`);
      if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const el = wrap.current?.querySelector<HTMLButtonElement>(`[data-tab="${value}"]`);
    if (el && wrap.current) wrap.current.scrollTo?.({ left: el.offsetLeft - 16, behavior: 'smooth' });
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => window.removeEventListener('resize', measure);
  }, [value, items.length]);
  return (
    <div ref={wrap} className="tabs no-scrollbar" role="tablist" aria-label={label}>
      {ind && <span className="tabs-ind" style={{ transform: `translateX(${ind.left}px)`, width: ind.width }} aria-hidden="true" />}
      {items.map((it) => (
        <button key={it.id} data-tab={it.id} type="button" role="tab" aria-selected={value === it.id}
          onClick={() => onChange(it.id)} className={`tabs-btn ${value === it.id ? 'is-active' : ''}`}>
          {it.label}{it.badge}
        </button>
      ))}
    </div>
  );
}

/** A number that counts up to `value` (ease-out, ~700 ms); instant with reduced motion. */
export function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof requestAnimationFrame === 'undefined') { setShown(value); from.current = value; return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, ms]);
  return shown;
}

/**
 * A horizontal strip that also scrolls with a plain mouse wheel (a vertical
 * wheel turns into horizontal scrolling while the strip can still move that
 * way; at either end the page scrolls as usual), with prev / next arrows on
 * devices with a mouse. Touch and trackpads keep their native swipe.
 */
export function ScrollStrip({ children, className = '', label, prevLabel, nextLabel }: {
  children: ReactNode;
  /** Classes of the scrolling list (layout, gaps, paddings). */
  className?: string;
  label?: string;
  prevLabel: string;
  nextLabel: string;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 });
    };
    const onWheel = (e: WheelEvent) => {
      // trackpads send horizontal deltas themselves; only translate a mostly vertical wheel
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.ctrlKey) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY;
      // at an end, let the page scroll
      if ((dy < 0 && el.scrollLeft <= 0) || (dy > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += dy;
    };
    update();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, []);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div className="scroll-strip relative">
      <ol ref={ref} className={`no-scrollbar overflow-x-auto ${className}`} aria-label={label}>{children}</ol>
      {!edges.start && <button type="button" className="strip-arrow strip-arrow-prev" onClick={() => page(-1)} aria-label={prevLabel}>‹</button>}
      {!edges.end && <button type="button" className="strip-arrow strip-arrow-next" onClick={() => page(1)} aria-label={nextLabel}>›</button>}
    </div>
  );
}
