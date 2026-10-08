// Aba Corte: monta a fala da timeline, gera o plano (engine/cut/smartCut), guarda a revisão
// (o que está marcado) e aplica tudo como UM passo de undo. Depois confere o resultado.

import type { Project } from '../core/types';
import { sourceEnd, toTimeline } from '../core/clipTime';
import { Cmd } from '../engine/commands/commands';
import { CUT_MODES, DEFAULT_OPTIONS, SMART_CUT_LABEL, checkCut, planSmartCuts } from '../engine/cut/smartCut';
import type { CutCheck, SmartCut, SmartCutKind, SmartCutOptions, TlWord } from '../engine/cut/smartCut';
import { LEVEL_RATE, noiseProfile } from '../engine/analysis/silence';
import { clipEnd } from '../engine/timeline/operations';
import type { Range } from '../engine/timeline/operations';
import { media, store, transcripts } from './editor';
import { notify } from './notify';

export interface SmartCutState {
  options: SmartCutOptions;
  cuts: SmartCut[];
  selected: Set<string>;
  busy: boolean;
  /** Duração da fala na timeline antes de cortar (s). */
  before: number;
  /** Mídias com fala que ainda não têm transcrição. */
  missing: string[];
  /** Resultado da conferência depois de aplicar. */
  lastApply: { removed: number; count: number; counts: Partial<Record<SmartCutKind, number>>; check: CutCheck; at: number } | null;
}

let state: SmartCutState = { options: DEFAULT_OPTIONS, cuts: [], selected: new Set(), busy: false, before: 0, missing: [], lastApply: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<SmartCutState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export const smartCutStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
  setOptions(patch: Partial<SmartCutOptions>) {
    set({ options: { ...state.options, ...patch } });
  },
  toggle(id: string) {
    const selected = new Set(state.selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    set({ selected });
  },
  setAll(on: boolean) {
    set({ selected: on ? new Set(state.cuts.map((c) => c.id)) : new Set() });
  },
  clear() {
    set({ cuts: [], selected: new Set() });
  },
};

/** Clipes de mídia com fala na timeline (trilhas de vídeo e áudio visíveis/ativas), em ordem. */
function speechClips(p: Project) {
  const hidden = new Set(p.tracks.filter((t) => t.hidden || t.muted).map((t) => t.id));
  return Object.values(p.clips)
    // volume 0 = take de apoio sem som (B-roll): não é fala
    .filter((c) => !c.caption && !c.title && !hidden.has(c.trackId) && p.assets[c.assetId]?.hasAudio && !c.muted && c.volume > 0)
    .sort((a, b) => a.start - b.start);
}

/** Palavras na ordem da timeline, com a origem de cada uma (para medir a onda). */
export function timelineSpeech(p: Project): { words: TlWord[]; missing: string[] } {
  const words: TlWord[] = [];
  const missing = new Set<string>();
  const seenAssetTrack = new Set<string>();
  speechClips(p).forEach((c, seg) => {
    // A mesma fala em duas trilhas (ex.: áudio separado) conta uma vez só.
    const key = `${c.assetId}@${c.start.toFixed(3)}`;
    if (seenAssetTrack.has(key)) return;
    seenAssetTrack.add(key);
    const t = transcripts.get(c.assetId);
    if (!t) {
      missing.add(c.assetId);
      return;
    }
    const srcEnd = sourceEnd(c);
    for (const w of t.words) {
      const mid = (w.start + w.end) / 2;
      if (mid < c.sourceIn || mid >= srcEnd) continue;
      const start = Math.max(c.start, toTimeline(c, w.start));
      const end = Math.min(clipEnd(c), toTimeline(c, w.end));
      words.push({ text: w.text, start, end: Math.max(end, start + 0.05), assetId: c.assetId, srcStart: w.start, srcEnd: w.end, seg });
    }
  });
  return { words: words.sort((a, b) => a.start - b.start), missing: [...missing] };
}

async function wavesFor(words: TlWord[]) {
  const waves = new Map<string, Float32Array>();
  for (const id of new Set(words.map((w) => w.assetId))) {
    const levels = media.get(id)?.levels ?? (await media.whenLevels(id));
    if (levels) waves.set(id, levels);
  }
  return waves;
}

export async function analyzeSmartCuts() {
  const p = store.getState().project;
  const { words, missing } = timelineSpeech(p);
  if (!words.length) {
    set({ missing, cuts: [], selected: new Set() });
    notify(missing.length ? 'Transcreva a fala primeiro (aba IA ou o botão aqui).' : 'Nenhuma fala na timeline.', 'error');
    return;
  }
  set({ busy: true, missing });
  try {
    const waves = await wavesFor(words);
    const { cuts } = planSmartCuts(words, waves, state.options);
    const before = words.at(-1)!.end - words[0].start;
    set({ cuts, selected: new Set(cuts.map((c) => c.id)), before, lastApply: null });
    if (!cuts.length) notify('Nada para cortar neste modo. A fala já está limpa.');
  } finally {
    set({ busy: false });
  }
}

/** Aplica os cortes marcados (um passo de undo) e confere o resultado. */
export async function applySmartCuts() {
  const chosen = state.cuts.filter((c) => state.selected.has(c.id));
  if (!chosen.length) return;
  const ranges: Range[] = chosen.map((c) => [c.start, c.end]);
  const removed = ranges.reduce((s, [a, b]) => s + (b - a), 0);
  const counts: Partial<Record<SmartCutKind, number>> = {};
  for (const c of chosen) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  store.execute(Cmd.rippleRemove(ranges, `Corte (${CUT_MODES[state.options.mode].label}): ${chosen.length} trechos`), []);

  // Conferência: pausas que sobraram acima do modo e emendas no meio de som.
  const p = store.getState().project;
  const { words } = timelineSpeech(p);
  const waves = await wavesFor(words);
  const clips = speechClips(p);
  const splices = clips.slice(1).map((c) => c.start);
  const soundAt = (t: number) => {
    const c = clips.find((x) => t >= x.start && t < clipEnd(x));
    const lv = c && waves.get(c.assetId);
    if (!c || !lv) return false;
    const src = c.sourceIn + (t - c.start);
    return lv[Math.min(lv.length - 1, Math.max(0, Math.round(src * LEVEL_RATE)))] >= noiseProfile(lv).thresholdDb;
  };
  const check = checkCut(words, state.options.mode, splices, soundAt);
  set({ cuts: state.cuts.filter((c) => !state.selected.has(c.id)), selected: new Set(), lastApply: { removed, count: chosen.length, counts, check, at: Date.now() } });
  const parts = (Object.entries(counts) as [SmartCutKind, number][]).map(([k, n]) => `${n}× ${SMART_CUT_LABEL[k].toLowerCase()}`);
  notify(`Corte aplicado: ${parts.join(', ')} · ${removed.toFixed(1).replace('.', ',')} s a menos. Ctrl+Z desfaz tudo.`, 'success', 6000);
}
