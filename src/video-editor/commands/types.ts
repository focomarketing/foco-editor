// Contrato de edição da IA. Toda alteração sugerida por uma skill é um EditCommand, e toda
// execução de skill é uma EditOperation (um passo de undo ao aplicar). O editor continua sendo
// a fonte da verdade: ao aplicar, cada comando vira os comandos nomeados do editor (Cmd).

import type { CaptionData, ColorSettings, Keyframes, TitleData, TransitionSpec } from '../../core/types';

export type EditCommandType =
  | 'add_clip'
  | 'remove_clip'
  | 'trim_clip'
  | 'move_clip'
  | 'split_clip'
  | 'add_overlay'
  | 'add_transition'
  | 'add_effect'
  | 'add_music'
  | 'add_sound_effect'
  | 'add_caption'
  | 'apply_lut'
  // extensão compatível com o editor atual: remover trechos e fechar o buraco (corte de fala)
  | 'ripple_remove';

/** Papel da faixa: a IA não escolhe "V3", escolhe a função; o editor cria/acha a faixa. */
export type TrackRole = 'main' | 'broll' | 'overlay' | 'captions' | 'voice' | 'narration' | 'music' | 'sfx' | 'ambience';

export interface EditCommand {
  id: string;
  projectId: string;
  type: EditCommandType;
  trackId?: string;
  start?: number;
  end?: number;
  createdBy: 'ai' | 'user';
  skill?: string;
  /** 0..1. Abaixo do limite de confiança a sugestão nunca é aplicada sozinha. */
  confidence?: number;
  reason?: string;
  reversible: boolean;
  payload: EditPayload;
}

/** Payloads por tipo (validados antes de aplicar). */
export type EditPayload = Record<string, unknown> &
  Partial<{
    // add_clip / add_overlay / add_music / add_sound_effect
    assetId: string;
    role: TrackRole;
    sourceIn: number;
    volume: number;
    fadeIn: number;
    fadeOut: number;
    keyframes: Keyframes;
    scale: number;
    title: TitleData;
    // add_caption
    caption: CaptionData;
    // remove/trim/move/split/add_effect/add_transition
    clipId: string;
    edge: 'start' | 'end';
    time: number;
    to: number;
    transition: TransitionSpec;
    // apply_lut / add_effect
    color: ColorSettings;
    // ripple_remove
    ranges: [number, number][];
    // descrição humana (lista de aprovação)
    label: string;
    // créditos de mídia externa
    license: AssetLicenseRef;
  }>;

export interface AssetLicenseRef {
  provider: string;
  licenseName: string;
  sourceUrl: string;
  author?: string;
}

export type OperationStatus = 'preview' | 'applied' | 'reverted' | 'rejected';

export interface EditOperation {
  id: string;
  projectId: string;
  commands: EditCommand[];
  status: OperationStatus;
  createdBy: 'ai' | 'user';
  skill?: string;
  createdAt: string;
  /** Etapa do fluxo que gerou a operação (para regenerar só ela). */
  stage?: string;
  /** Ids dos comandos escolhidos para aplicar (padrão: os de confiança alta). */
  selected?: string[];
  /** Ids dos clipes criados ao aplicar (para desfazer sem tocar no resto). */
  createdClipIds?: string[];
  /** Rótulo do passo de undo criado (desfazer direto quando ainda é o último). */
  undoLabel?: string;
  /** Mensagens das skills (o que fizeram, o que faltou). */
  notes?: string[];
  warnings?: string[];
}

/** Abaixo disto a sugestão fica para revisão e não é aplicada automaticamente. */
export const MIN_AUTO_CONFIDENCE = 0.6;
