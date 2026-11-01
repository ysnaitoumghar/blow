export interface Sampled {
  x: Float32Array;
  y: Float32Array;
  /** filled area in CSS px² */
  area: number;
  minX: number;
  maxX: number;
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export const isArabic = (s: string) => ARABIC_RE.test(s);

const LATIN =
  '800 {s}px ui-rounded, "SF Pro Rounded", "Avenir Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const ARABIC =
  '700 {s}px "Geeza Pro", "Noto Naskh Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif';

let cv: HTMLCanvasElement | null = null;

/** Split words into `L` contiguous lines minimising the widest line. */
function bestSplit(widths: number[], space: number, L: number) {
  const n = widths.length;
  const pre = [0];
  for (const w of widths) pre.push(pre[pre.length - 1] + w);
  const gw = (i: number, j: number) => pre[j] - pre[i] + space * (j - i - 1);
  const rec = (i: number, l: number): { cost: number; cuts: number[] } => {
    if (l === 1) return { cost: gw(i, n), cuts: [n] };
    let best = { cost: Infinity, cuts: [] as number[] };
    for (let j = i + 1; j <= n - (l - 1); j++) {
      const r = rec(j, l - 1);
      const cost = Math.max(gw(i, j), r.cost);
      if (cost < best.cost) best = { cost, cuts: [j, ...r.cuts] };
    }
    return best;
  };
  return rec(0, L);
}

export function sampleText(text: string, W: number, H: number, count: number): Sampled {
  const arabic = isArabic(text);
  const portrait = H >= W;
  const boxW = W * (portrait ? 0.88 : 0.8);
  const boxH = H * (portrait ? 0.4 : 0.52);
  const cy = H * (portrait ? 0.4 : 0.44);
  const fontOf = (s: number) => (arabic ? ARABIC : LATIN).replace('{s}', String(s));

  const sc = Math.min(1, 1100 / Math.max(W, H));
  const cw = Math.max(1, Math.round(W * sc));
  const ch = Math.max(1, Math.round(H * sc));
  cv ??= document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, cw, ch);

  // --- layout (CSS px) ---
  ctx.font = fontOf(100);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const widths = words.map((w) => ctx.measureText(w).width);
  const space = ctx.measureText(' ').width;
  const lh = arabic ? 1.35 : 1.08;
  const maxSize = Math.min(W, H) * 0.55;
  let best = { size: 0, lines: [words.join(' ')] };
  for (let L = 1; L <= Math.min(words.length, 4); L++) {
    const { cost, cuts } = bestSplit(widths, space, L);
    const size = Math.min((100 * boxW) / Math.max(cost, 1), boxH / (L * lh), maxSize);
    if (best.size === 0 || size > best.size * 1.12) {
      const lines: string[] = [];
      let from = 0;
      for (const c of cuts) {
        lines.push(words.slice(from, c).join(' '));
        from = c;
      }
      best = { size, lines };
    }
  }

  ctx.save();
  ctx.scale(sc, sc);
  ctx.font = fontOf(Math.round(best.size));
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  (ctx as CanvasRenderingContext2D & { direction: string }).direction = arabic ? 'rtl' : 'ltr';
  best.lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, cy + (i - (best.lines.length - 1) / 2) * best.size * lh);
  });
  ctx.restore();

  // --- sample ---
  const data = ctx.getImageData(0, 0, cw, ch).data;
  const filledIdx: number[] = [];
  for (let i = 3, p = 0; i < data.length; i += 4, p++) if (data[i] > 110) filledIdx.push(p);
  const filled = filledIdx.length;

  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  if (filled === 0) {
    for (let i = 0; i < count; i++) {
      xs[i] = W / 2;
      ys[i] = cy;
    }
    return { x: xs, y: ys, area: 1, minX: W / 2 - 1, maxX: W / 2 + 1 };
  }

  const step = Math.max(1, Math.sqrt(filled / count));
  const px: number[] = [];
  const py: number[] = [];
  for (let gy = 0; gy < ch; gy += step) {
    for (let gx = 0; gx < cw; gx += step) {
      const x = gx + Math.random() * step;
      const y = gy + Math.random() * step;
      const xi = x | 0;
      const yi = y | 0;
      if (xi < cw && yi < ch && data[(yi * cw + xi) * 4 + 3] > 110) {
        px.push(x);
        py.push(y);
      }
    }
  }
  while (px.length < count) {
    const p = filledIdx[(Math.random() * filled) | 0];
    px.push((p % cw) + Math.random());
    py.push(((p / cw) | 0) + Math.random());
  }
  // Fisher-Yates so that any prefix is a uniform subset of the word
  for (let i = px.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [px[i], px[j]] = [px[j], px[i]];
    [py[i], py[j]] = [py[j], py[i]];
  }
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < count; i++) {
    xs[i] = px[i] / sc;
    ys[i] = py[i] / sc;
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
  }
  return { x: xs, y: ys, area: filled / (sc * sc), minX, maxX };
}
