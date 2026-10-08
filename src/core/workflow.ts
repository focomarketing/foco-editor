// Fluxo guiado de um projeto: a trilha escolhida no início (YouTube longo, curtos, avatar,
// manual) define o tipo de vídeo, o formato, os padrões de cada fase e quais fases entram.
// Fica em project.metadata.workflow (serializável, vai no .foco). Funções puras.

import type { AspectRatio } from '../engine/ai/commands';
import type { CutMode } from '../engine/cut/smartCut';
import { PROJECT_PRESETS, presetById } from '../video-editor/presets';
import type { EditMode, ProjectTemplate } from '../video-editor/presets';

export type TrackId = 'youtube' | 'short' | 'avatar' | 'manual';
export type PhaseId = 'cut' | 'images' | 'transitions' | 'motion' | 'audio' | 'captions' | 'editor';
export type PhaseStatus = 'todo' | 'done' | 'skipped';

export interface PhaseDef {
  id: PhaseId;
  label: string;
  hint: string;
  /** Já tem tela própria; as outras aparecem como "em breve" e podem ser puladas. */
  ready: boolean;
}

export const PHASES: PhaseDef[] = [
  { id: 'cut', label: 'Corte', hint: 'pausas, erros e melhor tomada', ready: true },
  { id: 'images', label: 'Imagens', hint: 'imagens e B-roll na fala certa', ready: true },
  { id: 'transitions', label: 'Transições', hint: 'só onde o assunto muda', ready: false },
  { id: 'motion', label: 'Efeitos e motion', hint: 'zoom, textos animados, motion', ready: false },
  { id: 'audio', label: 'Música e efeitos', hint: 'trilha e efeitos sonoros', ready: false },
  { id: 'captions', label: 'Legenda', hint: 'legenda e estilo', ready: false },
  { id: 'editor', label: 'Editor', hint: 'timeline completa para finalizar', ready: true },
];

export const phaseDef = (id: PhaseId) => PHASES.find((p) => p.id === id)!;

export interface Subtype {
  id: string;
  label: string;
  hint: string;
  /** Padrões desta escolha (sobrepõem os da trilha). */
  cutMode?: CutMode;
  captionPreset?: string;
}

export interface TrackDef {
  id: TrackId;
  /** Preset de projeto de onde vêm formato, modos, skills e padrões. */
  template: ProjectTemplate;
  label: string;
  hint: string;
  available: boolean;
  aspect: AspectRatio;
  cutMode: CutMode;
  captionPreset: string;
  phases: PhaseId[];
  subtypes: Subtype[];
}

const ALL: PhaseId[] = ['cut', 'images', 'transitions', 'motion', 'audio', 'captions', 'editor'];

/** Trilha a partir do preset (fonte única de rótulo, disponibilidade, formato e padrões). */
function fromPreset(id: TrackId, template: ProjectTemplate, phases: PhaseId[], subtypes: Subtype[]): TrackDef {
  const pr = presetById(template);
  return {
    id,
    template,
    label: pr.label,
    hint: pr.description,
    available: pr.available,
    aspect: pr.aspectRatio === 'custom' ? '16:9' : pr.aspectRatio,
    cutMode: pr.defaultSettings.cutStyle,
    captionPreset: pr.defaultSettings.captionStyle,
    phases,
    subtypes,
  };
}

export const TRACKS: TrackDef[] = [
  fromPreset('youtube', 'youtube-long', ALL, [
    { id: 'dark', label: 'Dark / narrado', hint: 'narração com imagens, sem rosto', cutMode: 'dynamic', captionPreset: 'cinema' },
    { id: 'educativo', label: 'Educativo', hint: 'aula, explicação, tutorial', cutMode: 'dynamic', captionPreset: 'youtube' },
    { id: 'cristao', label: 'Cristão de estudo', hint: 'reflexão, estudo bíblico, pregação', cutMode: 'natural', captionPreset: 'cinema' },
    { id: 'podcast', label: 'Podcast / conversa', hint: 'uma ou mais pessoas conversando', cutMode: 'natural', captionPreset: 'podcast' },
    { id: 'opiniao', label: 'Opinião / comentário', hint: 'pessoa falando para a câmera', cutMode: 'dynamic', captionPreset: 'youtube' },
    { id: 'documentario', label: 'Documentário / ensaio', hint: 'narrativa com imagens de arquivo', cutMode: 'natural', captionPreset: 'cinema' },
  ]),
  fromPreset('short', 'short-form', ALL, [
    { id: 'dividida', label: 'Tela dividida', hint: 'você e uma imagem ou vídeo ao mesmo tempo' },
    { id: 'narracao', label: 'Narração', hint: 'voz sobre imagens' },
    { id: 'react', label: 'React', hint: 'você reagindo a um vídeo' },
    { id: 'venda', label: 'Vídeo de venda', hint: 'gancho, problema, prova e chamada' },
    { id: 'ia', label: 'Vídeo com IA', hint: 'cenas geradas por IA' },
  ]),
  fromPreset('avatar', 'ai-avatar', ALL, []),
  fromPreset('manual', 'manual', ['editor'], []),
];

/** Trilha de um preset (a tela inicial trabalha com presets). */
export const trackForTemplate = (t: ProjectTemplate) => TRACKS.find((x) => x.template === t)!;
export { PROJECT_PRESETS };

export const trackDef = (id: TrackId) => TRACKS.find((t) => t.id === id)!;

export interface Workflow {
  track: TrackId;
  subtype: string | null;
  phases: PhaseId[];
  status: Partial<Record<PhaseId, PhaseStatus>>;
  current: PhaseId;
  /** Fases que a IA já executou sozinha (não roda de novo ao reabrir). */
  ran?: Partial<Record<PhaseId, boolean>>;
  /** Padrões resolvidos da trilha + tipo (usados pelas fases). */
  defaults: { aspect: AspectRatio; cutMode: CutMode; captionPreset: string; musicLevel?: number; pacing?: 'natural' | 'fast' };
  /** Preset, modo de edição e skills (projetos antigos não têm: ver readWorkflow). */
  template?: ProjectTemplate;
  mode?: EditMode;
  enabledSkills?: string[];
  /** Roteiro/narração (modo script-led). */
  script?: string;
}

export function createWorkflow(track: TrackId, subtype: string | null, opts: { mode?: EditMode; script?: string } = {}): Workflow {
  const t = trackDef(track);
  const s = t.subtypes.find((x) => x.id === subtype);
  const pr = presetById(t.template);
  const mode = opts.mode && pr.modes.includes(opts.mode) ? opts.mode : pr.defaultMode;
  return {
    track,
    subtype: s?.id ?? null,
    template: t.template,
    mode,
    enabledSkills: [...pr.enabledSkills],
    ...(mode === 'script-led' && opts.script ? { script: opts.script } : {}),
    phases: [...t.phases],
    status: {},
    current: t.phases[0],
    defaults: {
      aspect: t.aspect,
      cutMode: s?.cutMode ?? t.cutMode,
      captionPreset: s?.captionPreset ?? t.captionPreset,
      musicLevel: pr.defaultSettings.musicLevel,
      pacing: pr.defaultSettings.pacing,
    },
  };
}

/** Workflow guardado no projeto (ou null em projetos antigos / sem fluxo). */
export function readWorkflow(metadata: Record<string, unknown> | undefined): Workflow | null {
  const w = metadata?.workflow as Workflow | undefined;
  if (!w || !Array.isArray(w.phases) || !w.phases.length) return null;
  // Projetos criados antes dos presets: completa preset e modo pela trilha.
  if (!w.template || !w.mode) {
    const t = TRACKS.find((x) => x.id === w.track);
    if (t) {
      const pr = presetById(t.template);
      return { ...w, template: t.template, mode: pr.defaultMode, enabledSkills: w.enabledSkills ?? [...pr.enabledSkills] };
    }
  }
  return w;
}

/** Marca a fase atual e avança para a próxima ainda não concluída. */
export function completePhase(w: Workflow, how: 'done' | 'skipped' = 'done'): Workflow {
  const status = { ...w.status, [w.current]: how };
  const i = w.phases.indexOf(w.current);
  const next = w.phases.slice(i + 1).find((p) => status[p] !== 'done') ?? w.phases.at(-1)!;
  return { ...w, status, current: next };
}

export function goToPhase(w: Workflow, id: PhaseId): Workflow {
  return w.phases.includes(id) ? { ...w, current: id } : w;
}

/** Rótulo curto do projeto: trilha · tipo. */
export function workflowLabel(w: Workflow | null): string {
  if (!w) return 'Edição manual';
  const t = trackDef(w.track);
  const s = t.subtypes.find((x) => x.id === w.subtype);
  return s ? `${t.label.split(' · ')[0]} · ${s.label}` : t.label;
}
