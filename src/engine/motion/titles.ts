// Motion Graphics Engine (núcleo): títulos animados por template, desenhados no canvas
// pelo compositor (preview e export). Entrada/saída são calculadas do tempo do clipe;
// posição/escala/opacidade extras vêm dos keyframes do clipe, então tudo continua
// editável à mão.

import type { Clip, TitleData, TitleTemplate } from '../../core/types';
import { ease } from '../../core/animation';
import { transformAt } from '../../core/animation';
import { speedOf } from '../../core/clipTime';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const TITLE_TEMPLATES: { id: TitleTemplate; label: string; duration: number }[] = [
  { id: 'title', label: 'Título', duration: 3 },
  { id: 'lowerThird', label: 'Lower third', duration: 4 },
  { id: 'callout', label: 'Destaque', duration: 2.5 },
  { id: 'cta', label: 'CTA', duration: 4 },
];

export function defaultTitle(template: TitleTemplate, text = 'Seu texto aqui'): TitleData {
  return {
    template,
    text,
    subtitle: template === 'lowerThird' ? 'Subtítulo' : '',
    fontFamily: template === 'title' ? '"Arial Black", "Segoe UI Black", sans-serif' : '"Segoe UI", Arial, sans-serif',
    color: '#ffffff',
    accent: template === 'callout' ? '#ffd400' : '#4f8cff',
    y: template === 'lowerThird' ? 0.8 : template === 'cta' ? 0.82 : template === 'callout' ? 0.25 : 0.5,
  };
}

const IN = 0.45;
const OUT = 0.35;

/** Progresso de entrada (0→1) e de saída (1→0) no tempo local do clipe. */
function phases(t: number, duration: number) {
  const inK = ease('easeOut', t / IN);
  const outK = 1 - ease('easeIn', (t - (duration - OUT)) / OUT);
  return { inK, outK: t > duration - OUT ? outK : 1 };
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawTitle(ctx: Ctx2D, W: number, H: number, clip: Clip, sourceTime: number) {
  const d = clip.title;
  if (!d) return;
  const t = (sourceTime - clip.sourceIn) / speedOf(clip);
  const tr = transformAt(clip, sourceTime);
  const base = Math.min(W, H);
  const { inK, outK } = phases(t, clip.duration);
  const vis = Math.min(inK, outK);
  if (vis <= 0 || tr.opacity <= 0) return;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.min(1, tr.opacity);
  const cx = W / 2 + tr.x * W;
  const cy = d.y * H + tr.y * H;
  ctx.translate(cx, cy);
  if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
  ctx.scale(tr.scale, tr.scale);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  switch (d.template) {
    case 'title': {
      const size = base * 0.09;
      ctx.globalAlpha *= vis;
      const s = 0.85 + 0.15 * inK;
      ctx.scale(s, s);
      ctx.font = `900 ${size}px ${d.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = size * 0.25;
      ctx.fillStyle = d.color;
      ctx.fillText(d.text, 0, 0);
      const w = ctx.measureText(d.text).width;
      ctx.shadowBlur = 0;
      ctx.fillStyle = d.accent;
      const barW = w * 0.5 * inK;
      ctx.fillRect(-barW / 2, size * 0.62, barW, size * 0.09);
      if (d.subtitle) {
        ctx.font = `500 ${size * 0.38}px "Segoe UI", Arial, sans-serif`;
        ctx.fillStyle = d.color;
        ctx.fillText(d.subtitle, 0, size * 1.15);
      }
      break;
    }
    case 'lowerThird': {
      const size = base * 0.045;
      ctx.translate(-cx + W * 0.06, 0); // ancorado à esquerda
      ctx.font = `700 ${size}px ${d.fontFamily}`;
      const w1 = ctx.measureText(d.text).width;
      ctx.font = `400 ${size * 0.7}px ${d.fontFamily}`;
      const w2 = d.subtitle ? ctx.measureText(d.subtitle).width : 0;
      const boxW = Math.max(w1, w2) + size * 1.4;
      const boxH = d.subtitle ? size * 2.3 : size * 1.5;
      const slide = (1 - Math.min(inK, outK)) * -(boxW + W * 0.06);
      ctx.translate(slide, 0);
      ctx.fillStyle = 'rgba(10,12,16,0.78)';
      ctx.fillRect(0, -boxH / 2, boxW, boxH);
      ctx.fillStyle = d.accent;
      ctx.fillRect(0, -boxH / 2, size * 0.22, boxH);
      ctx.textAlign = 'left';
      ctx.fillStyle = d.color;
      ctx.font = `700 ${size}px ${d.fontFamily}`;
      ctx.fillText(d.text, size * 0.7, d.subtitle ? -size * 0.42 : 0);
      if (d.subtitle) {
        ctx.globalAlpha *= 0.8;
        ctx.font = `400 ${size * 0.7}px ${d.fontFamily}`;
        ctx.fillText(d.subtitle, size * 0.7, size * 0.58);
      }
      break;
    }
    case 'callout': {
      const size = base * 0.05;
      // pop: cresce além do tamanho e volta
      const pop = t < IN ? 0.6 + 0.48 * ease('easeOut', t / IN) - 0.08 * Math.max(0, (t - IN * 0.6) / (IN * 0.4)) : 1;
      const s = Math.min(pop, outK);
      ctx.scale(s, s);
      ctx.font = `800 ${size}px ${d.fontFamily}`;
      const w = ctx.measureText(d.text).width;
      ctx.fillStyle = d.accent;
      roundRect(ctx, -w / 2 - size * 0.6, -size * 0.75, w + size * 1.2, size * 1.5, size * 0.3);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.fillText(d.text, 0, size * 0.04);
      break;
    }
    case 'cta': {
      const size = base * 0.055;
      ctx.globalAlpha *= vis;
      ctx.translate(0, (1 - inK) * size * 2);
      const pulse = 1 + 0.04 * Math.sin(Math.max(0, t - IN) * Math.PI * 2);
      ctx.scale(pulse, pulse);
      ctx.font = `800 ${size}px ${d.fontFamily}`;
      const w = ctx.measureText(d.text).width;
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = size * 0.4;
      ctx.fillStyle = d.accent;
      roundRect(ctx, -w / 2 - size * 0.9, -size * 0.85, w + size * 1.8, size * 1.7, size * 0.85);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = d.color;
      ctx.textAlign = 'center';
      ctx.fillText(d.text, 0, size * 0.04);
      break;
    }
  }
  ctx.restore();
}
