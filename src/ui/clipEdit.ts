// Edição de um clipe pelo Inspector: ajustes ao vivo (slider) e passos de undo.

import type { Clip } from '../core/types';
import { store } from '../app/editor';
import { clipPatchCommand } from '../engine/commands/commands';

/** Durante um gesto (slider): mostra o resultado; o gesto vira um único comando. */
export function live(clipId: string, fn: (c: Clip) => Partial<Clip>, label?: string) {
  const c = store.getState().project.clips[clipId];
  if (c) store.preview(clipPatchCommand(clipId, fn(c), label));
}

export function commit(clipId: string, label: string, fn: (c: Clip) => Partial<Clip>) {
  const c = store.getState().project.clips[clipId];
  if (c) store.execute(clipPatchCommand(clipId, fn(c), label));
}
