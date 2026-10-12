// Inserção de gráficos (títulos animados e elementos) e camadas de efeito em trilhas próprias no topo.

import type { EffectSpec, ElementData, Project, TitleTemplate } from '../../core/types';
import { DEFAULT_TRANSFORM, NO_ASSET } from '../../core/types';
import { newId } from '../../core/time';
import { addClip, addTrack } from '../timeline/operations';
import { defaultTitle } from './titles';

export const GRAPHICS_TRACK_NAME = 'Gráficos';

export const EFFECTS_TRACK_NAME = 'Efeitos';

/**
 * Trilha livre em [at, at + duration) entre as que se chamam `base` ("Gráficos", "Gráficos 2"…).
 * A timeline sobrescreve o que fica embaixo, então um clipe novo nunca entra em cima de outro:
 * usa a de menor número livre no trecho ou cria a próxima no topo.
 */
function freeTrack(p: Project, at: number, duration: number, base = GRAPHICS_TRACK_NAME): { project: Project; trackId: string } {
  const isOurs = (name: string) => name === base || name.startsWith(`${base} `);
  const num = (name: string) => Number(name.slice(base.length).trim() || 1);
  const tracks = p.tracks.filter((t) => t.kind === 'video' && isOurs(t.name) && !t.locked).sort((a, b) => num(a.name) - num(b.name));
  const free = tracks.find((t) => !Object.values(p.clips).some((c) => c.trackId === t.id && c.start < at + duration - 1e-6 && c.start + c.duration > at + 1e-6));
  if (free) return { project: p, trackId: free.id };
  const id = newId('t');
  const name = tracks.length ? `${base} ${tracks.length + 1}` : base;
  return { project: addTrack(p, 'video', { id, name }), trackId: id };
}

/** Camada de efeito no topo: aplica os efeitos em tudo que está embaixo no trecho. */
export function addAdjustment(p: Project, opts: { effects: EffectSpec[]; at: number; duration: number }): { project: Project; clipId: string } {
  const { project, trackId } = freeTrack(p, Math.max(0, opts.at), opts.duration, EFFECTS_TRACK_NAME);
  const clipId = newId('c');
  const next = addClip(project, {
    id: clipId,
    assetId: NO_ASSET,
    trackId,
    start: Math.max(0, opts.at),
    duration: opts.duration,
    sourceIn: 0,
    volume: 0,
    speed: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
    adjustment: true,
    effects: opts.effects,
  });
  return { project: next, clipId };
}

export function addElement(p: Project, opts: { element: ElementData; at: number; duration: number }): { project: Project; clipId: string } {
  const { project, trackId } = freeTrack(p, Math.max(0, opts.at), opts.duration);
  const clipId = newId('c');
  const next = addClip(project, {
    id: clipId,
    assetId: NO_ASSET,
    trackId,
    start: Math.max(0, opts.at),
    duration: opts.duration,
    sourceIn: 0,
    volume: 0,
    speed: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
    element: opts.element,
  });
  return { project: next, clipId };
}

export function addTitle(
  p: Project,
  opts: { template: TitleTemplate; text: string; subtitle?: string; at: number; duration: number },
): { project: Project; clipId: string } {
  const { project, trackId } = freeTrack(p, Math.max(0, opts.at), opts.duration);
  const title = defaultTitle(opts.template, opts.text);
  if (opts.subtitle !== undefined && (opts.subtitle || opts.template !== 'lowerThird')) title.subtitle = opts.subtitle;
  const clipId = newId('c');
  const next = addClip(project, {
    id: clipId,
    assetId: NO_ASSET,
    trackId,
    start: Math.max(0, opts.at),
    duration: opts.duration,
    sourceIn: 0,
    volume: 0,
    speed: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
    title,
  });
  return { project: next, clipId };
}
