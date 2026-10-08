// Fases do fluxo guiado ligadas ao orquestrador de skills: ao entrar numa fase automática,
// as skills da etapa geram sugestões (EditOperation); as de confiança alta são aplicadas como
// UM passo de undo e o resto fica para revisão. Progresso, regenerar e desfazer por etapa.

import type { PhaseId } from '../core/workflow';
import type { Asset, TransitionSpec } from '../core/types';
import type { EditCommand } from '../video-editor/commands/types';
import { WHISPER_MODELS } from '../engine/transcript/TranscriptEngine';
import '../video-editor/skills';
import { runStage } from '../video-editor/orchestrator/orchestrator';
import type { SkillServices } from '../video-editor/orchestrator/orchestrator';
import { applyOperation, readOperations, rejectOperation, revertOperation, setSelected } from '../video-editor/history/operations';
import type { EditorPort } from '../video-editor/history/operations';
import { providerKeys, saveProviderKeys } from '../video-editor/assets/hub';
import { removableClips } from '../video-editor/commands/apply';
import type { SourceKeys } from '../engine/images/sources';
import { aiStore } from './aiEditor';
import { Cmd } from '../engine/commands/commands';
import { actions, media, store, transcripts } from './editor';
import { notify } from './notify';
import { timelineSpeech } from './smartCut';
import { blobToBase64, framePixels, grabFramesBase64 } from '../engine/media/generators';

export interface PhaseRun {
  phase: PhaseId;
  running: boolean;
  step: string;
  done: number;
  total: number;
  error: string | null;
  summary: string | null;
  /** Operação gerada pela última execução desta fase. */
  opId: string | null;
}

let state: PhaseRun | null = null;
let abort: AbortController | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<PhaseRun>) => {
  state = { ...(state as PhaseRun), ...patch };
  for (const l of listeners) l();
};

export const phaseRunStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
};

/** Fases que a IA executa sozinha ao entrar nelas. */
export const AUTO_PHASES: PhaseId[] = ['cut', 'images', 'transitions', 'motion'];

// --- ponte entre o orquestrador e o editor ----------------------------------------------------

export const editorPort: EditorPort = {
  getProject: () => store.getState().project,
  execute: (cmd) => store.execute(cmd, []) !== null,
  undoLabel: () => store.undoLabel,
  undo: () => store.undo(),
  setMeta: (k, v) => store.setMeta(k, v),
};

async function ensureTranscripts(progress: (step: string, done?: number, total?: number) => void) {
  const { missing } = timelineSpeech(store.getState().project);
  if (!missing.length) return;
  let model = WHISPER_MODELS[0].id;
  try {
    model = localStorage.getItem('foco.whisperModel') || model;
  } catch {
    /* padrão */
  }
  for (const [i, id] of missing.entries()) {
    const name = store.getState().project.assets[id]?.name ?? 'vídeo';
    progress(`Ouvindo a fala de "${name}" (${i + 1}/${missing.length})`, 0, 1);
    const stop = transcripts.subscribe(() => {
      const j = transcripts.job(id);
      if (j?.phase === 'transcribing') progress(`Transcrevendo "${name}" · trecho ${j.done + 1} de ${j.total}`, j.done, j.total);
      if (j?.phase === 'loading-model') progress('Baixando o modelo de voz (só na primeira vez)…', j.loaded, j.total || 1);
    });
    try {
      await actions.transcribe(id, model, 'portuguese');
    } finally {
      stop();
    }
  }
}

export const skillServices: SkillServices = {
  ensureTranscripts,
  async importFiles(files) {
    await actions.importItems(files.map((file) => ({ file })));
    const byName = new Map<string, Asset>(Object.values(store.getState().project.assets).map((a) => [a.name, a]));
    const out = new Map<string, { id: string; width: number; height: number; duration: number }>();
    for (const f of files) {
      const a = byName.get(f.name);
      if (a) out.set(f.name, { id: a.id, width: a.width, height: a.height, duration: a.duration });
    }
    return out;
  },
  async levels(id) {
    return media.get(id)?.levels ?? (await media.whenLevels(id));
  },
  async frames(id, times) {
    const entry = media.get(id);
    if (entry?.image) {
      const bmp = entry.image;
      const k = 512 / Math.max(1, bmp.width);
      const c = new OffscreenCanvas(512, Math.max(2, Math.round(bmp.height * k)));
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
      return [await blobToBase64(await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 }))];
    }
    const track = await media.getInput(id)?.getPrimaryVideoTrack();
    return track ? grabFramesBase64(track, times) : [];
  },
  async pixels(id, time, width) {
    const entry = media.get(id);
    if (entry?.image) {
      const c = new OffscreenCanvas(width, Math.max(2, Math.round((entry.image.height * width) / Math.max(1, entry.image.width))));
      const g = c.getContext('2d')!;
      g.drawImage(entry.image, 0, 0, c.width, c.height);
      return g.getImageData(0, 0, c.width, c.height);
    }
    const track = await media.getInput(id)?.getPrimaryVideoTrack();
    return track ? framePixels(track, time, width) : null;
  },
};

// --- execução -----------------------------------------------------------------------------

export function cancelPhase() {
  abort?.abort();
}

export async function runPhase(phase: PhaseId, opts: { regenerate?: boolean; autoApply?: boolean } = {}) {
  if (state?.running) return;
  abort = new AbortController();
  state = { phase, running: true, step: 'Começando…', done: 0, total: 0, error: null, summary: null, opId: null };
  for (const l of listeners) l();
  try {
    const r = await runStage(
      editorPort,
      phase,
      {
        ai: aiStore.get().settings,
        signal: abort.signal,
        progress: (step, done = 0, total = 0) => set({ step, done, total }),
        words: () => timelineSpeech(store.getState().project).words,
        services: skillServices,
      },
      { autoApply: opts.autoApply ?? true, regenerate: opts.regenerate },
    );
    const op = r.op;
    const applied = op?.status === 'applied' ? op.selected?.length ?? 0 : 0;
    const pending = op ? op.commands.length - applied : 0;
    const summary = op
      ? `${op.notes?.join(' ') ?? ''}${applied ? ` Aplicadas: ${applied}.` : ''}${pending ? ` Para revisar: ${pending}.` : ''}`.trim()
      : r.messages.join(' ') || 'Nada a fazer nesta etapa.';
    set({ running: false, step: '', opId: op?.id ?? null, summary });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    set({ running: false, step: '', error: aborted ? 'Cancelado.' : e instanceof Error ? e.message : String(e) });
  }
}

/** Operação atual da fase (lida do projeto, para sobreviver a recarregar). */
export function currentOperation(opId: string | null) {
  return opId ? readOperations(store.getState().project).find((o) => o.id === opId) ?? null : null;
}

export function applyPending(opId: string, which: 'selected' | 'all') {
  const op = currentOperation(opId);
  if (!op) return;
  if (op.status === 'applied') {
    // já aplicada em parte: os itens restantes viram uma nova aplicação (outra operação)
    notify('Esta operação já foi aplicada. Use "Regenerar" para gerar de novo.', 'error');
    return;
  }
  const r = applyOperation(editorPort, opId, which);
  if (r.rejected.length) notify(`${r.rejected.length} sugestão(ões) não aplicadas: ${r.rejected[0].reason}`, 'error', 6000);
  set({});
}

export function toggleSuggestion(opId: string, cmdId: string) {
  const op = currentOperation(opId);
  if (!op || op.status !== 'preview') return;
  const sel = new Set(op.selected ?? []);
  if (sel.has(cmdId)) sel.delete(cmdId);
  else sel.add(cmdId);
  setSelected(editorPort, opId, [...sel]);
  set({});
}

export function rejectPending(opId: string) {
  rejectOperation(editorPort, opId);
  set({ summary: 'Sugestões rejeitadas.' });
}

/** Desfaz a operação inteira da fase; itens editados à mão só saem com confirmação. */
export function undoPhase(opId = state?.opId ?? null) {
  const op = currentOperation(opId);
  if (!op) return;
  const { edited } = removableClips(store.getState().project, op.id);
  const isLast = !!op.undoLabel && store.undoLabel === op.undoLabel;
  const includeEdited = !isLast && edited.length > 0 && confirm(`${edited.length} item(ns) criados pela IA foram editados por você. Remover também?`);
  const r = revertOperation(editorPort, op.id, { includeEdited });
  if (!r.ok) notify(r.message, 'error', 7000);
  set({ summary: r.message });
}

/** Desfaz um item só (uma imagem, um título…) criado pela IA. */
export function undoItem(clipId: string) {
  const c = store.getState().project.clips[clipId];
  if (!c || c.origin?.by !== 'ai') return;
  store.execute(Cmd.deleteClips([clipId]), []);
  set({});
}

/** Tira uma transição criada pela IA (volta a que havia antes, ou o corte seco). */
export function undoTransitionItem(clipId: string, cmd: EditCommand) {
  const c = store.getState().project.clips[clipId];
  if (!c?.transitionIn || c.transitionIn.by !== 'ai') return;
  store.execute(Cmd.setTransition({ [clipId]: (cmd.payload.prevTransition ?? undefined) as TransitionSpec | undefined }, 'Tirar transição'));
  set({});
}

export function imageKeys(): SourceKeys {
  return providerKeys();
}
export function saveImageKeys(k: SourceKeys) {
  saveProviderKeys(k);
}
