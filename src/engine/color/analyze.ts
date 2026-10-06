// Amostra quadros reais de um vídeo (decodificados via WebCodecs) e calcula a correção automática.

import { CanvasSink } from 'mediabunny';
import type { Asset, ColorSettings } from '../../core/types';
import type { MediaEngine } from '../media/MediaEngine';
import { autoColorFromStats, statsFromPixels } from './color';
import type { FrameStats } from './color';

export async function analyzeAssetColor(media: MediaEngine, asset: Asset, samples = 6): Promise<{ settings: ColorSettings; stats: FrameStats }> {
  const frames: ImageData[] = [];
  const small = new OffscreenCanvas(96, Math.max(2, Math.round((96 * asset.height) / Math.max(1, asset.width))));
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  if (asset.kind === 'image' || asset.kind === 'svg') {
    const img = media.get(asset.id)?.image;
    if (!img) throw new Error('imagem ainda carregando');
    ctx.drawImage(img, 0, 0, small.width, small.height);
    frames.push(ctx.getImageData(0, 0, small.width, small.height));
  } else {
    const track = await media.getInput(asset.id)?.getPrimaryVideoTrack();
    if (!track) throw new Error('vídeo não decodificável');
    const sink = new CanvasSink(track, { width: small.width, height: small.height, fit: 'fill', poolSize: 1 });
    const times = Array.from({ length: samples }, (_, i) => (asset.duration * (i + 0.5)) / samples);
    for await (const w of sink.canvasesAtTimestamps(times)) {
      if (!w) continue;
      ctx.drawImage(w.canvas, 0, 0, small.width, small.height);
      frames.push(ctx.getImageData(0, 0, small.width, small.height));
    }
  }
  if (!frames.length) throw new Error('nenhum quadro pôde ser lido');
  const stats = statsFromPixels(frames);
  return { settings: autoColorFromStats(stats), stats };
}
