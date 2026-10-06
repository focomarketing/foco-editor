// Desenho de legendas no canvas. Usado pelo Compositor (preview e export).

import type { Clip, TranscriptWord } from '../../core/types';
import { transformAt } from '../../core/animation';
import { sourceEnd } from '../../core/clipTime';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const POP_TIME = 0.14;

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

  const tr = transformAt(clip, time);
  const fontPx = Math.max(6, s.fontSize * Math.min(W, H) * tr.scale);
  const font = `${s.fontWeight} ${fontPx}px ${s.fontFamily}`;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.min(1, tr.opacity);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';

  const texts = words.map((w) => (s.uppercase ? w.text.toLocaleUpperCase('pt-BR') : w.text));
  const space = ctx.measureText(' ').width;
  const widths = texts.map((t) => ctx.measureText(t).width);
  const maxWidth = W * 0.86;

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
  const lineH = fontPx * 1.18;
  const cx = W / 2 + tr.x * W;
  const cy = s.y * H + tr.y * H;
  const top = cy - (lines.length * lineH) / 2;

  if (s.background) {
    const padX = fontPx * 0.45;
    const padY = fontPx * 0.2;
    const bw = Math.max(...lines.map(lineWidth)) + padX * 2;
    const bh = lines.length * lineH + padY * 2;
    ctx.fillStyle = s.background;
    roundRect(ctx, cx - bw / 2, top - padY, bw, bh, fontPx * 0.25);
    ctx.fill();
  }

  lines.forEach((line, li) => {
    let x = cx - lineWidth(line) / 2;
    const y = top + lineH * (li + 0.5);
    for (const i of line) {
      const isCurrent = i === currentIdx;
      const word = words[i];
      let scale = 1;
      if (s.pop && isCurrent) {
        const k = Math.min(1, Math.max(0, (time - word.start) / POP_TIME));
        scale = 1 + 0.22 * (1 - k) * (1 - k);
      }
      const color = s.mode === 'karaoke' || s.mode === 'word' ? (isCurrent ? s.highlightColor : s.color) : s.color;
      ctx.save();
      ctx.translate(x + widths[i] / 2, y);
      ctx.scale(scale, scale);
      if (s.strokeWidth > 0) {
        ctx.strokeStyle = s.strokeColor;
        ctx.lineWidth = s.strokeWidth * fontPx * 2;
        ctx.strokeText(texts[i], -widths[i] / 2, 0);
      }
      if (s.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = fontPx * 0.12;
        ctx.shadowOffsetY = fontPx * 0.05;
      }
      ctx.fillStyle = color;
      ctx.fillText(texts[i], -widths[i] / 2, 0);
      ctx.restore();
      x += widths[i] + space;
    }
  });
  ctx.restore();
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
