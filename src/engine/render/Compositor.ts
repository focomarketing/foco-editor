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
import type { LayerFx, OverlaySpec } from './transitions';
import { drawOverlay, drawSlices, maskBand, maskPath, rgbSplit } from './transitionDraw';

export { applyTransitions } from './transitionDraw';
export type { FrameSource } from './transitionDraw';

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
      /** Clipe de origem (para as transições acharem a camada). */
      clipId?: string;
      /** Efeito de transição neste quadro. */
      fx?: LayerFx;
    }
  | { kind: 'caption'; clip: Clip; time: number }
  | { kind: 'title'; clip: Clip; time: number }
  | { kind: 'overlay'; overlay: OverlaySpec };

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

let surfaceCanvas: OffscreenCanvas | null = null;
/** Superfície do tamanho do quadro para montar camadas com desfoque (reaproveitada). */
function fxSurface(W: number, H: number): OffscreenCanvas {
  surfaceCanvas ??= new OffscreenCanvas(W, H);
  if (surfaceCanvas.width !== W || surfaceCanvas.height !== H) {
    surfaceCanvas.width = W;
    surfaceCanvas.height = H;
  }
  return surfaceCanvas;
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
    if (l.kind === 'overlay') {
      drawOverlay(ctx, W, H, l.overlay);
      continue;
    }
    const fx = l.fx;
    const opacity = l.transform.opacity * (fx?.opacity ?? 1);
    if (l.width <= 0 || l.height <= 0 || opacity <= 0) continue;
    const tr = l.transform;
    // Encaixa a imagem inteira no quadro; o crop só esconde bordas (não reescala o resto).
    const fit = Math.min(W / l.width, H / l.height) * tr.scale * (fx?.scale ?? 1);
    const dw = l.width * fit * tr.scaleX * (fx?.scaleX ?? 1);
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
    if (fx?.mask) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      maskPath(ctx, W, H, fx.mask);
      ctx.clip();
    }
    const blend = !l.blendMode || l.blendMode === 'normal' ? 'source-over' : l.blendMode;
    // Com desfoque, a camada inteira (com as cópias espelhadas) é montada numa superfície e
    // desfocada de uma vez: sem emenda escura entre cópias nem borda puxando o preto de fora.
    const blurPx = fx?.blur && fx.blur > 0.0005 ? fx.blur * W : 0;
    const surface = blurPx ? fxSurface(W, H) : null;
    const target: Ctx2D = surface ? surface.getContext('2d')! : ctx;
    if (surface) {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = 1;
      target.globalCompositeOperation = 'source-over';
      target.filter = 'none';
      target.clearRect(0, 0, W, H);
    } else {
      ctx.globalAlpha = Math.min(1, opacity);
      ctx.globalCompositeOperation = blend;
    }
    target.setTransform(1, 0, 0, 1, W / 2 + (tr.x + (fx?.dx ?? 0)) * W, H / 2 + (tr.y + (fx?.dy ?? 0)) * H);
    const rot = tr.rotation + (fx?.rotate ?? 0);
    if (rot) target.rotate((rot * Math.PI) / 180);
    // A posição indica onde fica o ponto de âncora da camada.
    const x0 = -tr.anchorX * dw;
    const y0 = -tr.anchorY * dh;
    const draw = (ox: number, oy: number, flipX: boolean, flipY: boolean) => {
      target.save();
      target.translate(ox, oy);
      if (flipX || flipY) target.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      if (fx?.glitch && fx.glitch > 0.01) drawSlices(target, source, srcW, srcH, cr, keepW, keepH, x0, y0, dw, dh, fx.glitch, fx.seed ?? 0, W);
      else target.drawImage(source, cr.left * srcW, cr.top * srcH, keepW * srcW, keepH * srcH, x0 + cr.left * dw, y0 + cr.top * dh, keepW * dw, keepH * dh);
      target.restore();
    };
    draw(0, 0, false, false);
    // whip/push: espelha a imagem nas bordas em vez de mostrar preto
    if (fx?.mirror) {
      if (fx.dx) for (const s of [-1, 1]) draw(s * Math.abs(dw), 0, true, false);
      if (fx.dy) for (const s of [-1, 1]) draw(0, s * Math.abs(dh), false, true);
    }
    if (fx?.rgb && fx.rgb > 0.0005) rgbSplit(target, source, srcW, srcH, x0, y0, dw, dh, fx.rgb * W);
    if (surface) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(1, opacity);
      ctx.globalCompositeOperation = blend;
      ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
      const m = blurPx * 2; // sobra: a borda desfocada fica fora do quadro
      ctx.drawImage(surface, -m, -m, W + 2 * m, H + 2 * m);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (fx?.mask) {
      ctx.restore();
      if (fx.mask.band) maskBand(ctx, W, H, fx.mask);
    }
  }
  ctx.restore();
}
