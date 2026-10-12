import { describe, expect, it } from 'vitest';
import { planSmartCuts } from '../../engine/cut/smartCut';
import type { TlWord } from '../../engine/cut/smartCut';
import { relevantTo } from '../assets/hub';
import { briefMoments, paceFor } from '../skills/broll';
import { briefPicks, motionStyle, titleText } from '../skills/motion';
import { cutNarrative } from '../skills/transitions';
import { decide, newDirectorState } from '../transitions/director';
import type { CutFeatures } from '../transitions/director';
import { heuristicBrief, isParallel, resolveStored, storeFromLlm, storedFits } from './brief';
import { imageAllowed, profileFor, themesOf } from './profiles';
import { sentences } from '../skills/common';

/** Fala sintética: frases em sequência, ~0,35 s por palavra, `gap` s entre frases. */
function speak(lines: string[], gap = 0.3): TlWord[] {
  const out: TlWord[] = [];
  let t = 0;
  for (const line of lines) {
    for (const w of line.split(' ')) {
      out.push({ text: w, start: t, end: t + 0.3, srcStart: t, srcEnd: t + 0.3, assetId: 'a', seg: 0 });
      t += 0.35;
    }
    t += gap;
  }
  return out;
}

const cristao = profileFor({ track: 'youtube', subtype: 'cristao' });
const cutOpts = { mode: 'natural' as const, pauses: false, fillers: true, stutters: true, retakes: true, keepEmphasis: true };
const cutTexts = (w: TlWord[], extra = {}) => planSmartCuts(w, new Map(), { ...cutOpts, ...extra }).cuts.map((c) => c.text);

describe('corte respeita a retórica da fala', () => {
  it('anáfora não é começo falso', () => {
    const w = speak(['Não significa que uma mãe não deveria chorar.', 'Não significa que devemos olhar para uma guerra e dizer que faz parte.', 'Significa que a tragédia não é definitiva.']);
    expect(cutTexts(w)).toEqual([]);
  });
  it('perguntas em série não são frase repetida', () => {
    const w = speak(['Porque que ainda existem guerras?', 'Porque que ainda existem doenças?', 'Porque que as pessoas boas continuam sofrendo?']);
    expect(cutTexts(w)).toEqual([]);
  });
  it('paralelismo com uma palavra trocada fica', () => {
    const w = speak(['É por isso que ele curou alguns, mas não todos.', 'É por isso que ele ressuscitou alguns, mas não todos.']);
    expect(cutTexts(w)).toEqual([]);
  });
  it('começo falso de verdade (abandonado e retomado) ainda sai', () => {
    const w = speak(['Hoje eu vou', 'Hoje eu vou mostrar como editar um vídeo inteiro.'], 1.0); // parou e retomou
    expect(cutTexts(w)).toEqual(['Hoje eu vou']);
  });
  it('a mesma frase dita duas vezes ainda sai', () => {
    const w = speak(['Esse é o ponto mais importante do vídeo.', 'Esse é o ponto mais importante do vídeo.']);
    expect(cutTexts(w)).toHaveLength(1);
  });
  it('trecho protegido pelo mapa: nenhuma frase sai dali', () => {
    const w = speak(['Esse é o ponto mais importante do vídeo.', 'Esse é o ponto mais importante do vídeo.']);
    expect(cutTexts(w, { protect: [[0, w[w.length - 1].end]] })).toEqual([]);
  });
});

const VIDEO = [
  'Se Deus realmente pode fazer tudo, por que Ele deixa crianças morrer em guerras?',
  'Ela não escolheu o governo nem a bomba que caiu sobre a casa dela.',
  'Mas antes de continuar, se inscreve aí no nosso canal.',
  'A proposta aqui é colocar a fé diante das perguntas difíceis.',
  'Então vamos começar do começo.',
  'O mundo que Deus criou não é o mundo que conhecemos.',
  'A criação começa como algo bom, mas depois existe uma rebelião e a queda.',
  'Este mundo não é o destino final.',
  'Então por que Jesus não curou todo mundo?',
  'Os evangelhos mostram cegos recuperando a visão e paralíticos andando.',
  'Cura não é a mesma coisa que restauração.',
  'E isso muda a pergunta.',
  'Deus permitir algo não é o mesmo que considerar aquilo bom.',
  'Então eu volto a pergunta do começo.',
  'A cruz não foi o final, a ressurreição foi.',
  'Este mundo é uma passagem.',
  'Se esse vídeo fez você pensar, se inscreve aqui no canal.',
  'Até o próximo vídeo!',
];

describe('mapa narrativo por regras', () => {
  const words = speak(VIDEO);
  const b = heuristicBrief(words, cristao);
  const role = (start: string) => b.sentences.find((s) => s.text.startsWith(start))!.role;

  it('acha os blocos: abertura, chamada, conteúdo, conclusão e chamada final', () => {
    expect(b.sections.map((s) => s.kind)).toEqual(['abertura', 'cta', 'bloco', 'bloco', 'bloco', 'conclusao', 'cta']);
    expect(b.centralQuestion).toMatch(/^Se Deus realmente pode/);
  });
  it('a apresentação do canal fica na chamada; "vamos começar" passa o título para a frase seguinte', () => {
    expect(role('A proposta aqui')).toBe('cta');
    expect(role('O mundo que Deus criou')).toBe('chapter');
    expect(role('Então por que Jesus')).toBe('chapter');
  });
  it('teses curtas e clímax', () => {
    expect(role('Este mundo não é o destino')).toBe('thesis');
    expect(role('Cura não é a mesma')).toBe('thesis');
    expect(role('Este mundo é uma passagem')).toBe('climax');
  });
  it('temas visuais do perfil pela ideia, não por palavra solta', () => {
    expect(themesOf('Ou seja, esta realidade é passageira.', cristao)).toContain('passagem');
    expect(themesOf('Isso é muito superficial.', cristao)).toEqual([]);
    expect(themesOf('Agora então podemos voltar.', cristao)).toEqual([]);
    expect(themesOf('Os evangelhos mostram cegos recuperando a visão.', cristao)[0]).toBe('cura');
  });
  it('imagens: nada na chamada para ação, buscas curadas do tema', () => {
    const dur = words[words.length - 1].end;
    const ms = briefMoments(b, cristao, paceFor(cristao, false, dur), dur);
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) {
      const s = b.sentences.find((x) => Math.abs(x.start - m.start) < 0.01)!;
      expect(s.role).not.toBe('cta');
      expect(cristao.themes.some((t) => t.queries.includes(m.query))).toBe(true);
    }
  });
  it('títulos: tema do bloco e teses; nunca chamada nem frase de passagem', () => {
    const picks = briefPicks(b, { ...motionStyle(false), every: 2 }, 300, cristao);
    const texts = picks.map((p) => p.text);
    expect(texts).toContain('Por que Jesus não curou todo mundo?');
    expect(texts).toContain('Cura não é a mesma coisa que restauração.');
    expect(texts.some((t) => /inscreve|isso muda|eu volto/i.test(t))).toBe(false);
    expect(picks.find((p) => p.text.startsWith('Por que Jesus'))!.kind).toBe('lowerThird');
  });
  it('anáfora vira trecho protegido', () => {
    const w = speak(['É por isso que ele curou alguns, mas não todos.', 'É por isso que ele ressuscitou alguns, mas não todos.', 'O resto é outra conversa.']);
    expect(heuristicBrief(w, cristao).rhetoric).toHaveLength(1);
    expect(isParallel('Porque que ainda existem guerras?', 'Porque que ainda existem doenças?')).toBe(true);
  });
});

describe('mapa do diretor de IA guardado pelo texto', () => {
  const words = speak(VIDEO);
  const list = sentences(words);
  const raw = {
    summary: 'Por que Deus permite o sofrimento.',
    centralQuestion: VIDEO[0],
    thesis: 'Este mundo é passagem; a restauração é o destino.',
    tone: 'sério e esperançoso',
    sections: [
      { sentence: 0, kind: 'abertura', title: 'A acusação' },
      { sentence: 5, kind: 'bloco', title: 'O mundo que Deus criou' },
      { sentence: 99, kind: 'bloco', title: 'índice inválido' },
    ],
    beats: [
      { sentence: 9, role: 'example', visual: 'Jesus curando cegos', query: 'Christ healing the blind painting' },
      { sentence: 16, role: 'cta', visual: '', query: '' },
    ],
    rhetoric: [{ from: 6, to: 7, why: 'paralelismo' }],
  };
  const stored = storeFromLlm(raw, list, cristao)!;
  it('valida índices e guarda por texto', () => {
    expect(stored.sections).toHaveLength(2);
    expect(Object.keys(stored.beats)).toHaveLength(2);
  });
  it('sobrevive aos cortes: tempos novos, mesmos papéis', () => {
    // tira a frase 2 (a chamada do meio) e desloca o resto
    const shifted = speak(VIDEO.filter((_, i) => i !== 2));
    expect(storedFits(stored, sentences(shifted), 'cristao')).toBe(true);
    const b = resolveStored(stored, shifted, cristao);
    const ex = b.sentences.find((s) => s.text.startsWith('Os evangelhos'))!;
    expect(ex.role).toBe('example');
    expect(ex.query).toBe('Christ healing the blind painting');
    expect(b.sections.find((s) => s.title === 'O mundo que Deus criou')!.start).toBeCloseTo(shifted.find((w) => w.text === 'O')!.start, 1);
  });
  it('perfil diferente invalida o mapa guardado', () => {
    expect(storedFits(stored, list, 'educativo')).toBe(false);
  });
});

describe('imagens no contexto do canal', () => {
  it('bloqueia o que entrou fora de contexto no vídeo cristão', () => {
    for (const title of ['Passenger Bus Rotterdam', '21may16 Podemos III Asamblea Ciudadana', 'Superficial-burn', 'Icons8-question-mark-52', 'Handling serpents at the Pentecostal Church']) expect(imageAllowed(title, cristao)).toBe(false);
    expect(imageAllowed('Rembrandt - The Raising of Lazarus', cristao)).toBe(true);
  });
  it('o título tem de falar do que foi buscado', () => {
    expect(relevantTo('The Raising of Lazarus (Rembrandt)', 'Raising of Lazarus painting')).toBe(true);
    expect(relevantTo('Pietà (Michelangelo)', 'Michelangelo Pieta')).toBe(true);
    expect(relevantTo('Passenger Bus Rotterdam', 'Caspar David Friedrich Wanderer above the Sea of Fog')).toBe(false);
    expect(relevantTo('Glyptogenys Ornata paleoart', 'Gustave Dore creation of light')).toBe(false);
  });
});

describe('transições pela narrativa', () => {
  const base: CutFeatures = { cut: 50, aDuration: 30, bDuration: 30, jumpCut: true, role: 'main', motionA: 'static', motionB: 'static', motionMatch: false, visualChange: 0.05, pauseBefore: 0.3, cutInWord: false, keyWordsNear: 0, beat: null, energy: 0.4, captions: false };
  const style = cristao.transitions;
  const run = (n: CutFeatures['narrative'], extra: Partial<CutFeatures> = {}) => decide({ ...base, ...extra, narrative: n }, 'youtube', newDirectorState(), 10, style);

  it('corte de salto dentro de uma repetição intencional: seco', () => {
    expect(run({ sectionStart: false, toCta: false, nextRole: 'question', inRhetoric: true }).presetId).toBeNull();
  });
  it('corte de salto no meio do raciocínio: seco; antes de uma tese: punch-in', () => {
    expect(run({ sectionStart: false, toCta: false, nextRole: 'argument', inRhetoric: false }).presetId).toBeNull();
    expect(run({ sectionStart: false, toCta: false, nextRole: 'thesis', inRhetoric: false }).presetId).toBe('punch-in');
  });
  it('abertura de bloco na mesma câmera muda o enquadramento (sem dissolver o rosto)', () => {
    expect(run({ sectionStart: true, toCta: false, nextRole: 'chapter', inRhetoric: false }).presetId).toBe('punch-in');
  });
  it('abertura de bloco com troca de cena usa a transição do canal', () => {
    const d = run({ sectionStart: true, toCta: false, nextRole: 'chapter', inRhetoric: false }, { jumpCut: false, visualChange: 0.6 });
    expect(d.presetId).toBe(style.chapter);
  });
  it('preset fora do estilo do canal vira corte seco', () => {
    const d = decide({ ...base, jumpCut: false, visualChange: 0.6, pauseBefore: 2, role: 'main' }, 'youtube', newDirectorState(), 10, { ...style, allowed: ['punch-in'] });
    expect(d.presetId).toBeNull();
  });
  it('a chamada do meio do vídeo não é encerramento', () => {
    const words = speak(VIDEO);
    const b = heuristicBrief(words, cristao);
    const mid = b.sections.find((s) => s.kind === 'cta')!;
    const end = b.sections.at(-1)!;
    expect(cutNarrative(b, mid.start).toCta).toBe(false);
    expect(cutNarrative(b, end.start).toCta).toBe(true);
  });
  it('titleText tira o conectivo do começo', () => {
    expect(titleText('Então por que Jesus não curou todo mundo?')).toBe('Por que Jesus não curou todo mundo?');
  });
});
