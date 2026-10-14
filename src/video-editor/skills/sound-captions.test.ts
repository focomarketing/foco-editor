import { describe, expect, it } from 'vitest';
import type { Clip, Project } from '../../core/types';
import { DEFAULT_TRANSFORM, NO_ASSET } from '../../core/types';
import { createProject } from '../../engine/timeline/operations';
import { encodeWav, rng, SOUND_LIBRARY } from '../../engine/audio/soundLibrary';
import { heuristicBrief } from '../narrative/brief';
import { profileFor } from '../narrative/profiles';
import { fixWords } from '../narrative/reference';
import { musicSpans, sfxCues } from './audio';
import { applyTone } from '../narrative/tones';
import { ctaCues, ctaElement } from './cta';
import { punchSpans, wordStart } from './motion';
import { safeCorrection } from './color';
import { serialize } from '../director/claudeCode';

const cristao = profileFor({ track: 'youtube', subtype: 'cristao' });
const w = (text: string, i: number) => ({ text, start: i, end: i + 0.8 });

describe('legenda corrigida pelo roteiro (só onde é seguro)', () => {
  it('troca curta entre âncoras', () => {
    const words = ['Ele', 'veio', 'fazer', 'algo', 'maior.', 'Vem', 'ser', 'aquilo'].map(w);
    expect(fixWords(words.slice(5), 'Vencer aquilo que torna a morte definitiva.').map((x) => x.text)).toEqual(['Vencer', 'aquilo']);
    const l = ['Até', 'lásar,', 'o', 'que', 'foi', 'ressuscitado'].map(w);
    expect(fixWords(l, 'Até Lázaro, que foi ressuscitado por Jesus').map((x) => x.text)).toEqual(['Até', 'Lázaro,', 'que', 'foi', 'ressuscitado']);
  });
  it('trecho grande diferente fica como foi dito', () => {
    const words = ['E', 'antes', 'que', 'você', 'venha', 'com', 'o', 'papo', 'de', 'Líverbítrio,', 'não.'].map(w);
    const out = fixWords(words, 'E antes que você venha com “livre-arbítrio”…');
    expect(out.map((x) => x.text).join(' ')).toContain('o papo de');
  });
  it('mantém os tempos da fala', () => {
    const words = ['Vem', 'ser', 'aquilo'].map(w);
    const out = fixWords(words, 'Vencer aquilo.');
    expect(out[0].start).toBe(0);
    expect(out.at(-1)!.text).toBe('aquilo.');
  });
});

/** Fala sintética em blocos com marcadores (para o mapa por regras). */
function speak(lines: string[]) {
  const out: { text: string; start: number; end: number }[] = [];
  let t = 0;
  for (const line of lines) {
    for (const x of line.split(' ')) {
      out.push({ text: x, start: t, end: t + 0.3 });
      t += 0.35;
    }
    t += 0.3;
  }
  return out;
}
const VIDEO = [
  'Se Deus pode tudo, por que permite guerras?',
  'Uma criança não escolheu nascer no meio de uma guerra nem a bomba que caiu sobre a casa dela.',
  'Antes de continuar, se inscreve no canal.',
  'Então vamos começar do começo.',
  'O mundo que Deus criou não é o mundo que conhecemos.',
  'A criação começa como algo bom e depois vem a queda.',
  'Então por que Jesus não curou todo mundo?',
  'Os evangelhos mostram cegos recuperando a visão.',
  'Então eu volto a pergunta do começo.',
  'Este mundo é passagem.',
];

describe('trilha e efeitos pela narrativa', () => {
  const b = heuristicBrief(speak(VIDEO), cristao);
  const end = b.sentences.at(-1)!.end;
  it('cristão: uma trilha só, consistente, que abre na conclusão (sem pular de música)', () => {
    const spans = musicSpans(b, cristao, end + 20);
    expect(spans.map((x) => x.mood)).toEqual(['contemplativa', 'esperanca']);
    expect(spans.at(-1)!.end).toBeCloseTo(end + 20, 1); // vai até o fim do vídeo
    for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end - 0.01);
  });
  it('música escolhida no briefing vale para o vídeo inteiro; tom dramático muda a trilha', () => {
    expect(new Set(musicSpans(b, applyTone(cristao, 'auto', 'epica'), end).map((x) => x.mood))).toEqual(new Set(['epica']));
    expect(musicSpans(b, applyTone(cristao, 'auto', 'none'), end)).toEqual([]);
    const dram = applyTone(cristao, 'dramatico');
    expect(musicSpans(b, dram, end)[0].mood).toBe('tensao');
    expect(dram.sound.sfx.chapter).toBe('riser');
    expect(dram.transitions.allowed).toContain('dip-black');
    expect(applyTone(cristao, 'energetico').punchEvery).toBeLessThan(cristao.punchEvery!);
  });
  it('podcast fica sem trilha', () => {
    expect(musicSpans(b, profileFor({ track: 'youtube', subtype: 'podcast' }), end)).toEqual([]);
  });
  it('cristão: nenhum efeito sonoro gratuito; dramático: riser termina no corte de cada bloco, nada sobreposto', () => {
    let p: Project = createProject();
    const g = p.tracks.find((t) => t.kind === 'video')!.id;
    const title: Clip = { id: 'cT', assetId: NO_ASSET, trackId: g, start: 9, duration: 3, sourceIn: 0, volume: 0, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM }, title: { template: 'title', text: 'X', subtitle: '', fontFamily: '', color: '', accent: '', y: 0.5 }, origin: { by: 'ai', skill: 'motion-graphics-designer' } };
    p = { ...p, clips: { cT: title } };
    expect(sfxCues(p, b, cristao)).toEqual([]);
    const cues = sfxCues(p, b, applyTone(cristao, 'dramatico'));
    expect(cues.some((c) => c.id === 'brilho' || c.id === 'pop')).toBe(false);
    const swells = cues.filter((c) => c.id === 'riser');
    expect(swells.length).toBeGreaterThan(0);
    for (const s of swells) expect(b.sections.some((sec) => Math.abs(s.at + s.duration - sec.start) < 0.01)).toBe(true);
    for (let i = 1; i < cues.length; i++) expect(cues[i].at).toBeGreaterThanOrEqual(cues[i - 1].at + cues[i - 1].duration);
  });
});

describe('biblioteca de sons', () => {
  it('catálogo: trilhas, efeitos e ambientes com ids únicos', () => {
    expect(new Set(SOUND_LIBRARY.map((s) => s.id)).size).toBe(SOUND_LIBRARY.length);
    for (const k of ['music', 'sfx', 'ambience']) expect(SOUND_LIBRARY.some((s) => s.kind === k)).toBe(true);
  });
  it('WAV 16 bits válido', () => {
    const buf = encodeWav([new Float32Array([0, 0.5, -1]), new Float32Array([0, -0.5, 1])], 24000);
    const v = new DataView(buf);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(24000);
    expect(buf.byteLength).toBe(44 + 3 * 2 * 2);
  });
  it('semente: o mesmo som sempre', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('Diretor pela conta: conversa em texto', () => {
  it('ferramentas, resultados e imagens só do último passo', () => {
    const img = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: 'AAAA' } };
    const { text, images } = serialize([
      { role: 'user', content: 'Edite o vídeo.' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'view_frames', input: { times: [1] } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'quadros' }, img] }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'view_frames', input: { times: [2] } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'quadros 2' }, img] }] },
    ]);
    expect(text).toContain('[PESSOA]\nEdite o vídeo.');
    expect(text).toContain('[VOCÊ CHAMOU view_frames] {"times":[1]}');
    expect(text).toContain('(imagem vista num passo anterior)');
    expect(text).toContain('abra o arquivo quadros-1.jpg com Read');
    expect(images).toHaveLength(1);
  });
});

describe('chamada para o canal na palavra da transcrição', () => {
  const words = ['Mas', 'antes', 'de', 'continuar,', 'se', 'inscreve', 'aí', 'no', 'canal', 'e', 'compartilha', 'com', 'alguém.', 'O', 'link', 'está', 'na', 'descrição.'].map((t, i) => ({ text: t, start: i * 0.4 }));
  it('acha inscrição e link na palavra exata (uma peça por vez)', () => {
    const c = ctaCues(words);
    expect(c[0]).toMatchObject({ kind: 'inscricao', at: 5 * 0.4 });
    expect(c.find((x) => x.kind === 'link')?.at).toBeCloseTo(14 * 0.4);
    // "compartilha" a 2 s do botão de inscrição não empilha outra peça
    expect(c.some((x) => x.kind === 'compartilhar')).toBe(false);
  });
  it('botão de inscrição com cursor, acima da legenda', () => {
    const e = ctaElement('inscricao');
    expect(e.layers.some((l) => l.kind === 'text' && l.text === 'INSCREVA-SE')).toBe(true);
    expect(e.layers.some((l) => l.kind === 'arrow')).toBe(true);
    expect(e.layers.every((l) => l.y < 0.8)).toBe(true);
    expect(new Set(e.layers.map((l) => l.id)).size).toBe(e.layers.length);
  });
});

describe('ritmo de agência', () => {
  const list = Array.from({ length: 12 }, (_, i) => ({ start: i * 3, end: i * 3 + 2.8, role: 'argument' }));
  it('troca de enquadramento quando passa do limite sem mudança visual', () => {
    const spans = punchSpans(list, [], 7);
    expect(spans.length).toBeGreaterThan(2);
    let last = 0;
    for (const [a, z] of spans) {
      expect(a - last).toBeGreaterThanOrEqual(7);
      expect(z - a).toBeLessThanOrEqual(6);
      last = z;
    }
  });
  it('imagens e títulos já contam como mudança visual', () => {
    expect(punchSpans(list, [0, 6, 12, 18, 24, 30], 7)).toEqual([]);
  });
  it('título entra na palavra que o chama', () => {
    const ws = ['A', 'resposta', 'é', 'Este', 'mundo', 'é', 'passagem.'].map((t, i) => ({ text: t, start: 10 + i * 0.4, end: 10 + i * 0.4 + 0.35 }));
    expect(wordStart(ws, { index: 0, text: '', start: 10, end: 13 }, 'Este mundo é passagem.')).toBeCloseTo(11.2 - 0.1);
  });
});

describe('colorista: corrige, não estiliza', () => {
  it('limites de segurança e "nada a fazer" quando a diferença não aparece', () => {
    expect(safeCorrection({ exposure: 1.8, saturation: 0.9, temperature: -0.7 })).toMatchObject({ exposure: 0.6, saturation: 0.15, temperature: -0.25 });
    expect(safeCorrection({ exposure: 0.05, contrast: 0.02 })).toBeNull();
  });
});
