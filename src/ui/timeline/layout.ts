import type { Track } from '../../core/types';

export const RULER_H = 28;
export const trackHeight = (t: Track) => (t.kind === 'video' ? 64 : 52);
