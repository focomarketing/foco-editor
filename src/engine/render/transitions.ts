// Motor de transições: transforma "clipe B entra com o preset X" em efeitos por camada para o
// instante t. Funções puras (testáveis); o compositor só aplica o que sai daqui. Nada altera a
// mídia: tirar a transição do clipe volta tudo ao corte seco.
//
// Janelas (ver Align na biblioteca):
// - center: metade antes do corte (efeito no clipe que sai) e metade depois (no que entra);
// - in: depois do corte, com o último quadro do clipe anterior por baixo ("cauda");
// - hold: o clipe que entra inteiro (punch-in).

import type { Clip, Project, TransitionSpec } from '../../core/types';
import { clipEnd } from '../timeline/operations';
import { presetFor } from '../../video-editor/transitions/library';
import type { TransitionPreset } from '../../video-editor/transitions/library';

export interface MaskSpec {
  shape: NonNullable<TransitionPreset['parameters']['shape']>;
  /** 0 nada revelado → 1 tudo. */
  progress: number;
  direction: 'left' | 'right' | 'up' | 'down';
  /** Faixa colorida na borda da máscara (object wipe, branded wipe). */
  band?: string;
}

export interface LayerFx {
  opacity?: number;
  /** Multiplica a escala do clipe. */
  scale?: number;
  /** Achatamento horizontal (cartão 3D). */
  scaleX?: number;
  /** Deslocamento em fração do quadro. */
  dx?: number;
  dy?: number;
  /** Graus. */
  rotate?: number;
  /** Desfoque em fração da largura do quadro. */
  blur?: number;
  /** Repete a imagem espelhada nas bordas ao deslocar (whip sem buraco preto). */
  mirror?: boolean;
  /** Separação de canais em fração da largura. */
  rgb?: number;
  /** Fatias deslocadas (0..1) e semente que muda a cada poucos quadros. */
  glitch?: number;
  seed?: number;
  mask?: MaskSpec;
}

export interface OverlaySpec {
  kind: 'solid' | 'leak' | 'sweep';
  color: string;
  alpha: number;
  /** Posição 0..1 da faixa (sweep) ou do brilho (leak). */
  pos?: number;
}

export interface RenderOut {
  /** Clipe que sai (ou a cauda dele, nas janelas "in"). */
  a?: LayerFx;
  /** Clipe que entra. */
  b?: LayerFx;
  overlay?: OverlaySpec;
}

// --- curvas -----------------------------------------------------------------------------------

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export function easeBy(kind: TransitionSpec['easing'] | undefined, x: number): number {
  const u = clamp01(x);
  switch (kind) {
    case 'linear':
      return u;
    case 'snappy':
      return u < 0.5 ? 8 * u ** 4 : 1 - 8 * (1 - u) ** 4;
    case 'elastic':
      // passa um pouco do ponto e volta (ease-out-back)
      return 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
    default:
      return u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
  }
}

/** Ruído determinístico (-1..1) para tremidas e glitch: o mesmo quadro sempre igual (preview = export). */
export function noise(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

const DIR = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const;

type Params = TransitionPreset['parameters'];

/**
 * Efeito no progresso u (0..1) da janela. Nas janelas "center", k sobe até 1 no corte e volta
 * a 0: nas bordas da janela o efeito é zero (sem salto ao entrar/sair da transição).
 */
export function renderTransition(preset: TransitionPreset, spec: TransitionSpec, u: number): RenderOut {
  const prm: Params = { ...preset.parameters, ...(spec.params as Params | undefined) };
  const I = clamp01(spec.intensity ?? prm.intensity ?? 0.5);
  const easing = spec.easing ?? prm.easing;
  const k = preset.align === 'center' ? easeBy(easing, 1 - Math.abs(u - 0.5) * 2) : easeBy(easing, u);
  const [vx, vy] = DIR[prm.direction ?? 'left'];
  const amp = 0.5 + I; // intensidade 0..1 → 0,5x..1,5x do preset
  const blur = (prm.blur ?? 0) * amp;
  const scale = (prm.scale ?? 0) * amp;
  const seed = Math.floor(u * 14);
  switch (preset.render) {
    case 'none':
      return {};
    case 'zoom': {
      if (preset.align === 'in') {
        // punch-out: entra fechado e abre
        return { b: { scale: 1 + scale * (1 - k) } };
      }
      const fx = { scale: 1 + scale * k, blur: blur * k };
      return { a: fx, b: fx };
    }
    case 'whip': {
      const travel = 0.35 + 0.5 * I;
      const rgb = preset.id === 'digital-swipe' ? 0.012 * k * amp : 0;
      return {
        a: { dx: vx * travel * k, dy: vy * travel * k, mirror: true, blur: blur * k, rgb },
        b: { dx: -vx * travel * k, dy: -vy * travel * k, mirror: true, blur: blur * k, rgb },
      };
    }
    case 'spin': {
      const rot = ((prm.rotation ?? 180) / 2) * k * amp;
      return { a: { rotate: rot, scale: 1 + scale * k, blur: blur * k }, b: { rotate: -rot, scale: 1 + scale * k, blur: blur * k } };
    }
    case 'blur': {
      const fx = { blur: blur * k, scale: 1 + scale * k };
      return { a: fx, b: fx };
    }
    case 'flash': {
      const out: RenderOut = { overlay: { kind: 'solid', color: prm.color ?? '#ffffff', alpha: Math.min(1, I * 1.2) * k ** 2 } };
      if (scale || prm.position) {
        const sh = (prm.position ?? 0) * amp * k;
        const fx = { scale: 1 + scale * k, dx: sh * noise(seed), dy: sh * noise(seed + 7) };
        out.a = fx;
        out.b = fx;
      }
      return out;
    }
    case 'shake': {
      const sh = (prm.position ?? 0.02) * amp * k;
      const fx = { dx: sh * noise(seed), dy: sh * noise(seed + 3), blur: blur * k, scale: 1 + sh * 2 };
      return { a: fx, b: fx };
    }
    case 'rgb': {
      const fx = { rgb: (prm.position ?? 0.012) * amp * k };
      return { a: fx, b: fx };
    }
    case 'glitch': {
      const fx = { glitch: I * k, seed, rgb: 0.006 * k * amp };
      return { a: fx, b: fx };
    }
    case 'dip': {
      const fx = scale ? { scale: 1 + scale * k } : undefined;
      return { a: fx, b: fx, overlay: { kind: 'solid', color: prm.color ?? '#000000', alpha: Math.min(1, I) * k } };
    }
    case 'light':
      return preset.id === 'light-sweep'
        ? { overlay: { kind: 'sweep', color: prm.color ?? '#ffffff', alpha: I * Math.sin(Math.PI * clamp01(u)), pos: u } }
        : { overlay: { kind: 'leak', color: prm.color ?? '#ff9a3c', alpha: I * k, pos: u } };
    case 'dissolve':
      return { a: {}, b: { opacity: k, scale: scale ? 1 + scale * (1 - k) : undefined } };
    case 'push': {
      const parallax = preset.id === 'parallax';
      const travel = preset.id === 'subtle-push' ? 0.25 + 0.5 * I : 1;
      return {
        a: { dx: vx * k * (parallax ? 0.45 : travel), dy: vy * k * (parallax ? 0.45 : travel), opacity: travel < 1 ? 1 - k : undefined },
        b: { dx: -vx * (1 - k) * travel, dy: -vy * (1 - k) * travel, opacity: travel < 1 ? k : undefined },
      };
    }
    case 'mask':
      return { a: {}, b: { mask: { shape: prm.shape ?? 'linear', progress: k, direction: prm.direction ?? 'left', band: prm.shape === 'band' ? prm.color ?? '#0b0b0d' : prm.shape === 'diagonal' ? prm.color : undefined } } };
    case 'card':
      // o plano anterior vira até a metade; o novo termina o giro
      return u < 0.5 ? { a: { scaleX: Math.cos(k * Math.PI), opacity: 1 }, b: { opacity: 0 } } : { a: { opacity: 0 }, b: { scaleX: -Math.cos(k * Math.PI) } };
    case 'punch':
      return { b: { scale: 1 + (prm.scale ?? 0.12) * amp } };
  }
}

// --- janela e estado no instante t ----------------------------------------------------------------

/** Janela [início, fim] da transição de entrada de B (null = sem efeito desenhado). */
export function transitionWindow(b: Clip): [number, number] | null {
  const spec = b.transitionIn;
  const preset = spec && presetFor(spec.type);
  if (!spec || !preset || preset.render === 'none') return null;
  if (preset.align === 'hold') return [b.start, clipEnd(b)];
  const d = Math.max(1 / 60, Math.min(spec.duration, b.duration));
  if (preset.align === 'in') return [b.start, b.start + d];
  const c = b.start + Math.max(-d / 2, Math.min(d / 2, spec.offset ?? 0));
  return [c - d / 2, c + d / 2];
}

export interface TransitionFrame {
  fx: Map<string, LayerFx>;
  /** Último quadro do clipe anterior, desenhado por baixo do que entra. */
  tails: { clip: Clip; under: string; fx: LayerFx }[];
  overlays: { after: string; overlay: OverlaySpec }[];
  /** Clipes cujo quadro atual deve ser guardado (vão virar cauda logo adiante). */
  capture: Set<string>;
}

const ADJ = 0.02;

/** Tudo o que as transições pedem no instante t. */
export function transitionsAt(p: Project, t: number): TransitionFrame {
  const out: TransitionFrame = { fx: new Map(), tails: [], overlays: [], capture: new Set() };
  for (const track of p.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const list = Object.values(p.clips)
      .filter((c) => c.trackId === track.id && !c.caption && !c.title)
      .sort((x, y) => x.start - y.start);
    list.forEach((b, i) => {
      const w = transitionWindow(b);
      if (!w) return;
      const preset = presetFor(b.transitionIn!.type)!;
      const prev = list[i - 1];
      const a = prev && Math.abs(clipEnd(prev) - b.start) < ADJ ? prev : null;
      if (a && preset.align === 'in' && t >= clipEnd(a) - 0.3 && t < clipEnd(a)) out.capture.add(a.id);
      if (t < w[0] || t >= w[1]) return;
      const u = (t - w[0]) / Math.max(1e-6, w[1] - w[0]);
      const r = renderTransition(preset, b.transitionIn!, u);
      const bActive = t >= b.start;
      if (preset.align === 'center') {
        if (!bActive && a && r.a) out.fx.set(a.id, r.a);
        if (bActive && r.b) out.fx.set(b.id, r.b);
      } else {
        if (r.b) out.fx.set(b.id, r.b);
        if (a && preset.align === 'in' && bActive) out.tails.push({ clip: a, under: b.id, fx: r.a ?? {} });
      }
      if (r.overlay) out.overlays.push({ after: bActive ? b.id : a?.id ?? b.id, overlay: r.overlay });
    });
  }
  return out;
}

/** Pares (clipe anterior, clipe seguinte) colados na mesma faixa de vídeo: os cortes. */
export function cutPairs(p: Project): { a: Clip; b: Clip; trackId: string }[] {
  const out: { a: Clip; b: Clip; trackId: string }[] = [];
  for (const track of p.tracks) {
    if (track.kind !== 'video') continue;
    const list = Object.values(p.clips)
      .filter((c) => c.trackId === track.id && !c.caption && !c.title)
      .sort((x, y) => x.start - y.start);
    for (let i = 1; i < list.length; i++) if (Math.abs(clipEnd(list[i - 1]) - list[i].start) < ADJ) out.push({ a: list[i - 1], b: list[i], trackId: track.id });
  }
  return out;
}
