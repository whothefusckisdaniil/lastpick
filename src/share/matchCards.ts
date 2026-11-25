import type { Hero } from '../types';
import { localPortraitUrl } from '../components/HeroPortrait';
import { C, DISPLAY, UI, fit, label, loadImage, logo, portrait, roundRect, wrap, type CardFormat } from './shareCard';

/**
 * Match recap slides as images: one generic layout that every slide fills —
 * kicker, headline, a line under it, then the two teams, the gold graph or a
 * short list. Same sizes as the draft card (story 1080×1920, post 1200×630).
 */
export type Tone = 'pos' | 'neg' | 'muted' | 'accent' | 'ink';

export interface RecapCardRow { hero?: Hero; title: string; sub?: string; value?: string; tone?: Tone }

export interface RecapCard {
  kicker: string;
  title: string;
  subtitle?: string;
  teams?: { top: Hero[]; bottom: Hero[]; topLabel: string; bottomLabel: string; topWin: boolean; highlight?: number | null };
  /** Gold lead per minute, positive = the top team. */
  chart?: { values: number[]; topLabel: string; bottomLabel: string };
  rows?: RecapCardRow[];
  /** Ward map: positions 0..1, y up. */
  map?: { wards: { x: number; y: number; radiant: boolean; obs: boolean; dead: boolean; mine?: boolean }[] };
  /** A player's avatar (Steam CDN, CORS-enabled; a letter when it fails) with an optional rank medal; no src and an empty letter = the medal alone. */
  avatar?: { src: string | null; letter: string; medal: string | null };
  /** Big kill score: Radiant – Dire, with the length between. */
  score?: { left: number; right: number; mid: string; leftWin: boolean };
  footer: string;
  site: string;
  notAffiliated: string;
}

/** Lines `text` takes at the current font. */
function countLines(ctx: CanvasRenderingContext2D, text: string, max: number): number {
  let lines = 1;
  let line = '';
  for (const w of text.split(' ')) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > max && line) { lines++; line = w; } else line = next;
  }
  return lines;
}

/** Headline: the largest of `sizes` that fits in `maxLines`, then drawn. Returns its height. */
function headline(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, sizes: number[], maxLines: number): number {
  let size = sizes[sizes.length - 1];
  for (const s of sizes) {
    ctx.font = `700 ${s}px ${DISPLAY}`;
    if (countLines(ctx, text, max) <= maxLines) { size = s; break; }
  }
  ctx.font = `700 ${size}px ${DISPLAY}`;
  ctx.fillStyle = C.ink;
  const lineH = Math.round(size * 1.24);
  return lineH * wrap(ctx, text, x, y, max, lineH, maxLines);
}

function kicker(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, max: number) {
  ctx.font = `600 ${size}px ${UI}`;
  ctx.letterSpacing = `${size * 0.08}px`;
  const shown = fit(ctx, text.toUpperCase(), max);
  ctx.letterSpacing = '0px';
  label(ctx, shown, x, y, size, C.accent);
}

function score(ctx: CanvasRenderingContext2D, sc: NonNullable<RecapCard['score']>, cx: number, y: number, size: number) {
  ctx.font = `600 ${Math.round(size * 0.4)}px ${UI}`;
  const mw = ctx.measureText(sc.mid).width;
  ctx.fillStyle = C.muted;
  ctx.fillText(sc.mid, cx - mw / 2, y);
  ctx.font = `700 ${size}px ${DISPLAY}`;
  const l = String(sc.left);
  ctx.fillStyle = sc.leftWin ? C.pos : C.muted;
  ctx.fillText(l, cx - mw / 2 - size * 0.4 - ctx.measureText(l).width, y);
  ctx.fillStyle = sc.leftWin ? C.muted : C.neg;
  ctx.fillText(String(sc.right), cx + mw / 2 + size * 0.4, y);
}

/** Our schematic map (bases, lanes, river) with the wards. */
function wardMap(ctx: CanvasRenderingContext2D, wards: NonNullable<RecapCard['map']>['wards'], x0: number, y0: number, size: number) {
  const X = (v: number) => x0 + v * size;
  const Y = (v: number) => y0 + (1 - v) * size;
  const line = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([a, b], k) => (k ? ctx.lineTo(X(a), Y(b)) : ctx.moveTo(X(a), Y(b)))); ctx.stroke(); };
  ctx.save();
  roundRect(ctx, x0, y0, size, size, size * 0.03);
  ctx.fillStyle = '#0C0F14';
  ctx.fill();
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(111,183,255,0.16)';
  ctx.lineWidth = size * 0.07;
  line([[0, 0.62], [0.3, 0.55], [0.5, 0.5], [0.7, 0.45], [1, 0.38]]);
  ctx.strokeStyle = '#2E3847';
  ctx.lineWidth = size * 0.012;
  line([[0.09, 0.2], [0.09, 0.91], [0.8, 0.91]]);
  line([[0.17, 0.17], [0.83, 0.83]]);
  line([[0.2, 0.09], [0.91, 0.09], [0.91, 0.8]]);
  for (const [bx, by, color] of [[0.02, 0.22, 'rgba(61,220,151,'], [0.78, 0.98, 'rgba(255,92,92,']] as const) {
    roundRect(ctx, X(bx), Y(by), size * 0.2, size * 0.2, size * 0.03);
    ctx.fillStyle = `${color}0.14)`;
    ctx.fill();
  }
  const r = size * 0.018;
  for (const w of wards) {
    const cx = X(w.x), cy = Y(w.y);
    const color = w.radiant ? C.pos : C.neg;
    if (w.obs) {
      ctx.beginPath();
      ctx.arc(cx, cy, w.mine ? r * 1.3 : r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (w.mine) { ctx.strokeStyle = C.accent; ctx.lineWidth = size * 0.006; ctx.stroke(); }
    } else {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = w.mine ? C.accent : color;
      ctx.lineWidth = size * 0.005;
      ctx.strokeRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
      ctx.restore();
    }
    if (w.dead) {
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = size * 0.004;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const toneColor = (t: Tone | undefined) => (t === 'pos' ? C.pos : t === 'neg' ? C.neg : t === 'accent' ? C.accent : t === 'muted' ? C.muted : C.ink);

function teamRow(ctx: CanvasRenderingContext2D, imgs: Map<number, HTMLImageElement | null>, heroes: Hero[], x: number, y: number, size: number, gap: number, color: string, highlight?: number | null) {
  heroes.slice(0, 5).forEach((h, i) => {
    const px = x + i * (size + gap);
    portrait(ctx, imgs.get(h.id) ?? null, h, px, y, size, size * 0.18);
    ctx.save();
    roundRect(ctx, px, y, size, size, size * 0.18);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(px, y + size - Math.max(4, size * 0.05), size, Math.max(4, size * 0.05));
    ctx.restore();
    if (h.id === highlight) {
      roundRect(ctx, px - 3, y - 3, size + 6, size + 6, size * 0.2);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 5;
      ctx.stroke();
    }
  });
}

function chart(ctx: CanvasRenderingContext2D, values: number[], x: number, y: number, w: number, h: number, topLabel: string, bottomLabel: string, fontSize: number) {
  const max = Math.max(1000, ...values.map(Math.abs));
  const mid = y + h / 2;
  const px = (i: number) => x + (i / Math.max(1, values.length - 1)) * w;
  const py = (v: number) => mid - (v / max) * (h / 2);
  roundRect(ctx, x - 16, y - 16, w + 32, h + 32, 18);
  ctx.fillStyle = C.s1;
  ctx.fill();
  for (const [sign, color] of [[1, 'rgba(61,220,151,0.28)'], [-1, 'rgba(255,92,92,0.28)']] as const) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, sign > 0 ? y : mid, w, h / 2);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(px(0), mid);
    values.forEach((v, i) => ctx.lineTo(px(i), py(v)));
    ctx.lineTo(px(values.length - 1), mid);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, mid);
  ctx.lineTo(x + w, mid);
  ctx.stroke();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
  ctx.stroke();
  ctx.font = `600 ${fontSize}px ${UI}`;
  ctx.fillStyle = C.pos;
  ctx.fillText(topLabel, x + 8, y + fontSize + 4);
  ctx.fillStyle = C.neg;
  ctx.fillText(bottomLabel, x + 8, y + h - 8);
}

function rowsBlock(ctx: CanvasRenderingContext2D, imgs: Map<number, HTMLImageElement | null>, rows: RecapCardRow[], x: number, y: number, w: number, rowH: number, gap: number) {
  rows.forEach((r, i) => {
    const ry = y + i * (rowH + gap);
    roundRect(ctx, x, ry, w, rowH, rowH * 0.18);
    ctx.fillStyle = C.s1;
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    const pad = rowH * 0.16;
    let tx = x + pad * 1.4;
    if (r.hero) {
      const ps = rowH - pad * 2;
      portrait(ctx, imgs.get(r.hero.id) ?? null, r.hero, x + pad, ry + pad, ps, ps * 0.16);
      tx = x + pad * 2 + ps;
    }
    let right = x + w - pad * 1.4;
    if (r.value) {
      ctx.font = `700 ${Math.round(rowH * 0.28)}px ${DISPLAY}`;
      const vw = ctx.measureText(r.value).width;
      ctx.fillStyle = toneColor(r.tone ?? 'accent');
      ctx.fillText(r.value, right - vw, ry + rowH / 2 + rowH * 0.1);
      right -= vw + pad;
    }
    const max = right - tx;
    ctx.font = `600 ${Math.round(rowH * 0.24)}px ${UI}`;
    ctx.fillStyle = C.ink;
    ctx.fillText(fit(ctx, r.title, max), tx, ry + (r.sub ? rowH * 0.44 : rowH * 0.58));
    if (r.sub) {
      ctx.font = `400 ${Math.round(rowH * 0.19)}px ${UI}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(fit(ctx, r.sub, max), tx, ry + rowH * 0.74);
    }
  });
}

function loadCorsImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Round avatar (or its letter) at x, y with a medal on its lower right. */
function avatarBadge(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, letter: string, medal: HTMLImageElement | null, x: number, y: number, size: number) {
  // no avatar and no letter (a hidden nickname): the medal alone
  if (!img && !letter) {
    if (medal) ctx.drawImage(medal, x, y, size, size);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, x, y, size, size);
  } else {
    ctx.fillStyle = C.s2;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = C.muted;
    ctx.font = `700 ${Math.round(size * 0.45)}px ${DISPLAY}`;
    const w = ctx.measureText(letter).width;
    ctx.fillText(letter, x + (size - w) / 2, y + size * 0.66);
  }
  ctx.restore();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = Math.max(2, size / 40);
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.stroke();
  if (medal) ctx.drawImage(medal, x + size * 0.58, y + size * 0.58, size * 0.56, size * 0.56);
}

export async function renderRecapCard(format: CardFormat, card: RecapCard): Promise<Blob> {
  const [W, H] = format === 'story' ? [1080, 1920] : [1200, 630];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  await Promise.all([document.fonts.load('700 40px Unbounded'), document.fonts.load('600 40px Inter')]).catch(() => undefined);
  const heroes = [...(card.teams?.top ?? []), ...(card.teams?.bottom ?? []), ...(card.rows ?? []).flatMap((r) => (r.hero ? [r.hero] : []))];
  const imgs = new Map<number, HTMLImageElement | null>();
  await Promise.all(heroes.map(async (h) => { if (!imgs.has(h.id)) imgs.set(h.id, await loadImage(localPortraitUrl(h))); }));
  const [avatarImg, medalImg] = card.avatar
    ? await Promise.all([card.avatar.src ? loadCorsImage(card.avatar.src) : Promise.resolve(null), card.avatar.medal ? loadImage(card.avatar.medal) : Promise.resolve(null)])
    : [null, null];

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.9, H * 0.08, 0, W * 0.9, H * 0.08, W * 0.7);
  glow.addColorStop(0, 'rgba(255,180,58,0.16)');
  glow.addColorStop(1, 'rgba(255,180,58,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  if (format === 'story') {
    const M = 80;
    const CW = W - M * 2;
    logo(ctx, M, 236, 46);
    if (card.avatar) avatarBadge(ctx, avatarImg, card.avatar.letter, medalImg, W - M - 170, 150, 170);
    kicker(ctx, card.kicker, M, 380, 30, CW);
    let y = 456 + headline(ctx, card.title, M, 456, CW, [58, 50, 44], 3) + 6;
    if (card.subtitle) {
      ctx.font = `400 32px ${UI}`;
      ctx.fillStyle = C.muted;
      y += 44 * wrap(ctx, card.subtitle, M, y, CW, 44, 2) + 40;
    }
    y = Math.max(y, 700);
    if (card.score) {
      score(ctx, card.score, W / 2, y + 90, 110);
      y += 170;
    }
    if (card.teams) {
      const gap = 22;
      const size = (CW - gap * 4) / 5;
      label(ctx, card.teams.topLabel, M, y, 26, card.teams.topWin ? C.pos : C.muted);
      teamRow(ctx, imgs, card.teams.top, M, y + 24, size, gap, C.pos, card.teams.highlight);
      y += 24 + size + 60;
      label(ctx, card.teams.bottomLabel, M, y, 26, card.teams.topWin ? C.muted : C.neg);
      teamRow(ctx, imgs, card.teams.bottom, M, y + 24, size, gap, C.neg, card.teams.highlight);
      y += 24 + size + 50;
    }
    if (card.chart) {
      chart(ctx, card.chart.values, M + 16, y + 16, CW - 32, 360, card.chart.topLabel, card.chart.bottomLabel, 26);
      y += 420;
    }
    if (card.map) {
      wardMap(ctx, card.map.wards, M, y, CW);
      y += CW + 30;
    }
    if (card.rows?.length) {
      const rowH = 120;
      const room = Math.floor((1640 - y) / (rowH + 16));
      rowsBlock(ctx, imgs, card.rows.slice(0, Math.max(0, room)), M, y, CW, rowH, 16);
    }
    ctx.font = `600 30px ${UI}`;
    ctx.fillStyle = C.accent;
    ctx.fillText(card.site, M, 1716);
    ctx.font = `400 24px ${UI}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(fit(ctx, card.footer, CW), M, 1756);
    ctx.fillText(card.notAffiliated, W - M - ctx.measureText(card.notAffiliated).width, 1716);
  } else {
    const M = 56;
    logo(ctx, M, 52, 30);
    if (card.avatar) avatarBadge(ctx, avatarImg, card.avatar.letter, medalImg, M + 520 - 96, 28, 96);
    kicker(ctx, card.kicker, M, 150, 18, 520);
    const th = headline(ctx, card.title, M, 200, 520, [34, 30, 26], 4);
    let ly = 200 + th + 4;
    if (card.subtitle) {
      ctx.font = `400 20px ${UI}`;
      ctx.fillStyle = C.muted;
      ly += 28 * wrap(ctx, card.subtitle, M, ly, 520, 28, 3) + 12;
    }
    if (card.score && ly < H - 160) score(ctx, card.score, M + 200, ly + 60, 64);
    ctx.font = `600 20px ${UI}`;
    ctx.fillStyle = C.accent;
    ctx.fillText(card.site, M, H - 56);
    ctx.font = `400 16px ${UI}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(fit(ctx, `${card.footer} · ${card.notAffiliated}`, 520), M, H - 28);

    const RX = 620;
    const RW = W - RX - M;
    let y = 64;
    if (card.teams) {
      const gap = 12;
      const size = (RW - gap * 4) / 5;
      label(ctx, card.teams.topLabel, RX, y, 16, card.teams.topWin ? C.pos : C.muted);
      teamRow(ctx, imgs, card.teams.top, RX, y + 14, size, gap, C.pos, card.teams.highlight);
      y += 14 + size + 40;
      label(ctx, card.teams.bottomLabel, RX, y, 16, card.teams.topWin ? C.muted : C.neg);
      teamRow(ctx, imgs, card.teams.bottom, RX, y + 14, size, gap, C.neg, card.teams.highlight);
      y += 14 + size + 30;
    }
    if (card.chart) {
      chart(ctx, card.chart.values, RX + 12, y + 12, RW - 24, card.teams ? H - y - 70 : 240, card.chart.topLabel, card.chart.bottomLabel, 16);
      y += (card.teams ? H - y - 70 : 240) + 40;
    }
    if (card.map) {
      wardMap(ctx, card.map.wards, RX + (RW - (H - 2 * y)) / 2, y, H - 2 * y);
      y = H;
    }
    if (card.rows?.length && y < H - 120) {
      const rowH = 84;
      const room = Math.floor((H - 40 - y) / (rowH + 10));
      rowsBlock(ctx, imgs, card.rows.slice(0, Math.max(0, room)), RX, y, RW, rowH, 10);
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('export failed'))), 'image/png'));
}

/** Phones: the system share sheet with the files; elsewhere they download. */
export async function deliverImages(files: File[], text: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files }) && window.matchMedia('(pointer: coarse)').matches) {
    try {
      await nav.share({ files, title: 'LASTPICK', text });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    await new Promise((r) => window.setTimeout(r, 250));
  }
  return 'saved';
}
