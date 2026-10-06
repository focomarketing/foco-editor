// Worker de transcrição: Whisper (ONNX) rodando localmente via transformers.js.
// WebGPU quando disponível, WebAssembly como alternativa. O áudio nunca sai da máquina;
// só os arquivos do modelo são baixados uma vez (ficam no cache do navegador).

import { env, pipeline } from '@huggingface/transformers';
import type { AutomaticSpeechRecognitionPipeline, ProgressInfo } from '@huggingface/transformers';

export type WorkerRequest =
  | { type: 'load'; model: string; dtype: { webgpu: Record<string, string>; wasm: Record<string, string> } }
  | { type: 'run'; id: number; audio: Float32Array; language: string | null };

export type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'result'; id: number; words: { text: string; start: number; end: number | null }[] }
  | { type: 'error'; id?: number; message: string };

env.allowLocalModels = false;

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadedModel = '';
let device: 'webgpu' | 'wasm' = 'wasm';

const post = (msg: WorkerResponse) => self.postMessage(msg);

async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function load(model: string, dtypes: { webgpu: Record<string, string>; wasm: Record<string, string> }) {
  if (asr && loadedModel === model) {
    post({ type: 'ready', device });
    return;
  }
  if (asr) {
    await asr.dispose();
    asr = null;
  }
  device = (await hasWebGPU()) ? 'webgpu' : 'wasm';
  const dtype = dtypes[device];
  const files = new Map<string, { loaded: number; total: number }>();
  asr = (await pipeline('automatic-speech-recognition', model, {
    device,
    dtype: dtype as never,
    progress_callback: (p: ProgressInfo) => {
      if (p.status === 'progress') {
        files.set(p.file, { loaded: p.loaded, total: p.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        post({ type: 'progress', loaded, total });
      }
    },
  })) as AutomaticSpeechRecognitionPipeline;
  loadedModel = model;
  post({ type: 'ready', device });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await load(msg.model, msg.dtype);
    } else if (msg.type === 'run') {
      if (!asr) throw new Error('modelo não carregado');
      const out = await asr(msg.audio, {
        return_timestamps: 'word',
        task: 'transcribe',
        ...(msg.language ? { language: msg.language } : {}),
      });
      const result = Array.isArray(out) ? out[0] : out;
      const words = (result.chunks ?? []).map((c: { text: string; timestamp: [number, number | null] }) => ({ text: c.text, start: c.timestamp[0], end: c.timestamp[1] }));
      post({ type: 'result', id: msg.id, words });
    }
  } catch (err) {
    post({ type: 'error', id: msg.type === 'run' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
