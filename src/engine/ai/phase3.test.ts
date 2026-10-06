import { describe, expect, it } from 'vitest';
import { removeKeyframe, setKeyframe, transformAt, valueAt } from '../../core/animation';
import type { Clip, TranscriptWord } from '../../core/types';
import { DEFAULT_TRANSFORM } from '../../core/types';
import { validateCommands } from './commands';
import { smartZoomKeyframes, sentencesOf } from '../analysis/zoom';
import { autoColorFromStats, statsFromPixels } from '../color/color';
import { audioFxFromPreset } from '../audio/audioFx';

describe('keyframes', () => {
  const kfs = [
    { t: 1, v: 1, ease: 'linear' as const },
    { t: 2, v: 2, ease: 'easeInOut' as const },
    { t: 3, v: 1, ease: 'hold' as const },
  ];
  it('interpola e segura nas pontas', () => {
    expect(valueAt(kfs, 0, 9)).toBe(1);
    expect(valueAt(kfs, 1.5, 9)).toBeCloseTo(1.5);
    expect(valueAt(kfs, 2.5, 9)).toBeCloseTo(1.5); // easeInOut no meio = 0.5
    expect(valueAt(kfs, 5, 9)).toBe(1);
    expect(valueAt(undefined, 5, 9)).toBe(9);
  });
  it('set/remove mantém ordem e limpa vazios', () => {
    let k = setKeyframe(undefined, 'scale', { t: 2, v: 1.1, ease: 'linear' });
    k = setKeyframe(k, 'scale', { t: 1, v: 1, ease: 'linear' });
    expect(k.scale!.map((x) => x.t)).toEqual([1, 2]);
    expect(removeKeyframe(removeKeyframe(k, 'scale', 1), 'scale', 2)).toBeUndefined();
  });
  it('transformAt aplica sobre a base', () => {
    const clip = { transform: { ...DEFAULT_TRANSFORM, x: 0.2 }, keyframes: { scale: kfs } } as unknown as Clip;
    expect(transformAt(clip, 1.5)).toMatchObject({ x: 0.2, scale: 1.5 });
  });
});

describe('validador de comandos', () => {
  it('aceita comandos válidos, ajusta tempos e rejeita o resto', () => {
    const { commands, errors } = validateCommands(
      [
        { type: 'remove_silences', level: 'balanced' },
        { type: 'add_title', template: 'title', text: ' Felicidade ', subtitle: '', at: 999, duration: 50 },
        { type: 'color_preset', preset: 'neon' },
        { type: 'delete_everything' },
        { type: 'smart_zoom', intensity: 'normal' },
      ],
      { duration: 60 },
    );
    expect(commands.map((c) => c.type)).toEqual(['remove_silences', 'add_title', 'smart_zoom']);
    expect(commands[1]).toMatchObject({ text: 'Felicidade', at: 59.5, duration: 15 });
    expect(errors).toHaveLength(2);
  });
  it('preenche campo ausente com padrão, mas rejeita valor inválido e marcadores', () => {
    const { commands, errors } = validateCommands(
      [
        { type: 'generate_captions' },
        { type: 'smart_zoom', intensity: 'extremo' },
        { type: 'add_title', template: 'title', text: 'palavra_principal', at: 0, duration: 2 },
      ],
      { duration: 10 },
    );
    expect(commands).toEqual([{ type: 'generate_captions', preset: 'podcast' }]);
    expect(errors).toHaveLength(2);
  });
  it('rejeita resposta que não é lista', () => {
    expect(validateCommands({}, { duration: 1 }).errors).toHaveLength(1);
  });
});

describe('smart zoom', () => {
  const w = (text: string, start: number, end: number): TranscriptWord => ({ text, start, end });
  const words = [
    w('Olá', 0, 0.4), w('pessoal.', 0.4, 1.0),
    w('Isso', 2, 2.3), w('é', 2.3, 2.4), w('muito', 2.4, 2.8), w('importante!', 2.8, 3.6),
    w('Vamos', 5, 5.3), w('continuar', 5.3, 6), w('agora', 6, 6.5), w('com', 6.5, 6.7), w('calma.', 6.7, 7.4),
    w('Outra', 12, 12.3), w('frase', 12.3, 12.7), w('qualquer', 12.7, 13.2), w('aqui.', 13.2, 13.9),
  ];
  it('separa frases', () => {
    expect(sentencesOf(words).map((s) => s.text)).toEqual(['Olá pessoal.', 'Isso é muito importante!', 'Vamos continuar agora com calma.', 'Outra frase qualquer aqui.']);
  });
  it('escolhe a frase enfática e cria entrada/saída suaves', () => {
    const { keyframes, moments } = smartZoomKeyframes(words, null, 'normal');
    expect(moments[0].text).toContain('importante');
    expect(keyframes).toHaveLength(4);
    expect(keyframes[0].v).toBe(1);
    expect(keyframes[1].v).toBeGreaterThan(1.05);
    expect(keyframes.at(-1)!.v).toBe(1);
  });
});

describe('cor automática', () => {
  const frame = (r: number, g: number, b: number) => ({ data: new Uint8ClampedArray(Array.from({ length: 400 }, (_, i) => [r, g, b, 255][i % 4])) });
  it('clareia imagem escura e esquenta imagem azulada', () => {
    const dark = autoColorFromStats(statsFromPixels([frame(40, 40, 40)]));
    expect(dark.exposure).toBeGreaterThan(0.5);
    const blue = autoColorFromStats(statsFromPixels([frame(100, 120, 170)]));
    expect(blue.temperature).toBeGreaterThan(0.2);
  });
  it('imagem neutra fica quase sem correção de balanço', () => {
    const n = autoColorFromStats(statsFromPixels([frame(115, 115, 115)]));
    expect(Math.abs(n.temperature)).toBeLessThan(0.01);
    expect(Math.abs(n.tint)).toBeLessThan(0.01);
  });
});

describe('áudio', () => {
  it('normaliza pela fala e liga o gate quando há ruído', () => {
    const lv = new Float32Array(1000).fill(-30);
    lv.fill(-55, 0, 300); // ruído de fundo
    const fx = audioFxFromPreset('podcast', lv);
    expect(fx.gainDb).toBeCloseTo(13, 0); // -17 alvo - (-30)
    expect(fx.gateDb).toBe(-49);
    expect(audioFxFromPreset('cinematic', lv).gateDb).toBeNull();
  });
});
