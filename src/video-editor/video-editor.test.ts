import { beforeEach, describe, expect, it } from 'vitest';
import type { Asset, Clip, Project } from '../core/types';
import { DEFAULT_TRANSFORM } from '../core/types';
import { EditorStore } from '../engine/timeline/EditorStore';
import { addTrack, createProject, projectDuration } from '../engine/timeline/operations';
import { serialize, deserialize } from '../engine/project/ProjectEngine';
import { createWorkflow } from '../core/workflow';
import type { EditCommand } from './commands/types';
import { applyOperation, createOperation, previewProject, readOperations, rejectOperation, revertOperation } from './history/operations';
import type { EditorPort } from './history/operations';
import { registerSkill, runStage } from './orchestrator/orchestrator';
import type { Skill } from './orchestrator/orchestrator';
import { clipStamp } from './validation/validate';

// --- utilitários ------------------------------------------------------------------------------

const asset = (id: string, kind: Asset['kind'] = 'video', duration = 60): Asset => ({
  id, name: `${id}.mp4`, kind, mimeType: 'video/mp4', size: 1, lastModified: 1, duration, width: 1920, height: 1080, fps: 30,
  hasVideo: kind !== 'audio', hasAudio: kind !== 'image', videoCodec: 'avc', audioCodec: 'aac', videoDecodable: true, audioDecodable: true,
});

function baseProject(): Project {
  let p = createProject();
  p = { ...p, assets: { main: asset('main'), take1: asset('take1'), img: asset('img', 'image', 0), song: asset('song', 'audio', 120) } };
  const v1 = p.tracks.find((t) => t.kind === 'video')!;
  const main: Clip = { id: 'cMain', assetId: 'main', trackId: v1.id, start: 0, duration: 60, sourceIn: 0, volume: 1, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM } };
  return { ...p, clips: { cMain: main }, metadata: { ...p.metadata, workflow: createWorkflow('youtube', 'educativo') } };
}

let store: EditorStore;
let port: EditorPort;
let n = 0;
const cmd = (type: EditCommand['type'], extra: Partial<EditCommand> & { payload?: EditCommand['payload'] }): EditCommand => ({
  id: `k${n++}`, projectId: 'p', type, createdBy: 'ai', skill: 'teste', confidence: 0.9, reason: 'teste', reversible: true, payload: {}, ...extra,
});

beforeEach(() => {
  store = new EditorStore(baseProject());
  port = { getProject: () => store.getState().project, execute: (c) => store.execute(c) !== null, undoLabel: () => store.undoLabel, undo: () => store.undo(), setMeta: (k, v) => store.setMeta(k, v) };
});

const clips = () => Object.values(store.getState().project.clips);
const aiClips = () => clips().filter((c) => c.origin?.by === 'ai');

// --- comandos ------------------------------------------------------------------------------------

describe('comandos aplicados na timeline', () => {
  it('add_overlay (B-roll), add_music, add_caption e título criam faixas por papel e marcam a origem', () => {
    const op = createOperation(port, {
      stage: 'images',
      commands: [
        cmd('add_overlay', { start: 5, end: 9, payload: { assetId: 'img', role: 'broll', scale: 1.3 } }),
        cmd('add_music', { start: 0, end: 60, payload: { assetId: 'song', volume: 0.12, fadeIn: 1, fadeOut: 2 } }),
        cmd('add_caption', { start: 1, end: 3, payload: { caption: { words: [{ text: 'olá', start: 0, end: 0.5 }], style: {} as never } } }),
        cmd('add_overlay', { start: 10, end: 13, payload: { role: 'overlay', title: { template: 'title', text: 'Tese', subtitle: '', fontFamily: 'Arial', color: '#fff', accent: '#00f', y: 0.5 } } }),
      ],
    });
    const res = applyOperation(port, op.id);
    expect(res.rejected).toEqual([]);
    const p = store.getState().project;
    const names = p.tracks.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['B-roll', 'Música', 'Legendas', 'Gráficos']));
    expect(aiClips()).toHaveLength(4);
    expect(aiClips().every((c) => c.origin?.operationId === op.id && c.origin.skill === 'teste')).toBe(true);
    const music = aiClips().find((c) => c.assetId === 'song')!;
    expect(music.volume).toBe(0.12);
    expect(music.fadeOut).toBe(2);
  });

  it('ripple_remove de vários trechos vira um corte só (sem deslocar os outros trechos)', () => {
    const op = createOperation(port, { stage: 'cut', commands: [cmd('ripple_remove', { payload: { ranges: [[10, 12]] } }), cmd('ripple_remove', { payload: { ranges: [[30, 33]] } })] });
    applyOperation(port, op.id);
    expect(projectDuration(store.getState().project)).toBeCloseTo(55, 5);
  });

  it('trim, split, move, efeito, transição e cor em clipe criado pela IA', () => {
    const add = createOperation(port, { commands: [cmd('add_overlay', { start: 20, end: 30, payload: { assetId: 'take1', role: 'broll' } })] });
    applyOperation(port, add.id);
    const id = aiClips()[0].id;
    const op = createOperation(port, {
      commands: [
        cmd('trim_clip', { payload: { clipId: id, edge: 'end', time: 28 } }),
        cmd('add_effect', { payload: { clipId: id, keyframes: { scale: [{ t: 0, v: 1, ease: 'linear' }, { t: 8, v: 1.1, ease: 'linear' }] } } }),
        cmd('add_transition', { payload: { clipId: id, transition: { type: 'dissolve', duration: 0.5 } } }),
        cmd('apply_lut', { payload: { clipId: id, color: { preset: 'x', exposure: 0, contrast: 0.1, highlights: 0, shadows: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, vignette: 0 } } }),
      ],
    });
    applyOperation(port, op.id);
    const c = store.getState().project.clips[id];
    expect(c.duration).toBeCloseTo(8, 5);
    expect(c.keyframes?.scale?.[1].v).toBe(1.1);
    expect(c.transitionIn?.type).toBe('dissolve');
    expect(c.color?.contrast).toBe(0.1);
    const mv = createOperation(port, { commands: [cmd('move_clip', { payload: { clipId: id, to: 40 } })] });
    applyOperation(port, mv.id);
    expect(store.getState().project.clips[id].start).toBe(40);
    const sp = createOperation(port, { commands: [cmd('split_clip', { payload: { clipId: id, time: 44 } })] });
    applyOperation(port, sp.id);
    const pieces = aiClips().filter((x) => x.assetId === 'take1');
    expect(pieces).toHaveLength(2);
    expect(pieces.find((x) => x.start > 40)?.transitionIn).toBeUndefined(); // metade da direita não herda a transição
  });
});

// --- validação e proteção ------------------------------------------------------------------------

describe('validação e proteção do manual', () => {
  it('conflito na faixa, mídia inexistente e tempo inválido são recusados', () => {
    const op = createOperation(port, {
      commands: [
        cmd('add_overlay', { start: 5, end: 9, payload: { assetId: 'img', role: 'broll' } }),
        cmd('add_overlay', { start: 7, end: 11, payload: { assetId: 'img', role: 'broll' } }), // sobrepõe a anterior
        cmd('add_overlay', { start: 20, end: 25, payload: { assetId: 'nao-existe', role: 'broll' } }),
        cmd('add_overlay', { start: 30, end: 29, payload: { assetId: 'img', role: 'broll' } }),
      ],
    });
    const r = applyOperation(port, op.id);
    expect(aiClips()).toHaveLength(1);
    expect(r.rejected.map((x) => x.reason)).toEqual(['conflito: já há um item nesse trecho da faixa', 'mídia inexistente no projeto', 'tempo inválido']);
  });

  it('a IA não remove nem move clipe do usuário; clipe "não alterar" e faixa bloqueada ficam intactos', () => {
    const op1 = createOperation(port, { commands: [cmd('remove_clip', { payload: { clipId: 'cMain' } }), cmd('move_clip', { payload: { clipId: 'cMain', to: 5 } })] });
    expect(applyOperation(port, op1.id).rejected).toHaveLength(2);
    expect(store.getState().project.clips.cMain.start).toBe(0);
    // usuário protege o clipe: nem trim
    store.execute({ type: 'TEST', label: 'proteger', payload: null, execute: (p: Project) => ({ ...p, clips: { ...p.clips, cMain: { ...p.clips.cMain, origin: { by: 'user', locked: true } } } }) });
    const op2 = createOperation(port, { commands: [cmd('trim_clip', { payload: { clipId: 'cMain', edge: 'end', time: 50 } })] });
    expect(applyOperation(port, op2.id).rejected[0].reason).toMatch(/protegido/);
    expect(store.getState().project.clips.cMain.duration).toBe(60);
  });

  it('baixa confiança não vem marcada para aplicar', () => {
    const op = createOperation(port, { commands: [cmd('add_overlay', { start: 5, end: 9, confidence: 0.4, payload: { assetId: 'img' } }), cmd('add_overlay', { start: 20, end: 24, confidence: 0.8, payload: { assetId: 'img' } })] });
    expect(op.selected).toHaveLength(1);
    applyOperation(port, op.id);
    expect(aiClips()).toHaveLength(1);
    expect(aiClips()[0].start).toBe(20);
  });
});

// --- histórico -----------------------------------------------------------------------------------

describe('operações: preview, rejeitar, desfazer, refazer, preservar o manual', () => {
  it('preview não muda a timeline; rejeitar descarta', () => {
    const op = createOperation(port, { commands: [cmd('add_overlay', { start: 5, end: 9, payload: { assetId: 'img' } })] });
    const pv = previewProject(store.getState().project, op);
    expect(Object.keys(pv.project.clips)).toHaveLength(2);
    expect(clips()).toHaveLength(1);
    rejectOperation(port, op.id);
    expect(readOperations(store.getState().project).find((o) => o.id === op.id)?.status).toBe('rejected');
    expect(clips()).toHaveLength(1);
  });

  it('desfazer a operação inteira e refazer (Ctrl+Y)', () => {
    const op = createOperation(port, { commands: [cmd('add_overlay', { start: 5, end: 9, payload: { assetId: 'img' } }), cmd('add_overlay', { start: 20, end: 24, payload: { assetId: 'img' } })] });
    applyOperation(port, op.id);
    expect(aiClips()).toHaveLength(2);
    expect(revertOperation(port, op.id).ok).toBe(true);
    expect(aiClips()).toHaveLength(0);
    store.redo();
    expect(aiClips()).toHaveLength(2);
  });

  it('desfazer depois de outras edições tira só o que a IA criou e mantém o que o usuário editou', () => {
    const op = createOperation(port, { commands: [cmd('add_overlay', { start: 5, end: 9, payload: { assetId: 'img' } }), cmd('add_overlay', { start: 20, end: 24, payload: { assetId: 'img' } })] });
    applyOperation(port, op.id);
    const [a, b] = aiClips();
    // usuário mexe na segunda imagem (escala) e faz outra edição qualquer depois
    store.execute({ type: 'TEST', label: 'manual', payload: null, execute: (p: Project) => ({ ...p, clips: { ...p.clips, [b.id]: { ...p.clips[b.id], transform: { ...p.clips[b.id].transform, scale: 2 } } } }) });
    store.execute({ type: 'TEST', label: 'outra', payload: null, execute: (p: Project) => addTrack(p, 'audio') });
    const r = revertOperation(port, op.id);
    expect(r.ok).toBe(true);
    expect(r.keptEdited).toBe(1);
    expect(store.getState().project.clips[a.id]).toBeUndefined();
    expect(store.getState().project.clips[b.id]).toBeDefined();
  });

  it('impressão do clipe detecta edição manual', () => {
    const c = baseProject().clips.cMain;
    expect(clipStamp(c)).toBe(clipStamp({ ...c }));
    expect(clipStamp(c)).not.toBe(clipStamp({ ...c, start: 1 }));
  });
});

// --- orquestrador --------------------------------------------------------------------------------

describe('orquestrador', () => {
  const deps = () => ({ ai: { provider: 'ollama' as const, claudeKey: '', claudeModel: '', ollamaUrl: '', ollamaModel: '', cloudConsent: false }, signal: new AbortController().signal, progress: () => {}, words: () => [], services: { ensureTranscripts: async () => {}, importFiles: async () => new Map(), levels: async () => null } });

  it('roda as skills habilitadas da etapa, aplica as de confiança alta e deixa o resto para revisão', async () => {
    let calls = 0;
    const skill: Skill = {
      id: 'broll-selector',
      stage: 'images',
      label: 't',
      modes: ['audio-led'],
      async run() {
        calls++;
        return { commands: [cmd('add_overlay', { start: 5 + calls * 20, end: 9 + calls * 20, payload: { assetId: 'img' } }), cmd('add_overlay', { start: 40, end: 44, confidence: 0.3, payload: { assetId: 'img' } })], notes: ['ok'] };
      },
    };
    registerSkill(skill);
    const r = await runStage(port, 'images', deps(), { autoApply: true });
    expect(r.skills).toContain('broll-selector');
    expect(r.op?.status).toBe('applied');
    expect(aiClips()).toHaveLength(1); // a de confiança 0.3 ficou de fora
    // regenerar a etapa: tira só o que a IA criou nela e gera de novo
    const r2 = await runStage(port, 'images', deps(), { autoApply: true, regenerate: true });
    expect(r2.op?.status).toBe('applied');
    expect(aiClips()).toHaveLength(1);
    expect(aiClips()[0].start).toBe(45);
    expect(clips().find((c) => c.id === 'cMain')).toBeDefined(); // clipe do usuário intacto
    expect((store.getState().project.metadata.aiLog as string[]).length).toBeGreaterThan(0);
  });

  it('skill fora do preset ou do modo não roda; sem mídia compatível não cria operação', async () => {
    registerSkill({ id: 'trend-adapter', stage: 'motion', label: 't', modes: ['audio-led'], run: async () => ({ commands: [cmd('add_overlay', { start: 1, end: 2, payload: { assetId: 'img' } })] }) });
    expect((await runStage(port, 'motion', deps(), { autoApply: true })).op).toBeNull(); // youtube-long não habilita trend-adapter
    registerSkill({ id: 'broll-selector', stage: 'images', label: 't', modes: ['audio-led'], run: async () => ({ commands: [], warnings: ['Os acervos não devolveram imagens (sem mídia compatível).'] }) });
    const r = await runStage(port, 'images', deps(), { autoApply: true });
    expect(r.op).toBeNull();
    expect(r.messages.join(' ')).toMatch(/sem mídia compatível/);
  });
});

// --- salvar e reabrir -------------------------------------------------------------------------------

describe('salvar e reabrir', () => {
  it('operações, origem dos clipes e workflow sobrevivem ao .foco', () => {
    const op = createOperation(port, { stage: 'images', commands: [cmd('add_overlay', { start: 5, end: 9, payload: { assetId: 'img' } })] });
    applyOperation(port, op.id);
    const text = serialize(store.getState().project, []);
    const back = deserialize(text).project;
    expect(readOperations(back)[0].status).toBe('applied');
    expect(Object.values(back.clips).find((c) => c.origin?.by === 'ai')?.origin?.operationId).toBe(op.id);
    expect((back.metadata.workflow as { template: string }).template).toBe('youtube-long');
  });
});
