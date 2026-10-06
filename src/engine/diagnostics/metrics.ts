// Diagnóstico interno: tempos de processamento, FPS do preview, quadros perdidos,
// tarefas longas da thread principal e memória. Alimenta o Performance Panel e os
// testes de carga. CPU/GPU por processo não são expostos ao navegador.

export interface TimingSample {
  kind: string;
  label: string;
  ms: number;
  at: number;
  /** ex.: segundos de mídia processados, para calcular velocidade (x tempo real). */
  mediaSeconds?: number;
}

type Listener = () => void;

class Metrics {
  timings: TimingSample[] = [];
  previewFrames = 0;
  /** Quadros desenhados por segundo no preview (média móvel de 1 s). */
  previewFps = 0;
  droppedFrames = 0;
  longTasks = 0;
  longTaskMs = 0;
  maxLongTaskMs = 0;
  private frameTimes: number[] = [];
  private listeners = new Set<Listener>();
  private version = 0;

  constructor() {
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          this.longTasks++;
          this.longTaskMs += e.duration;
          this.maxLongTaskMs = Math.max(this.maxLongTaskMs, e.duration);
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      /* navegador sem longtask */
    }
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  record(kind: string, label: string, ms: number, mediaSeconds?: number) {
    this.timings.push({ kind, label, ms, at: Date.now(), mediaSeconds });
    if (this.timings.length > 500) this.timings.shift();
    this.emit();
  }

  /** Mede uma operação assíncrona. */
  async time<T>(kind: string, label: string, fn: () => Promise<T>, mediaSeconds?: number): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.record(kind, label, performance.now() - t0, mediaSeconds);
    }
  }

  frameDrawn() {
    const now = performance.now();
    this.previewFrames++;
    this.frameTimes.push(now);
    while (this.frameTimes.length && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
    this.previewFps = this.frameTimes.length;
  }

  memory(): { usedMB: number; limitMB: number } | null {
    const m = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    return m ? { usedMB: m.usedJSHeapSize / 1048576, limitMB: m.jsHeapSizeLimit / 1048576 } : null;
  }

  resetCounters() {
    this.longTasks = 0;
    this.longTaskMs = 0;
    this.maxLongTaskMs = 0;
    this.previewFrames = 0;
    this.droppedFrames = 0;
    this.emit();
  }

  last(kind: string) {
    for (let i = this.timings.length - 1; i >= 0; i--) if (this.timings[i].kind === kind) return this.timings[i];
    return undefined;
  }
}

export const metrics = new Metrics();
