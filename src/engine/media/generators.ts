// Geradores de dados derivados da mídia. Cada um lê o arquivo em streaming (nunca inteiro
// na memória), informa progresso e respeita cancelamento. Resultados vão para o cache.

import { AudioBufferSink, CanvasSink, EncodedPacketSink } from 'mediabunny';
import type { InputAudioTrack, InputVideoTrack } from 'mediabunny';
import { SILENT_DB } from '../analysis/silence';

export const WAVEFORM_RATE = 100;

type Progress = (p: number) => void;

const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

async function canvasToBlob(c: HTMLCanvasElement | OffscreenCanvas, quality = 0.8): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('falha ao gerar imagem'))), 'image/jpeg', quality));
}

/** Thumbnail representativa (quadro em ~1 s ou no início). */
export async function makeAssetThumbnail(track: InputVideoTrack, duration: number, width = 192): Promise<Blob | null> {
  const w = await track.getDisplayWidth();
  const h = await track.getDisplayHeight();
  const height = Math.max(2, Math.round((width * h) / Math.max(1, w)));
  const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });
  const wrapped = (await sink.getCanvas(duration > 2 ? 1 : 0)) ?? (await sink.getCanvas(0));
  return wrapped ? canvasToBlob(wrapped.canvas) : null;
}

/** Quadros JPEG (base64, sem prefixo) em tempos escolhidos: para a IA "olhar" um take. */
export async function grabFramesBase64(track: InputVideoTrack, times: number[], width = 512): Promise<string[]> {
  const w = await track.getDisplayWidth();
  const h = await track.getDisplayHeight();
  const height = Math.max(2, Math.round((width * h) / Math.max(1, w)));
  const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });
  const out: string[] = [];
  for (const t of times) {
    const wrapped = await sink.getCanvas(t).catch(() => null);
    if (wrapped) out.push(await blobToBase64(await canvasToBlob(wrapped.canvas, 0.7)));
  }
  return out;
}

const pixelSinks = new WeakMap<InputVideoTrack, Map<number, CanvasSink>>();

/** Pixels RGBA de um quadro em baixa resolução (análise de movimento/cor). */
export async function framePixels(track: InputVideoTrack, time: number, width = 64): Promise<ImageData | null> {
  let byWidth = pixelSinks.get(track);
  if (!byWidth) pixelSinks.set(track, (byWidth = new Map()));
  let sink = byWidth.get(width);
  if (!sink) {
    const w = await track.getDisplayWidth();
    const h = await track.getDisplayHeight();
    sink = new CanvasSink(track, { width, height: Math.max(2, Math.round((width * h) / Math.max(1, w))), fit: 'fill', poolSize: 1 });
    byWidth.set(width, sink);
  }
  const wrapped = await sink.getCanvas(time).catch(() => null);
  if (!wrapped) return null;
  const c = wrapped.canvas;
  const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  return g ? g.getImageData(0, 0, c.width, c.height) : null;
}

export async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Tempos alinhados aos keyframes mais próximos (decodificar um keyframe é barato:
 * não precisa decodificar o GOP inteiro).
 */
async function keyAlignedTimes(track: InputVideoTrack, times: number[], signal: AbortSignal): Promise<number[]> {
  const ps = new EncodedPacketSink(track);
  const out: number[] = [];
  for (const t of times) {
    if (signal.aborted) throw new DOMException('cancelado', 'AbortError');
    const kp = await ps.getKeyPacket(t, { metadataOnly: true }).catch(() => null);
    out.push(kp ? kp.timestamp : t);
  }
  return out;
}

export interface SpriteResult {
  blobs: Blob[];
  info: { frames: number; frameW: number; frameH: number; cols: number; rows: number; perSheet: number; interval: number };
}

/**
 * Folhas de sprites com quadros espalhados pelo vídeo. Usado no filmstrip da timeline
 * (poucos quadros) e nas thumbnails de scrubbing (um a cada N segundos, até `maxFrames`).
 */
export async function makeSprites(
  track: InputVideoTrack,
  duration: number,
  opts: { frames: number; frameH: number; cols: number; rows: number; keyAligned: boolean },
  signal: AbortSignal,
  progress: Progress,
): Promise<SpriteResult> {
  const w = await track.getDisplayWidth();
  const h = await track.getDisplayHeight();
  const frameH = opts.frameH;
  const frameW = Math.max(2, Math.round((frameH * w) / Math.max(1, h)));
  const frames = Math.max(1, opts.frames);
  const interval = duration / frames;
  let times = Array.from({ length: frames }, (_, i) => (i + 0.5) * interval);
  if (opts.keyAligned) times = await keyAlignedTimes(track, times, signal);
  const perSheet = opts.cols * opts.rows;
  const sink = new CanvasSink(track, { width: frameW, height: frameH, fit: 'fill', poolSize: 2 });
  const blobs: Blob[] = [];
  let sheet: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let i = 0;
  for await (const wc of sink.canvasesAtTimestamps(times)) {
    if (signal.aborted) throw new DOMException('cancelado', 'AbortError');
    const k = i % perSheet;
    if (k === 0) {
      const remaining = frames - i;
      const rows = Math.min(opts.rows, Math.ceil(remaining / opts.cols));
      sheet = new OffscreenCanvas(frameW * opts.cols, frameH * rows);
      ctx = sheet.getContext('2d')!;
    }
    if (wc && ctx) ctx.drawImage(wc.canvas, (k % opts.cols) * frameW, Math.floor(k / opts.cols) * frameH, frameW, frameH);
    i++;
    if (k === perSheet - 1 || i === frames) blobs.push(await canvasToBlob(sheet!, 0.72));
    if (i % 10 === 0) progress(i / frames);
  }
  return { blobs, info: { frames, frameW, frameH, cols: opts.cols, rows: opts.rows, perSheet, interval } };
}

export interface WaveformData {
  /** Pico de amplitude 0..1 por bloco de 10 ms. */
  peaks: Float32Array;
  /** Nível RMS em dBFS por bloco de 10 ms (detecção de silêncio, normalização). */
  levels: Float32Array;
}

/** Waveform real: lê o áudio em streaming e reduz a picos/RMS a cada 10 ms. */
export async function makeWaveform(track: InputAudioTrack, duration: number, signal: AbortSignal, progress: Progress, partial?: (d: WaveformData) => void): Promise<WaveformData> {
  const buckets = Math.max(1, Math.ceil(duration * WAVEFORM_RATE));
  const peaks = new Float32Array(buckets);
  const sumSq = new Float64Array(buckets);
  const count = new Uint32Array(buckets);
  const levels = new Float32Array(buckets).fill(SILENT_DB);
  const sink = new AudioBufferSink(track);
  let lastYield = performance.now();
  let lastPartial = lastYield;
  for await (const { buffer, timestamp } of sink.buffers()) {
    if (signal.aborted) throw new DOMException('cancelado', 'AbortError');
    const sr = buffer.sampleRate;
    const perBucket = sr / WAVEFORM_RATE;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const startSample = timestamp * sr;
    for (let i = 0; i < buffer.length; ) {
      const bucket = Math.floor((startSample + i) / perBucket);
      const end = Math.min(buffer.length, Math.ceil((bucket + 1) * perBucket - startSample));
      let max = 0;
      let sq = 0;
      for (const data of channels) {
        for (let j = i; j < end; j++) {
          const v = data[j];
          sq += v * v;
          const a = v < 0 ? -v : v;
          if (a > max) max = a;
        }
      }
      if (bucket >= 0 && bucket < buckets) {
        if (max > peaks[bucket]) peaks[bucket] = max;
        sumSq[bucket] += sq;
        count[bucket] += (end - i) * channels.length;
      }
      i = Math.max(i + 1, end);
    }
    const now = performance.now();
    if (now - lastYield > 30) {
      progress(Math.min(1, timestamp / Math.max(0.001, duration)));
      if (partial && now - lastPartial > 500) {
        lastPartial = now;
        partial({ peaks, levels });
      }
      await yieldToUI();
      lastYield = performance.now();
    }
  }
  for (let b = 0; b < buckets; b++) {
    const rms = count[b] ? Math.sqrt(sumSq[b] / count[b]) : 0;
    levels[b] = rms > 1e-5 ? 20 * Math.log10(rms) : SILENT_DB;
  }
  return { peaks, levels };
}

/** Serializa picos+níveis num único blob binário para o cache. */
export function waveformToBlob(d: WaveformData): Blob {
  const header = new Uint32Array([d.peaks.length]);
  return new Blob([header, d.peaks as Float32Array<ArrayBuffer>, d.levels as Float32Array<ArrayBuffer>]);
}

export async function waveformFromBlob(b: Blob): Promise<WaveformData> {
  const buf = await b.arrayBuffer();
  const n = new Uint32Array(buf, 0, 1)[0];
  return { peaks: new Float32Array(buf, 4, n), levels: new Float32Array(buf, 4 + n * 4, n) };
}

/**
 * Pirâmide de resoluções (cada nível = máximo de 2 blocos do anterior).
 * A timeline escolhe o nível com ~1 bloco por pixel: desenhar custa O(pixels), não O(áudio).
 */
export function waveformMipmaps(peaks: Float32Array): Float32Array[] {
  const levels = [peaks];
  while (levels.at(-1)!.length > 64) {
    const prev = levels.at(-1)!;
    const next = new Float32Array(Math.ceil(prev.length / 2));
    for (let i = 0; i < next.length; i++) next[i] = Math.max(prev[2 * i], prev[2 * i + 1] ?? 0);
    levels.push(next);
  }
  return levels;
}
