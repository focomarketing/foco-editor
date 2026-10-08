// Fluxo guiado de um projeto: a trilha escolhida no início (YouTube longo, curtos, avatar,
// manual) define o tipo de vídeo, o formato, os padrões de cada fase e quais fases entram.
// Fica em project.metadata.workflow (serializável, vai no .foco). Funções puras.

import type { AspectRatio } from '../engine/ai/commands';
import type { CutMode } from '../engine/cut/smartCut';

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
  { id: 'images', label: 'Imagens', hint: 'imagens e B-roll na fala certa', ready: false },
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

export const TRACKS: TrackDef[] = [
  {
    id: 'youtube',
    label: 'Vídeo longo · YouTube',
    hint: 'vídeos horizontais, com ritmo e respiro para assistir até o fim',
    available: true,
    aspect: '16:9',
    cutMode: 'dynamic',
    captionPreset: 'youtube',
    phases: ALL,
    subtypes: [
      { id: 'dark', label: 'Dark / narrado', hint: 'narração com imagens, sem rosto', cutMode: 'dynamic', captionPreset: 'cinema' },
      { id: 'educativo', label: 'Educativo', hint: 'aula, explicação, tutorial', cutMode: 'dynamic', captionPreset: 'youtube' },
      { id: 'cristao', label: 'Cristão de estudo', hint: 'reflexão, estudo bíblico, pregação', cutMode: 'natural', captionPreset: 'cinema' },
      { id: 'podcast', label: 'Podcast / conversa', hint: 'uma ou mais pessoas conversando', cutMode: 'natural', captionPreset: 'podcast' },
      { id: 'opiniao', label: 'Opinião / comentário', hint: 'pessoa falando para a câmera', cutMode: 'dynamic', captionPreset: 'youtube' },
      { id: 'documentario', label: 'Documentário / ensaio', hint: 'narrativa com imagens de arquivo', cutMode: 'natural', captionPreset: 'cinema' },
    ],
  },
  {
    id: 'short',
    label: 'Vídeo curto · Reels, TikTok, Shorts',
    hint: 'vertical, ritmo seco, legenda forte',
    available: true,
    aspect: '9:16',
    cutMode: 'dry',
    captionPreset: 'shorts',
    phases: ALL,
    subtypes: [
      { id: 'dividida', label: 'Tela dividida', hint: 'você e uma imagem ou vídeo ao mesmo tempo' },
      { id: 'narracao', label: 'Narração', hint: 'voz sobre imagens' },
      { id: 'react', label: 'React', hint: 'você reagindo a um vídeo' },
      { id: 'venda', label: 'Vídeo de venda', hint: 'gancho, problema, prova e chamada' },
      { id: 'ia', label: 'Vídeo com IA', hint: 'cenas geradas por IA' },
    ],
  },
  {
    id: 'avatar',
    label: 'Avatar de IA',
    hint: 'vídeos com um avatar falando o seu texto, e criar o seu avatar',
    available: false,
    aspect: '9:16',
    cutMode: 'dry',
    captionPreset: 'shorts',
    phases: ALL,
    subtypes: [],
  },
  {
    id: 'manual',
    label: 'Edição manual',
    hint: 'vai direto para a timeline; aplique o que quiser depois',
    available: true,
    aspect: '16:9',
    cutMode: 'natural',
    captionPreset: 'minimal',
    phases: ['editor'],
    subtypes: [],
  },
];

export const trackDef = (id: TrackId) => TRACKS.find((t) => t.id === id)!;

export interface Workflow {
  track: TrackId;
  subtype: string | null;
  phases: PhaseId[];
  status: Partial<Record<PhaseId, PhaseStatus>>;
  current: PhaseId;
  /** Padrões resolvidos da trilha + tipo (usados pelas fases). */
  defaults: { aspect: AspectRatio; cutMode: CutMode; captionPreset: string };
}

export function createWorkflow(track: TrackId, subtype: string | null): Workflow {
  const t = trackDef(track);
  const s = t.subtypes.find((x) => x.id === subtype);
  return {
    track,
    subtype: s?.id ?? null,
    phases: [...t.phases],
    status: {},
    current: t.phases[0],
    defaults: { aspect: t.aspect, cutMode: s?.cutMode ?? t.cutMode, captionPreset: s?.captionPreset ?? t.captionPreset },
  };
}

/** Workflow guardado no projeto (ou null em projetos antigos / sem fluxo). */
export function readWorkflow(metadata: Record<string, unknown> | undefined): Workflow | null {
  const w = metadata?.workflow as Workflow | undefined;
  if (!w || !Array.isArray(w.phases) || !w.phases.length) return null;
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
