import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, Clip, Project } from '../../core/types';
import { DEFAULT_TRANSFORM } from '../../core/types';
import { EditorStore } from '../../engine/timeline/EditorStore';
import { createProject } from '../../engine/timeline/operations';
import { createWorkflow } from '../../core/workflow';
import type { TlWord } from '../../engine/cut/smartCut';
import { applyOperation, revertOperation } from '../history/operations';
import type { EditorPort } from '../history/operations';
import { runStage } from '../orchestrator/orchestrator';
import { Cmd } from '../../engine/commands/commands';
import { manifestFromName, matchScore, tokens } from '../media-analysis/manifest';
import { timelineAssets } from '../../core/workflow';
import { faceSentences, keywordPlacements, schedule, interviewRules } from './interview';
import { splitScript, timeBlocks, READ_RATE } from './script';
import { heuristicPicks, motionStyle, textFromSpeech, trimText, zoomKeyframes } from './motion';
import { sentences } from './common';
import './index';

// sem rede nos testes: os acervos não devolvem nada
vi.mock('../assets/hub', () => ({ findImage: async () => null, providerKeys: () => ({}), saveProviderKeys: () => {} }));
const asset = (id: string, name: string, kind: Asset['kind'] = 'video', duration = 12): Asset => ({
  id, name, kind, mimeType: 'video/mp4', size: 1, lastModified: 1, duration, width: 1920, height: 1080, fps: 30,
  hasVideo: kind !== 'audio', hasAudio: kind !== 'image', videoCodec: 'avc', audioCodec: 'aac', videoDecodable: true, audioDecodable: true,
});

/** Palavras com tempo a partir de frases (0,4 s por palavra, 0,5 s entre frases). */
function speak(lines: string[], assetId = 'main'): TlWord[] {
  const out: TlWord[] = [];
  let t = 0;
  for (const line of lines) {
    for (const w of line.split(' ')) {
      out.push({ text: w, start: t, end: t + 0.35, assetId, srcStart: t, srcEnd: t + 0.35, seg: 0 });
      t += 0.4;
    }
    t += 0.5;
  }
  return out;
}

const SPEECH = [
  'Hoje eu vou contar como mudei de vida.',
  'Tudo começou numa viagem para a praia com a minha família.',
  'A gente acordava cedo e tomava café olhando o mar.',
  'Foi ali que eu entendi o que importava de verdade.',
  'Depois disso voltei para o escritório com outra cabeça.',
  'Trabalhei menos horas e produzi muito mais.',
  'Quanto tempo você ainda vai esperar para mudar?',
  'Comece hoje, mesmo que seja pequeno.',
];

function project(enabled: string[], mode: 'audio-led' | 'script-led' = 'audio-led', script?: string): Project {
  let p = createProject();
  const wf = { ...createWorkflow('youtube', 'educativo', { mode, script }), enabledSkills: enabled };
  p = {
    ...p,
    assets: {
      main: asset('main', 'fala-principal.mp4', 'video', 60),
      t1: asset('t1', 'praia-familia-drone.mp4'),
      t2: asset('t2', 'cafe-xicara-mar.mp4'),
      t3: asset('t3', 'escritorio-computador.mp4'),
      t4: asset('t4', 'DJI_0042.mp4'),
    },
    metadata: { ...p.metadata, workflow: wf },
  };
  if (mode === 'audio-led') {
    const v1 = p.tracks.find((t) => t.kind === 'video')!;
    const main: Clip = { id: 'cMain', assetId: 'main', trackId: v1.id, start: 0, duration: 60, sourceIn: 0, volume: 1, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM } };
    p = { ...p, clips: { cMain: main } };
  }
  return p;
}

let store: EditorStore;
let port: EditorPort;
const portFor = (p: Project) => {
  store = new EditorStore(p);
  port = { getProject: () => store.getState().project, execute: (c) => store.execute(c) !== null, undoLabel: () => store.undoLabel, undo: () => store.undo(), setMeta: (k, v) => store.setMeta(k, v) };
};
const deps = (words: TlWord[]) => ({
  // Claude sem chave: as skills usam as regras locais (sem rede)
  ai: { provider: 'claude' as const, claudeKey: '', claudeModel: '', ollamaUrl: '', ollamaModel: '', cloudConsent: false },
  signal: new AbortController().signal,
  progress: () => {},
  words: () => words,
  services: { ensureTranscripts: async () => {}, importFiles: async () => new Map(), levels: async () => null },
});
const aiClips = () => Object.values(store.getState().project.clips).filter((c) => c.origin?.by === 'ai');

beforeEach(() => portFor(project([])));

describe('índice de mídia (MediaManifest)', () => {
  it('palavras-chave do nome do arquivo, sem lixo de câmera, e casamento com a fala', () => {
    const m = manifestFromName({ id: 't1', name: 'praia-familia-drone_DJI_0042.mp4', duration: 12, width: 3840, height: 2160 });
    expect(m.keywords).toEqual(expect.arrayContaining(['praia', 'familia', 'drone']));
    expect(m.keywords).not.toContain('dji');
    expect(m.usableRanges[0].start).toBeGreaterThan(0); // sem a pontinha da câmera ligando
    expect(m.usableRanges.every((r) => r.end - r.start <= 6)).toBe(true);
    expect(matchScore('fomos à praia com a família', m)).toBeGreaterThan(0.4);
    expect(matchScore('falei de dinheiro e trabalho', m)).toBe(0);
    expect(tokens('Café, MAR e Praias!')).toEqual(expect.arrayContaining(['cafe', 'mar']));
  });
});

describe('edit-interview-with-broll (pela fala)', () => {
  it('cada take entra na frase que fala dele, sem repetir, sem cobrir gancho e fechamento', () => {
    const list = sentences(speak(SPEECH));
    const ms = Object.values(project([]).assets).filter((a) => a.id !== 'main').map((a) => manifestFromName(a));
    const blocked = faceSentences(list);
    const placed = keywordPlacements(list, ms, blocked);
    const byTake = Object.fromEntries(placed.map((p) => [p.manifest.assetId, p.sentence.index]));
    expect(byTake.t1).toBe(1); // praia
    expect(byTake.t2).toBe(2); // café
    expect(byTake.t3).toBe(4); // escritório
    expect(new Set(placed.map((p) => p.manifest.assetId)).size).toBe(placed.length);
    const chosen = schedule(placed, list, ms, blocked, interviewRules(true), list[list.length - 1].end);
    expect(chosen.some((c) => blocked.has(c.sentence.index))).toBe(false);
    // frases seguidas com takes casados viram sequência; o take sem nome descritivo (DJI_0042) entra espalhado, para revisão
    expect(chosen.filter((c) => c.by === 'keywords').map((c) => c.manifest.assetId)).toEqual(['t1', 't2', 't3']);
    expect(chosen.find((c) => c.manifest.assetId === 't1')?.until).toBeDefined();
    expect(chosen.find((c) => c.manifest.assetId === 't4')?.by).toBe('spread');
  });

  it('pela orquestração: takes mudos no B-roll, fala principal intacta, baixa confiança para revisão', async () => {
    portFor(project(['edit-interview-with-broll']));
    const r = await runStage(port, 'images', deps(speak(SPEECH)), { autoApply: true });
    expect(r.skills).toContain('edit-interview-with-broll');
    const op = r.op!;
    expect(op.commands.length).toBeGreaterThanOrEqual(3);
    expect(op.commands.every((c) => c.skill === 'edit-interview-with-broll' && c.reason)).toBe(true);
    const applied = aiClips();
    expect(applied.length).toBeGreaterThan(0);
    const track = store.getState().project.tracks.find((t) => t.id === applied[0].trackId)!;
    expect(track.name).toBe('B-roll');
    expect(applied.every((c) => c.volume === 0)).toBe(true); // o áudio é o da fala principal
    expect(store.getState().project.clips.cMain.duration).toBe(60);
    const low = op.commands.filter((c) => (c.confidence ?? 0) < 0.6);
    expect(low.every((c) => !op.selected?.includes(c.id))).toBe(true);
  });

  it('sem takes de apoio a skill não roda', async () => {
    const p = project(['edit-interview-with-broll']);
    for (const id of ['t1', 't2', 't3', 't4']) delete p.assets[id];
    portFor(p);
    const r = await runStage(port, 'images', deps(speak(SPEECH)), { autoApply: true });
    expect(r.skills).not.toContain('edit-interview-with-broll');
  });

  it('ao criar o projeto pela fala só o vídeo principal vai para a timeline; pelo roteiro, só a narração', () => {
    const a = [asset('m', 'fala.mp4', 'video', 600), asset('x', 'praia.mp4', 'video', 10), asset('n', 'narracao.wav', 'audio', 300), asset('i', 'foto.jpg', 'image', 0)];
    expect(timelineAssets(a, 'audio-led').map((x) => x.id)).toEqual(['m']);
    expect(timelineAssets(a, 'script-led').map((x) => x.id)).toEqual(['n']);
    expect(timelineAssets(a, 'manual-assisted')).toHaveLength(4);
  });
});

describe('edit-script-to-video (pelo roteiro)', () => {
  const SCRIPT = 'Uma família chega à praia ao amanhecer.\n\nNo café da manhã, a xícara fumega diante do mar.\n\nDe volta ao escritório, o computador espera.\n\nUm segredo que ninguém conta.';

  it('divide em blocos e estima o tempo de leitura sem narração', () => {
    const blocks = splitScript(SCRIPT);
    expect(blocks).toHaveLength(4);
    const t = timeBlocks(blocks, []);
    expect(t[0].start).toBe(0);
    expect(t[0].end).toBeCloseTo(blocks[0].split(' ').length / READ_RATE, 1);
    expect(t.every((x) => x.timing === 'estimated')).toBe(true);
    for (let i = 1; i < t.length; i++) expect(t[i].start).toBe(t[i - 1].end);
    const long = splitScript(Array(12).fill('Esta é uma frase de teste com várias palavras.').join(' '));
    expect(long.length).toBeGreaterThan(1);
  });

  it('com narração, cada bloco começa onde a fala dele começa', () => {
    const blocks = splitScript(SCRIPT);
    const words = speak(['Olá.', ...blocks]);
    const t = timeBlocks(blocks, words);
    expect(t.every((x) => x.timing === 'narration')).toBe(true);
    const second = words.find((w) => w.text === 'No')!;
    expect(t[1].start).toBeCloseTo(second.start, 2);
  });

  it('monta com a mídia do usuário que fala de cada bloco e avisa o bloco sem mídia', async () => {
    portFor(project(['edit-script-to-video'], 'script-led', SCRIPT));
    const r = await runStage(port, 'images', deps([]), { autoApply: false });
    const op = r.op!;
    const byAsset = op.commands.map((c) => c.payload.assetId);
    expect(byAsset).toEqual(expect.arrayContaining(['t1', 't2', 't3']));
    expect(new Set(byAsset).size).toBe(byAsset.length); // sem repetir
    expect(op.commands.every((c) => c.payload.role === 'main')).toBe(true); // sem imagem na timeline: vira a trilha principal
    expect(op.warnings?.join(' ')).toMatch(/bloco\(s\) 4/);
    expect(op.notes?.join(' ')).toMatch(/tempo estimado/);
    applyOperation(port, op.id, 'all');
    expect(aiClips().length).toBe(op.commands.length);
  });

  it('sem roteiro, avisa e não faz nada', async () => {
    portFor(project(['edit-script-to-video'], 'script-led'));
    const r = await runStage(port, 'images', deps([]), { autoApply: true });
    expect(r.op).toBeNull();
    expect(r.messages.join(' ')).toMatch(/não tem roteiro/);
  });
});

describe('motion-graphics-designer', () => {
  it('texto sempre tirado da fala; perguntas e números viram destaque', () => {
    expect(textFromSpeech('Quanto tempo você vai esperar', 'Quanto tempo você ainda vai esperar para mudar?')).toBe(true);
    expect(textFromSpeech('Mude sua vida agora', 'Quanto tempo você ainda vai esperar para mudar?')).toBe(false);
    expect(trimText('Trabalhei menos horas e', 5)).toBe('Trabalhei menos horas');
    const list = sentences(speak([...SPEECH, 'Foram 3 anos de trabalho duro até aqui.']));
    const picks = heuristicPicks(list, motionStyle(true), 60);
    expect(picks.some((p) => p.kind === 'callout' && /tempo/i.test(p.text))).toBe(true);
    expect(picks.every((p) => textFromSpeech(p.text, p.sentence.text))).toBe(true);
  });

  it('zoom: keyframes em tempo de origem, volta ao normal no fim da frase', () => {
    const c: Clip = { id: 'c', assetId: 'main', trackId: 't', start: 10, duration: 20, sourceIn: 5, volume: 1, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM } };
    const kf = zoomKeyframes(c, [[12, 15]], motionStyle(true));
    expect(kf).toEqual([
      { t: 5, v: 1, ease: 'hold' },
      { t: 7, v: 1.12, ease: 'hold' },
      { t: 10, v: 1, ease: 'hold' },
    ]);
  });

  it('pela orquestração: títulos em Gráficos + zoom no rosto; desfazer depois de outras edições volta o zoom', async () => {
    portFor(project(['motion-graphics-designer']));
    const r = await runStage(port, 'motion', deps(speak(SPEECH)), { autoApply: false });
    const op = r.op!;
    const titles = op.commands.filter((c) => c.payload.title);
    const zoom = op.commands.find((c) => c.type === 'add_effect');
    expect(titles.length).toBeGreaterThan(0);
    expect(zoom?.payload.clipId).toBe('cMain');
    applyOperation(port, op.id, 'all');
    const p = store.getState().project;
    expect(p.tracks.find((t) => t.id === aiClips()[0].trackId)?.name).toBe('Gráficos');
    expect(p.clips.cMain.keyframes?.scale?.length).toBeGreaterThan(1);
    // outra edição depois: o desfazer não é mais o último passo
    store.execute(Cmd.setVolume({ cMain: 0.9 }));
    const rv = revertOperation(port, op.id);
    expect(rv.ok).toBe(true);
    expect(aiClips()).toHaveLength(0);
    expect(store.getState().project.clips.cMain.keyframes?.scale).toBeUndefined();
  });
});
