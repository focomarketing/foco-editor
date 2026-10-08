import { beforeEach, describe, expect, it } from 'vitest';
import type { Asset, Clip, Project } from '../../core/types';
import { DEFAULT_TRANSFORM } from '../../core/types';
import { EditorStore } from '../../engine/timeline/EditorStore';
import { createProject } from '../../engine/timeline/operations';
import { Cmd } from '../../engine/commands/commands';
import { createWorkflow } from '../../core/workflow';
import { renderTransition, transitionWindow, transitionsAt, cutPairs } from '../../engine/render/transitions';
import { applyOperation, createOperation, previewProject, revertOperation } from '../history/operations';
import type { EditorPort } from '../history/operations';
import type { EditCommand } from '../commands/types';
import { validateTransition } from '../validation/validate';
import { runStage } from '../orchestrator/orchestrator';
import { CATEGORY_LABEL, TRANSITIONS, presetFor, transitionById } from './library';
import { detectBeats, globalShift, motionDirection, motionMatches, toGray, visualDistance } from './analysis';
import type { Pixels } from './analysis';
import { decide, newDirectorState } from './director';
import type { CutFeatures } from './director';
import '../skills';

// --- utilitários ------------------------------------------------------------------------------------

const asset = (id: string, duration = 30): Asset => ({
  id, name: `${id}.mp4`, kind: 'video', mimeType: 'video/mp4', size: 1, lastModified: 1, duration, width: 1920, height: 1080, fps: 30,
  hasVideo: true, hasAudio: true, videoCodec: 'avc', audioCodec: 'aac', videoDecodable: true, audioDecodable: true,
});
const clip = (id: string, assetId: string, trackId: string, start: number, duration: number, sourceIn = 0): Clip => ({
  id, assetId, trackId, start, duration, sourceIn, volume: 1, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM },
});

/** Três clipes colados na V1: A (0–4), B (4–8), C (8–12). */
function project(template: 'youtube' | 'short' = 'youtube'): Project {
  let p = createProject();
  const v1 = p.tracks.find((t) => t.kind === 'video')!.id;
  p = {
    ...p,
    assets: { a: asset('a'), b: asset('b'), c: asset('c') },
    clips: { A: clip('A', 'a', v1, 0, 4), B: clip('B', 'b', v1, 4, 4), C: clip('C', 'c', v1, 8, 4) },
    metadata: { ...p.metadata, workflow: { ...createWorkflow(template, template === 'youtube' ? 'educativo' : null), enabledSkills: ['professional-transition-designer'] } },
  };
  return p;
}

let store: EditorStore;
let port: EditorPort;
const use = (p: Project) => {
  store = new EditorStore(p);
  port = { getProject: () => store.getState().project, execute: (c) => store.execute(c) !== null, undoLabel: () => store.undoLabel, undo: () => store.undo(), setMeta: (k, v) => store.setMeta(k, v) };
};
beforeEach(() => use(project()));

let n = 0;
const trCmd = (clipId: string, type: string, duration: number, extra: Partial<EditCommand> = {}): EditCommand => ({
  id: `t${n++}`, projectId: 'p', type: 'add_transition', start: 4 - duration / 2, end: 4 + duration / 2, createdBy: 'ai', skill: 'professional-transition-designer', confidence: 0.9, reason: 'teste', reversible: true,
  payload: { clipId, transitionId: type, transition: { type, duration, intensity: 0.5 }, prevTransition: store.getState().project.clips[clipId].transitionIn ?? null, label: type },
  ...extra,
});
const clips = () => store.getState().project.clips;

// --- biblioteca ------------------------------------------------------------------------------------

describe('biblioteca de transições', () => {
  it('30+ presets originais nas quantidades pedidas, todos válidos e para 16:9 e 9:16', () => {
    const rendered = TRANSITIONS.filter((t) => t.render !== 'none');
    expect(rendered.length).toBeGreaterThanOrEqual(30);
    const by = (c: string) => TRANSITIONS.filter((t) => t.category === c).length;
    expect(by('clean')).toBeGreaterThanOrEqual(10);
    expect(by('social')).toBeGreaterThanOrEqual(10);
    expect(by('youtube')).toBeGreaterThanOrEqual(5);
    expect(by('commercial')).toBeGreaterThanOrEqual(5);
    expect(new Set(TRANSITIONS.map((t) => t.id)).size).toBe(TRANSITIONS.length);
    for (const t of TRANSITIONS) {
      expect(CATEGORY_LABEL[t.category]).toBeDefined();
      expect(t.duration.min).toBeLessThanOrEqual(t.duration.recommended);
      expect(t.duration.recommended).toBeLessThanOrEqual(t.duration.max);
      expect(t.requirements.compatibleAspectRatios).toEqual(expect.arrayContaining(['16:9', '9:16']));
      expect(t.reference.length).toBeGreaterThan(3);
      expect([1, 2, 3]).toContain(t.level);
    }
  });

  it('ids antigos continuam abrindo (projetos de antes da biblioteca)', () => {
    expect(presetFor('dissolve')?.id).toBe('cross-dissolve');
    expect(presetFor('whip')?.id).toBe('whip-transition');
  });

  it('todo efeito começa e termina neutro (sem salto ao entrar/sair da janela)', () => {
    for (const t of TRANSITIONS.filter((x) => x.render !== 'none' && x.align === 'center')) {
      for (const u of [0, 1]) {
        const r = renderTransition(t, { type: t.id, duration: t.duration.recommended }, u);
        for (const fx of [r.a, r.b]) {
          if (!fx) continue;
          expect(fx.scale ?? 1).toBeCloseTo(1, 3);
          expect(fx.blur ?? 0).toBeCloseTo(0, 4);
          expect(fx.dx ?? 0).toBeCloseTo(0, 4);
          expect(fx.rotate ?? 0).toBeCloseTo(0, 3);
        }
        expect(r.overlay?.alpha ?? 0).toBeCloseTo(0, 3);
      }
    }
    // entradas terminam com o plano novo inteiro
    for (const t of TRANSITIONS.filter((x) => x.align === 'in' && x.render !== 'zoom')) {
      const r = renderTransition(t, { type: t.id, duration: t.duration.recommended }, 1);
      expect(r.b?.opacity ?? 1).toBeCloseTo(1, 3);
      if (r.b?.mask) expect(r.b.mask.progress).toBeCloseTo(1, 3);
    }
  });
});

// --- motor no compositor ---------------------------------------------------------------------------

describe('motor de transições', () => {
  it('janela centrada: antes do corte o efeito vai no clipe que sai, depois no que entra', () => {
    store.execute(Cmd.setTransition({ B: { type: 'zoom-clean', duration: 0.4 } }));
    const p = store.getState().project;
    expect(transitionWindow(p.clips.B)).toEqual([3.8, 4.2]);
    const before = transitionsAt(p, 3.95);
    expect(before.fx.get('A')?.scale).toBeGreaterThan(1);
    expect(before.fx.has('B')).toBe(false);
    const after = transitionsAt(p, 4.05);
    expect(after.fx.get('B')?.scale).toBeGreaterThan(1);
    expect(transitionsAt(p, 4.5).fx.size).toBe(0); // fora da janela: corte normal
  });

  it('dissolve: depois do corte, o último quadro do anterior fica por baixo (e é guardado antes)', () => {
    store.execute(Cmd.setTransition({ B: { type: 'cross-dissolve', duration: 0.6 } }));
    const p = store.getState().project;
    expect(transitionsAt(p, 3.9).capture.has('A')).toBe(true);
    const mid = transitionsAt(p, 4.3);
    expect(mid.tails[0]).toMatchObject({ under: 'B' });
    expect(mid.tails[0].clip.id).toBe('A');
    expect(mid.fx.get('B')?.opacity).toBeGreaterThan(0.2);
    expect(mid.fx.get('B')?.opacity).toBeLessThan(0.8);
  });

  it('cortes = pares colados na mesma faixa', () => {
    expect(cutPairs(store.getState().project).map((x) => `${x.a.id}>${x.b.id}`)).toEqual(['A>B', 'B>C']);
  });
});

// --- comandos, validação, preview, desfazer --------------------------------------------------------

describe('aplicar, alterar, remover e desfazer', () => {
  it('aplica uma transição (marcada como da IA) e desfaz com Ctrl+Z', () => {
    const op = createOperation(port, { stage: 'transitions', commands: [trCmd('B', 'whip-transition', 0.3)] });
    applyOperation(port, op.id);
    expect(clips().B.transitionIn).toMatchObject({ type: 'whip-transition', duration: 0.3, by: 'ai' });
    store.undo();
    expect(clips().B.transitionIn).toBeUndefined();
  });

  it('alterar parâmetros e remover são comandos desfazíveis', () => {
    store.execute(Cmd.setTransition({ B: { type: 'push-slide', duration: 0.4, by: 'user' } }));
    store.execute(Cmd.setTransition({ B: { ...clips().B.transitionIn!, duration: 0.6, intensity: 0.8, params: { direction: 'up' } } }));
    expect(clips().B.transitionIn).toMatchObject({ duration: 0.6, intensity: 0.8, params: { direction: 'up' } });
    store.execute(Cmd.setTransition({ B: undefined }));
    expect(clips().B.transitionIn).toBeUndefined();
    store.undo();
    expect(clips().B.transitionIn?.duration).toBe(0.6);
  });

  it('duração mínima/máxima do preset e sobreposição inválida são recusadas', () => {
    const p = store.getState().project;
    expect(validateTransition(p, p.clips.B, { type: 'beat-zoom', duration: 0.05 })).toMatch(/duração fora do limite/);
    expect(validateTransition(p, p.clips.B, { type: 'beat-zoom', duration: 0.9 })).toMatch(/duração fora do limite/);
    expect(validateTransition(p, p.clips.B, { type: 'nao-existe', duration: 0.3 })).toMatch(/desconhecida/);
    expect(validateTransition(p, p.clips.B, { type: 'beat-zoom', duration: 0.2 })).toBeNull();
    // C com transição longa invadindo a janela da transição de B
    store.execute(Cmd.setTransition({ B: { type: 'cinematic-dissolve', duration: 2 } }));
    const q = store.getState().project;
    expect(validateTransition(q, { ...q.clips.C, start: 5.2, duration: 3 }, { type: 'zoom-clean', duration: 0.6 })).toBeNull(); // não colado: sem anterior
    const shortB = { ...q, clips: { ...q.clips, B: { ...q.clips.B, transitionIn: { type: 'cinematic-dissolve', duration: 2 } } } };
    expect(validateTransition(shortB, shortB.clips.B, { type: 'cinematic-dissolve', duration: 2.4 })).toMatch(/metade do clipe/);
  });

  it('a IA não substitui uma transição escolhida pelo usuário', () => {
    store.execute(Cmd.setTransition({ B: { type: 'dip-white', duration: 0.6, by: 'user' } }));
    const op = createOperation(port, { stage: 'transitions', commands: [trCmd('B', 'flash-cut', 0.15)] });
    const r = applyOperation(port, op.id);
    expect(r.rejected[0].reason).toMatch(/escolhida por você/);
    expect(clips().B.transitionIn?.type).toBe('dip-white');
  });

  it('preview mostra a transição sem mexer na timeline final', () => {
    const op = createOperation(port, { stage: 'transitions', commands: [trCmd('B', 'flash-cut', 0.15)] });
    const pv = previewProject(store.getState().project, op).project;
    expect(pv.clips.B.transitionIn?.type).toBe('flash-cut');
    expect(transitionsAt(pv, 4.0).overlays.length).toBe(1);
    expect(clips().B.transitionIn).toBeUndefined();
  });

  it('desfazer a etapa depois de outras edições volta a transição anterior e preserva a editada à mão', () => {
    const op = createOperation(port, { stage: 'transitions', commands: [trCmd('B', 'zoom-clean', 0.4), trCmd('C', 'zoom-clean', 0.4, { start: 7.8, end: 8.2 })] });
    applyOperation(port, op.id);
    // o usuário ajusta a de C (vira dele) e faz outra edição qualquer
    store.execute(Cmd.setTransition({ C: { ...clips().C.transitionIn!, duration: 0.5, by: 'user' } }));
    store.execute(Cmd.setVolume({ A: 0.5 }));
    const r = revertOperation(port, op.id);
    expect(r.ok).toBe(true);
    expect(clips().B.transitionIn).toBeUndefined();
    expect(clips().C.transitionIn?.duration).toBe(0.5); // a editada fica
    expect(r.keptEdited).toBe(1);
  });
});

// --- análise ------------------------------------------------------------------------------------------

function stripes(offset: number, w = 64, h = 36, tint = [255, 255, 255]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = ((Math.floor((x - offset) / 5) % 2) + 2) % 2 ? 1 : Math.sin((x - offset) * 0.7 + y * 0.3) * 0.5 + 0.5;
      const i = (y * w + x) * 4;
      data[i] = v * tint[0];
      data[i + 1] = v * tint[1];
      data[i + 2] = v * tint[2];
      data[i + 3] = 255;
    }
  return { data, width: w, height: h };
}

describe('análise do corte', () => {
  it('movimento: acha para onde a imagem andou e se dois planos combinam', () => {
    const v = globalShift(toGray(stripes(0)), toGray(stripes(-3)));
    expect(motionDirection(v)).toBe('left');
    const w = globalShift(toGray(stripes(0)), toGray(stripes(3)));
    expect(motionDirection(w)).toBe('right');
    expect(motionMatches(v, globalShift(toGray(stripes(10)), toGray(stripes(7))))).toBe(true);
    expect(motionMatches(v, w)).toBe(false);
  });

  it('mudança visual: quadros iguais 0, cores opostas alto', () => {
    expect(visualDistance(stripes(0), stripes(0))).toBe(0);
    expect(visualDistance(stripes(0, 64, 36, [255, 40, 40]), stripes(0, 64, 36, [20, 40, 255]))).toBeGreaterThan(0.35);
  });

  it('batidas: picos de energia viram tempos', () => {
    const rate = 100;
    const lv = new Float32Array(rate * 4).fill(-40);
    for (const s of [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]) for (let k = 0; k < 6; k++) lv[Math.round(s * rate) + k] = -8;
    const beats = detectBeats(lv, rate);
    expect(beats.length).toBe(6);
    expect(beats[0]).toBeCloseTo(0.5, 1);
  });
});

// --- diretor ----------------------------------------------------------------------------------------

const base = (o: Partial<CutFeatures> = {}): CutFeatures => ({
  cut: 20, aDuration: 4, bDuration: 4, jumpCut: false, role: 'main', motionA: 'static', motionB: 'static', motionMatch: false, visualChange: 0.6,
  pauseBefore: 0.2, cutInWord: false, keyWordsNear: 0, beat: null, energy: 0.5, captions: false, ...o,
});

describe('diretor de montagem', () => {
  it('prefere corte seco: no YouTube, troca de cena no meio da fala fica seca', () => {
    expect(decide(base(), 'youtube', newDirectorState(), 10).presetId).toBeNull();
    expect(decide(base({ pauseBefore: 0.9 }), 'youtube', newDirectorState(), 10).presetId).toBe('cross-dissolve');
    expect(decide(base({ pauseBefore: 2 }), 'youtube', newDirectorState(), 10).presetId).toBe('chapter-transition');
  });

  it('recusa quando o corte cai numa palavra ou os planos já casam', () => {
    expect(decide(base({ cutInWord: true, beat: 20 }), 'shorts', newDirectorState(), 10)).toMatchObject({ presetId: null, type: 'nenhuma' });
    expect(decide(base({ visualChange: 0.05 }), 'shorts', newDirectorState(), 10)).toMatchObject({ presetId: null, type: 'match-cut' });
  });

  it('sincroniza com a batida (janela centrada na batida)', () => {
    const d = decide(base({ beat: 20.08, energy: 0.6 }), 'shorts', newDirectorState(), 10);
    expect(d.type).toBe('audio');
    // a janela anda em direção à batida (sem deixar de conter o corte) e a batida cai dentro dela
    expect(d.offset).toBeGreaterThan(0);
    expect(d.offset).toBeLessThanOrEqual(d.duration / 2 + 1e-9);
    const center = 20 + d.offset;
    expect(Math.abs(20.08 - center)).toBeLessThanOrEqual(d.duration / 2);
    expect(transitionById(d.presetId!)!.platforms).toEqual(expect.arrayContaining(['tiktok']));
  });

  it('presets diferentes por plataforma para o mesmo corte', () => {
    const f = base({ motionA: 'left', motionB: 'left', motionMatch: true });
    expect(decide(f, 'shorts', newDirectorState(), 10).presetId).toBe('whip-transition');
    expect(decide(f, 'commercial', newDirectorState(), 10).presetId).toBe('whip-pan-soft');
    expect(decide(f, 'youtube', newDirectorState(), 10)).toMatchObject({ presetId: null, type: 'movimento' });
    expect(decide(base({ pauseBefore: 1 }), 'interview', newDirectorState(), 10).presetId).toBe('clean-dissolve');
  });

  it('corte de salto: punch-in alternado (corte invisível)', () => {
    const s = newDirectorState();
    const ids = [1, 2, 3, 4].map((i) => decide(base({ jumpCut: true, cut: i * 20 }), 'youtube', s, 10).presetId);
    expect(ids).toEqual(['punch-in', null, 'punch-in', null]);
  });

  it('ritmo: espaço mínimo entre transições, nada de duas fortes seguidas, palavra importante protege o depoimento', () => {
    const s = newDirectorState();
    const a = decide(base({ beat: 20, energy: 0.9 }), 'shorts', s, 20);
    const b = decide(base({ cut: 20.5, beat: 20.5, energy: 0.9 }), 'shorts', s, 20);
    expect(a.presetId).not.toBeNull();
    expect(b.presetId).toBeNull(); // 0,5 s depois: cedo demais
    const c = decide(base({ cut: 22, beat: 22, energy: 0.9 }), 'shorts', s, 20);
    expect(transitionById(a.presetId!)!.level === 3 && c.presetId ? transitionById(c.presetId)!.level : 0).toBeLessThan(3);
    expect(decide(base({ pauseBefore: 1, keyWordsNear: 2 }), 'interview', newDirectorState(), 10).presetId).toBe('clean-dissolve'); // nível 1: fica
    expect(decide(base({ beat: 20, keyWordsNear: 2 }), 'shorts', newDirectorState(), 10).intensity).toBeLessThan(0.65);
  });
});

// --- skill pela orquestração ---------------------------------------------------------------------------

describe('professional-transition-designer', () => {
  it('analisa os cortes com os quadros e devolve sugestões com preset, confiança e motivo', async () => {
    // B e C: cenas bem diferentes do anterior, em pausa longa da fala → transição no YouTube
    const words = [
      { text: 'Primeira', start: 0.2, end: 1.5, assetId: 'a', srcStart: 0.2, srcEnd: 1.5, seg: 0 },
      { text: 'parte.', start: 1.6, end: 2.4, assetId: 'a', srcStart: 1.6, srcEnd: 2.4, seg: 0 },
      { text: 'Segunda', start: 4.3, end: 5, assetId: 'b', srcStart: 0.3, srcEnd: 1, seg: 1 },
    ];
    const tint: Record<string, number[]> = { a: [255, 40, 40], b: [20, 40, 255], c: [40, 255, 40] };
    const r = await runStage(
      port,
      'transitions',
      {
        ai: { provider: 'claude', claudeKey: '', claudeModel: '', ollamaUrl: '', ollamaModel: '', cloudConsent: false },
        signal: new AbortController().signal,
        progress: () => {},
        words: () => words,
        services: { ensureTranscripts: async () => {}, importFiles: async () => new Map(), levels: async () => null, pixels: async (id) => stripes(0, 64, 36, tint[id]) },
      },
      { autoApply: false },
    );
    expect(r.skills).toContain('professional-transition-designer');
    const op = r.op!;
    expect(op.commands.length).toBeGreaterThan(0);
    const first = op.commands[0];
    expect(first).toMatchObject({ type: 'add_transition', createdBy: 'ai', skill: 'professional-transition-designer' });
    expect(first.payload).toMatchObject({ clipId: 'B', clipBeforeId: 'A' });
    expect(first.confidence).toBeGreaterThan(0);
    expect(first.reason).toBeTruthy();
    expect(op.notes?.join(' ')).toMatch(/corte\(s\) analisados/);
    expect(clips().B.transitionIn).toBeUndefined(); // ainda em revisão
  });
});
