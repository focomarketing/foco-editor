// Quadros do rascunho para o Diretor "ver": cada instante é montado pelo mesmo compositor do
// preview/export (vídeo, B-roll, títulos, legendas, transições) e os quadros viram uma folha de
// contato com o tempo de cada um.

import type { Clip, Project } from '../../core/types';
import { sourceEnd } from '../../core/clipTime';
import { applyTransitions, composite, graphicLayer, mediaTransform, visualLayersAt } from '../../engine/render/Compositor';
import type { DrawLayer, FrameSource } from '../../engine/render/Compositor';
import { transitionsAt } from '../../engine/render/transitions';

/** Acesso aos quadros das mídias (o app usa o MediaEngine; os testes, quadros sintéticos). */
export interface FrameReader {
  /** Imagem parada já carregada. */
  image(assetId: string): FrameSource | null;
  /** Quadro de vídeo no tempo de origem pedido, na largura pedida. */
  video(assetId: string, sourceTime: number, width: number): Promise<FrameSource | null>;
}

/** Desenha o rascunho no instante t num canvas W×H. */
export async function renderStill(p: Project, t: number, W: number, H: number, frames: FrameReader): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const layers: DrawLayer[] = [];
  const width = Math.min(960, W);
  for (const active of visualLayersAt(p, t)) {
    if (!active.asset) {
      const g = graphicLayer(active);
      if (g) layers.push(g);
      continue;
    }
    const src = active.asset.kind === 'image' ? frames.image(active.asset.id) : await frames.video(active.asset.id, active.sourceTime, width);
    if (!src) continue;
    const { clip } = active;
    layers.push({ kind: 'media', ...src, transform: mediaTransform(active), color: clip.color, crop: clip.crop, blendMode: clip.blendMode, clipId: clip.id });
  }
  // dissolve/máscara/push: o último quadro do clipe anterior fica por baixo
  const tails = new Map<string, FrameSource | null>();
  for (const tail of transitionsAt(p, t).tails) {
    const a = p.assets[tail.clip.assetId];
    if (!a) continue;
    tails.set(tail.clip.id, a.kind === 'image' ? frames.image(a.id) : await frames.video(a.id, sourceEnd(tail.clip) - 0.04, width));
  }
  composite(ctx, W, H, applyTransitions(p, t, layers, (c: Clip) => tails.get(c.id) ?? null));
  return canvas;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Folha de contato: quadros em grade, com o tempo de cada um. Devolve JPEG em base64. */
export async function contactSheet(p: Project, times: number[], frames: FrameReader, opts: { cellWidth?: number } = {}): Promise<{ base64: string; cols: number; rows: number }> {
  const vertical = p.settings.height > p.settings.width;
  const cw = opts.cellWidth ?? (vertical ? 200 : 320);
  const ch = Math.round((cw * p.settings.height) / p.settings.width);
  const cols = Math.min(times.length, vertical ? 6 : 4);
  const rows = Math.ceil(times.length / cols);
  const pad = 6;
  const label = 22;
  const sheet = new OffscreenCanvas(cols * (cw + pad) + pad, rows * (ch + label + pad) + pad);
  const g = sheet.getContext('2d')!;
  g.fillStyle = '#16181c';
  g.fillRect(0, 0, sheet.width, sheet.height);
  for (const [i, t] of times.entries()) {
    const x = pad + (i % cols) * (cw + pad);
    const y = pad + Math.floor(i / cols) * (ch + label + pad);
    const still = await renderStill(p, t, cw, ch, frames);
    g.drawImage(still, x, y + label);
    g.fillStyle = '#ffffff';
    g.font = '600 14px "Segoe UI", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(`${i + 1} · ${fmt(t)}`, x + 2, y + label / 2);
  }
  const blob = await sheet.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), cols, rows };
}
