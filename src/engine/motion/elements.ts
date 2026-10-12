// Elementos (Fase 5): grupos de camadas — formas, texto e partículas — desenhados pelo
// compositor (preview e export). Tudo é função do tempo do clipe e de uma semente fixa:
// o mesmo instante gera sempre o mesmo quadro. O clipe (transform + keyframes) move o grupo.

import type { Clip, ElementAnim, ElementLayer, ParticlePreset, ParticleSpec } from '../../core/types';
import { ease, transformAt } from '../../core/animation';
import { speedOf } from '../../core/clipTime';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const backOut = (k: number) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;

interface Pose {
  alpha: number;
  scale: number;
  dx: number;
  dy: number;
  rot: number;
  /** 0..1: quanto do traço/da largura aparece (draw/wipe). */
  reveal: number;
  wipe: boolean;
}
const REST: Pose = { alpha: 1, scale: 1, dx: 0, dy: 0, rot: 0, reveal: 1, wipe: false };

/** Pose de entrada (k 0→1) ou de saída (k 1→0 perto do fim); `dist` = deslocamento dos slides (px). */
function animPose(anim: ElementAnim, k: number, dist: number, exit: boolean): Pose {
  if (anim === 'none' || k >= 1) return REST;
  const e = ease('easeOut', k);
  switch (anim) {
    case 'fade':
      return { ...REST, alpha: e };
    case 'pop':
      return { ...REST, alpha: clamp01(k * 3), scale: exit ? 0.6 + 0.4 * e : Math.max(0, backOut(k)) };
    case 'slideLeft':
      return { ...REST, alpha: e, dx: (exit ? -1 : 1) * dist * (1 - e) };
    case 'slideRight':
      return { ...REST, alpha: e, dx: (exit ? 1 : -1) * dist * (1 - e) };
    case 'slideUp':
      return { ...REST, alpha: e, dy: (exit ? -1 : 1) * dist * (1 - e) };
    case 'slideDown':
      return { ...REST, alpha: e, dy: (exit ? 1 : -1) * dist * (1 - e) };
    case 'draw':
      return { ...REST, reveal: ease('easeInOut', k) };
    case 'wipe':
      return { ...REST, reveal: ease('easeInOut', k), wipe: true };
    case 'spin':
      return { ...REST, alpha: e, scale: e, rot: (exit ? 180 : -180) * (1 - e) };
  }
}

/** Movimento contínuo (t = segundos desde que a camada entrou). */
function loopPose(l: ElementLayer, t: number, base: number): Pose {
  const sp = l.loopSpeed ?? 1;
  switch (l.loop ?? 'none') {
    case 'none':
      return REST;
    case 'pulse':
      return { ...REST, scale: 1 + 0.06 * Math.sin(t * Math.PI * 2 * 1.1 * sp) };
    case 'rotate':
      return { ...REST, rot: t * 60 * sp };
    case 'float':
      return { ...REST, dy: Math.sin(t * Math.PI * 2 * 0.5 * sp) * base * 0.015 };
    case 'blink':
      return { ...REST, alpha: 0.55 + 0.45 * Math.cos(t * Math.PI * 2 * 1.2 * sp) };
    case 'wiggle':
      return { ...REST, rot: Math.sin(t * Math.PI * 2 * 3 * sp) * 6 * Math.max(0, Math.sin(t * Math.PI * 0.8 * sp)) };
  }
}

// --- formas ---------------------------------------------------------------------------

function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function starPoints(n: number, rx: number, ry: number, inner: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? inner : 1;
    pts.push([Math.cos(a) * rx * r, Math.sin(a) * ry * r]);
  }
  return pts;
}
function polygonPoints(n: number, rx: number, ry: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [Math.cos(a) * rx, Math.sin(a) * ry] as [number, number];
  });
}
const perimeter = (pts: [number, number][]) => pts.reduce((s, p, i) => s + Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]), 0);

/** Monta o caminho da forma (centrada em 0,0) e devolve o comprimento do traço (para "draw"). */
function shapePath(ctx: Ctx2D, l: ElementLayer, w: number, h: number): number {
  ctx.beginPath();
  switch (l.kind) {
    case 'rect': {
      const r = (l.radius ?? 0) * Math.min(w, h);
      roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
      return 2 * (w + h);
    }
    case 'ellipse':
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      return Math.PI * (3 * (w + h) / 2 - Math.sqrt(((3 * w) / 2 + h / 2) * (w / 2 + (3 * h) / 2)));
    case 'line':
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      return w;
    case 'arrow': {
      const head = Math.min(h, w * 0.4);
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      ctx.moveTo(w / 2 - head, -head * 0.7);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w / 2 - head, head * 0.7);
      return w + head * 2.5;
    }
    case 'star':
    case 'polygon': {
      const pts = l.kind === 'star' ? starPoints(l.points ?? 5, w / 2, h / 2, l.innerRatio ?? 0.45) : polygonPoints(l.points ?? 6, w / 2, h / 2);
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      return perimeter(pts);
    }
    default:
      return 0;
  }
}

function paint(ctx: Ctx2D, l: ElementLayer, w: number, base: number, reveal: number, len: number) {
  const open = l.kind === 'line' || l.kind === 'arrow';
  const fill = open ? null : l.fill;
  // linhas e setas usam a cor de preenchimento como traço quando não há contorno
  const stroke = l.stroke ?? (open ? l.fill : null);
  const lw = Math.max(1, l.strokeWidth * base || (open ? base * 0.012 : 0));
  if (fill) {
    if (l.fill2) {
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, fill);
      g.addColorStop(1, l.fill2);
      ctx.fillStyle = g;
    } else ctx.fillStyle = fill;
    const a = ctx.globalAlpha;
    if (reveal < 1) ctx.globalAlpha = a * (stroke ? reveal * reveal : reveal); // "draw": preenchimento chega junto
    ctx.fill();
    ctx.globalAlpha = a;
    ctx.shadowColor = 'transparent'; // a sombra fica só no preenchimento
  }
  if (stroke && (l.strokeWidth > 0 || open)) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (reveal < 1) {
      ctx.setLineDash([len * reveal, len + 1]);
      ctx.lineDashOffset = 0;
      ctx.stroke();
      ctx.setLineDash([]);
    } else ctx.stroke();
  }
}

function drawText(ctx: Ctx2D, l: ElementLayer, w: number, h: number, base: number) {
  const text = l.text ?? '';
  if (!text) return;
  ctx.font = `${l.fontWeight ?? 800} ${h}px ${l.fontFamily ?? '"Segoe UI", Arial, sans-serif'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  if (tw > w && tw > 0) ctx.scale(w / tw, w / tw); // cabe na largura da camada
  if (l.stroke && l.strokeWidth > 0) {
    ctx.strokeStyle = l.stroke;
    ctx.lineWidth = l.strokeWidth * base * 2;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, 0, 0);
  }
  if (l.fill) {
    if (l.fill2) {
      const g = ctx.createLinearGradient(-tw / 2, 0, tw / 2, 0);
      g.addColorStop(0, l.fill);
      g.addColorStop(1, l.fill2);
      ctx.fillStyle = g;
    } else ctx.fillStyle = l.fill;
    ctx.fillText(text, 0, 0);
  }
}

// --- partículas -------------------------------------------------------------------------

/** Gerador determinístico (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Comportamento base de cada preset: vida (s), tamanho (fração do lado menor), sentido. */
export const PARTICLE_PRESETS: Record<ParticlePreset, { label: string; life: number; size: number; colors: string[] }> = {
  confetti: { label: 'Confete', life: 3.2, size: 0.016, colors: ['#ff4d6d', '#ffd400', '#3dd5f3', '#7cff6b', '#b388ff'] },
  snow: { label: 'Neve', life: 6, size: 0.008, colors: ['#ffffff'] },
  sparkles: { label: 'Brilhos', life: 1.6, size: 0.02, colors: ['#fff6c2', '#ffffff'] },
  bubbles: { label: 'Bolhas', life: 4.5, size: 0.022, colors: ['#bfe9ff'] },
  embers: { label: 'Faíscas', life: 2.6, size: 0.006, colors: ['#ffb347', '#ff6a00', '#ffd27a'] },
  hearts: { label: 'Corações', life: 3, size: 0.026, colors: ['#ff4d6d', '#ff85a1'] },
};

function heartPath(ctx: Ctx2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
  ctx.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
  ctx.closePath();
}

function sparklePath(ctx: Ctx2D, s: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const r = i % 2 ? s * 0.22 : s;
    if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

/** Desenha as partículas na caixa (bx, by, bw, bh em px) no tempo t (s). */
export function drawParticles(ctx: Ctx2D, spec: ParticleSpec, bx: number, by: number, bw: number, bh: number, base: number, t: number) {
  const pr = PARTICLE_PRESETS[spec.preset];
  const colors = spec.colors.length ? spec.colors : pr.colors;
  const life = pr.life / Math.max(0.1, spec.speed);
  const count = Math.max(0, Math.min(600, Math.round(spec.count)));
  for (let i = 0; i < count; i++) {
    const r = rng(spec.seed * 7919 + i * 104729);
    const r0 = r(), r1 = r(), r2 = r(), r3 = r(), r4 = r(), r5 = r();
    // cada partícula renasce em ciclos de `life` segundos, com fase própria (a tela já começa cheia)
    const cycle = (t + r0 * life) / life;
    const k = cycle - Math.floor(cycle);
    const age = k * life;
    const gen = Math.floor(cycle); // nova posição a cada ciclo
    const g = rng(spec.seed * 31 + i * 977 + gen * 7);
    const gx = g();
    const size = pr.size * base * spec.size * (0.6 + r1 * 0.8);
    const color = colors[Math.floor(r2 * colors.length) % colors.length];
    let x = bx + gx * bw;
    let y = by;
    let rot = 0;
    let alpha = 1;
    ctx.save();
    switch (spec.preset) {
      case 'confetti': {
        y = by - size * 2 + k * (bh + size * 4);
        x += Math.sin(age * (2 + r3 * 2) + r4 * 6) * bw * 0.03;
        rot = age * (3 + r5 * 5) + r4 * 6;
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.scale(1, Math.cos(age * (4 + r3 * 4))); // gira no ar
        ctx.fillStyle = color;
        ctx.fillRect(-size / 2, -size * 0.3, size, size * 0.6);
        break;
      }
      case 'snow': {
        y = by - size + k * (bh + size * 2);
        x += Math.sin(age * (0.8 + r3) + r4 * 6) * bw * 0.025;
        ctx.globalAlpha *= 0.55 + r5 * 0.45;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'sparkles': {
        y = by + g() * bh;
        alpha = Math.sin(k * Math.PI) ** 2;
        ctx.globalAlpha *= alpha;
        ctx.translate(x, y);
        ctx.rotate(r4 * Math.PI);
        ctx.scale(0.3 + 0.7 * alpha, 0.3 + 0.7 * alpha);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = size * 0.8;
        sparklePath(ctx, size);
        ctx.fill();
        break;
      }
      case 'bubbles': {
        y = by + bh + size - k * (bh + size * 2);
        x += Math.sin(age * (1.2 + r3) + r4 * 6) * bw * 0.03;
        alpha = Math.min(1, k * 6) * (k > 0.92 ? (1 - k) / 0.08 : 1);
        ctx.globalAlpha *= alpha * 0.85;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, size * 0.12);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha *= 0.5;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x - size * 0.35, y - size * 0.35, size * 0.18, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'embers': {
        y = by + bh - k * bh * (0.6 + r3 * 0.4);
        x += Math.sin(age * (2 + r4 * 2) + r5 * 6) * bw * 0.02;
        alpha = (1 - k) * (0.6 + 0.4 * Math.sin(age * 20 + r4 * 10));
        ctx.globalAlpha *= clamp01(alpha);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = size * 3;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'hearts': {
        y = by + bh - k * bh;
        x += Math.sin(age * (1.5 + r3) + r4 * 6) * bw * 0.03;
        alpha = Math.min(1, k * 5) * (1 - k);
        ctx.globalAlpha *= alpha;
        ctx.translate(x, y);
        ctx.rotate((r5 - 0.5) * 0.6);
        ctx.fillStyle = color;
        heartPath(ctx, size);
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  }
}

// --- elemento -------------------------------------------------------------------------

/** Desenha uma camada no quadro W×H no tempo local t (s desde o início do clipe). */
export function drawLayer(ctx: Ctx2D, W: number, H: number, l: ElementLayer, t: number, duration: number) {
  const base = Math.min(W, H);
  const delay = l.delay ?? 0;
  const dur = Math.max(0.01, l.animDuration ?? 0.4);
  if ((l.animIn ?? 'none') !== 'none' && t < delay) return;
  const dist = base * 0.12;
  const pin = animPose(l.animIn ?? 'none', clamp01((t - delay) / dur), dist, false);
  const pout = animPose(l.animOut ?? 'none', clamp01((duration - t) / dur), dist, true);
  const loop = loopPose(l, Math.max(0, t - delay - ((l.animIn ?? 'none') !== 'none' ? dur : 0)), base);
  const alpha = l.opacity * pin.alpha * pout.alpha * loop.alpha;
  if (alpha <= 0.002) return;

  ctx.save();
  ctx.globalAlpha *= clamp01(alpha);
  if (l.kind === 'particles') {
    if (!l.particles) return void ctx.restore();
    const bw = l.w * W;
    const bh = l.h * H;
    ctx.translate(pin.dx + pout.dx, pin.dy + pout.dy);
    drawParticles(ctx, l.particles, l.x * W - bw / 2, l.y * H - bh / 2, bw, bh, base, t);
    return void ctx.restore();
  }
  const w = l.w * (l.frameUnits ? W : base);
  const h = l.h * (l.frameUnits ? H : base);
  ctx.translate(l.x * W + pin.dx + pout.dx + loop.dx, l.y * H + pin.dy + pout.dy + loop.dy);
  const rot = l.rotation + pin.rot + pout.rot + loop.rot;
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  const s = pin.scale * pout.scale * loop.scale;
  if (s !== 1) ctx.scale(s, s);
  const reveal = Math.min(pin.reveal, pout.reveal);
  const wipe = pin.wipe || pout.wipe;
  if (wipe && reveal < 1) {
    const span = Math.max(w, h) * 1.2;
    ctx.beginPath();
    ctx.rect(-span / 2, -span / 2, span * reveal, span);
    ctx.clip();
  }
  if (l.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = base * 0.03;
    ctx.shadowOffsetY = base * 0.008;
  }
  if (l.kind === 'text') drawText(ctx, l, w, h, base);
  else paint(ctx, l, w, base, wipe ? 1 : reveal, shapePath(ctx, l, w, h));
  ctx.restore();
}

export function drawElement(ctx: Ctx2D, W: number, H: number, clip: Clip, sourceTime: number) {
  const el = clip.element;
  if (!el) return;
  const t = (sourceTime - clip.sourceIn) / speedOf(clip);
  const tr = transformAt(clip, sourceTime);
  if (tr.opacity <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = clamp01(tr.opacity);
  // o grupo inteiro se move/gira/escala em torno do centro do quadro (posição = deslocamento)
  ctx.translate(W / 2 + tr.x * W, H / 2 + tr.y * H);
  if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
  if (tr.scale !== 1) ctx.scale(tr.scale, tr.scale);
  ctx.translate(-W / 2, -H / 2);
  for (const l of el.layers) drawLayer(ctx, W, H, l, t, clip.duration);
  ctx.restore();
}
