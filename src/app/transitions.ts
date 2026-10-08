// Transições à mão: aplicar um preset da biblioteca no clipe selecionado, mudar parâmetros,
// remover e ver no player. Tudo por comando (desfazível); a escolha manual fica marcada como
// do usuário e a IA não a substitui.

import type { TransitionSpec } from '../core/types';
import { Cmd } from '../engine/commands/commands';
import { clipEnd } from '../engine/timeline/operations';
import { transitionWindow } from '../engine/render/transitions';
import { presetFor, transitionById } from '../video-editor/transitions/library';
import { validateTransition } from '../video-editor/validation/validate';
import { playback, store } from './editor';

/** Clipe colado antes deste na mesma faixa (sem ele, as transições "por baixo" não têm de onde vir). */
export function previousClip(clipId: string) {
  const p = store.getState().project;
  const c = p.clips[clipId];
  if (!c) return undefined;
  return Object.values(p.clips).find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(clipEnd(x) - c.start) < 0.02);
}

/** Melhor duração do preset que cabe nos dois clipes. */
export function fittingDuration(clipId: string, presetId: string): number {
  const p = store.getState().project;
  const preset = transitionById(presetId)!;
  const c = p.clips[clipId];
  const prev = previousClip(clipId);
  const room = Math.min(c.duration / 2, prev ? (preset.align === 'center' ? prev.duration : Infinity) : Infinity);
  return +Math.max(preset.duration.min, Math.min(preset.duration.recommended, room)).toFixed(3);
}

/** Define (ou remove, com spec undefined) a transição de entrada. Devolve o erro, se houver. */
export function setClipTransition(clipId: string, spec: TransitionSpec | undefined, opts: { live?: boolean } = {}): string | null {
  const p = store.getState().project;
  const c = p.clips[clipId];
  if (!c) return 'clipe inexistente';
  const value = spec ? { ...spec, by: 'user' as const } : undefined;
  if (value) {
    const err = validateTransition(p, { ...c, transitionIn: undefined }, value);
    if (err) return err;
  }
  const cmd = Cmd.setTransition({ [clipId]: value }, value ? `Transição: ${presetFor(value.type)?.name ?? value.type}` : 'Remover transição');
  if (opts.live) store.preview(cmd);
  else store.execute(cmd);
  return null;
}

/** Aplica um preset nos clipes selecionados (cada um com a duração que couber). */
export function applyPresetToSelection(presetId: string): { applied: number; errors: string[] } {
  const preset = transitionById(presetId);
  const errors: string[] = [];
  let applied = 0;
  if (!preset) return { applied, errors: ['preset desconhecido'] };
  const sel = store.getState().selection;
  if (!sel.length) return { applied, errors: ['Selecione na timeline o clipe que ENTRA (a transição fica no começo dele).'] };
  for (const id of sel) {
    if (preset.align !== 'hold' && preset.render !== 'none' && !previousClip(id)) {
      errors.push('O clipe selecionado não tem outro colado antes dele na mesma faixa.');
      continue;
    }
    const err = setClipTransition(id, { type: preset.id, duration: preset.render === 'none' || preset.align === 'hold' ? 0 : fittingDuration(id, preset.id), intensity: preset.parameters.intensity, easing: preset.parameters.easing });
    if (err) errors.push(err);
    else applied++;
  }
  return { applied, errors };
}

/** Toca a transição no player: começa um pouco antes e para logo depois. */
export function playTransition(clipId: string) {
  const c = store.getState().project.clips[clipId];
  const w = c && transitionWindow(c);
  if (!w) return;
  const from = Math.max(0, w[0] - 0.8);
  playback.seek(from);
  playback.play();
  const stopAt = Math.min(w[1], w[0] + 3) + 0.8;
  const tick = () => {
    if (!playback.getSnapshot().playing) return;
    if (playback.getSnapshot().time >= stopAt) playback.pause();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
