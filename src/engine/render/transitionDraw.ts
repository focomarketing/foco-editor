// Desenho dos efeitos de transição no canvas 2D (fatias, separação de cor, máscaras, flashes e
// luzes) e a montagem das camadas com transição. Usado pelo compositor (preview e export).

import type { Clip, Crop, Project } from '../../core/types';
import { sourceEnd } from '../../core/clipTime';
import { transformAt } from '../../core/animation';
import { transitionsAt } from './transitions';
import type { MaskSpec, OverlaySpec } from './transitions';
import type { DrawLayer } from './Compositor';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawSlices(ctx: Ctx2D, source: CanvasImageSource, srcW: number, srcH: number, cr: Crop, keepW: number, keepH: number, x0: number, y0: number, dw: number, dh: number, amount: number, seed: number, W: number) {
  const n = 9;
  for (let i = 0; i < n; i++) {
    const r = Math.sin((seed + 1) * 91.7 + i * 17.3) * 43758.5;
    const shift = (r - Math.floor(r) - 0.5) * (i % 3 === 0 ? 2 : 0.3) * amount * 0.12 * W;
    const sy = cr.top * srcH + (keepH * srcH * i) / n;
    const dy = y0 + cr.top * dh + (keepH * dh * i) / n;
    ctx.drawImage(source, cr.left * srcW, sy, keepW * srcW, (keepH * srcH) / n, x0 + cr.left * dw + shift, dy, keepW * dw, (keepH * dh) / n + 0.5);
  }
}

let tint: OffscreenCanvas | null = null;
/** Separação de cor: cópias vermelha e azul deslocadas, somadas por cima ("screen"). */
export function rgbSplit(ctx: Ctx2D, source: CanvasImageSource, srcW: number, srcH: number, x0: number, y0: number, dw: number, dh: number, px: number) {
  if (typeof OffscreenCanvas === 'undefined') return;
  const w = Math.max(2, Math.min(640, Math.round(Math.abs(dw))));
  const h = Math.max(2, Math.round((w * srcH) / Math.max(1, srcW)));
  tint ??= new OffscreenCanvas(w, h);
  if (tint.width !== w || tint.height !== h) {
    tint.width = w;
    tint.height = h;
  }
  const t = tint.getContext('2d')!;
  const prevAlpha = ctx.globalAlpha;
  for (const [color, off] of [['#ff0000', -px], ['#0000ff', px]] as const) {
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, w, h);
    t.drawImage(source, 0, 0, srcW, srcH, 0, 0, w, h);
    t.globalCompositeOperation = 'multiply';
    t.fillStyle = color;
    t.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.55 * prevAlpha;
    ctx.drawImage(tint, x0 + off, y0, dw, dh);
  }
  ctx.globalAlpha = prevAlpha;
}

/** Região revelada da máscara (em pixels do quadro). */
export function maskPath(ctx: Ctx2D, W: number, H: number, m: MaskSpec) {
  const p = Math.max(0, Math.min(1, m.progress));
  ctx.beginPath();
  switch (m.shape) {
    case 'circle':
      ctx.arc(W / 2, H / 2, (p * Math.hypot(W, H)) / 2 + 0.5, 0, Math.PI * 2);
      break;
    case 'diamond': {
      const r = p * (W + H) * 0.55;
      ctx.moveTo(W / 2, H / 2 - r);
      ctx.lineTo(W / 2 + r, H / 2);
      ctx.lineTo(W / 2, H / 2 + r);
      ctx.lineTo(W / 2 - r, H / 2);
      break;
    }
    case 'bars': {
      const n = 6;
      for (let i = 0; i < n; i++) ctx.rect((W / n) * i, 0, (W / n) * p, H);
      break;
    }
    case 'diagonal': {
      const x = p * (W + H) * 1.05;
      ctx.moveTo(0, 0);
      ctx.lineTo(x, 0);
      ctx.lineTo(x - H, H);
      ctx.lineTo(0, H);
      break;
    }
    case 'liquid': {
      const y = p * H * 1.15;
      ctx.moveTo(0, 0);
      ctx.lineTo(W, 0);
      for (let i = 0; i <= 24; i++) ctx.lineTo(W - (W * i) / 24, y + Math.sin(i * 0.9 + p * 6) * H * 0.05 * (1 - p * 0.5));
      break;
    }
    default: {
      // linear e band: revela a partir da borda oposta à direção
      const [x, y, w, h] = edgeRect(W, H, m.direction, p);
      ctx.rect(x, y, w, h);
    }
  }
}

function edgeRect(W: number, H: number, dir: MaskSpec['direction'], p: number): [number, number, number, number] {
  switch (dir) {
    case 'left':
      return [W * (1 - p), 0, W * p, H];
    case 'right':
      return [0, 0, W * p, H];
    case 'up':
      return [0, H * (1 - p), W, H * p];
    case 'down':
      return [0, 0, W, H * p];
  }
}

/** Faixa colorida na borda da máscara (objeto passando / cor da marca). */
export function maskBand(ctx: Ctx2D, W: number, H: number, m: MaskSpec) {
  const p = Math.max(0, Math.min(1, m.progress));
  if (p <= 0 || p >= 1 || !m.band) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = m.band;
  const horizontal = m.direction === 'left' || m.direction === 'right';
  const size = (horizontal ? W : H) * (m.shape === 'band' ? 0.22 : 0.025);
  if (m.shape === 'diagonal') {
    const x = p * (W + H) * 1.05;
    ctx.beginPath();
    ctx.moveTo(x - size, 0);
    ctx.lineTo(x + size, 0);
    ctx.lineTo(x + size - H, H);
    ctx.lineTo(x - size - H, H);
    ctx.fill();
  } else {
    const edge = m.direction === 'left' ? W * (1 - p) : m.direction === 'right' ? W * p : m.direction === 'up' ? H * (1 - p) : H * p;
    if (horizontal) ctx.fillRect(edge - size / 2, 0, size, H);
    else ctx.fillRect(0, edge - size / 2, W, size);
  }
  ctx.restore();
}

export function drawOverlay(ctx: Ctx2D, W: number, H: number, o: OverlaySpec) {
  if (o.alpha <= 0.002) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.min(1, o.alpha);
  if (o.kind === 'solid') {
    ctx.fillStyle = o.color;
    ctx.fillRect(0, 0, W, H);
  } else if (o.kind === 'sweep') {
    const x = (o.pos ?? 0.5) * (W + H * 0.6) - H * 0.3;
    const g = ctx.createLinearGradient(x - W * 0.16, 0, x + W * 0.16, H * 0.35);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, o.color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    const cx = W * (0.15 + 0.7 * (o.pos ?? 0.5));
    const g = ctx.createRadialGradient(cx, H * 0.3, 0, cx, H * 0.3, Math.max(W, H) * 0.8);
    g.addColorStop(0, o.color);
    g.addColorStop(0.45, `${o.color}88`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

// --- transições na lista de camadas (preview e export usam a mesma função) ----------------------

const tails = new Map<string, { canvas: OffscreenCanvas; width: number; height: number }>();

/** Guarda o quadro atual de um clipe (vira a "cauda" por baixo do clipe seguinte). */
function captureTail(clipId: string, source: CanvasImageSource, width: number, height: number) {
  if (typeof OffscreenCanvas === 'undefined') return;
  const w = Math.max(2, Math.min(1920, Math.round(width)));
  const h = Math.max(2, Math.round((w * height) / Math.max(1, width)));
  let entry = tails.get(clipId);
  if (!entry || entry.canvas.width !== w || entry.canvas.height !== h) {
    entry = { canvas: new OffscreenCanvas(w, h), width, height };
    tails.set(clipId, entry);
    if (tails.size > 12) tails.delete(tails.keys().next().value!); // poucas caudas vivas por vez
  }
  entry.canvas.getContext('2d')!.drawImage(source, 0, 0, w, h);
}

export type FrameSource = { source: CanvasImageSource & TexImageSource; width: number; height: number };

/**
 * Aplica as transições do instante t às camadas montadas (de baixo para cima): efeito em cada
 * clipe, cauda do clipe anterior por baixo do que entra e flashes/luzes por cima. `fallback` dá um
 * quadro do fim do clipe anterior quando a cauda ainda não foi capturada (preview que pulou
 * direto para dentro da transição).
 */
export function applyTransitions(p: Project, t: number, layers: DrawLayer[], fallback?: (clip: Clip) => FrameSource | null): DrawLayer[] {
  const tf = transitionsAt(p, t);
  if (!tf.fx.size && !tf.tails.length && !tf.overlays.length && !tf.capture.size) return layers;
  const out: DrawLayer[] = [];
  for (const l of layers) {
    if (l.kind !== 'media' || !l.clipId) {
      out.push(l);
      continue;
    }
    if (tf.capture.has(l.clipId)) captureTail(l.clipId, l.source, l.width, l.height);
    for (const tail of tf.tails.filter((x) => x.under === l.clipId)) {
      const cached = tails.get(tail.clip.id);
      const src: FrameSource | null = cached ? { source: cached.canvas, width: cached.width, height: cached.height } : (fallback?.(tail.clip) ?? null);
      if (src) out.push({ kind: 'media', ...src, transform: transformAt(tail.clip, sourceEnd(tail.clip) - 1e-3), color: tail.clip.color, crop: tail.clip.crop, blendMode: tail.clip.blendMode, fx: tail.fx });
    }
    const fx = tf.fx.get(l.clipId);
    out.push(fx ? { ...l, fx } : l);
    for (const o of tf.overlays.filter((x) => x.after === l.clipId)) out.push({ kind: 'overlay', overlay: o.overlay });
  }
  return out;
}
