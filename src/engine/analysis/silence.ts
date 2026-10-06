// Detecção de silêncio sobre o nível RMS do áudio (dBFS, LEVEL_RATE valores por segundo).
// O limiar se adapta ao material: fica entre o ruído de fundo e o nível típico da fala,
// então funciona tanto em estúdio quanto em gravação com ruído ambiente.

import type { Range } from '../timeline/operations';

export const LEVEL_RATE = 100;
export const SILENT_DB = -100;

export interface NoiseProfile {
  floorDb: number;
  speechDb: number;
  thresholdDb: number;
}

function percentile(sorted: Float32Array, p: number) {
  if (!sorted.length) return SILENT_DB;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

export function noiseProfile(levels: Float32Array): NoiseProfile {
  const sorted = Float32Array.from(levels).sort();
  const floorDb = percentile(sorted, 0.1);
  const speechDb = percentile(sorted, 0.9);
  const span = Math.max(0, speechDb - floorDb);
  // 35% acima do piso; nunca colado no piso nem acima da fala.
  const thresholdDb = Math.min(speechDb - 6, Math.max(floorDb + 4, floorDb + span * 0.35));
  return { floorDb, speechDb, thresholdDb };
}

/**
 * Trechos abaixo do limiar com pelo menos `minDuration` segundos.
 * Picos curtos (até `bridge` segundos, ex.: um estalo) não quebram o silêncio.
 */
export function detectSilences(
  levels: Float32Array,
  thresholdDb: number,
  minDuration: number,
  rate = LEVEL_RATE,
  bridge = 0.03,
): Range[] {
  const out: Range[] = [];
  const maxBlip = Math.round(bridge * rate);
  let runStart = -1;
  let lastQuiet = -1;
  for (let i = 0; i <= levels.length; i++) {
    const quiet = i < levels.length && levels[i] < thresholdDb;
    if (quiet) {
      if (runStart < 0) runStart = i;
      lastQuiet = i;
    } else if (runStart >= 0 && (i === levels.length || i - lastQuiet > maxBlip)) {
      const a = runStart / rate;
      const b = (lastQuiet + 1) / rate;
      if (b - a >= minDuration) out.push([a, b]);
      runStart = -1;
    }
  }
  return out;
}

/** Fração do intervalo que está abaixo do limiar. */
export function quietFraction(levels: Float32Array, thresholdDb: number, a: number, b: number, rate = LEVEL_RATE): number {
  const i0 = Math.max(0, Math.floor(a * rate));
  const i1 = Math.min(levels.length, Math.ceil(b * rate));
  if (i1 <= i0) return 1;
  let q = 0;
  for (let i = i0; i < i1; i++) if (levels[i] < thresholdDb) q++;
  return q / (i1 - i0);
}
