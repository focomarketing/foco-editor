// Preferências de interface e de performance (por navegador; não entram no projeto nem no histórico).

import { formatTimecode, formatTimecodeMs } from '../core/time';

export type TimeMode = 'frames' | 'ms';
export type Tool = 'select' | 'razor';
export type PreviewQuality = 'auto' | 'full' | '1/2' | '1/4' | '1/8';
export type PerformanceMode = 'auto' | 'quality' | 'balanced' | 'performance';
export type AutoProxy = 'ask' | 'always' | 'never';

export interface Prefs {
  timeMode: TimeMode;
  tool: Tool;
  previewQuality: PreviewQuality;
  useProxies: boolean;
  autoProxy: AutoProxy;
  performanceMode: PerformanceMode;
  /** Modo efetivo quando performanceMode = auto (definido pela detecção de hardware). */
  resolvedMode: Exclude<PerformanceMode, 'auto'>;
  /** Segundos entre autosaves; 0 = logo após cada edição. */
  autosaveInterval: number;
  showPerformancePanel: boolean;
}

const DEFAULTS: Prefs = {
  timeMode: 'frames',
  tool: 'select',
  previewQuality: 'auto',
  useProxies: true,
  autoProxy: 'ask',
  performanceMode: 'auto',
  resolvedMode: 'balanced',
  autosaveInterval: 0,
  showPerformancePanel: false,
};

const PERSIST: (keyof Prefs)[] = ['timeMode', 'previewQuality', 'useProxies', 'autoProxy', 'performanceMode', 'autosaveInterval', 'showPerformancePanel'];

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem('foco.prefs') ?? '{}') as Partial<Prefs>), tool: 'select' };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs = load();
const listeners = new Set<() => void>();

export const prefsStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => prefs,
  set(patch: Partial<Prefs>) {
    prefs = { ...prefs, ...patch };
    try {
      localStorage.setItem('foco.prefs', JSON.stringify(Object.fromEntries(PERSIST.map((k) => [k, prefs[k]]))));
    } catch {
      /* ok */
    }
    for (const l of listeners) l();
  },
};

/** Modo de performance em vigor (resolve "auto"). */
export const effectiveMode = (): Exclude<PerformanceMode, 'auto'> => (prefs.performanceMode === 'auto' ? prefs.resolvedMode : prefs.performanceMode);

/** Timecode no modo escolhido pelo usuário. */
export const formatTime = (t: number, fps: number, mode: TimeMode) => (mode === 'ms' ? formatTimecodeMs(t) : formatTimecode(t, fps));
