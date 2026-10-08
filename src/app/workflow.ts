// Fluxo guiado: criar projeto pela trilha, abrir do catálogo, voltar para Projetos e
// navegar pelas fases. A fase atual fica no projeto (metadata.workflow), fora do undo.

import type { Project } from '../core/types';
import type { AspectRatio } from '../engine/ai/commands';
import { completePhase, createWorkflow, goToPhase, readWorkflow } from '../core/workflow';
import type { PhaseId, TrackId, Workflow } from '../core/workflow';
import { createProject, projectDuration } from '../engine/timeline/operations';
import { smartCutStore } from './smartCut';
import { actions, playback, projectFile, store, transcripts } from './editor';
import { notify } from './notify';
import { viewStore } from './view';
import type { ImportItem } from '../engine/media/MediaEngine';
import type { EditMode } from '../video-editor/presets';

const ASPECT_SIZE: Record<AspectRatio, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

export const currentWorkflow = (p: Project = store.getState().project): Workflow | null => readWorkflow(p.metadata);

const setWorkflow = (w: Workflow) => store.setMeta('workflow', w);

/** Salva já no catálogo (a lista de Projetos não espera o autosave). */
async function persist() {
  const p = store.getState().project;
  await projectFile.autosave(p, store.getState().dirty);
  await projectFile.catalogSave(p, transcripts.all(), projectDuration(p));
}

export async function goHome() {
  playback.pause();
  await persist(); // a lista de Projetos lê o catálogo: salva antes de mostrar
  viewStore.set('home');
}

export function startNewProject() {
  viewStore.set('new');
}

/** Cria o projeto pela trilha escolhida e pede os vídeos (com acesso guardado, para reabrir depois). */
export async function createGuidedProject(opts: { name: string; track: TrackId; subtype: string | null; aspect?: AspectRatio; mode?: EditMode; script?: string }, items?: ImportItem[]) {
  const wf = createWorkflow(opts.track, opts.subtype, { mode: opts.mode, script: opts.script });
  if (opts.aspect) wf.defaults.aspect = opts.aspect;
  const p = createProject();
  const [width, height] = ASPECT_SIZE[wf.defaults.aspect];
  const project: Project = { ...p, name: opts.name.trim() || 'Projeto sem nome', settings: { ...p.settings, width, height }, metadata: { ...p.metadata, workflow: wf } };
  projectFile.handle = null;
  await actions.load(project);
  smartCutStore.setOptions({ mode: wf.defaults.cutMode });
  smartCutStore.clear();
  // Importa e coloca na timeline, em sequência, tudo o que foi escolhido.
  const before = new Set(Object.keys(store.getState().project.assets));
  if (items) await actions.importItems(items);
  else await actions.importMedia();
  const added = Object.values(store.getState().project.assets).filter((a) => !before.has(a.id));
  for (const a of added) actions.addAssetToTimeline(a.id);
  await persist();
  if (!added.length) notify('Projeto criado. Importe os vídeos pela aba Mídia quando quiser.');
}

export async function openFromCatalog(id: string) {
  const rec = await projectFile.catalogGet(id);
  if (!rec) {
    notify('Projeto não encontrado.', 'error');
    return;
  }
  projectFile.handle = null;
  await actions.load(rec.project, rec.transcripts);
  const wf = currentWorkflow();
  smartCutStore.clear();
  if (wf) smartCutStore.setOptions({ mode: wf.defaults.cutMode });
}

export async function removeFromCatalog(id: string) {
  await projectFile.catalogRemove(id);
}

export function setPhase(id: PhaseId) {
  const wf = currentWorkflow();
  if (wf) setWorkflow(goToPhase(wf, id));
}

/** Conclui (ou pula) a fase atual e vai para a próxima. */
export function finishPhase(how: 'done' | 'skipped' = 'done') {
  const wf = currentWorkflow();
  if (!wf) return;
  setWorkflow(completePhase(wf, how));
  void persist();
}

/** Marca que a IA já executou esta fase (para não repetir sozinha ao reabrir). */
export function markRan(phase: PhaseId) {
  const wf = currentWorkflow();
  if (wf) setWorkflow({ ...wf, ran: { ...wf.ran, [phase]: true } });
}
