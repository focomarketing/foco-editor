import { describe, expect, it } from 'vitest';
import { checkCut, planSmartCuts, refineEnd, refineStart, similarity } from './smartCut';
import type { TlWord } from './smartCut';
import { LEVEL_RATE } from '../analysis/silence';

/** Fala sintética: cada item é [texto, início, fim] (s). O áudio tem som só dentro das palavras. */
function speech(items: [string, number, number][], opts: { seg?: number[]; asset?: string } = {}) {
  const asset = opts.asset ?? 'a';
  const words: TlWord[] = items.map(([text, s, e], i) => ({ text, start: s, end: e, srcStart: s, srcEnd: e, assetId: asset, seg: opts.seg?.[i] ?? 0 }));
  const dur = Math.max(...items.map((x) => x[2])) + 2;
  const levels = new Float32Array(Math.ceil(dur * LEVEL_RATE)).fill(-70);
  for (const [, s, e] of items) for (let i = Math.floor(s * LEVEL_RATE); i < Math.ceil(e * LEVEL_RATE); i++) levels[i] = -18;
  return { words, waves: new Map([[asset, levels]]) };
}

const opts = (mode: 'natural' | 'dynamic' | 'dry', extra = {}) => ({ mode, pauses: true, fillers: true, stutters: true, retakes: true, keepEmphasis: true, ...extra });

describe('bordas pela onda', () => {
  const levels = new Float32Array(500).fill(-70);
  for (let i = 100; i < 160; i++) levels[i] = -18; // som de 1,00 s a 1,60 s
  const wave = { levels, threshold: -40 };
  it('fim: segue o som além do tempo do Whisper e acrescenta cauda', () => {
    const e = refineEnd(wave, 1.4, 3); // Whisper disse que acabou em 1,40
    expect(e).toBeGreaterThan(1.6);
    expect(e).toBeLessThan(1.7);
  });
  it('início: volta até onde a energia começa', () => {
    const s = refineStart(wave, 1.2, 0); // Whisper disse que começou em 1,20
    expect(s).toBeGreaterThan(0.94);
    expect(s).toBeLessThanOrEqual(1.0);
  });
});

describe('pausas por modo', () => {
  // pausa de 1,5 s entre duas frases comuns
  const { words, waves } = speech([['Hoje', 0, 0.4], ['eu', 0.45, 0.6], ['falo.', 0.65, 1.0], ['Isso', 2.5, 2.8], ['funciona.', 2.85, 3.3]]);
  it('natural encurta mas mantém respiração', () => {
    const r = planSmartCuts(words, waves, opts('natural', { keepEmphasis: false }));
    const p = r.cuts.filter((c) => c.kind === 'pause');
    expect(p).toHaveLength(1);
    const left = 1.5 - (p[0].end - p[0].start);
    expect(left).toBeGreaterThan(0.35);
  });
  it('seco deixa quase emendado', () => {
    const r = planSmartCuts(words, waves, opts('dry'));
    const p = r.cuts.find((c) => c.kind === 'pause')!;
    // a pausa original menos o corte: o que sobra fica perto de 0,1 s (mais a cauda das bordas)
    const left = 2.5 - 1.0 - (p.end - p.start);
    expect(left).toBeLessThan(0.3);
  });
  it('pausa curta natural não é tocada', () => {
    const s = speech([['um', 0, 0.3], ['dois', 0.7, 1.0]]);
    expect(planSmartCuts(s.words, s.waves, opts('natural')).cuts).toHaveLength(0);
  });
});

describe('pausa de ênfase', () => {
  const items: [string, number, number][] = [['Se', 0, 0.2], ['Deus', 0.25, 0.6], ['é', 0.65, 0.75], ['bom…', 0.8, 1.2], ['por', 2.2, 2.4], ['que', 2.45, 2.6], ['existe', 2.65, 3.0], ['sofrimento?', 3.05, 3.7]];
  it('natural preserva a pausa antes da pergunta', () => {
    const { words, waves } = speech(items);
    const r = planSmartCuts(words, waves, opts('natural'));
    expect(r.cuts.filter((c) => c.kind === 'pause')).toHaveLength(0);
  });
  it('seco não preserva', () => {
    const { words, waves } = speech(items);
    expect(planSmartCuts(words, waves, opts('dry')).cuts.some((c) => c.kind === 'pause')).toBe(true);
  });
});

describe('erros', () => {
  it('vício e gagueira', () => {
    const { words, waves } = speech([['eu', 0, 0.2], ['eu', 0.3, 0.5], ['acho', 0.55, 0.9], ['ééé', 1.0, 1.5], ['isso.', 1.6, 2.0]]);
    const r = planSmartCuts(words, waves, opts('natural'));
    expect(r.cuts.map((c) => c.kind).sort()).toEqual(['filler', 'stutter']);
  });
  it('começo falso: remove a tentativa abandonada', () => {
    const { words, waves } = speech([['Quando', 0, 0.3], ['nós', 0.35, 0.6], ['fomos.', 0.65, 0.9], ['Quando', 1.6, 1.9], ['nós', 1.95, 2.2], ['fomos', 2.25, 2.5], ['para', 2.55, 2.7], ['a', 2.75, 2.8], ['igreja.', 2.85, 3.3]]);
    const r = planSmartCuts(words, waves, opts('natural'));
    const fs = r.cuts.find((c) => c.kind === 'falseStart')!;
    expect(fs.start).toBeLessThanOrEqual(0.01);
    expect(fs.end).toBeGreaterThan(1.5);
    expect(fs.end).toBeLessThanOrEqual(1.6);
  });
  it('frase repetida em outro take: fica a mais limpa', () => {
    const { words, waves } = speech(
      [['Isso', 0, 0.3], ['acontece', 0.35, 0.8], ['ééé', 0.9, 1.3], ['porque', 1.4, 1.8], ['sim.', 1.85, 2.2], ['Isso', 3.0, 3.3], ['acontece', 3.35, 3.8], ['porque', 3.85, 4.2], ['sim.', 4.25, 4.6]],
      { seg: [0, 0, 0, 0, 0, 1, 1, 1, 1] },
    );
    const r = planSmartCuts(words, waves, opts('natural'));
    const rt = r.cuts.find((c) => c.kind === 'retake')!;
    expect(rt.start).toBeLessThan(0.05); // a primeira (com "ééé") sai
    expect(rt.end).toBeLessThanOrEqual(3.0);
  });
});

describe('utilitários', () => {
  it('similarity', () => {
    expect(similarity(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
    expect(similarity(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd'])).toBe(0.75);
  });
  it('checkCut acha pausa longa e emenda com som', () => {
    const { words } = speech([['a', 0, 0.3], ['b', 2.0, 2.3]]);
    const c = checkCut(words, 'dry', [0.15, 1.0], (t) => t < 0.3);
    expect(c.longPauses).toHaveLength(1);
    expect(c.riskySplices).toEqual([0.15]);
  });
});
