// Converte EditCommands validados nos comandos nomeados do editor (Cmd). Um conjunto vira um
// Cmd.batch = um passo de undo. Os clipes criados levam a origem (IA, skill, operação).

import type { Clip, Project, TrackKind } from '../../core/types';
import { DEFAULT_TRANSFORM, NO_ASSET } from '../../core/types';
import { newId } from '../../core/time';
import { Cmd } from '../../engine/commands/commands';
import type { EditCommand as EditorCommand } from '../../engine/commands/commands';
import { clipPatchCommand } from '../../engine/commands/commands';
import { clipEnd } from '../../engine/timeline/operations';
import type { EditCommand, TrackRole } from './types';
import { clipStamp, occupancy, validateCommand } from '../validation/validate';

/** Nome e tipo da faixa de cada papel. */
export const ROLE_TRACK: Record<TrackRole, { name: string; kind: TrackKind }> = {
  main: { name: 'V1', kind: 'video' },
  broll: { name: 'B-roll', kind: 'video' },
  overlay: { name: 'Gráficos', kind: 'video' },
  captions: { name: 'Legendas', kind: 'video' },
  voice: { name: 'A1', kind: 'audio' },
  narration: { name: 'Narração', kind: 'audio' },
  music: { name: 'Música', kind: 'audio' },
  sfx: { name: 'Efeitos sonoros', kind: 'audio' },
  ambience: { name: 'Ambiente', kind: 'audio' },
};

export interface Converted {
  commands: EditorCommand[];
  createdClipIds: string[];
  rejected: { id: string; reason: string }[];
}

const ADDS = new Set(['add_clip', 'add_overlay', 'add_music', 'add_sound_effect', 'add_caption']);

/** Valida e converte. Comandos inválidos ficam de fora (com o motivo), o resto vira o lote. */
export function toEditorCommands(p: Project, list: EditCommand[], operationId: string): Converted {
  const out: Converted = { commands: [], createdClipIds: [], rejected: [] };
  const occupied = occupancy(p);
  const roleTrack = new Map<TrackRole, string>();
  const trackFor = (role: TrackRole): string => {
    if (roleTrack.has(role)) return roleTrack.get(role)!;
    const spec = ROLE_TRACK[role];
    const existing = p.tracks.find((t) => t.kind === spec.kind && t.name === spec.name && !t.locked);
    let id = existing?.id;
    if (!id) {
      id = newId('t');
      out.commands.push(Cmd.addTrack(spec.kind, { id, name: spec.name }));
    }
    roleTrack.set(role, id);
    return id;
  };

  // Cortes vêm em tempo da timeline original: juntam-se num único "remover trechos", aplicado
  // por último (depois das adições, que também usam a timeline original).
  const ripple: [number, number][] = [];
  for (const cmd of list) {
    const pl = cmd.payload;
    const role = (pl.role as TrackRole | undefined) ?? defaultRole(cmd);
    // a ocupação é por faixa real: resolve o papel antes de validar adições
    // o papel resolvido vai junto (a validação de conflito é por faixa/papel real)
    const resolved: EditCommand = ADDS.has(cmd.type) ? { ...cmd, payload: { ...pl, role } } : cmd;
    if (ADDS.has(cmd.type) && !cmd.trackId) {
      const existing = p.tracks.find((t) => t.kind === ROLE_TRACK[role].kind && t.name === ROLE_TRACK[role].name);
      if (existing) resolved.trackId = existing.id;
    }
    const err = validateCommand(resolved, p, occupied);
    if (err) {
      out.rejected.push({ id: cmd.id, reason: err });
      continue;
    }
    const origin = { by: cmd.createdBy, skill: cmd.skill, operationId, confidence: cmd.confidence, reason: cmd.reason } as const;
    switch (cmd.type) {
      case 'add_clip':
      case 'add_overlay':
      case 'add_music':
      case 'add_sound_effect':
      case 'add_caption': {
        const trackId = resolved.trackId ?? trackFor(role);
        const clip: Clip = {
          id: newId('c'),
          assetId: pl.title || pl.caption ? NO_ASSET : pl.assetId!,
          trackId,
          start: cmd.start!,
          duration: cmd.end! - cmd.start!,
          sourceIn: pl.sourceIn ?? 0,
          volume: pl.volume ?? (cmd.type === 'add_overlay' || pl.title || pl.caption ? 0 : 1),
          speed: 1,
          fadeIn: pl.fadeIn ?? 0,
          fadeOut: pl.fadeOut ?? 0,
          transform: { ...DEFAULT_TRANSFORM, scale: pl.scale ?? 1 },
          ...(pl.keyframes ? { keyframes: pl.keyframes } : {}),
          ...(pl.title ? { title: pl.title } : {}),
          ...(pl.caption ? { caption: pl.caption } : {}),
        };
        clip.origin = { ...origin, stamp: clipStamp(clip) };
        out.commands.push(Cmd.addClip(clip));
        out.createdClipIds.push(clip.id);
        break;
      }
      case 'remove_clip':
        out.commands.push(Cmd.deleteClips([pl.clipId!]));
        break;
      case 'trim_clip':
        out.commands.push(Cmd.trimClip(pl.clipId!, pl.edge!, pl.time!));
        break;
      case 'move_clip': {
        const c = p.clips[pl.clipId!];
        out.commands.push(Cmd.moveClips([{ id: c.id, start: pl.to!, trackId: c.trackId }]));
        break;
      }
      case 'split_clip':
        out.commands.push(Cmd.splitClips([pl.clipId!], pl.time!));
        break;
      case 'add_transition':
        out.commands.push(clipPatchCommand(pl.clipId!, { transitionIn: pl.transition }, 'Transição'));
        break;
      case 'add_effect': {
        const c = p.clips[pl.clipId!];
        if (pl.keyframes) out.commands.push(Cmd.setKeyframes({ [c.id]: { ...c.keyframes, ...pl.keyframes } }, String(pl.label ?? 'Efeito')));
        if (pl.color) out.commands.push(Cmd.setColor({ [c.id]: pl.color }, String(pl.label ?? 'Efeito')));
        break;
      }
      case 'apply_lut':
        out.commands.push(Cmd.setColor({ [pl.clipId!]: pl.color }, String(pl.label ?? 'Cor')));
        break;
      case 'ripple_remove':
        ripple.push(...pl.ranges!);
        break;
    }
  }
  if (ripple.length) out.commands.push(Cmd.rippleRemove(ripple, 'Corte'));
  return out;
}

function defaultRole(cmd: EditCommand): TrackRole {
  switch (cmd.type) {
    case 'add_music':
      return 'music';
    case 'add_sound_effect':
      return 'sfx';
    case 'add_caption':
      return 'captions';
    case 'add_overlay':
      return cmd.payload.title ? 'overlay' : 'broll';
    default:
      return 'broll';
  }
}

/** Clipes de uma operação que ainda existem e não foram mexidos à mão (seguros de remover). */
export function removableClips(p: Project, operationId: string) {
  const mine = Object.values(p.clips).filter((c) => c.origin?.operationId === operationId);
  const untouched = mine.filter((c) => c.origin?.by === 'ai' && !c.origin.locked && c.origin.stamp === clipStamp({ ...c, origin: undefined }));
  return { untouched, edited: mine.filter((c) => !untouched.includes(c)) };
}

export { clipEnd };
