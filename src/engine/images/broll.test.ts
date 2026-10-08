import { describe, expect, it } from 'vitest';
import { BROLL_TRACK, brollCommands, coverScale, density, heuristicMoments, validateMoments } from './broll';
import { createProject } from '../timeline/operations';

describe('densidade', () => {
  it('longo: poucas imagens e mais longas; curto: mais frequentes e curtas', () => {
    const long = density({ short: false, duration: 600 });
    const short = density({ short: true, duration: 40 });
    expect(long.count).toBeGreaterThanOrEqual(15);
    expect(long.max).toBe(8);
    expect(short.count).toBe(8);
    expect(short.max).toBe(4);
  });
});

describe('validação do diretor', () => {
  const d = density({ short: false, duration: 100 });
  it('ordena, limita duração e descarta momento colado no anterior', () => {
    const raw = {
      moments: [
        { start: 50, end: 70, text: 'b', why: '', query: 'war ruins', queryAlt: '' },
        { start: 10, end: 11, text: 'a', why: '', query: 'creation light', queryAlt: 'genesis' },
        { start: 52, end: 55, text: 'colado', why: '', query: 'x', queryAlt: '' },
        { start: 'abc', end: 3, query: 'y' },
        { start: 80, end: 85, text: 'sem busca', query: '' },
      ],
    };
    const m = validateMoments(raw, 100, d);
    expect(m.map((x) => x.text)).toEqual(['a', 'b']);
    expect(m[0].end - m[0].start).toBeGreaterThanOrEqual(d.min);
    expect(m[1].end - m[1].start).toBeLessThanOrEqual(d.max);
  });
  it('resposta inválida vira lista vazia', () => {
    expect(validateMoments(null, 100, d)).toEqual([]);
    expect(validateMoments({ moments: 'x' }, 100, d)).toEqual([]);
  });
});

describe('heurística sem IA', () => {
  it('escolhe frases fortes, espaçadas, com termos de busca', () => {
    const words = [
      ['Hoje', 0], ['vamos', 0.4], ['conversar.', 0.8],
      ['Isso', 10], ['é', 10.3], ['muito', 10.5], ['importante', 10.9], ['sobre', 11.5], ['guerras!', 12],
      ['Bom', 30], ['dia.', 30.5],
    ].map(([text, s]) => ({ text: text as string, start: s as number, end: (s as number) + 0.35 }));
    const m = heuristicMoments(words, 40, density({ short: false, duration: 40 }));
    expect(m.length).toBeGreaterThan(0);
    const strong = m.find((x) => /importante/.test(x.text));
    expect(strong).toBeDefined();
    expect(strong!.query).toMatch(/importante|guerras/);
    // em ordem de tempo e sem sobreposição
    for (let i = 1; i < m.length; i++) expect(m[i].start).toBeGreaterThanOrEqual(m[i - 1].end);
  });
});

describe('montagem', () => {
  it('escala de cobertura preenche o quadro', () => {
    // retrato 1000x1500 num 1920x1080: precisa crescer para cobrir a largura
    expect(coverScale(1000, 1500, 1920, 1080)).toBeGreaterThan(2.5);
    expect(coverScale(1920, 1080, 1920, 1080)).toBeCloseTo(1.02, 2);
  });
  it('cria a trilha B-roll no topo e clipes com movimento e dissolve', () => {
    let p = createProject();
    const { commands, clipIds } = brollCommands(p, [
      { assetId: 'img1', width: 1600, height: 1200, start: 5, duration: 4 },
      { assetId: 'img2', width: 1200, height: 1600, start: 20, duration: 3 },
    ]);
    for (const c of commands) p = c.execute(p);
    expect(p.tracks[0].name).toBe(BROLL_TRACK);
    const c1 = p.clips[clipIds[0]];
    expect(c1.trackId).toBe(p.tracks[0].id);
    expect(c1.keyframes?.opacity?.[0].v).toBe(0);
    expect(c1.keyframes?.opacity?.[1].v).toBe(1);
    const s = c1.keyframes!.scale!;
    expect(s[1].v).toBeGreaterThan(s[0].v); // primeira aproxima
    const s2 = p.clips[clipIds[1]].keyframes!.scale!;
    expect(s2[1].v).toBeLessThan(s2[0].v); // segunda afasta
    // rodar de novo reaproveita a trilha
    const again = brollCommands(p, [{ assetId: 'img3', width: 800, height: 800, start: 40, duration: 3 }]);
    expect(again.commands.some((c) => c.type === 'ADD_TRACK')).toBe(false);
  });
});
