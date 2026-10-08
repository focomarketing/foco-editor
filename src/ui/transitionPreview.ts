// Preview procedural de um modelo de transição (dois quadros sintéticos A → B), desenhado
// pelo mesmo compositor do preview/export: o que a miniatura mostra é o que o vídeo terá.

import type { TransitionSpec } from '../core/types';
import { DEFAULT_TRANSFORM } from '../core/types';
import { composite } from '../engine/render/Compositor';
import type { DrawLayer } from '../engine/render/Compositor';
import { renderTransition } from '../engine/render/transitions';
import type { TransitionPreset } from '../video-editor/transitions/library';

const frames = new Map<string, OffscreenCanvas>();
function frame(which: 'A' | 'B', vertical: boolean): OffscreenCanvas {
  const key = `${which}${vertical ? 'v' : 'h'}`;
  let c = frames.get(key);
  if (c) return c;
  const [w, h] = vertical ? [180, 320] : [320, 180];
  c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, h);
  if (which === 'A') {
    grad.addColorStop(0, '#16324f');
    grad.addColorStop(1, '#2d7dd2');
  } else {
    grad.addColorStop(0, '#f08a24');
    grad.addColorStop(1, '#8a2be2');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // listras para o movimento aparecer
  g.globalAlpha = 0.18;
  g.fillStyle = '#fff';
  for (let x = -h; x < w; x += 28) {
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(x + h, 0);
    g.lineTo(x + h + 10, 0);
    g.lineTo(x + 10, h);
    g.fill();
  }
  g.globalAlpha = 1;
  g.font = `900 ${Math.round(Math.min(w, h) * 0.45)}px "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.fillText(which, w / 2, h / 2);
  frames.set(key, c);
  return c;
}

/** Desenha o modelo no progresso u (0..1) com o mesmo motor do preview/export. */
export function drawTransitionPreview(ctx: CanvasRenderingContext2D, preset: TransitionPreset, u: number, vertical: boolean) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const spec: TransitionSpec = { type: preset.id, duration: preset.duration.recommended || 0.4 };
  const r = renderTransition(preset, spec, u);
  const layer = (which: 'A' | 'B', fx = {}): DrawLayer => {
    const src = frame(which, vertical);
    return { kind: 'media', source: src as unknown as CanvasImageSource & TexImageSource, width: src.width, height: src.height, transform: DEFAULT_TRANSFORM, fx };
  };
  const layers: DrawLayer[] = [];
  if (preset.render === 'none') layers.push(layer(u < 0.5 ? 'A' : 'B'));
  else if (preset.align === 'center') layers.push(u < 0.5 ? layer('A', r.a) : layer('B', r.b));
  else if (preset.align === 'hold') layers.push(u < 0.35 ? layer('A') : layer('B', r.b));
  else layers.push(layer('A', r.a), layer('B', r.b));
  if (r.overlay) layers.push({ kind: 'overlay', overlay: r.overlay });
  composite(ctx, W, H, layers);
}

