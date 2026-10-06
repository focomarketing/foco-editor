import { describe, expect, it } from 'vitest';
import type { TranscriptWord } from '../../core/types';
import { detectSilences, noiseProfile } from './silence';
import { isFiller, normalizeWord, suggestCuts, summarize } from './cuts';

/** Gera níveis: fala (-20 dB) com pausas (-60 dB) nos intervalos dados. */
function levels(duration: number, pauses: [number, number][]) {
  const arr = new Float32Array(Math.round(duration * 100)).fill(-20);
  for (const [a, b] of pauses) arr.fill(-60, Math.round(a * 100), Math.round(b * 100));
  // ruído leve para não ficar artificialmente perfeito
  for (let i = 0; i < arr.length; i++) arr[i] += ((i * 7919) % 13) / 13 - 0.5;
  return arr;
}

const w = (text: string, start: number, end: number): TranscriptWord => ({ text, start, end });

describe('silêncio', () => {
  it('limiar fica entre o ruído e a fala', () => {
    const p = noiseProfile(levels(10, [[2, 4], [6, 8]]));
    expect(p.thresholdDb).toBeGreaterThan(-58);
    expect(p.thresholdDb).toBeLessThan(-25);
  });

  it('encontra as pausas com a duração certa', () => {
    const lv = levels(10, [[2, 3.5], [6, 6.3], [8, 9]]);
    const r = detectSilences(lv, noiseProfile(lv).thresholdDb, 0.5);
    expect(r).toHaveLength(2);
    expect(r[0][0]).toBeCloseTo(2, 1);
    expect(r[0][1]).toBeCloseTo(3.5, 1);
  });

  it('um estalo curto não quebra a pausa', () => {
    const lv = levels(5, [[1, 3]]);
    lv[200] = -10;
    expect(detectSilences(lv, noiseProfile(lv).thresholdDb, 1)).toHaveLength(1);
  });
});

describe('vícios', () => {
  it('normaliza e reconhece', () => {
    expect(normalizeWord('Ééé,').norm).toBe('é');
    expect(isFiller(' ééé')).toBe(true);
    expect(isFiller('é')).toBe(false); // verbo "é"
    expect(isFiller('um')).toBe(false); // artigo
    expect(isFiller('Hum...')).toBe(true);
  });
});

describe('sugestões', () => {
  it('SAFE corta só pausas longas com respiro', () => {
    const lv = levels(12, [[2, 4], [7, 7.7]]);
    const s = suggestCuts({ levels: lv, duration: 12, words: null, level: 'safe' });
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe('silence');
    expect(s[0].start).toBeCloseTo(2.25, 1);
    expect(s[0].end).toBeCloseTo(3.75, 1);
  });

  it('AGGRESSIVE pega pausas menores', () => {
    const lv = levels(12, [[2, 4], [7, 7.7]]);
    expect(suggestCuts({ levels: lv, duration: 12, words: null, level: 'aggressive' })).toHaveLength(2);
  });

  it('não corta palavra dita baixinho dentro da pausa', () => {
    const lv = levels(10, [[2, 5]]);
    const s = suggestCuts({ levels: lv, duration: 10, words: [w('sim', 3, 3.4)], level: 'safe' });
    for (const c of s) expect(c.end <= 3 || c.start >= 3.4).toBe(true);
  });

  it('frase repetida, gagueira e vício', () => {
    const words = [
      w('Hoje', 0, 0.3), w('eu', 0.3, 0.45), w('quero,', 0.45, 0.8),
      w('hoje', 1.0, 1.3), w('eu', 1.3, 1.45), w('quero', 1.45, 1.8), w('falar', 1.8, 2.2),
      w('eu', 2.6, 2.7), w('eu', 2.75, 2.9), w('acho', 2.9, 3.2),
      w('ééé', 3.4, 3.9), w('isso', 4.0, 4.3),
    ];
    const s = suggestCuts({ levels: null, duration: 5, words, level: 'balanced' });
    const kinds = s.map((x) => x.kind);
    expect(kinds).toEqual(['repeat', 'stutter', 'filler']);
    expect(s[0].start).toBe(0);
    expect(s[0].end).toBe(1.0);
    expect(summarize(s).counts.repeat).toBe(1);
  });

  it('SAFE não marca repetição de palavra longa (pode ser ênfase)', () => {
    const words = [w('muito', 0, 0.3), w('muito', 0.35, 0.7), w('bom', 0.7, 1)];
    expect(suggestCuts({ levels: null, duration: 2, words, level: 'safe' })).toHaveLength(0);
    expect(suggestCuts({ levels: null, duration: 2, words, level: 'balanced' })).toHaveLength(1);
  });
});
