// Ganchos de teste carregados apenas em `npm run dev` (import.meta.env.DEV).
// Usados pelo teste end-to-end (scripts/e2e.mjs) para gerar mídia sintética e
// verificar o arquivo exportado. Não fazem parte do build de produção.

import { ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output } from 'mediabunny';
import { actions, media, playback, store, transcripts } from '../app/editor';
import { analysisStore } from '../app/analysis';
import { toSRT } from '../engine/captions/captions';
import * as ai from '../app/aiEditor';
import { clearLoadFiles, makeLongVideo } from './loadGen';
import { metrics } from '../engine/diagnostics/metrics';
import { jobs } from '../engine/jobs/JobQueue';
import { cache } from '../engine/cache/CacheEngine';
import * as insert from '../engine/motion/insert';
import * as ops from '../engine/timeline/operations';
import * as anim from '../core/animation';
import * as commands from '../engine/ai/commands';
import { Cmd } from '../engine/commands/commands';
import { createdIds } from '../engine/commands/patch';
import { prefsStore } from '../app/prefs';
import { projectFile } from '../app/editor';
import { serialize, deserialize } from '../engine/project/ProjectEngine';
import { exportProject } from '../engine/export/ExportEngine';
import * as smartCut from '../app/smartCut';
import * as workflow from '../app/workflow';
import { viewStore } from '../app/view';

/** Gera um MP4 H.264+AAC com contador de quadros e um tom senoidal. */
async function makeTestVideo(opts: { name: string; seconds: number; width: number; height: number; fps: number; hue: number; freq: number }) {
  const canvas = new OffscreenCanvas(opts.width, opts.height);
  const ctx = canvas.getContext('2d')!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 2_000_000 });
  const audio = new AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
  output.addVideoTrack(video, { frameRate: opts.fps });
  output.addAudioTrack(audio);
  await output.start();
  const total = Math.round(opts.seconds * opts.fps);
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = `hsl(${opts.hue}, 60%, ${20 + (i % opts.fps)}%)`;
    ctx.fillRect(0, 0, opts.width, opts.height);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(opts.height / 5)}px sans-serif`;
    ctx.fillText(`${opts.name} ${i}`, 20, opts.height / 2);
    await video.add(i / opts.fps, 1 / opts.fps);
  }
  const sr = 48000;
  const buf = new AudioBuffer({ length: Math.round(opts.seconds * sr), numberOfChannels: 2, sampleRate: sr });
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = 0.3 * Math.sin((2 * Math.PI * opts.freq * i) / sr);
  }
  await audio.add(buf);
  await output.finalize();
  const data = (output.target as BufferTarget).buffer!;
  return new File([data], `${opts.name}.mp4`, { type: 'video/mp4', lastModified: Date.now() });
}

/** Busca um tempo e mede até o preview mostrar o quadro (mídia posicionada + desenho). */
async function measureSeek(t: number): Promise<number> {
  const t0 = performance.now();
  playback.seek(t);
  const frames0 = metrics.previewFrames;
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    if (metrics.previewFrames > frames0) return performance.now() - t0;
  }
  return Infinity;
}

/** Gera um áudio AAC (tom com pausas) — para testar importação de áudio separado. */
async function makeTestAudio(opts: { name: string; seconds: number; freq: number }) {
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const audio = new AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
  output.addAudioTrack(audio);
  await output.start();
  const sr = 48000;
  const buf = new AudioBuffer({ length: Math.round(opts.seconds * sr), numberOfChannels: 2, sampleRate: sr });
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = 0.3 * Math.sin((2 * Math.PI * opts.freq * i) / sr);
  }
  await audio.add(buf);
  await output.finalize();
  return new File([(output.target as BufferTarget).buffer!], `${opts.name}.m4a`, { type: 'audio/mp4', lastModified: 1 });
}

let lastExport: Blob | null = null;

/** Toca o último arquivo exportado num <video> de verdade e informa se reproduziu. */
async function playExported(): Promise<{ played: boolean; duration: number; width: number; height: number; error?: string }> {
  if (!lastExport) return { played: false, duration: 0, width: 0, height: 0, error: 'nada exportado' };
  const v = document.createElement('video');
  v.muted = true;
  v.src = URL.createObjectURL(lastExport);
  try {
    await new Promise((res, rej) => {
      v.onloadedmetadata = res;
      v.onerror = () => rej(new Error(v.error?.message ?? 'erro de mídia'));
    });
    await v.play();
    await new Promise((r) => setTimeout(r, 1200));
    const played = v.currentTime > 0.5;
    v.pause();
    return { played, duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  } catch (e) {
    return { played: false, duration: 0, width: 0, height: 0, error: String(e) };
  } finally {
    URL.revokeObjectURL(v.src);
  }
}

/** Lê o quadro do arquivo exportado no tempo t (cor média do centro). */
async function exportedPixel(t: number) {
  if (!lastExport) return null;
  const input = new Input({ source: new BlobSource(lastExport), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return null;
  const { CanvasSink } = await import('mediabunny');
  const sink = new CanvasSink(track, { width: 64, height: 36, fit: 'fill' });
  const w = await sink.getCanvas(t);
  const c = w!.canvas as OffscreenCanvas;
  const d = (c.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(32, 18, 1, 1).data;
  input.dispose();
  return [d[0], d[1], d[2]];
}

/** Lê dimensões e duração de um arquivo de vídeo (mesma instância do Mediabunny do app). */
async function probeBlob(b: Blob) {
  const i = new Input({ source: new BlobSource(b), formats: ALL_FORMATS });
  const v = await i.getPrimaryVideoTrack();
  const r = { w: v ? await v.getDisplayWidth() : 0, h: v ? await v.getDisplayHeight() : 0, d: await i.computeDuration(), size: b.size };
  i.dispose();
  return r;
}

/** Exporta para memória e devolve metadados lidos de volta do arquivo gerado. */
async function exportAndProbe(settings: { width: number; height: number; fps: number; bitrate: number; codec: 'avc' | 'hevc' }) {
  const ctrl = new AbortController();
  let frames = 0;
  const { blob } = await exportProject(store.getState().project, media, settings, { kind: 'buffer' }, (p) => (frames = p.frame), ctrl.signal);
  lastExport = blob ?? null;
  const input = new Input({ source: new BlobSource(blob!), formats: ALL_FORMATS });
  const v = await input.getPrimaryVideoTrack();
  const a = await input.getPrimaryAudioTrack();
  const result = {
    bytes: blob!.size,
    framesReported: frames,
    duration: await input.computeDuration(),
    width: v ? await v.getDisplayWidth() : 0,
    height: v ? await v.getDisplayHeight() : 0,
    videoCodec: v ? await v.getCodec() : null,
    audioCodec: a ? await a.getCodec() : null,
    videoPackets: v ? (await v.computePacketStats()).packetCount : 0,
    audioDuration: a ? await a.computeDuration() : 0,
  };
  input.dispose();
  return result;
}

Object.assign(window, { __foco: { store, media, playback, actions, transcripts, analysisStore, toSRT, ai, insert, ops, anim, commands, Cmd, createdIds, prefsStore, projectFile, serialize, deserialize, makeTestVideo, makeTestAudio, exportAndProbe, playExported, exportedPixel, makeLongVideo, clearLoadFiles, metrics, measureSeek, jobs, cache, probeBlob, smartCut, workflow, viewStore } });
