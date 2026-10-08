// Fases automáticas: ao entrar numa fase, a IA faz o trabalho dela no vídeo (com barra de
// progresso) e aplica tudo como UM passo de undo; depois a pessoa revisa, troca ou desfaz.

import type { Asset } from '../core/types';
import { readWorkflow } from '../core/workflow';
import type { PhaseId, Workflow } from '../core/workflow';
import { askJson } from '../engine/ai/providers';
import { BROLL_TRACK, MOMENTS_SCHEMA, brollCommands, density, directorPrompt, heuristicMoments, validateMoments } from '../engine/images/broll';
import type { Moment, Placement } from '../engine/images/broll';
import { downloadImage, searchImages } from '../engine/images/sources';
import type { ImageCandidate, SourceKeys } from '../engine/images/sources';
import { Cmd } from '../engine/commands/commands';
import { projectDuration } from '../engine/timeline/operations';
import { WHISPER_MODELS } from '../engine/transcript/TranscriptEngine';
import { aiStore } from './aiEditor';
import { actions, store, transcripts } from './editor';
import { notify } from './notify';
import { analyzeSmartCuts, applySmartCuts, smartCutStore, timelineSpeech } from './smartCut';

export interface PlacedImage {
  clipId: string;
  start: number;
  text: string;
  why: string;
  query: string;
  credit: ImageCandidate;
}

export interface PhaseRun {
  phase: PhaseId;
  running: boolean;
  step: string;
  done: number;
  total: number;
  error: string | null;
  summary: string | null;
  /** Rótulo do passo de undo que esta fase criou (para "Desfazer esta fase"). */
  undoLabel: string | null;
  images: PlacedImage[];
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
export const AUTO_PHASES: PhaseId[] = ['cut', 'images'];

// --- chaves das fontes de imagem (no navegador) -------------------------------------------

const KEYS = 'foco.imageKeys';
export function imageKeys(): SourceKeys {
  try {
    return JSON.parse(localStorage.getItem(KEYS) || '{}') as SourceKeys;
  } catch {
    return {};
  }
}
export function saveImageKeys(k: SourceKeys) {
  try {
    localStorage.setItem(KEYS, JSON.stringify(k));
  } catch {
    /* sessão */
  }
}

// --- execução -----------------------------------------------------------------------------

export function cancelPhase() {
  abort?.abort();
}

export async function runPhase(phase: PhaseId) {
  if (state?.running) return;
  abort = new AbortController();
  state = { phase, running: true, step: 'Começando…', done: 0, total: 0, error: null, summary: null, undoLabel: null, images: [] };
  for (const l of listeners) l();
  try {
    if (phase === 'cut') await runCut();
    else if (phase === 'images') await runImages(abort.signal);
    set({ running: false, step: '' });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    set({ running: false, step: '', error: aborted ? 'Cancelado.' : e instanceof Error ? e.message : String(e) });
  }
}

/** Transcreve (no computador) as falas da timeline que ainda não têm transcrição. */
async function ensureTranscripts() {
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
    set({ step: `Ouvindo a fala de "${name}" (${i + 1}/${missing.length})`, done: 0, total: 1 });
    const stop = transcripts.subscribe(() => {
      const j = transcripts.job(id);
      if (j?.phase === 'transcribing') set({ done: j.done, total: j.total, step: `Transcrevendo "${name}" · trecho ${j.done + 1} de ${j.total}` });
      if (j?.phase === 'loading-model') set({ step: 'Baixando o modelo de voz (só na primeira vez)…', done: j.loaded, total: j.total || 1 });
    });
    try {
      await actions.transcribe(id, model, 'portuguese');
    } finally {
      stop();
    }
  }
}

async function runCut() {
  await ensureTranscripts();
  const wf = readWorkflow(store.getState().project.metadata);
  if (wf) smartCutStore.setOptions({ mode: wf.defaults.cutMode });
  set({ step: 'Medindo a fala na onda do áudio…', done: 0, total: 1 });
  await analyzeSmartCuts();
  const n = smartCutStore.get().cuts.length;
  if (!n) {
    set({ summary: 'A fala já está limpa neste ritmo: nada foi cortado.', done: 1, total: 1 });
    return;
  }
  set({ step: `Aplicando ${n} cortes…`, done: 1, total: 1 });
  smartCutStore.setAll(true);
  await applySmartCuts();
  const last = smartCutStore.get().lastApply;
  set({ summary: `${last?.count ?? n} trechos cortados · ${(last?.removed ?? 0).toFixed(1).replace('.', ',')} s a menos.`, undoLabel: store.undoLabel ?? null });
}

async function chooseMoments(wf: Workflow | null, signal: AbortSignal): Promise<{ moments: Moment[]; by: string }> {
  const p = store.getState().project;
  const { words } = timelineSpeech(p);
  const duration = projectDuration(p);
  const short = wf?.track === 'short' || p.settings.height > p.settings.width;
  const d = density({ short, duration });
  const s = aiStore.get().settings;
  const llmReady = s.provider === 'ollama' || (!!s.claudeKey && s.cloudConsent);
  if (llmReady && words.length) {
    try {
      set({ step: 'O diretor está lendo a fala e escolhendo as imagens…', done: 0, total: 1 });
      const lines: string[] = [];
      let cur: string[] = [];
      let t0 = words[0].start;
      for (const [i, w] of words.entries()) {
        cur.push(w.text.trim());
        const next = words[i + 1];
        if (!next || /[.!?…]$/.test(w.text.trim()) || next.start - w.end > 0.8) {
          lines.push(`[${t0.toFixed(1)}–${w.end.toFixed(1)}] ${cur.join(' ')}`);
          cur = [];
          if (next) t0 = next.start;
        }
      }
      const kind = wf ? `${wf.track === 'short' ? 'vídeo curto vertical' : 'vídeo longo'}${wf.subtype ? ` (${wf.subtype})` : ''}` : 'vídeo';
      const archive = !!wf && ['cristao', 'documentario', 'dark'].includes(wf.subtype ?? '');
      const raw = await askJson(s, directorPrompt({ kind, short, archive, count: d.count, min: d.min, max: d.max }), `Duração: ${duration.toFixed(1)} s\n\n${lines.join('\n')}`, MOMENTS_SCHEMA as unknown as Record<string, unknown>, signal);
      const moments = validateMoments(raw, duration, d);
      if (moments.length) return { moments, by: s.provider === 'claude' ? 'Claude' : 'IA local' };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      notify(`Diretor de IA indisponível (${e instanceof Error ? e.message : e}). Usei a escolha automática local.`, 'error', 8000);
    }
  }
  return { moments: heuristicMoments(words, duration, d), by: 'escolha automática local' };
}

async function runImages(signal: AbortSignal) {
  await ensureTranscripts();
  const p0 = store.getState().project;
  const wf = readWorkflow(p0.metadata);
  const { moments, by } = await chooseMoments(wf, signal);
  if (!moments.length) {
    set({ summary: 'Não encontrei momentos que peçam imagem (a fala está transcrita?).' });
    return;
  }
  const keys = imageKeys();
  const vertical = p0.settings.height > p0.settings.width;
  const preferArchive = !wf || ['cristao', 'documentario', 'dark'].includes(wf.subtype ?? '') || (!keys.pexels && !keys.pixabay);
  const found: { m: Moment; c: ImageCandidate; file: File }[] = [];
  for (const [i, m] of moments.entries()) {
    signal.throwIfAborted();
    set({ step: `Buscando imagem ${i + 1} de ${moments.length}: "${m.query}"`, done: i, total: moments.length });
    let cands = await searchImages(m.query, { keys, vertical, preferArchive, signal });
    if (!cands.length && m.queryAlt) cands = await searchImages(m.queryAlt, { keys, vertical, preferArchive, signal });
    // Não repete a mesma imagem no vídeo.
    const c = cands.find((x) => !found.some((f) => f.c.url === x.url));
    if (!c) continue;
    try {
      const file = await downloadImage(c, signal);
      // nome único por ordem, para achar o asset depois de importar
      found.push({ m, c, file: new File([file], `${String(found.length + 1).padStart(2, '0')} - ${file.name}`, { type: file.type, lastModified: file.lastModified }) });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
    }
  }
  if (!found.length) {
    set({ summary: 'Os acervos não devolveram imagens para estas falas. Tente de novo ou adicione chaves do Pexels/Pixabay.' });
    return;
  }
  set({ step: `Colocando ${found.length} imagens no vídeo…`, done: moments.length, total: moments.length });
  await actions.importItems(found.map((f) => ({ file: f.file })));
  const p = store.getState().project;
  const byName = new Map<string, Asset>(Object.values(p.assets).map((a) => [a.name, a]));
  const placements: Placement[] = [];
  const meta: { asset: Asset; f: (typeof found)[number] }[] = [];
  for (const f of found) {
    const a = byName.get(f.file.name);
    if (!a || !a.width) continue;
    placements.push({ assetId: a.id, width: a.width, height: a.height, start: f.m.start, duration: f.m.end - f.m.start });
    meta.push({ asset: a, f });
  }
  const { commands, clipIds } = brollCommands(p, placements);
  // créditos de cada imagem nos metadados do asset
  for (const { asset, f } of meta) {
    commands.push(Cmd.updateAsset({ ...asset, metadata: { ...asset.metadata, credit: { source: f.c.source, title: f.c.title, author: f.c.author, license: f.c.license, page: f.c.page } } }, 'Créditos da imagem'));
  }
  const label = `Imagens (${by}): ${placements.length}`;
  store.execute(Cmd.batch(label, commands), []);
  set({
    summary: `${placements.length} imagens na trilha "${BROLL_TRACK}" · escolhidas por ${by}.`,
    undoLabel: store.undoLabel ?? label,
    images: meta.map(({ f }, i) => ({ clipId: clipIds[i], start: f.m.start, text: f.m.text, why: f.m.why, query: f.m.query, credit: f.c })),
  });
}

/** Desfaz o que a fase aplicou (só se ainda for o último passo do histórico). */
export function undoPhase() {
  const s = state;
  if (!s?.undoLabel || store.undoLabel !== s.undoLabel) {
    notify('A edição desta fase não é mais a última: use Ctrl+Z até ela ou desfaça pelo histórico.', 'error');
    return;
  }
  store.undo();
  set({ summary: 'Desfeito.', undoLabel: null, images: [] });
}

/** Tira uma imagem colocada pela fase. */
export function removePlacedImage(clipId: string) {
  store.execute(Cmd.deleteClips([clipId]), []);
  if (state) set({ images: state.images.filter((i) => i.clipId !== clipId) });
}
