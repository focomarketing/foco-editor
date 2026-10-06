// Motor de keyframes: interpola propriedades animáveis no tempo "de origem" do clipe.

import type { AnimProp, Clip, Ease, Keyframe, Keyframes, Transform } from './types';

export const ANIM_PROPS: AnimProp[] = ['scale', 'x', 'y', 'rotation', 'opacity'];

export function ease(kind: Ease, k: number): number {
  const t = Math.min(1, Math.max(0, k));
  switch (kind) {
    case 'linear':
      return t;
    case 'easeIn':
      return t * t * t;
    case 'easeOut':
      return 1 - (1 - t) ** 3;
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    case 'hold':
      return 0;
  }
}

/** Valor da propriedade no tempo t (antes do 1º keyframe e depois do último, mantém). */
export function valueAt(kfs: Keyframe[] | undefined, t: number, fallback: number): number {
  if (!kfs || kfs.length === 0) return fallback;
  if (t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t < b.t) {
      const k = ease(a.ease, (t - a.t) / Math.max(1e-6, b.t - a.t));
      return a.v + (b.v - a.v) * k;
    }
  }
  return last.v;
}

/** Transformação efetiva do clipe no tempo de origem t. */
export function transformAt(clip: Clip, sourceTime: number): Transform {
  const kf = clip.keyframes;
  if (!kf) return clip.transform;
  const base = clip.transform;
  return {
    ...base,
    scale: valueAt(kf.scale, sourceTime, base.scale),
    x: valueAt(kf.x, sourceTime, base.x),
    y: valueAt(kf.y, sourceTime, base.y),
    rotation: valueAt(kf.rotation, sourceTime, base.rotation),
    opacity: valueAt(kf.opacity, sourceTime, base.opacity),
  };
}

/** Insere/substitui um keyframe mantendo a lista ordenada. */
export function setKeyframe(kfs: Keyframes | undefined, prop: AnimProp, k: Keyframe): Keyframes {
  const list = (kfs?.[prop] ?? []).filter((x) => Math.abs(x.t - k.t) > 1e-3);
  list.push(k);
  list.sort((a, b) => a.t - b.t);
  return { ...kfs, [prop]: list };
}

export function removeKeyframe(kfs: Keyframes | undefined, prop: AnimProp, t: number): Keyframes | undefined {
  if (!kfs?.[prop]) return kfs;
  const list = kfs[prop]!.filter((x) => Math.abs(x.t - t) > 1e-3);
  const next = { ...kfs, [prop]: list };
  if (!list.length) delete next[prop];
  return Object.keys(next).length ? next : undefined;
}

/** Todos os tempos (de origem) com keyframe, para desenhar na timeline. */
export function keyframeTimes(kfs: Keyframes | undefined): number[] {
  if (!kfs) return [];
  const set = new Set<number>();
  for (const p of ANIM_PROPS) for (const k of kfs[p] ?? []) set.add(Math.round(k.t * 1000) / 1000);
  return [...set].sort((a, b) => a - b);
}
