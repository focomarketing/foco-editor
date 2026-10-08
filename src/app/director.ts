// Diretor de edição no app: monta o rascunho a partir do projeto aberto, liga as ferramentas às
// mídias reais (quadros, níveis de áudio, transcrições, skills) e guarda o andamento para a tela.
// A timeline real só muda em "Aplicar" (um passo de undo).

import { CanvasSink } from 'mediabunny';
import type { InputVideoTrack } from 'mediabunny';
import { Cmd } from '../engine/commands/commands';
import { WAVEFORM_RATE } from '../engine/media/MediaEngine';
import { Draft } from '../video-editor/director/draft';
import { DirectorTools } from '../video-editor/director/tools';
import type { DirectorFinish, DirectorPlan } from '../video-editor/director/tools';
import type { FrameReader } from '../video-editor/director/still';
import type { Issue } from '../video-editor/director/verify';
import { runDirector } from '../video-editor/director/agent';
import type { CreateMessage, DirectorEvent, DirectorRun, StopReason } from '../video-editor/director/agent';
import { aiStore } from './aiEditor';
import { media, playback, store } from './editor';
import { skillServices } from './phases';
import { smartCutStore, timelineSpeech } from './smartCut';
import { notify } from './notify';

export interface LogEntry {
  id: number;
  kind: DirectorEvent['type'] | 'info';
  text: string;
  image?: string;
  isError?: boolean;
}

export interface DirectorState {
  status: 'idle' | 'running' | 'done';
  log: LogEntry[];
  costUsd: number;
  turns: number;
  plan?: DirectorPlan;
  finished?: DirectorFinish;
  issues?: Issue[];
  stopped?: StopReason;
  message?: string;
  previewing: boolean;
  /** Há um rascunho para ver/aplicar. */
  hasDraft: boolean;
}

const BUDGET_KEY = 'foco.director.budget';
export const directorBudget = {
  get(): number {
    try {
      const v = Number(localStorage.getItem(BUDGET_KEY));
      return Number.isFinite(v) && v > 0 ? v : 2;
    } catch {
      return 2;
    }
  },
  set(v: number) {
    try {
      localStorage.setItem(BUDGET_KEY, String(v));
    } catch {
      /* sem armazenamento: fica o padrão */
    }
  },
};

let state: DirectorState = { status: 'idle', log: [], costUsd: 0, turns: 0, previewing: false, hasDraft: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<DirectorState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
export const directorStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
};

let draft: Draft | null = null;
let tools: DirectorTools | null = null;
let conversation: DirectorRun['conversation'] = [];
let abort: AbortController | null = null;
let seq = 0;
const log = (e: Omit<LogEntry, 'id'>) => set({ log: [...state.log, { ...e, id: ++seq }].slice(-400) });

// --- quadros das mídias reais ------------------------------------------------------------------

const sinks = new Map<string, Promise<CanvasSink | null>>();
function sinkFor(assetId: string, width: number) {
  const key = `${assetId}@${width}`;
  if (!sinks.has(key)) {
    sinks.set(
      key,
      (async () => {
        const track = (await media.getInput(assetId)?.getPrimaryVideoTrack()) as InputVideoTrack | null | undefined;
        if (!track) return null;
        const w = await track.getDisplayWidth();
        const h = await track.getDisplayHeight();
        return new CanvasSink(track, { width, height: Math.max(2, Math.round((width * h) / Math.max(1, w))), fit: 'fill' });
      })(),
    );
  }
  return sinks.get(key)!;
}

const frames: FrameReader = {
  image(assetId) {
    const img = media.get(assetId)?.image;
    return img ? { source: img, width: img.width, height: img.height } : null;
  },
  async video(assetId, t, width) {
    const sink = await sinkFor(assetId, width);
    const w = await sink?.getCanvas(Math.max(0, t)).catch(() => null);
    if (!w) return null;
    const c = w.canvas as OffscreenCanvas | HTMLCanvasElement;
    return { source: c as unknown as CanvasImageSource & TexImageSource, width: c.width, height: c.height };
  },
};

// --- execução ------------------------------------------------------------------------------------

function onEvent(e: DirectorEvent) {
  switch (e.type) {
    case 'cost':
      set({ costUsd: e.usd, turns: e.turns });
      break;
    case 'thinking':
      log({ kind: 'thinking', text: e.text });
      break;
    case 'text':
      log({ kind: 'text', text: e.text });
      break;
    case 'tool':
      log({ kind: 'tool', text: toolLabel(e.name, e.input) });
      break;
    case 'tool_result':
      log({ kind: 'tool_result', text: e.text.slice(0, 1200), image: e.image, isError: e.isError });
      set({ plan: tools?.state.plan, issues: tools?.state.lastIssues, finished: tools?.state.finished });
      break;
  }
}

const TOOL_LABEL: Record<string, string> = {
  project_overview: 'Lendo o projeto',
  read_transcript: 'Lendo a fala',
  audio_report: 'Medindo o áudio',
  view_frames: 'Olhando quadros',
  list_clips: 'Conferindo a timeline',
  run_skill: 'Rodando skill',
  accept_suggestions: 'Aplicando sugestões',
  edit_timeline: 'Editando',
  undo_last: 'Desfazendo',
  verify: 'Verificando',
  set_plan: 'Plano editorial',
  finish: 'Entregando',
};

function toolLabel(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const base = TOOL_LABEL[name] ?? name;
  if (name === 'run_skill') return `${base}: ${String(i.stage)}${i.cut_mode ? ` (${String(i.cut_mode)})` : ''}`;
  if (name === 'view_frames' && Array.isArray(i.times)) return `${base} (${i.times.length})`;
  if (name === 'edit_timeline' && Array.isArray(i.edits)) return `${base}: ${(i.edits as { action?: string }[]).map((x) => x.action).join(', ')}`;
  return base;
}

async function run(userText: string) {
  const settings = aiStore.get().settings;
  if (settings.provider !== 'claude' || !settings.claudeKey || !settings.cloudConsent) {
    notify('O Diretor usa o Claude: configure a chave e autorize o envio nas configurações de IA.', 'error', 8000);
    return;
  }
  if (!draft) return;
  abort = new AbortController();
  set({ status: 'running', stopped: undefined, message: undefined });
  const r = await runDirector({
    settings,
    draft,
    tools: tools!,
    userText,
    conversation,
    budgetUsd: state.costUsd + directorBudget.get(),
    maxTurns: 40,
    signal: abort.signal,
    onEvent,
    spentUsd: state.costUsd,
    // testes ponta a ponta (só no modo de desenvolvimento) trocam a API por um roteiro
    create: import.meta.env.DEV ? (globalThis as { __focoDirectorCreate?: CreateMessage }).__focoDirectorCreate : undefined,
  });
  conversation = r.conversation;
  abort = null;
  set({ status: 'done', stopped: r.stopped, message: r.message, costUsd: r.costUsd, plan: tools?.state.plan, finished: tools?.state.finished, issues: tools?.state.lastIssues, hasDraft: true });
  if (r.stopped === 'finished') notify('O Diretor entregou a edição: veja no player e aplique.', 'success', 6000);
  else if (r.message) notify(r.message, r.stopped === 'error' || r.stopped === 'refusal' ? 'error' : 'info', 7000);
}

/** Começa uma edição nova a partir do projeto aberto. */
export async function startDirector(brief: string) {
  if (state.status === 'running') return;
  stopPreview();
  const live = store.getState();
  draft = new Draft(live.project, live.revision);
  const idle = new AbortController().signal;
  tools = new DirectorTools({
    // getters: o rascunho troca depois de "Aplicar" e cada execução tem o seu cancelamento
    get draft() {
      return draft!;
    },
    get ai() {
      return aiStore.get().settings;
    },
    get signal() {
      return abort?.signal ?? idle;
    },
    frames,
    levels: async (id) => media.get(id)?.levels ?? (await media.whenLevels(id)),
    levelRate: WAVEFORM_RATE,
    words: (p) => timelineSpeech(p).words,
    services: skillServices,
    liveAssets: () => Object.values(store.getState().project.assets),
    setCutMode: (mode) => smartCutStore.setOptions({ mode }),
    progress: (step) => log({ kind: 'info', text: step }),
  });
  conversation = [];
  set({ log: [], costUsd: 0, turns: 0, plan: undefined, finished: undefined, issues: undefined, hasDraft: false });
  log({ kind: 'info', text: 'Diretor começou. A timeline só muda quando você aplicar.' });
  await run(`BRIEFING DA PESSOA:\n${brief.trim() || '(sem briefing: siga o método do formato)'}\n\nEdite o projeto seguindo o seu processo e entregue com finish.`);
}

/** Pedido de ajuste em linguagem natural (continua a mesma conversa e o mesmo rascunho). */
export async function adjustDirector(text: string) {
  if (state.status === 'running' || !draft || !text.trim()) return;
  stopPreview();
  if (tools) tools.state.finished = undefined;
  log({ kind: 'info', text: `Ajuste pedido: ${text.trim()}` });
  await run(`PEDIDO DE AJUSTE DA PESSOA: ${text.trim()}\nFaça o ajuste no rascunho, confira (view_frames/verify) e entregue de novo com finish.`);
}

export function cancelDirector() {
  abort?.abort();
}

export function previewDraft() {
  if (!draft) return;
  playback.setPreviewProject(draft.project);
  set({ previewing: true });
  playback.seek(0);
}

export function stopPreview() {
  if (state.previewing) playback.setPreviewProject(null);
  if (state.previewing) set({ previewing: false });
}

/** Leva o rascunho para a timeline real como um passo de undo. */
export function applyDirector(): boolean {
  if (!draft) return false;
  const live = store.getState();
  if (live.revision !== draft.baseRevision && !confirm('Você mexeu na timeline enquanto o Diretor trabalhava. Aplicar substitui a montagem pela do Diretor (dá para desfazer com Ctrl+Z). Continuar?')) return false;
  stopPreview();
  store.execute(Cmd.replaceTimeline(draft.project));
  notify('Edição do Diretor aplicada (Ctrl+Z desfaz tudo de uma vez).', 'success');
  // próximos ajustes partem do que está aplicado
  draft = new Draft(store.getState().project, store.getState().revision);
  return true;
}

export function discardDirector() {
  stopPreview();
  draft = null;
  tools = null;
  conversation = [];
  set({ status: 'idle', log: [], costUsd: 0, turns: 0, plan: undefined, finished: undefined, issues: undefined, hasDraft: false, stopped: undefined, message: undefined });
}
