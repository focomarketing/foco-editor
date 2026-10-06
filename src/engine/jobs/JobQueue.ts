// MEDIA JOB QUEUE: todo processamento pesado vira um job com status, progresso,
// prioridade, cancelamento e retry. A UI só observa; nada pesado roda "solto".

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type JobPriority = 'high' | 'medium' | 'low';
export type JobType = 'analyze' | 'thumbnail' | 'filmstrip' | 'preview-thumbs' | 'waveform' | 'proxy' | 'hash' | 'transcribe' | 'export';

export interface JobContext {
  signal: AbortSignal;
  progress(p: number, detail?: string): void;
}

export interface Job {
  id: string;
  type: JobType;
  label: string;
  /** Asset relacionado (se houver). */
  assetId?: string;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  detail?: string;
  priority: JobPriority;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

interface Entry {
  job: Job;
  run: (ctx: JobContext) => Promise<unknown>;
  ctrl?: AbortController;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  promise: Promise<unknown>;
}

const RANK: Record<JobPriority, number> = { high: 0, medium: 1, low: 2 };

/** Quantos jobs de cada grupo rodam ao mesmo tempo (decodificação pesada é limitada). */
const LIMITS: Partial<Record<JobType, number>> = { proxy: 1, export: 1, transcribe: 1, waveform: 1 };
const GLOBAL_LIMIT = 3;
/**
 * Grupos que disputam o mesmo recurso. Decodificar vídeo (4K principalmente) usa memória
 * da GPU: medimos ~5,6 GB de VRAM com 3 decodificações 4K simultâneas numa GPU de 6 GB.
 */
const GROUPS: Partial<Record<JobType, { group: string; limit: number }>> = {
  thumbnail: { group: 'decode', limit: 2 },
  'preview-thumbs': { group: 'decode', limit: 2 },
  proxy: { group: 'decode', limit: 2 },
  export: { group: 'decode', limit: 2 },
};
const KEEP_FINISHED = 60;

export class CancelledError extends Error {
  constructor() {
    super('Cancelado');
    this.name = 'AbortError';
  }
}

export class JobQueue {
  private entries: Entry[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private seq = 0;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  get jobs(): Job[] {
    return this.entries.map((e) => e.job);
  }

  get active(): Job[] {
    return this.jobs.filter((j) => j.status === 'queued' || j.status === 'processing');
  }

  forAsset(assetId: string): Job[] {
    return this.jobs.filter((j) => j.assetId === assetId);
  }

  /** Enfileira e devolve a promessa do resultado (rejeita se falhar ou for cancelado). */
  add<T>(spec: { type: JobType; label: string; assetId?: string; priority?: JobPriority }, run: (ctx: JobContext) => Promise<T>): { id: string; done: Promise<T> } {
    const id = `job${++this.seq}`;
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => {}); // erros ficam visíveis no job; quem aguarda trata
    this.entries.push({
      job: { id, type: spec.type, label: spec.label, assetId: spec.assetId, status: 'queued', progress: 0, priority: spec.priority ?? 'medium', createdAt: Date.now() },
      run: run as (ctx: JobContext) => Promise<unknown>,
      resolve,
      reject,
      promise,
    });
    this.trim();
    this.emit();
    queueMicrotask(() => this.pump());
    return { id, done: promise as Promise<T> };
  }

  /** Muda a prioridade (ex.: o vídeo entrou na timeline → sobe). */
  setPriority(id: string, priority: JobPriority) {
    const e = this.entries.find((x) => x.job.id === id);
    if (!e || e.job.status !== 'queued') return;
    e.job = { ...e.job, priority };
    this.emit();
    this.pump();
  }

  cancel(id: string) {
    const e = this.entries.find((x) => x.job.id === id);
    if (!e) return;
    if (e.job.status === 'queued') {
      this.finish(e, 'cancelled');
      e.reject(new CancelledError());
    } else if (e.job.status === 'processing') {
      e.ctrl?.abort();
    }
  }

  /** Reexecuta um job que falhou ou foi cancelado (mesmo trabalho, novo id). */
  retry(id: string): Promise<unknown> | null {
    const e = this.entries.find((x) => x.job.id === id);
    if (!e || (e.job.status !== 'failed' && e.job.status !== 'cancelled')) return null;
    const { type, label, assetId, priority } = e.job;
    this.entries = this.entries.filter((x) => x !== e);
    return this.add({ type, label, assetId, priority }, e.run).done;
  }

  clearFinished() {
    this.entries = this.entries.filter((e) => e.job.status === 'queued' || e.job.status === 'processing');
    this.emit();
  }

  private patch(e: Entry, p: Partial<Job>) {
    e.job = { ...e.job, ...p };
    this.emit();
  }

  private finish(e: Entry, status: JobStatus, error?: string) {
    this.patch(e, { status, finishedAt: Date.now(), error, progress: status === 'completed' ? 1 : e.job.progress });
  }

  private pump() {
    const running = this.entries.filter((e) => e.job.status === 'processing');
    if (running.length >= GLOBAL_LIMIT) return;
    const queued = this.entries
      .filter((e) => e.job.status === 'queued')
      .sort((a, b) => RANK[a.job.priority] - RANK[b.job.priority] || a.job.createdAt - b.job.createdAt);
    for (const e of queued) {
      if (this.entries.filter((x) => x.job.status === 'processing').length >= GLOBAL_LIMIT) break;
      const limit = LIMITS[e.job.type];
      if (limit !== undefined && this.entries.filter((x) => x.job.status === 'processing' && x.job.type === e.job.type).length >= limit) continue;
      const g = GROUPS[e.job.type];
      if (g && this.entries.filter((x) => x.job.status === 'processing' && GROUPS[x.job.type]?.group === g.group).length >= g.limit) continue;
      void this.start(e);
    }
  }

  private async start(e: Entry) {
    e.ctrl = new AbortController();
    this.patch(e, { status: 'processing', startedAt: Date.now() });
    let lastEmit = 0;
    const ctx: JobContext = {
      signal: e.ctrl.signal,
      progress: (p, detail) => {
        const now = performance.now();
        if (now - lastEmit < 100 && p < 1) {
          e.job = { ...e.job, progress: p, detail: detail ?? e.job.detail };
          return;
        }
        lastEmit = now;
        this.patch(e, { progress: Math.min(1, Math.max(0, p)), detail: detail ?? e.job.detail });
      },
    };
    try {
      const value = await e.run(ctx);
      if (e.ctrl.signal.aborted) throw new CancelledError();
      this.finish(e, 'completed');
      e.resolve(value);
    } catch (err) {
      const cancelled = e.ctrl.signal.aborted || (err instanceof DOMException && err.name === 'AbortError') || err instanceof CancelledError;
      this.finish(e, cancelled ? 'cancelled' : 'failed', cancelled ? undefined : err instanceof Error ? err.message : String(err));
      e.reject(cancelled ? new CancelledError() : err);
    } finally {
      this.pump();
    }
  }

  private trim() {
    const finished = this.entries.filter((e) => !(e.job.status === 'queued' || e.job.status === 'processing'));
    if (finished.length <= KEEP_FINISHED) return;
    const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED));
    this.entries = this.entries.filter((e) => !drop.has(e));
  }
}

export const jobs = new JobQueue();
