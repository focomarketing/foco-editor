// Conversões de tempo de um clipe considerando a velocidade.
// timeline: posição na sequência · source: tempo dentro da mídia de origem.

import type { Clip } from './types';

export const speedOf = (c: Clip) => (c.speed > 0 ? c.speed : 1);
/** Quanto de mídia o clipe consome. */
export const sourceSpan = (c: Clip) => c.duration * speedOf(c);
export const sourceEnd = (c: Clip) => c.sourceIn + sourceSpan(c);
export const toSource = (c: Clip, timelineTime: number) => c.sourceIn + (timelineTime - c.start) * speedOf(c);
export const toTimeline = (c: Clip, sourceTime: number) => c.start + (sourceTime - c.sourceIn) / speedOf(c);

/** Ganho do fade de áudio do clipe no tempo t da timeline (linear). */
export function fadeGain(c: Clip, t: number): number {
  let g = 1;
  if (c.fadeIn > 0) g = Math.min(g, Math.max(0, (t - c.start) / c.fadeIn));
  if (c.fadeOut > 0) g = Math.min(g, Math.max(0, (c.start + c.duration - t) / c.fadeOut));
  return g;
}
