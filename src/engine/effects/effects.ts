// Efeitos de vídeo (Fase 6). Cada efeito transforma uma superfície do tamanho do quadro, no
// lugar: a imagem de um clipe (fora dela, transparente) ou o quadro inteiro (camada de efeito).
// Tudo é função do tempo e de sementes fixas: o mesmo instante sai igual no preview e no export.

import type { EffectSpec, EffectType } from '../../core/types';
import { NO_CROP } from '../../core/types';
import { newId } from '../../core/time';
import { drawSlices, rgbSplit } from '../render/transitionDraw';
import { colorProcessor, NEUTRAL_COLOR } from '../color/color';

type Surface = OffscreenCanvas;
type Ctx = OffscreenCanvasRenderingContext2D;

export interface EffectDef {
  label: string;
  category: 'Desfoque e luz' | 'Cor' | 'Estilo' | 'Movimento' | 'Sobreposição';
  hint: string;
  amount: number;
  color?: string;
  color2?: string;
  speed?: number;
}

export const EFFECT_CATEGORIES = ['Desfoque e luz', 'Cor', 'Estilo', 'Movimento', 'Sobreposição'] as const;

export const EFFECTS: Record<EffectType, EffectDef> = {
  blur: { label: 'Desfoque', category: 'Desfoque e luz', hint: 'desfoca a imagem', amount: 0.4 },
  glow: { label: 'Brilho', category: 'Desfoque e luz', hint: 'luzes estouram com halo suave', amount: 0.5 },
  lightLeak: { label: 'Light leak', category: 'Desfoque e luz', hint: 'vazamento de luz quente de filme', amount: 0.55, color: '#ff8a3d', color2: '#ff3d8a', speed: 1 },
  bw: { label: 'Preto e branco', category: 'Cor', hint: 'tira a cor', amount: 1 },
  sepia: { label: 'Sépia', category: 'Cor', hint: 'tom de foto antiga', amount: 0.8 },
  duotone: { label: 'Duotone', category: 'Cor', hint: 'duas cores: sombras e luzes', amount: 1, color: '#1b1464', color2: '#ff7a59' },
  invert: { label: 'Inverter', category: 'Cor', hint: 'negativo', amount: 1 },
  hue: { label: 'Girar cor', category: 'Cor', hint: 'gira o matiz de todas as cores', amount: 0.5 },
  look: { label: 'Look (LUT)', category: 'Cor', hint: 'look de cor pronto ou LUT .cube importada', amount: 1 },
  pixelate: { label: 'Pixelizar', category: 'Estilo', hint: 'mosaico de blocos', amount: 0.35 },
  rgbSplit: { label: 'RGB split', category: 'Estilo', hint: 'aberração cromática', amount: 0.4 },
  glitch: { label: 'Glitch', category: 'Estilo', hint: 'falhas digitais em rajadas', amount: 0.6, speed: 1 },
  vhs: { label: 'VHS', category: 'Estilo', hint: 'fita antiga: linhas, cor borrada, ruído', amount: 0.7 },
  grain: { label: 'Grão de filme', category: 'Estilo', hint: 'textura de película', amount: 0.45 },
  shake: { label: 'Tremor', category: 'Movimento', hint: 'câmera na mão / impacto', amount: 0.4, speed: 1 },
  zoomPulse: { label: 'Pulso de zoom', category: 'Movimento', hint: 'zoom no ritmo (120 bpm × ritmo)', amount: 0.5, speed: 1 },
  flip: { label: 'Espelhar', category: 'Movimento', hint: 'inverte na horizontal', amount: 1 },
  vignette: { label: 'Vinheta', category: 'Sobreposição', hint: 'escurece as bordas', amount: 0.55 },
  letterbox: { label: 'Barras de cinema', category: 'Sobreposição', hint: 'faixas pretas em cima e embaixo', amount: 0.5 },
  flash: { label: 'Flash', category: 'Sobreposição', hint: 'clarão no ritmo (120 bpm × ritmo)', amount: 0.6, speed: 1 },
};

export function makeEffect(type: EffectType): EffectSpec {
  const d = EFFECTS[type];
  return {
    id: newId('fx'), type, amount: d.amount,
    ...(d.color && { color: d.color }), ...(d.color2 && { color2: d.color2 }), ...(d.speed && { speed: d.speed }),
    ...(type === 'look' && { lut: 'look:teal-orange' }),
  };
}

export const activeEffects = (list: EffectSpec[] | undefined) => (list ?? []).filter((e) => e.enabled !== false && e.amount > 0.001);

// --- superfícies auxiliares -----------------------------------------------------------------

const pool: Surface[] = [];
/** Superfície auxiliar i (reaproveitada) do tamanho pedido, limpa. */
function scratch(i: number, W: number, H: number): [Surface, Ctx] {
  pool[i] ??= new OffscreenCanvas(W, H);
  const s = pool[i];
  if (s.width !== W || s.height !== H) {
    s.width = W;
    s.height = H;
  }
  const c = s.getContext('2d')!;
  reset(c);
  c.clearRect(0, 0, W, H);
  return [s, c];
}
function reset(c: Ctx) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.filter = 'none';
  c.imageSmoothingEnabled = true;
}
/** Cópia da superfície (para redesenhar a partir dela). */
function copyOf(S: Surface, i: number): Surface {
  const [T, t] = scratch(i, S.width, S.height);
  t.drawImage(S, 0, 0);
  return T;
}
/** Recorta de volta à transparência original (sobreposições não vazam para fora do clipe). */
function keepAlpha(s: Ctx, original: Surface) {
  s.globalAlpha = 1;
  s.globalCompositeOperation = 'destination-in';
  s.drawImage(original, 0, 0);
  s.globalCompositeOperation = 'source-over';
}

/** Gerador determinístico (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noiseTiles = new Map<number, Surface>();
/** Ladrilho de ruído 256×256 (6 variações que se alternam a 24 qps). */
function noiseTile(frame: number): Surface {
  const k = ((frame % 6) + 6) % 6;
  let c = noiseTiles.get(k);
  if (!c) {
    c = new OffscreenCanvas(256, 256);
    const x = c.getContext('2d')!;
    const img = x.createImageData(256, 256);
    const r = rng(1234 + k * 977);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.round(r() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    noiseTiles.set(k, c);
  }
  return c;
}

/** Ruído suave e determinístico em [-1, 1]. */
const wobble = (t: number, seed: number) => (Math.sin(t * 13.1 + seed) * 0.5 + Math.sin(t * 29.7 + seed * 2.3) * 0.3 + Math.sin(t * 51.3 + seed * 4.1) * 0.2);

// --- aplicação ------------------------------------------------------------------------------

/**
 * Aplica os efeitos (na ordem) à superfície S, no lugar. `t` = segundos desde o início do clipe.
 */
export function applyEffects(S: Surface, effects: EffectSpec[] | undefined, t: number) {
  const list = activeEffects(effects);
  if (!list.length) return;
  const W = S.width;
  const H = S.height;
  const s = S.getContext('2d')!;
  // filtros simples seguidos viram uma passada só
  let filters: string[] = [];
  const flush = () => {
    if (!filters.length) return;
    const T = copyOf(S, 0);
    reset(s);
    s.clearRect(0, 0, W, H);
    s.filter = filters.join(' ');
    s.drawImage(T, 0, 0);
    reset(s);
    filters = [];
  };
  for (const e of list) {
    const a = Math.min(1, Math.max(0, e.amount));
    switch (e.type) {
      case 'bw':
        filters.push(`grayscale(${a})`);
        continue;
      case 'sepia':
        filters.push(`sepia(${a})`);
        continue;
      case 'invert':
        filters.push(`invert(${a})`);
        continue;
      case 'hue':
        filters.push(`hue-rotate(${Math.round(a * 360)}deg)`);
        continue;
    }
    flush();
    reset(s);
    switch (e.type) {
      case 'blur': {
        const T = copyOf(S, 0);
        // a cópia nítida por baixo evita a borda escura do desfoque no quadro inteiro
        s.filter = `blur(${(a * 0.02 * W).toFixed(1)}px)`;
        s.drawImage(T, 0, 0);
        break;
      }
      case 'glow': {
        const [G, g] = scratch(0, W, H);
        g.filter = `blur(${(0.012 * W + a * 0.02 * W).toFixed(1)}px) brightness(1.35)`;
        g.drawImage(S, 0, 0);
        s.globalCompositeOperation = 'screen';
        s.globalAlpha = a;
        s.drawImage(G, 0, 0);
        break;
      }
      case 'duotone': {
        const orig = copyOf(S, 0);
        const [L, l] = scratch(1, W, H);
        l.filter = 'grayscale(1) contrast(1.1)';
        l.drawImage(orig, 0, 0);
        l.filter = 'none';
        l.globalCompositeOperation = 'multiply';
        l.fillStyle = e.color2 ?? '#ff7a59';
        l.fillRect(0, 0, W, H);
        const [D, d] = scratch(2, W, H);
        d.filter = 'grayscale(1) contrast(1.1) invert(1)';
        d.drawImage(orig, 0, 0);
        d.filter = 'none';
        d.globalCompositeOperation = 'multiply';
        d.fillStyle = e.color ?? '#1b1464';
        d.fillRect(0, 0, W, H);
        l.globalCompositeOperation = 'lighter';
        l.drawImage(D, 0, 0);
        s.globalAlpha = a;
        s.drawImage(L, 0, 0);
        keepAlpha(s, orig);
        break;
      }
      case 'pixelate': {
        const block = Math.max(2, Math.round((0.004 + a * 0.05) * W));
        const sw = Math.max(1, Math.ceil(W / block));
        const sh = Math.max(1, Math.ceil(H / block));
        const [P, p] = scratch(0, sw, sh);
        p.drawImage(S, 0, 0, sw, sh);
        s.clearRect(0, 0, W, H);
        s.imageSmoothingEnabled = false;
        s.drawImage(P, 0, 0, sw, sh, 0, 0, sw * block, sh * block);
        break;
      }
      case 'rgbSplit': {
        const T = copyOf(S, 0);
        rgbSplit(s, T, W, H, 0, 0, W, H, a * 0.014 * W);
        break;
      }
      case 'glitch': {
        // rajadas: em cada fatia de tempo, sorteia (fixo) se há falha e com que força
        const slot = Math.floor(t * 10 * (e.speed ?? 1));
        const r = rng(slot * 7919 + 17)();
        if (r > 0.25 + a * 0.55) break;
        const k = a * (0.5 + r);
        const T = copyOf(S, 0);
        s.clearRect(0, 0, W, H);
        drawSlices(s, T, W, H, NO_CROP, 1, 1, 0, 0, W, H, k, slot, W);
        rgbSplit(s, T, W, H, 0, 0, W, H, k * 0.01 * W);
        break;
      }
      case 'shake': {
        const sp = e.speed ?? 1;
        const T = copyOf(S, 0);
        const k = 1 + a * 0.06; // aproxima um pouco: a borda não aparece
        s.clearRect(0, 0, W, H);
        s.translate(W / 2 + wobble(t * sp, 1) * a * 0.025 * W, H / 2 + wobble(t * sp, 7) * a * 0.025 * H);
        s.rotate(wobble(t * sp, 3) * a * 0.012);
        s.scale(k, k);
        s.drawImage(T, -W / 2, -H / 2);
        break;
      }
      case 'zoomPulse': {
        const period = 60 / (120 * (e.speed ?? 1));
        const ph = (((t % period) + period) % period) / period;
        const k = 1 + a * 0.09 * (1 - ph) ** 3;
        const T = copyOf(S, 0);
        s.clearRect(0, 0, W, H);
        s.translate(W / 2, H / 2);
        s.scale(k, k);
        s.drawImage(T, -W / 2, -H / 2);
        break;
      }
      case 'flip': {
        const T = copyOf(S, 0);
        s.clearRect(0, 0, W, H);
        s.translate(W, 0);
        s.scale(-1, 1);
        s.drawImage(T, 0, 0);
        break;
      }
      case 'grain': {
        const orig = copyOf(S, 0);
        const frame = Math.floor(t * 24);
        const pat = s.createPattern(noiseTile(frame), 'repeat')!;
        const off = rng(frame + 1)() * 256;
        s.translate(off, off);
        s.globalCompositeOperation = 'overlay';
        s.globalAlpha = a * 0.55;
        s.fillStyle = pat;
        s.fillRect(-off, -off, W, H);
        reset(s);
        keepAlpha(s, orig);
        break;
      }
      case 'vhs': {
        const orig = copyOf(S, 0);
        const T = copyOf(S, 1);
        s.clearRect(0, 0, W, H);
        s.filter = `saturate(${1 + a * 0.4}) contrast(${1 + a * 0.08}) blur(${(a * 0.0012 * W).toFixed(1)}px)`;
        s.drawImage(T, 0, 0);
        s.filter = 'none';
        rgbSplit(s, T, W, H, 0, 0, W, H, a * 0.006 * W);
        reset(s);
        // linhas de varredura
        s.globalAlpha = a * 0.22;
        s.fillStyle = '#000';
        const gap = Math.max(2, Math.round(H / 240));
        for (let y = 0; y < H; y += gap * 2) s.fillRect(0, y, W, gap);
        // faixa de "tracking" que desce
        const band = (((t * 0.25) % 1.3) - 0.15) * H;
        s.globalAlpha = a * 0.35;
        s.globalCompositeOperation = 'screen';
        s.fillStyle = s.createPattern(noiseTile(Math.floor(t * 24)), 'repeat')!;
        s.fillRect(0, band, W, H * 0.04);
        reset(s);
        keepAlpha(s, orig);
        break;
      }
      case 'vignette': {
        const orig = copyOf(S, 0);
        const g = s.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${(a * 0.9).toFixed(3)})`);
        s.fillStyle = g;
        s.fillRect(0, 0, W, H);
        keepAlpha(s, orig);
        break;
      }
      case 'letterbox': {
        const orig = copyOf(S, 0);
        const bar = H * a * 0.13;
        s.fillStyle = '#000';
        s.fillRect(0, 0, W, bar);
        s.fillRect(0, H - bar, W, bar);
        keepAlpha(s, orig);
        break;
      }
      case 'lightLeak': {
        const orig = copyOf(S, 0);
        const sp = e.speed ?? 1;
        s.globalCompositeOperation = 'screen';
        s.globalAlpha = a;
        for (const [color, ph, ox] of [[e.color ?? '#ff8a3d', 0, 0.15], [e.color2 ?? '#ff3d8a', 2.1, 0.85]] as const) {
          const x = (ox + Math.sin(t * 0.35 * sp + ph) * 0.18) * W;
          const y = (0.35 + Math.sin(t * 0.27 * sp + ph * 1.7) * 0.3) * H;
          const r = (0.45 + Math.sin(t * 0.5 * sp + ph) * 0.12) * Math.max(W, H);
          const g = s.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          s.fillStyle = g;
          s.fillRect(0, 0, W, H);
        }
        reset(s);
        keepAlpha(s, orig);
        break;
      }
      case 'look': {
        // mesmo processador de cor dos clipes (LUT 3D na GPU)
        const out = colorProcessor().process(S, W, H, { ...NEUTRAL_COLOR, preset: 'look', lut: e.lut, lutAmount: a });
        if (!out) break;
        const orig = copyOf(S, 0);
        s.clearRect(0, 0, W, H);
        s.drawImage(out, 0, 0, W, H);
        keepAlpha(s, orig);
        break;
      }
      case 'flash': {
        const period = 60 / (120 * (e.speed ?? 1));
        const ph = ((t % period) + period) % period;
        const k = Math.max(0, 1 - ph / 0.14);
        if (k <= 0) break;
        const orig = copyOf(S, 0);
        s.globalCompositeOperation = 'screen';
        s.globalAlpha = a * k;
        s.fillStyle = '#fff';
        s.fillRect(0, 0, W, H);
        reset(s);
        keepAlpha(s, orig);
        break;
      }
    }
    reset(s);
  }
  flush();
}
