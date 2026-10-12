// Inserção de gráficos (títulos animados e elementos) numa trilha própria no topo.

import type { ElementData, Project, TitleTemplate } from '../../core/types';
import { DEFAULT_TRANSFORM, NO_ASSET } from '../../core/types';
import { newId } from '../../core/time';
import { addClip, addTrack } from '../timeline/operations';
import { defaultTitle } from './titles';

export const GRAPHICS_TRACK_NAME = 'Gráficos';

/**
 * Trilha de gráficos livre em [at, at + duration). A timeline sobrescreve o que fica embaixo,
 * então um gráfico novo nunca entra em cima de outro: usa a primeira trilha "Gráficos…" livre
 * no trecho ou cria a próxima ("Gráficos 2", "Gráficos 3"…) no topo.
 */
function graphicsTrack(p: Project, at: number, duration: number): { project: Project; trackId: string } {
  const isGraphics = (name: string) => name === GRAPHICS_TRACK_NAME || name.startsWith(`${GRAPHICS_TRACK_NAME} `);
  const num = (name: string) => Number(name.slice(GRAPHICS_TRACK_NAME.length).trim() || 1);
  // a de menor número primeiro: "Gráficos", depois "Gráficos 2"…
  const tracks = p.tracks.filter((t) => t.kind === 'video' && isGraphics(t.name) && !t.locked).sort((a, b) => num(a.name) - num(b.name));
  const free = tracks.find((t) => !Object.values(p.clips).some((c) => c.trackId === t.id && c.start < at + duration - 1e-6 && c.start + c.duration > at + 1e-6));
  if (free) return { project: p, trackId: free.id };
  const id = newId('t');
  const name = tracks.length ? `${GRAPHICS_TRACK_NAME} ${tracks.length + 1}` : GRAPHICS_TRACK_NAME;
  return { project: addTrack(p, 'video', { id, name }), trackId: id };
}

export function addElement(p: Project, opts: { element: ElementData; at: number; duration: number }): { project: Project; clipId: string } {
  const { project, trackId } = graphicsTrack(p, Math.max(0, opts.at), opts.duration);
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
  const { project, trackId } = graphicsTrack(p, Math.max(0, opts.at), opts.duration);
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
