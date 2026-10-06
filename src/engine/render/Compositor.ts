// Compositor 2D compartilhado entre preview e export: o mesmo código decide o que
// aparece em cada instante e como é desenhado. Se o preview mostra, o export renderiza.

import type { Asset, BlendMode, Clip, ColorSettings, Crop, Project, Transform } from '../../core/types';
import { NO_CROP } from '../../core/types';
import { EPS } from '../../core/time';
import { toSource } from '../../core/clipTime';
import { transformAt } from '../../core/animation';
import { clipEnd } from '../timeline/operations';
import { drawCaption } from '../captions/renderCaption';
import { drawTitle } from '../motion/titles';
import { colorProcessor, isNeutral } from '../color/color';

export interface ActiveClip {
  clip: Clip;
  /** Ausente em legendas e títulos. */
  asset?: Asset;
  /** Tempo dentro da mídia de origem (ou do gráfico). */
  sourceTime: number;
}

/**
 * Clipes visuais ativos em t, da camada de baixo para a de cima
 * (a trilha mais baixa da lista de vídeo fica por baixo).
 */
export function visualLayersAt(p: Project, t: number): ActiveClip[] {
  const videoTracks = p.tracks.filter((tr) => tr.kind === 'video' && !tr.hidden);
  const out: ActiveClip[] = [];
  for (let i = videoTracks.length - 1; i >= 0; i--) {
    const trackId = videoTracks[i].id;
    for (const clip of Object.values(p.clips)) {
      if (clip.trackId !== trackId) continue;
      if (t < clip.start - EPS || t >= clipEnd(clip) - EPS) continue;
      const sourceTime = toSource(clip, t);
      if (clip.caption || clip.title) {
        out.push({ clip, sourceTime });
        break;
      }
      const asset = p.assets[clip.assetId];
      if (!asset || !asset.hasVideo) continue;
      out.push({ clip, asset, sourceTime });
      break; // overwrite garante no máximo um clipe por trilha
    }
  }
  return out;
}

/** Clipes que produzem som (trilha não silenciada, volume > 0). */
export function audibleClips(p: Project): Clip[] {
  const muted = new Set(p.tracks.filter((t) => t.muted).map((t) => t.id));
  return Object.values(p.clips).filter((c) => {
    const a = p.assets[c.assetId];
    return a?.hasAudio && a.audioDecodable && !muted.has(c.trackId) && !c.muted && c.volume > 0;
  });
}

export type DrawLayer =
  | {
      kind: 'media';
      source: CanvasImageSource & TexImageSource;
      /** Dimensões de exibição da fonte. */
      width: number;
      height: number;
      transform: Transform;
      color?: ColorSettings;
      crop?: Crop;
      blendMode?: BlendMode;
    }
  | { kind: 'caption'; clip: Clip; time: number }
  | { kind: 'title'; clip: Clip; time: number };

/** Monta a camada de um clipe ativo que não é mídia (legenda/título). */
export function graphicLayer(a: ActiveClip): DrawLayer | null {
  if (a.clip.caption) return { kind: 'caption', clip: a.clip, time: a.sourceTime };
  if (a.clip.title) return { kind: 'title', clip: a.clip, time: a.sourceTime };
  return null;
}

/** Transformação efetiva (keyframes) de um clipe de mídia ativo. */
export const mediaTransform = (a: ActiveClip) => transformAt(a.clip, a.sourceTime);

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface CompositeOptions {
  /** Mostra o original sem correção de cor (comparação ORIGINAL vs AI COLOR). */
  bypassColor?: boolean;
}

/** Desenha as camadas: cada mídia é encaixada (contain) no quadro e então transformada. */
export function composite(ctx: Ctx2D, W: number, H: number, layers: DrawLayer[], opts: CompositeOptions = {}) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  for (const l of layers) {
    if (l.kind === 'caption') {
      drawCaption(ctx, W, H, l.clip, l.time);
      continue;
    }
    if (l.kind === 'title') {
      drawTitle(ctx, W, H, l.clip, l.time);
      continue;
    }
    if (l.width <= 0 || l.height <= 0 || l.transform.opacity <= 0) continue;
    const tr = l.transform;
    // Encaixa a imagem inteira no quadro; o crop só esconde bordas (não reescala o resto).
    const fit = Math.min(W / l.width, H / l.height) * tr.scale;
    const dw = l.width * fit * tr.scaleX;
    const dh = l.height * fit * tr.scaleY;
    const cr = l.crop ?? NO_CROP;
    const keepW = Math.max(0, 1 - cr.left - cr.right);
    const keepH = Math.max(0, 1 - cr.top - cr.bottom);
    if (keepW <= 0 || keepH <= 0) continue;
    let source: CanvasImageSource = l.source;
    let srcW = l.width;
    let srcH = l.height;
    if (l.color && !opts.bypassColor && !isNeutral(l.color)) {
      // Processa no tamanho em que vai aparecer (nunca maior que a fonte).
      const k = Math.min(1, Math.abs(dw) / l.width);
      const graded = colorProcessor().process(l.source, l.width * k, l.height * k, l.color);
      if (graded) {
        source = graded;
        srcW = graded.width;
        srcH = graded.height;
      }
    }
    ctx.setTransform(1, 0, 0, 1, W / 2 + tr.x * W, H / 2 + tr.y * H);
    if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
    ctx.globalAlpha = Math.min(1, tr.opacity);
    ctx.globalCompositeOperation = !l.blendMode || l.blendMode === 'normal' ? 'source-over' : l.blendMode;
    // A posição indica onde fica o ponto de âncora da camada.
    const x0 = -tr.anchorX * dw;
    const y0 = -tr.anchorY * dh;
    ctx.drawImage(
      source,
      cr.left * srcW,
      cr.top * srcH,
      keepW * srcW,
      keepH * srcH,
      x0 + cr.left * dw,
      y0 + cr.top * dh,
      keepW * dw,
      keepH * dh,
    );
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}
