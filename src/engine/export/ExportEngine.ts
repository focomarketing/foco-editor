// Export Engine: renderiza a timeline quadro a quadro e grava um MP4 real.
// Vídeo: decodificação WebCodecs (Mediabunny CanvasSink) -> Compositor -> encoder H.264/H.265
// (aceleração por hardware quando o navegador oferece). Áudio: mixagem em blocos com
// OfflineAudioContext (reamostragem e ganho nativos) -> AAC (ou Opus se AAC indisponível).
// Grava em streaming no arquivo de destino; a RAM não cresce com a duração do vídeo.

import {
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  canEncodeVideo,
  getFirstEncodableAudioCodec,
} from 'mediabunny';
import type { InputAudioTrack, StreamTargetChunk, WrappedCanvas } from 'mediabunny';
import type { Asset, Clip, Project, Transform } from '../../core/types';
import type { MediaEngine } from '../media/MediaEngine';
import { clipEnd, isStill, projectDuration } from '../timeline/operations';
import { audibleClips, composite, graphicLayer, mediaTransform, visualLayersAt } from '../render/Compositor';
import type { DrawLayer } from '../render/Compositor';
import { buildChain, prepareContext } from '../audio/audioFx';
import { timeStretch } from '../audio/timeStretch';
import { fadeGain, sourceEnd, sourceSpan, speedOf, toSource } from '../../core/clipTime';

export type VideoCodecChoice = 'avc' | 'hevc';

export interface ExportPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  bitrate: number;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'yt1080', label: 'YouTube 1080p', width: 1920, height: 1080, bitrate: 12_000_000 },
  { id: 'yt4k', label: 'YouTube 4K', width: 3840, height: 2160, bitrate: 40_000_000 },
  { id: 'vertical', label: 'Shorts · Reels · TikTok', width: 1080, height: 1920, bitrate: 10_000_000 },
  { id: 'feed45', label: 'Instagram Feed 4:5', width: 1080, height: 1350, bitrate: 8_000_000 },
  { id: 'feed11', label: 'Instagram Feed 1:1', width: 1080, height: 1080, bitrate: 8_000_000 },
];

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: VideoCodecChoice;
}

export interface ExportProgress {
  frame: number;
  totalFrames: number;
  elapsed: number;
  /** Quadros renderizados por segundo (velocidade do export). */
  speed: number;
}

export type ExportTarget = { kind: 'stream'; writable: FileSystemWritableFileStream } | { kind: 'buffer' };

const SAMPLE_RATE = 48_000;
const CHUNK_SECONDS = 2;
const PRE_ROLL = 0.5;
/** Limite para esticar o áudio de um clipe inteiro na memória (≈ 1 GB a 48 kHz estéreo). */
const MAX_STRETCH_SECONDS = 45 * 60;
const EPS = 1e-6;

/** Problemas que impedem o export (mídia offline, codec não decodificável...). */
export function exportProblems(p: Project, media: MediaEngine): string[] {
  const problems = new Set<string>();
  const used = new Set(Object.values(p.clips).map((c) => c.assetId));
  for (const id of used) {
    const a = p.assets[id];
    const entry = media.get(id);
    if (!a) continue;
    if (!entry || entry.status === 'offline') problems.add(`"${a.name}": o arquivo original não foi encontrado. Use "Localizar mídia".`);
    else if (entry.status === 'needs-permission') problems.add(`"${a.name}": o navegador precisa de permissão para ler o arquivo de novo. Clique em "Reconectar".`);
    else if (entry.status === 'changed') problems.add(`"${a.name}": o arquivo foi alterado fora do editor. Recarregue a mídia antes de exportar.`);
    else if (entry.status === 'error') problems.add(`"${a.name}": ${entry.warning ?? 'erro ao ler a mídia'}.`);
    else if (!isStill(a) && a.hasVideo && !a.videoDecodable)
      problems.add(`"${a.name}": o codec de vídeo (${a.videoCodec}) não pode ser decodificado neste navegador.`);
    else if (isStill(a) && !entry.image) problems.add(`"${a.name}": imagem ainda carregando.`);
  }
  if (projectDuration(p) <= 0) problems.add('A timeline está vazia.');
  return [...problems];
}

export async function supportedVideoCodecs(width: number, height: number, bitrate: number): Promise<VideoCodecChoice[]> {
  const out: VideoCodecChoice[] = [];
  for (const codec of ['avc', 'hevc'] as const) {
    if (await canEncodeVideo(codec, { width, height, bitrate }).catch(() => false)) out.push(codec);
  }
  return out;
}

export async function exportProject(
  project: Project,
  media: MediaEngine,
  settings: ExportSettings,
  target: ExportTarget,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<{ blob?: Blob }> {
  const p = project; // snapshot imutável: edições durante o export não afetam o arquivo
  const { width: W, height: H, fps } = settings;
  const duration = projectDuration(p);
  const totalFrames = Math.ceil(duration * fps - EPS);
  if (totalFrames <= 0) throw new Error('A timeline está vazia.');

  if (!(await canEncodeVideo(settings.codec, { width: W, height: H, bitrate: settings.bitrate }))) {
    throw new Error(`Este navegador não consegue codificar ${settings.codec === 'avc' ? 'H.264' : 'H.265'} em ${W}×${H}.`);
  }

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D indisponível.');

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: target.kind === 'buffer' ? 'in-memory' : false }),
    target:
      target.kind === 'stream'
        ? new StreamTarget(target.writable as unknown as WritableStream<StreamTargetChunk>, { chunked: true })
        : new BufferTarget(),
  });

  const videoSource = new CanvasSource(canvas, { codec: settings.codec, bitrate: settings.bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });

  const audible = audibleClips(p);
  let audioSource: AudioBufferSource | null = null;
  if (audible.length > 0) {
    const codec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE });
    if (!codec) throw new Error('Nenhum codec de áudio (AAC/Opus) disponível para codificar.');
    audioSource = new AudioBufferSource({ codec, bitrate: 192_000 });
    output.addAudioTrack(audioSource);
  }

  const frames = new ClipFrameProvider(media, W, H, fps);
  const audio = audioSource ? new AudioMixer(p, media, audible) : null;
  const started = performance.now();
  let lastReport = 0;

  try {
    await output.start();
    const framesPerChunk = Math.max(1, Math.round(CHUNK_SECONDS * fps));
    for (let chunk = 0; chunk < totalFrames; chunk += framesPerChunk) {
      const chunkEnd = Math.min(totalFrames, chunk + framesPerChunk);
      for (let i = chunk; i < chunkEnd; i++) {
        if (signal.aborted) throw new DOMException('Export cancelado', 'AbortError');
        const t = i / fps;
        const layers: DrawLayer[] = [];
        for (const active of visualLayersAt(p, t)) {
          if (!active.asset) {
            const g = graphicLayer(active);
            if (g) layers.push(g);
            continue;
          }
          const layer = await frames.layerFor(active.clip, active.asset, i, mediaTransform(active));
          if (layer) layers.push(layer);
        }
        composite(ctx, W, H, layers);
        await videoSource.add(t, 1 / fps);
        await frames.releaseFinished(i);

        const now = performance.now();
        if (now - lastReport > 120 || i === totalFrames - 1) {
          lastReport = now;
          const elapsed = (now - started) / 1000;
          onProgress({ frame: i + 1, totalFrames, elapsed, speed: (i + 1) / Math.max(elapsed, 0.001) });
        }
      }
      if (audio && audioSource) {
        const rendered = await audio.render(chunk / fps, chunkEnd / fps);
        await audioSource.add(rendered);
      }
    }
    await output.finalize();
  } catch (e) {
    await frames.dispose();
    await output.cancel().catch(() => {});
    throw e;
  }
  await frames.dispose();

  if (target.kind === 'buffer') {
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('Export não produziu dados.');
    return { blob: new Blob([buffer], { type: 'video/mp4' }) };
  }
  return {};
}

// ---------------------------------------------------------------------------

/** Mantém um iterador de quadros decodificados por clipe, avançando em ordem. */
class ClipFrameProvider {
  private iters = new Map<string, { it: AsyncGenerator<WrappedCanvas | null>; lastFrame: number }>();
  private media: MediaEngine;
  private W: number;
  private H: number;
  private fps: number;

  constructor(media: MediaEngine, W: number, H: number, fps: number) {
    this.media = media;
    this.W = W;
    this.H = H;
    this.fps = fps;
  }

  private range(c: Clip): [number, number] {
    return [Math.ceil((c.start - EPS) * this.fps), Math.ceil((clipEnd(c) - EPS) * this.fps)];
  }

  async layerFor(clip: Clip, asset: Asset, frame: number, transform: Transform): Promise<DrawLayer | null> {
    if (isStill(asset)) {
      const img = this.media.get(asset.id)?.image;
      return img ? { kind: 'media', source: img, width: img.width, height: img.height, transform, color: clip.color, crop: clip.crop, blendMode: clip.blendMode } : null;
    }
    let entry = this.iters.get(clip.id);
    if (!entry) {
      const it = await this.open(clip, asset, frame);
      if (!it) return null;
      entry = { it, lastFrame: this.range(clip)[1] - 1 };
      this.iters.set(clip.id, entry);
    }
    const r = await entry.it.next();
    if (r.done || !r.value) return null;
    const c = r.value.canvas;
    return { kind: 'media', source: c, width: c.width, height: c.height, transform, color: clip.color, crop: clip.crop, blendMode: clip.blendMode };
  }

  private async open(clip: Clip, asset: Asset, fromFrame: number) {
    const track = await this.media.getInput(asset.id)?.getPrimaryVideoTrack();
    if (!track) return null;
    // Decodifica já no tamanho em que o clipe vai aparecer (nunca maior que a fonte).
    // Maior escala que o clipe atinge (inclui zooms por keyframe).
    const maxScale = Math.max(clip.transform.scale, ...(clip.keyframes?.scale ?? []).map((k) => k.v), 0.01);
    const fit = Math.min(this.W / asset.width, this.H / asset.height) * maxScale;
    const k = Math.min(1, fit);
    const width = Math.max(2, Math.round(asset.width * k));
    const height = Math.max(2, Math.round(asset.height * k));
    const sink = new CanvasSink(track, { width, height, fit: 'contain', poolSize: 3 });
    const [, end] = this.range(clip);
    const fps = this.fps;
    function* timestamps() {
      for (let i = fromFrame; i < end; i++) yield Math.max(0, toSource(clip, i / fps));
    }
    return sink.canvasesAtTimestamps(timestamps());
  }

  async releaseFinished(frame: number) {
    for (const [id, entry] of this.iters) {
      if (frame >= entry.lastFrame) {
        await entry.it.return(undefined);
        this.iters.delete(id);
      }
    }
  }

  async dispose() {
    for (const entry of this.iters.values()) await entry.it.return(undefined).catch(() => {});
    this.iters.clear();
  }
}

/** Mixa o áudio de todos os clipes audíveis em blocos de tempo da timeline. */
class AudioMixer {
  private tracks = new Map<string, Promise<InputAudioTrack | null>>();
  private p: Project;
  private media: MediaEngine;
  private clips: Clip[];

  constructor(p: Project, media: MediaEngine, clips: Clip[]) {
    this.p = p;
    this.media = media;
    this.clips = clips;
  }

  private stretchCache = new Map<string, Promise<AudioBuffer | null>>();

  /** Áudio do clipe já na velocidade dele (mesma duração do clipe na timeline). */
  private stretched(c: Clip, track: InputAudioTrack): Promise<AudioBuffer | null> {
    let job = this.stretchCache.get(c.id);
    if (!job) {
      job = (async () => {
        const span = sourceSpan(c);
        if (span > MAX_STRETCH_SECONDS) throw new Error(`Clipe com velocidade alterada longo demais para o export (${Math.round(span / 60)} min; máx. ${MAX_STRETCH_SECONDS / 60} min).`);
        const len = Math.max(1, Math.round(span * SAMPLE_RATE));
        const ctx = new OfflineAudioContext(2, len, SAMPLE_RATE);
        for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(Math.max(0, c.sourceIn - 0.1), sourceEnd(c))) {
          const a = Math.max(timestamp, c.sourceIn);
          const b = Math.min(timestamp + buffer.duration, sourceEnd(c));
          if (b <= a) continue;
          const n = ctx.createBufferSource();
          n.buffer = buffer;
          n.connect(ctx.destination);
          n.start(a - c.sourceIn, a - timestamp, b - a);
        }
        const raw = await ctx.startRendering();
        const outCh = timeStretch([raw.getChannelData(0), raw.getChannelData(1)], speedOf(c));
        const out = new AudioBuffer({ length: Math.max(1, outCh[0].length), numberOfChannels: 2, sampleRate: SAMPLE_RATE });
        outCh.forEach((d, i) => out.copyToChannel(d as Float32Array<ArrayBuffer>, i));
        return out;
      })();
      this.stretchCache.set(c.id, job);
    }
    return job;
  }

  private track(assetId: string) {
    let t = this.tracks.get(assetId);
    if (!t) {
      t = this.media.getInput(assetId)?.getPrimaryAudioTrack() ?? Promise.resolve(null);
      this.tracks.set(assetId, t);
    }
    return t;
  }

  async render(t0: number, t1: number): Promise<AudioBuffer> {
    const s0 = Math.round(t0 * SAMPLE_RATE);
    const s1 = Math.round(t1 * SAMPLE_RATE);
    const outLen = Math.max(1, s1 - s0);
    // Pré-rolagem: compressor/gate começam cada bloco já "aquecidos", sem saltos de ganho
    // nas emendas. Renderiza um pouco antes e descarta esse trecho.
    const preSamples = Math.min(s0, Math.round(PRE_ROLL * SAMPLE_RATE));
    const ctx = new OfflineAudioContext(2, outLen + preSamples, SAMPLE_RATE);
    if (this.clips.some((c) => c.audio?.gateDb !== null && c.audio?.gateDb !== undefined)) await prepareContext(ctx);
    const start = (s0 - preSamples) / SAMPLE_RATE;
    const end = s1 / SAMPLE_RATE;

    for (const c of this.clips) {
      const cs = c.start;
      const ce = clipEnd(c);
      if (ce <= start || cs >= end) continue;
      const track = await this.track(c.assetId);
      if (!track || !this.p.assets[c.assetId]) continue;

      const segStart = Math.max(start, cs);
      const segEnd = Math.min(end, ce);
      const chain = buildChain(ctx, c.audio, c.volume);
      chain.output.connect(ctx.destination);
      // Fade: automação linear de ganho entre os pontos do fade (exata, pois o fade é linear).
      const fade = ctx.createGain();
      fade.connect(chain.input);
      const pts = [start, c.start + c.fadeIn, ce - c.fadeOut, end].filter((x) => x >= start && x <= end).sort((a, b) => a - b);
      fade.gain.setValueAtTime(fadeGain(c, start), 0);
      for (const x of pts.slice(1)) fade.gain.linearRampToValueAtTime(fadeGain(c, Math.min(x, ce)), x - start);

      if (Math.abs(speedOf(c) - 1) > 1e-6) {
        // Velocidade: áudio do clipe inteiro esticado sem mudar o tom (WSOLA), gerado uma vez.
        const stretched = await this.stretched(c, track);
        if (!stretched) continue;
        const node = ctx.createBufferSource();
        node.buffer = stretched;
        node.connect(fade);
        node.start(segStart - start, segStart - cs, segEnd - segStart);
        continue;
      }
      const srcA = c.sourceIn + (segStart - cs);
      const srcB = c.sourceIn + (segEnd - cs);

      // Começa um pouco antes para pegar o buffer que contém srcA.
      for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(Math.max(0, srcA - 0.1), srcB)) {
        const pos = cs + (timestamp - c.sourceIn);
        const playStart = Math.max(pos, segStart);
        const playEnd = Math.min(pos + buffer.duration, segEnd);
        if (playEnd <= playStart) continue;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(fade);
        node.start(playStart - start, playStart - pos, playEnd - playStart);
      }
    }
    const rendered = await ctx.startRendering();
    if (!preSamples) return rendered;
    const out = new AudioBuffer({ length: outLen, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
    for (let ch = 0; ch < 2; ch++) out.copyToChannel(rendered.getChannelData(ch).subarray(preSamples, preSamples + outLen), ch);
    return out;
  }
}
