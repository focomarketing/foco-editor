// Presets de projeto: a tela inicial cria projetos por preset (um editor só, configurado).
// Cada preset define formato, modos de edição aceitos, skills habilitadas e padrões editoriais.

import type { AspectRatio } from '../engine/ai/commands';
import type { CutMode } from '../engine/cut/smartCut';

export type ProjectTemplate = 'youtube-long' | 'short-form' | 'ai-avatar' | 'manual';

/**
 * audio-led: há uma fala principal (vídeo/áudio) e o resto vem por cima dela.
 * script-led: há um roteiro/narração e a montagem nasce dele.
 * manual-assisted: nada é montado sozinho; a IA só age quando chamada.
 */
export type EditMode = 'audio-led' | 'script-led' | 'manual-assisted';

export interface ProjectPreset {
  id: ProjectTemplate;
  label: string;
  description: string;
  available: boolean;
  aspectRatio: AspectRatio | 'custom';
  modes: EditMode[];
  defaultMode: EditMode;
  enabledSkills: string[];
  defaultSettings: {
    pacing: 'natural' | 'fast';
    captionStyle: string;
    /** Volume da música relativo à voz (0..1). */
    musicLevel: number;
    cutStyle: CutMode;
  };
}

export const PROJECT_PRESETS: ProjectPreset[] = [
  {
    id: 'youtube-long',
    label: 'Vídeo longo · YouTube',
    description: 'vídeos horizontais, com ritmo e respiro para assistir até o fim',
    available: true,
    aspectRatio: '16:9',
    modes: ['audio-led', 'script-led'],
    defaultMode: 'audio-led',
    enabledSkills: [
      'media-analysis', 'transcription', 'editorial-director', 'edit-interview-with-broll', 'edit-script-to-video',
      'broll-selector', 'professional-transition-designer', 'motion-graphics-designer', 'audio-designer', 'caption-designer', 'chapter-generator', 'quality-control',
    ],
    defaultSettings: { pacing: 'natural', captionStyle: 'youtube', musicLevel: 0.12, cutStyle: 'dynamic' },
  },
  {
    id: 'short-form',
    label: 'Vídeo curto · Reels, TikTok, Shorts',
    description: 'vertical, ritmo seco, legenda forte',
    available: true,
    aspectRatio: '9:16',
    modes: ['audio-led', 'script-led'],
    defaultMode: 'audio-led',
    enabledSkills: [
      'media-analysis', 'transcription', 'hook-generator', 'aggressive-cut', 'edit-interview-with-broll',
      'edit-script-to-video', 'broll-selector', 'professional-transition-designer', 'caption-designer', 'motion-graphics-designer', 'trend-adapter',
      'audio-designer', 'platform-adapter', 'quality-control',
    ],
    defaultSettings: { pacing: 'fast', captionStyle: 'shorts', musicLevel: 0.22, cutStyle: 'dry' },
  },
  {
    id: 'ai-avatar',
    label: 'Avatar de IA',
    description: 'vídeos com um avatar falando o seu texto, e criar o seu avatar',
    available: false, // arquitetura preparada; geração de avatar ainda não implementada
    aspectRatio: '9:16',
    modes: ['script-led'],
    defaultMode: 'script-led',
    enabledSkills: ['script-to-avatar', 'voice-generation', 'avatar-generation', 'lip-sync', 'broll-selector', 'caption-designer'],
    defaultSettings: { pacing: 'fast', captionStyle: 'shorts', musicLevel: 0.18, cutStyle: 'dry' },
  },
  {
    id: 'manual',
    label: 'Edição manual',
    description: 'vai direto para a timeline; chame a IA só quando quiser',
    available: true,
    aspectRatio: 'custom',
    modes: ['manual-assisted'],
    defaultMode: 'manual-assisted',
    enabledSkills: ['caption-designer', 'aggressive-cut', 'broll-selector', 'professional-transition-designer', 'audio-designer', 'motion-graphics-designer', 'platform-adapter', 'quality-control'],
    defaultSettings: { pacing: 'natural', captionStyle: 'minimal', musicLevel: 0.15, cutStyle: 'natural' },
  },
];

export const presetById = (id: ProjectTemplate) => PROJECT_PRESETS.find((p) => p.id === id)!;

export const MODE_LABEL: Record<EditMode, { label: string; hint: string }> = {
  'audio-led': { label: 'Pela fala gravada', hint: 'há um vídeo/áudio principal; os takes e imagens entram por cima da fala' },
  'script-led': { label: 'Pelo roteiro', hint: 'você cola o roteiro ou a narração; a montagem nasce dele' },
  'manual-assisted': { label: 'Manual com IA', hint: 'nada é montado sozinho; chame a IA para cada tarefa' },
};

/** Montagem automática só nos modos guiados. */
export const autoAssembles = (mode: EditMode) => mode !== 'manual-assisted';
