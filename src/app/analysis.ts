// Estado de revisão das sugestões de corte (não entra no projeto nem no histórico).

import type { CutKind, CutLevel, CutSuggestion } from '../engine/analysis/cuts';

export interface AnalysisState {
  assetId: string | null;
  level: CutLevel;
  suggestions: CutSuggestion[];
  /** ids marcados para aplicar */
  selected: Set<string>;
  /** Fonte da análise: só áudio, ou áudio + transcrição. */
  usedTranscript: boolean;
  /** Resumo da última edição aplicada (AI EDIT SUMMARY). */
  lastEdit: { counts: Partial<Record<CutKind, number>>; seconds: number; cuts: number; at: number } | null;
}

let state: AnalysisState = {
  assetId: null,
  level: 'balanced',
  suggestions: [],
  selected: new Set(),
  usedTranscript: false,
  lastEdit: null,
};
const listeners = new Set<() => void>();

export const analysisStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
  set(patch: Partial<AnalysisState>) {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  },
  toggle(id: string) {
    const selected = new Set(state.selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    analysisStore.set({ selected });
  },
  setAll(on: boolean) {
    analysisStore.set({ selected: on ? new Set(state.suggestions.map((s) => s.id)) : new Set() });
  },
};
