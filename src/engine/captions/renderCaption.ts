// Desenho de legendas no canvas. Usado pelo Compositor (preview e export) e pelas prévias da
// galeria de estilos. Animações dependem só do tempo: o mesmo quadro sai igual no preview e no export.

import type { CaptionAnim, CaptionStyle, CaptionWordAnim, Clip, TranscriptWord } from '../../core/types';
import { transformAt } from '../../core/animation';
import { sourceEnd } from '../../core/clipTime';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Duração da animação de cada palavra (s). */
const WORD_ANIM_TIME = 0.16;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (k: number) => 1 - (1 - k) ** 3;
/** Passa um pouco do ponto e volta (pop/bounce). */
const backOut = (k: number, s = 1.70158) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2;

export const wordAnimOf = (s: CaptionStyle): CaptionWordAnim => s.wordAnim ?? (s.pop ? 'pop' : 'none');

interface Pose {
  alpha: number;
  scale: number;
  dx: number;
  dy: number;
  blur: number;
}
const REST: Pose = { alpha: 1, scale: 1, dx: 0, dy: 0, blur: 0 };

/** Pose do bloco na entrada (k: 0 → 1) ou na saída (k: 1 → 0 conforme o fim se aproxima). */
function blockPose(anim: CaptionAnim, k: number, fontPx: number, exit: boolean): Pose {
  if (anim === 'none' || k >= 1) return REST;
  const e = easeOut(k);
  switch (anim) {
    case 'fade':
      return { ...REST, alpha: e };
    case 'pop':
      return { ...REST, alpha: Math.min(1, k * 2), scale: exit ? 0.85 + 0.15 * e : 0.55 + 0.45 * backOut(k) };
    case 'zoom':
      return { ...REST, alpha: e, scale: 1 + 0.35 * (1 - e) };
    case 'slideUp':
      return { ...REST, alpha: e, dy: (exit ? -1 : 1) * fontPx * 0.7 * (1 - e) };
    case 'slideDown':
      return { ...REST, alpha: e, dy: (exit ? 1 : -1) * fontPx * 0.7 * (1 - e) };
    case 'blur':
      return { ...REST, alpha: e, blur: fontPx * 0.25 * (1 - e) };
  }
}

/** Pose de uma palavra `dt` segundos depois de começar. */
function wordPose(anim: CaptionWordAnim, dt: number, fontPx: number): Pose {
  if (anim === 'none' || dt < 0) return REST;
  const k = clamp01(dt / WORD_ANIM_TIME);
  if (k >= 1 && anim !== 'shake') return REST;
  switch (anim) {
    case 'pop':
      return { ...REST, scale: 1 + 0.22 * (1 - k) * (1 - k) };
    case 'bounce':
      return { ...REST, scale: 0.6 + 0.4 * backOut(k, 3) };
    case 'rise':
      return { ...REST, alpha: easeOut(k), dy: fontPx * 0.35 * (1 - easeOut(k)) };
    case 'fade':
      return { ...REST, alpha: easeOut(k) };
    case 'shake': {
      const kk = clamp01(dt / (WORD_ANIM_TIME * 1.6));
      return { ...REST, dx: Math.sin(dt * 70) * fontPx * 0.06 * (1 - kk) };
    }
  }
}

/**
 * @param time tempo "de origem" dentro do clipe (sourceIn + deslocamento na timeline)
 */
export function drawCaption(ctx: Ctx2D, W: number, H: number, clip: Clip, time: number) {
  const cap = clip.caption;
  if (!cap) return;
  const s = cap.style;
  const visible = cap.words.filter((w) => w.end > clip.sourceIn && w.start < sourceEnd(clip));
  if (!visible.length) return;

  // Palavra atual: a que está tocando, ou a última que já começou.
  let current = -1;
  for (let i = 0; i < visible.length; i++) if (visible[i].start <= time) current = i;

  let words: TranscriptWord[] = visible;
  let currentIdx = current;
  if (s.mode === 'word') {
    if (current < 0) return;
    words = [visible[current]];
    currentIdx = 0;
  }
  // reveal: o bloco se monta com o tamanho final (sem pular), mas só as palavras já faladas aparecem
  const shown = (i: number) => s.mode !== 'reveal' || i <= currentIdx;
  if (s.mode === 'reveal' && current < 0) return;

  const tr = transformAt(clip, time);
  const fontPx = Math.max(6, s.fontSize * Math.min(W, H) * tr.scale);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${s.fontWeight} ${fontPx}px ${s.fontFamily}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(s.letterSpacing ?? 0) * fontPx}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';

  const texts = words.map((w) => (s.uppercase ? w.text.toLocaleUpperCase('pt-BR') : w.text));
  const space = ctx.measureText(' ').width;
  const widths = texts.map((t) => ctx.measureText(t).width);
  const maxWidth = W * (s.maxWidth ?? 0.86);

  // Quebra em linhas.
  const lines: number[][] = [[]];
  let lineW = 0;
  texts.forEach((_, i) => {
    const add = (lines.at(-1)!.length ? space : 0) + widths[i];
    if (lines.at(-1)!.length && lineW + add > maxWidth) {
      lines.push([i]);
      lineW = widths[i];
    } else {
      lines.at(-1)!.push(i);
      lineW += add;
    }
  });
  const lineWidth = (l: number[]) => l.reduce((acc, i, k) => acc + widths[i] + (k ? space : 0), 0);
  const lineH = fontPx * (s.lineHeight ?? 1.18);
  const cx = W / 2 + tr.x * W;
  const cy = s.y * H + tr.y * H;
  const top = cy - (lines.length * lineH) / 2;

  // entrada/saída do bloco (no modo "uma palavra por vez", cada palavra é um bloco)
  const dur = Math.max(0.01, s.animDuration ?? 0.18);
  const blockStart = s.mode === 'word' ? Math.max(clip.sourceIn, words[0].start) : clip.sourceIn;
  const blockEnd = s.mode === 'word' ? Math.min(sourceEnd(clip), visible[current + 1]?.start ?? sourceEnd(clip)) : sourceEnd(clip);
  const pin = blockPose(s.animIn ?? 'none', clamp01((time - blockStart) / dur), fontPx, false);
  const pout = blockPose(s.animOut ?? 'none', clamp01((blockEnd - time) / dur), fontPx, true);
  const block: Pose = { alpha: pin.alpha * pout.alpha, scale: pin.scale * pout.scale, dx: pin.dx + pout.dx, dy: pin.dy + pout.dy, blur: pin.blur + pout.blur };
  ctx.globalAlpha = clamp01(tr.opacity) * block.alpha;
  if (block.alpha <= 0.001) return void ctx.restore();
  ctx.translate(cx + block.dx, cy + block.dy);
  ctx.scale(block.scale, block.scale);
  ctx.translate(-cx, -cy);
  if (block.blur > 0.3 && 'filter' in ctx) ctx.filter = `blur(${block.blur.toFixed(1)}px)`;

  if (s.background) {
    const padX = fontPx * (s.backgroundPadding ?? 0.45);
    const padY = fontPx * (s.backgroundPadding ?? 0.45) * 0.45;
    const bw = Math.max(...lines.map(lineWidth)) + padX * 2;
    const bh = lines.length * lineH + padY * 2;
    ctx.fillStyle = s.background;
    roundRect(ctx, cx - bw / 2, top - padY, bw, bh, fontPx * (s.backgroundRadius ?? 0.25));
    ctx.fill();
  }

  const anim = wordAnimOf(s);
  const highlights = s.mode !== 'block';
  lines.forEach((line, li) => {
    let x = cx - lineWidth(line) / 2;
    const y = top + lineH * (li + 0.5);
    for (const i of line) {
      const w = widths[i];
      if (!shown(i)) {
        x += w + space;
        continue;
      }
      const word = words[i];
      const isCurrent = i === currentIdx;
      // reveal: toda palavra anima ao aparecer; nos outros modos, só a falada
      const pose = s.mode === 'reveal' || isCurrent ? wordPose(anim, time - word.start, fontPx) : REST;
      const color = word.emphasis ? (s.emphasisColor ?? s.highlightColor) : highlights && isCurrent ? s.highlightColor : s.color;

      ctx.save();
      ctx.globalAlpha *= pose.alpha;
      ctx.translate(x + w / 2 + pose.dx, y + pose.dy);
      ctx.scale(pose.scale, pose.scale);
      if (s.highlightBg && isCurrent && highlights) {
        const px = fontPx * 0.18;
        ctx.fillStyle = s.highlightBg;
        roundRect(ctx, -w / 2 - px, -lineH / 2 + fontPx * 0.04, w + px * 2, lineH - fontPx * 0.08, fontPx * 0.18);
        ctx.fill();
      }
      if (s.strokeWidth > 0) {
        ctx.strokeStyle = s.strokeColor;
        ctx.lineWidth = s.strokeWidth * fontPx * 2;
        ctx.strokeText(texts[i], -w / 2, 0);
      }
      if (s.shadow) {
        ctx.shadowColor = s.shadowColor ?? 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = fontPx * (s.shadowBlur ?? 0.12);
        ctx.shadowOffsetY = fontPx * (s.shadowOffset ?? 0.05);
      }
      ctx.fillStyle = color;
      ctx.fillText(texts[i], -w / 2, 0);
      ctx.restore();
      x += w + space;
    }
  });
  ctx.restore();
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
