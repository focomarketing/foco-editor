// Inserção de gráficos (títulos animados) numa trilha própria no topo.

import type { Project, TitleTemplate } from '../../core/types';
import { DEFAULT_TRANSFORM, NO_ASSET } from '../../core/types';
import { newId } from '../../core/time';
import { addClip, addTrack } from '../timeline/operations';
import { defaultTitle } from './titles';

export const GRAPHICS_TRACK_NAME = 'Gráficos';

export function addTitle(
  p: Project,
  opts: { template: TitleTemplate; text: string; subtitle?: string; at: number; duration: number },
): { project: Project; clipId: string } {
  let next = p;
  let track = next.tracks.find((t) => t.kind === 'video' && t.name === GRAPHICS_TRACK_NAME);
  if (!track) {
    const id = newId('t');
    next = addTrack(next, 'video', { id, name: GRAPHICS_TRACK_NAME });
    track = next.tracks.find((t) => t.id === id)!;
  }
  const title = defaultTitle(opts.template, opts.text);
  if (opts.subtitle !== undefined && (opts.subtitle || opts.template !== 'lowerThird')) title.subtitle = opts.subtitle;
  const clipId = newId('c');
  next = addClip(next, {
    id: clipId,
    assetId: NO_ASSET,
    trackId: track.id,
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
