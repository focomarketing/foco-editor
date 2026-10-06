// Transcript Engine: transforma o áudio de um asset em palavras com tempo (tempo da mídia).
// O áudio é decodificado aos pedaços (no máximo ~30 s), reamostrado para 16 kHz mono e
// enviado ao worker do Whisper. Os pedaços terminam no ponto mais silencioso perto do
// limite, para não cortar palavras ao meio; trechos sem fala são pulados (evita o
// Whisper "inventar" texto em silêncio).

import { AudioBufferSink } from 'mediabunny';
import type { Asset, Transcript, TranscriptWord } from '../../core/types';
import type { MediaEngine } from '../media/MediaEngine';
import { idb, safe } from '../platform/idb';
import { LEVEL_RATE, noiseProfile, quietFraction } from '../analysis/silence';
import type { WorkerRequest, WorkerResponse } from './whisper.worker';

export interface WhisperModel {
  id: string;
  label: string;
  /** Download aproximado (MB) com GPU / sem GPU. */
  mbGpu: number;
  mbCpu: number;
  /** Precisão dos pesos por dispositivo (arquivos do repositório ONNX). */
  dtype: { webgpu: Record<string, string>; wasm: Record<string, string> };
}

const STD_DTYPE = {
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' },
};

export const WHISPER_MODELS: WhisperModel[] = [
  { id: 'onnx-community/whisper-base_timestamped', label: 'Rápido · Whisper base', mbGpu: 206, mbCpu: 77, dtype: STD_DTYPE },
  { id: 'onnx-community/whisper-small_timestamped', label: 'Preciso · Whisper small', mbGpu: 586, mbCpu: 249, dtype: STD_DTYPE },
  {
    id: 'onnx-community/whisper-large-v3-turbo_timestamped',
    label: 'Máximo · Whisper large-v3 turbo',
    mbGpu: 760,
    mbCpu: 1085,
    dtype: {
      webgpu: { encoder_model: 'q4', decoder_model_merged: 'q4' },
      wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    },
  },
];

export const LANGUAGES = [
  { id: 'portuguese', label: 'Português' },
  { id: 'english', label: 'Inglês' },
  { id: 'spanish', label: 'Espanhol' },
  { id: '', label: 'Detectar automaticamente' },
];

export type JobState =
  | { phase: 'loading-model'; loaded: number; total: number }
  | { phase: 'transcribing'; done: number; total: number; device: string; startedAt: number }
  | { phase: 'error'; message: string };

const SAMPLE_RATE = 16_000;
const MAX_CHUNK = 29.5;
const MIN_CHUNK = 20;

const fingerprint = (a: Asset) => `${a.name}|${a.size}|${a.lastModified}`;

export class TranscriptEngine {
  private transcripts = new Map<string, Transcript>();
  private jobs = new Map<string, JobState>();
  private listeners = new Set<() => void>();
  private version = 0;
  private worker: Worker | null = null;
  private media: MediaEngine;

  constructor(media: MediaEngine) {
    this.media = media;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  get(assetId: string) {
    return this.transcripts.get(assetId);
  }

  job(assetId: string) {
    return this.jobs.get(assetId);
  }

  all(): Transcript[] {
    return [...this.transcripts.values()];
  }

  /** Recupera transcrições já feitas (cache por arquivo) e as que vieram no arquivo do projeto. */
  async hydrate(assets: Asset[], fromProject: Transcript[] = []) {
    this.transcripts.clear();
    for (const t of fromProject) this.transcripts.set(t.assetId, t);
    for (const a of assets) {
      if (this.transcripts.has(a.id)) continue;
      const t = await safe(idb.get<Transcript>('transcripts', fingerprint(a)));
      if (t) this.transcripts.set(a.id, { ...t, assetId: a.id });
    }
    this.emit();
  }

  /** Edição manual de palavras (corrigir o que o modelo errou). */
  async setWords(asset: Asset, words: TranscriptWord[]) {
    const t = this.transcripts.get(asset.id);
    if (!t) return;
    const next = { ...t, words };
    this.transcripts.set(asset.id, next);
    this.emit();
    await safe(idb.set('transcripts', fingerprint(asset), next));
  }

  cancel(assetId: string) {
    if (!this.jobs.has(assetId)) return;
    this.worker?.terminate();
    this.worker = null;
    this.jobs.delete(assetId);
    this.emit();
  }

  private setJob(assetId: string, s: JobState | null) {
    if (s) this.jobs.set(assetId, s);
    else this.jobs.delete(assetId);
    this.emit();
  }

  private getWorker(): Worker {
    this.worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    return this.worker;
  }

  private request<T extends WorkerResponse['type']>(
    msg: WorkerRequest,
    until: T,
    onProgress?: (m: Extract<WorkerResponse, { type: 'progress' }>) => void,
    transfer: Transferable[] = [],
  ): Promise<Extract<WorkerResponse, { type: T }>> {
    const worker = this.getWorker();
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent<WorkerResponse>) => {
        const r = e.data;
        if (r.type === 'progress') onProgress?.(r);
        else if (r.type === 'error') done(() => reject(new Error(r.message)));
        else if (r.type === until) done(() => resolve(r as Extract<WorkerResponse, { type: T }>));
      };
      const onError = (e: ErrorEvent) => done(() => reject(new Error(e.message || 'falha no worker de transcrição')));
      const done = (fn: () => void) => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        fn();
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage(msg, transfer);
    });
  }

  async transcribe(asset: Asset, opts: { model: string; language: string }): Promise<Transcript | null> {
    if (this.jobs.has(asset.id)) return null;
    const input = this.media.getInput(asset.id);
    const track = await input?.getPrimaryAudioTrack();
    if (!track) throw new Error('A mídia não tem áudio decodificável.');

    try {
      this.setJob(asset.id, { phase: 'loading-model', loaded: 0, total: 0 });
      const spec = WHISPER_MODELS.find((m) => m.id === opts.model) ?? WHISPER_MODELS[0];
      const ready = await this.request({ type: 'load', model: spec.id, dtype: spec.dtype }, 'ready', (p) => {
        if (this.jobs.has(asset.id)) this.setJob(asset.id, { phase: 'loading-model', loaded: p.loaded, total: p.total });
      });

      const levels = await this.media.whenLevels(asset.id);
      const chunks = planChunks(asset.duration, levels);
      const threshold = levels ? noiseProfile(levels).thresholdDb : -Infinity;
      const startedAt = performance.now();
      const words: TranscriptWord[] = [];
      const sink = new AudioBufferSink(track);

      for (let i = 0; i < chunks.length; i++) {
        if (!this.jobs.has(asset.id)) return null; // cancelado
        this.setJob(asset.id, { phase: 'transcribing', done: i, total: chunks.length, device: ready.device, startedAt });
        const [a, b] = chunks[i];
        if (levels && quietFraction(levels, threshold, a, b) > 0.97) continue;
        const audio = await decodeMono16k(sink, a, b);
        const res = await this.request({ type: 'run', id: i, audio, language: opts.language || null }, 'result', undefined, [audio.buffer]);
        for (const w of res.words) {
          const text = w.text.trim();
          if (!text) continue;
          const start = a + w.start;
          const end = a + (w.end ?? w.start + 0.3);
          words.push({ text, start, end: Math.min(Math.max(end, start + 0.02), b) });
        }
      }

      const transcript: Transcript = {
        assetId: asset.id,
        model: opts.model,
        language: opts.language || 'auto',
        device: ready.device,
        seconds: (performance.now() - startedAt) / 1000,
        createdAt: Date.now(),
        words,
      };
      this.transcripts.set(asset.id, transcript);
      this.setJob(asset.id, null);
      await safe(idb.set('transcripts', fingerprint(asset), transcript));
      return transcript;
    } catch (e) {
      if (!this.jobs.has(asset.id)) return null; // cancelado: o worker foi encerrado
      this.setJob(asset.id, { phase: 'error', message: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }
}

/** Divide a duração em trechos de até ~30 s, terminando no ponto mais silencioso disponível. */
export function planChunks(duration: number, levels: Float32Array | null): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  while (start < duration - 0.05) {
    let end = Math.min(duration, start + MAX_CHUNK);
    if (end < duration && levels) {
      let best = end;
      let bestDb = Infinity;
      const i0 = Math.floor((start + MIN_CHUNK) * LEVEL_RATE);
      const i1 = Math.min(levels.length - 3, Math.floor(end * LEVEL_RATE));
      for (let i = i0; i < i1; i++) {
        const db = (levels[i] + levels[i + 1] + levels[i + 2]) / 3;
        if (db < bestDb) {
          bestDb = db;
          best = (i + 1.5) / LEVEL_RATE;
        }
      }
      end = best;
    }
    out.push([start, end]);
    start = end;
  }
  return out;
}

/** Decodifica [a, b) da mídia para mono 16 kHz (o formato que o Whisper espera). */
export async function decodeMono16k(sink: AudioBufferSink, a: number, b: number): Promise<Float32Array> {
  const len = Math.max(1, Math.round((b - a) * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(1, len, SAMPLE_RATE);
  for await (const { buffer, timestamp } of sink.buffers(Math.max(0, a - 0.1), b)) {
    const playStart = Math.max(timestamp, a);
    const playEnd = Math.min(timestamp + buffer.duration, b);
    if (playEnd <= playStart) continue;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.start(playStart - a, playStart - timestamp, playEnd - playStart);
  }
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}
