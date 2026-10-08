import { describe, expect, it } from 'vitest';
import type { Asset, Clip, Project } from '../../core/types';
import { DEFAULT_TRANSFORM, NO_ASSET } from '../../core/types';
import { EditorStore } from '../../engine/timeline/EditorStore';
import { createProject, projectDuration } from '../../engine/timeline/operations';
import { Cmd } from '../../engine/commands/commands';
import { createWorkflow } from '../../core/workflow';
import { defaultTitle } from '../../engine/motion/titles';
import type { TlWord } from '../../engine/cut/smartCut';
import { Draft } from './draft';
import { DirectorTools } from './tools';
import type { DirectorEnv } from './tools';
import { verifyProject } from './verify';
import { costOf, directorSystem, runDirector } from './agent';
import type { CreateMessage } from './agent';
import { methodFor } from './methods';
import '../skills';

// --- projeto sintético: fala principal 0–30 s + dois takes de apoio ---------------------------------

const asset = (id: string, kind: Asset['kind'] = 'video', duration = 30): Asset => ({
  id, name: `${id}.mp4`, kind, mimeType: 'video/mp4', size: 1, lastModified: 1, duration, width: 1920, height: 1080, fps: 30,
  hasVideo: kind !== 'audio', hasAudio: kind !== 'image', videoCodec: 'avc', audioCodec: 'aac', videoDecodable: true, audioDecodable: true,
});

function project(): Project {
  let p = createProject();
  const v1 = p.tracks.find((t) => t.kind === 'video')!.id;
  const main: Clip = { id: 'cMain', assetId: 'main', trackId: v1, start: 0, duration: 30, sourceIn: 0, volume: 1, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM } };
  p = {
    ...p,
    assets: { main: asset('main'), take1: asset('take1', 'video', 10), foto: asset('foto', 'image', 0), song: asset('song', 'audio', 60) },
    clips: { cMain: main },
    metadata: { ...p.metadata, workflow: { ...createWorkflow('youtube', 'educativo'), enabledSkills: ['professional-transition-designer'] } },
  };
  return p;
}

/** Fala: uma frase a cada 3 s, palavras de 0,4 s. */
function speech(n = 9): TlWord[] {
  const out: TlWord[] = [];
  for (let s = 0; s < n; s++) {
    const t0 = s * 3 + 0.2;
    ['Esta', 'é', 'a', `frase${s}.`].forEach((w, i) => out.push({ text: w, start: t0 + i * 0.45, end: t0 + i * 0.45 + 0.4, assetId: 'main', srcStart: t0 + i * 0.45, srcEnd: t0 + i * 0.45 + 0.4, seg: 0 }));
  }
  return out;
}

function env(draft: Draft, words: TlWord[] = speech()): DirectorEnv {
  const lv = new Float32Array(30 * 100).fill(-18);
  return {
    draft,
    ai: { provider: 'claude', claudeKey: '', claudeModel: 'claude-opus-5-5', ollamaUrl: '', ollamaModel: '', cloudConsent: false },
    signal: new AbortController().signal,
    frames: { image: () => null, video: async () => null },
    levels: async () => lv,
    levelRate: 100,
    words: (p) => (Object.keys(p.clips).length ? words.filter((w) => w.end <= projectDuration(p) + 0.01) : []),
    services: { ensureTranscripts: async () => {}, importFiles: async () => new Map(), levels: async () => lv },
    liveAssets: () => [],
    progress: () => {},
  };
}

describe('aplicar a edição do Diretor', () => {
  it('replaceTimeline troca a montagem num passo de undo, mantém id, nome, fluxo e mídias', () => {
    const live = new EditorStore(project());
    const draft = new Draft(live.getState().project, live.getState().revision);
    draft.store.execute(Cmd.rippleRemove([[5, 10]]));
    draft.store.execute(Cmd.renameProject('nome do rascunho'));
    live.execute(Cmd.importAssets([asset('novo', 'image', 0)])); // entrou na Mídia real durante o trabalho
    live.execute(Cmd.replaceTimeline(draft.project));
    const p = live.getState().project;
    expect(projectDuration(p)).toBeCloseTo(25, 5);
    expect(p.name).toBe(project().name);
    expect(p.assets.novo).toBeDefined();
    expect(p.metadata.workflow).toEqual(project().metadata.workflow);
    live.undo();
    expect(projectDuration(live.getState().project)).toBeCloseTo(30, 5);
  });

  it('o rascunho é isolado: editar nele não muda a timeline real', () => {
    const live = new EditorStore(project());
    const draft = new Draft(live.getState().project);
    draft.store.execute(Cmd.rippleRemove([[0, 10]]));
    expect(projectDuration(draft.project)).toBeCloseTo(20, 5);
    expect(projectDuration(live.getState().project)).toBeCloseTo(30, 5);
  });
});

describe('ferramentas do Diretor', () => {
  it('edit_timeline: título, B-roll, música, zoom, transição e corte; inválidos voltam com motivo; undo_last desfaz', () => {
    const draft = new Draft(project());
    const t = new DirectorTools(env(draft));
    const out = t.edit([
      { action: 'title', start: 3, end: 6, text: 'frase1', template: 'callout', reason: 'tese' },
      { action: 'broll', asset_id: 'take1', start: 9.2, end: 13, source_in: 1, reason: 'ilustra' },
      { action: 'broll', asset_id: 'foto', start: 15, end: 18, reason: 'ilustra' },
      { action: 'music', asset_id: 'song', start: 0, end: 30, volume: 0.12, reason: 'clima' },
      { action: 'zoom', clip_id: 'cMain', start: 21, end: 23, amount: 1.1, style: 'push', reason: 'ênfase' },
      { action: 'broll', asset_id: 'naoexiste', start: 1, end: 2, reason: 'x' },
      { action: 'title', start: 4, end: 5, text: 'sobreposto', reason: 'x' },
    ]);
    expect(out).toMatch(/Aplicado: 5 de 7/);
    expect(out).toMatch(/erro #6/);
    expect(out).toMatch(/recusado item .*conflito/);
    const p = draft.project;
    expect(Object.values(p.clips).find((c) => c.title)?.title?.text).toBe('frase1');
    expect(Object.values(p.clips).filter((c) => c.assetId === 'take1')[0].volume).toBe(0);
    expect(p.clips.cMain.keyframes?.scale?.length).toBeGreaterThan(1);
    expect(Object.values(p.clips).every((c) => c.id === 'cMain' || c.origin?.skill === 'director')).toBe(true);
    // corte separado (vira a timeline atual)
    t.edit([{ action: 'cut', ranges: [[27, 30]], reason: 'fim morno' }]);
    expect(projectDuration(draft.project)).toBeCloseTo(27, 1);
    expect(t.undo()).toMatch(/Desfeito/);
    expect(projectDuration(draft.project)).toBeCloseTo(30, 1);
  });

  it('transição pela ferramenta usa a biblioteca e respeita a validação', () => {
    const p = project();
    const v1 = p.tracks.find((x) => x.kind === 'video')!.id;
    p.clips.cMain = { ...p.clips.cMain, duration: 15 };
    p.clips.cB = { ...p.clips.cMain, id: 'cB', start: 15, sourceIn: 15, trackId: v1 };
    const draft = new Draft(p);
    const t = new DirectorTools(env(draft));
    expect(t.edit([{ action: 'transition', clip_id: 'cB', preset_id: 'cross-dissolve', duration: 0.6, reason: 'troca de bloco' }])).toMatch(/Aplicado: 1 de 1/);
    expect(draft.project.clips.cB.transitionIn).toMatchObject({ type: 'cross-dissolve', duration: 0.6, by: 'ai' });
    expect(t.edit([{ action: 'transition', clip_id: 'cB', preset_id: 'beat-zoom', duration: 3, reason: 'x' }])).toMatch(/recusado.*duração/);
  });

  it('leitura: overview, transcrição com pausas e lista de clipes', () => {
    const draft = new Draft(project());
    const t = new DirectorTools(env(draft));
    expect(t.overview()).toMatch(/take1.*NÃO usada/);
    expect(t.transcript()).toMatch(/\[0:00\.2–.*frase0\./);
    expect(t.clips({})).toMatch(/cMain \| V\d \| 0:00\.0–0:30\.0/);
  });

  it('run_skill + accept_suggestions: a skill sugere no rascunho e só aplica o que foi aceito', async () => {
    const p = project();
    const v1 = p.tracks.find((x) => x.kind === 'video')!.id;
    p.clips.cMain = { ...p.clips.cMain, duration: 15 };
    p.clips.cB = { ...p.clips.cMain, id: 'cB', assetId: 'take1', start: 15, duration: 10, sourceIn: 0, trackId: v1 };
    const draft = new Draft(p);
    const t = new DirectorTools(env(draft, []));
    const out = await t.skill('transitions');
    const opId = /Operação (\S+)/.exec(out)?.[1];
    expect(opId).toBeTruthy();
    expect(draft.project.clips.cB.transitionIn).toBeUndefined();
    expect(t.accept(opId!, [], true)).toMatch(/Aplicado/);
    expect(draft.project.clips.cB.transitionIn).toBeDefined();
  });

  it('set_plan e finish registram plano e entrega', () => {
    const t = new DirectorTools(env(new Draft(project())));
    t.setPlan({ summary: 'aula curta', target_duration: 25, structure: [{ start: 0, end: 3, part: 'gancho' }, { start: 3, end: 25, part: 'conteúdo' }] });
    expect(t.state.plan?.structure).toHaveLength(2);
    t.finish({ summary: 'pronto', changes: ['cortei pausas'], open_questions: ['manter a música?'] });
    expect(t.state.finished).toMatchObject({ summary: 'pronto', changes: ['cortei pausas'], openQuestions: ['manter a música?'] });
  });
});

describe('verificação automática', () => {
  const base = (p: Project, words = speech()) => verifyProject({ project: p, words, levels: new Map([['main', new Float32Array(3000).fill(-18)]]), rate: 100, format: 'youtube' });

  it('projeto limpo: sem erros', () => {
    expect(base(project()).filter((i) => i.severity === 'erro')).toEqual([]);
  });

  it('acusa tela preta, corte dentro de palavra, títulos sobrepostos, B-roll no gancho, voz estourada, música alta, trecho parado e duração', () => {
    const p = project();
    const v1 = p.tracks.find((x) => x.kind === 'video')!.id;
    const store = new EditorStore(p);
    // corte em 3,4 s: no meio de "Esta" da frase 1 (3,2–3,6)
    store.execute(Cmd.splitClips(['cMain'], 3.4));
    // buraco: tira 20–22 sem fechar
    const right = Object.values(store.getState().project.clips).find((c) => c.start > 3)!;
    store.execute(Cmd.splitClips([right.id], 20));
    const mid = Object.values(store.getState().project.clips).find((c) => Math.abs(c.start - 20) < 0.01)!;
    store.execute(Cmd.trimClip(mid.id, 'start', 22));
    const broll = store.getState().project.tracks.length;
    void broll;
    store.execute(Cmd.addTrack('video', { id: 'tb', name: 'B-roll' }));
    store.execute(Cmd.addClip({ id: 'b1', assetId: 'take1', trackId: 'tb', start: 0, duration: 2, sourceIn: 0, volume: 0, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM } }));
    store.execute(Cmd.addTrack('video', { id: 'tg', name: 'Gráficos' }));
    store.execute(Cmd.addTrack('video', { id: 'tg2', name: 'Gráficos 2' }));
    store.execute(Cmd.addClip({ id: 't1', assetId: NO_ASSET, trackId: 'tg', start: 6, duration: 3, sourceIn: 0, volume: 0, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM }, title: defaultTitle('callout', 'A') }));
    store.execute(Cmd.addClip({ id: 't2', assetId: NO_ASSET, trackId: 'tg2', start: 7, duration: 3, sourceIn: 0, volume: 0, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM }, title: defaultTitle('callout', 'B') }));
    store.execute(Cmd.addTrack('audio', { id: 'tm', name: 'Música' }));
    store.execute(Cmd.addClip({ id: 'm1', assetId: 'song', trackId: 'tm', start: 0, duration: 30, sourceIn: 0, volume: 0.6, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_TRANSFORM } }));
    void v1;
    const hot = new Float32Array(3000).fill(-0.2);
    const issues = verifyProject({ project: store.getState().project, words: speech(), levels: new Map([['main', hot]]), rate: 100, format: 'shorts', targetDuration: 10 });
    const kinds = new Set(issues.map((i) => i.kind));
    for (const k of ['tela-preta', 'corte-na-palavra', 'titulos-sobrepostos', 'broll-no-gancho', 'voz-estourada', 'musica-alta', 'trecho-parado', 'duracao']) expect(kinds.has(k), k).toBe(true);
    expect(issues[0].severity).toBe('erro');
  });
});

// --- loop do agente com um roteiro (sem API) ----------------------------------------------------------

type Block = Record<string, unknown>;
const msg = (content: Block[], stop: string, usage = { input_tokens: 1000, output_tokens: 200 }) =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, stop_sequence: null, usage }) as unknown as Awaited<ReturnType<CreateMessage>>;
const use = (id: string, name: string, input: Block) => ({ type: 'tool_use', id, name, input });

function scripted(turns: Awaited<ReturnType<CreateMessage>>[]): { create: CreateMessage; calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    create: async (params) => {
      calls.push(structuredClone(params));
      return turns[Math.min(i++, turns.length - 1)];
    },
  };
}

const settings = { provider: 'claude' as const, claudeKey: 'x', claudeModel: 'claude-opus-5-5', ollamaUrl: '', ollamaModel: '', cloudConsent: true };

describe('loop do Diretor', () => {
  it('lê, planeja, edita, verifica e entrega; o histórico volta inteiro (thinking incluído) e o custo é somado', async () => {
    const draft = new Draft(project());
    const tools = new DirectorTools(env(draft));
    const s = scripted([
      msg([{ type: 'thinking', thinking: 'vou ler', signature: 'sig' }, use('u1', 'project_overview', {}), use('u2', 'read_transcript', {})], 'tool_use'),
      msg([use('u3', 'set_plan', { summary: 'aula', structure: [{ start: 0, end: 30, part: 'tudo' }] }), use('u4', 'edit_timeline', { edits: [{ action: 'title', start: 3, end: 6, text: 'frase1', reason: 'tese' }] })], 'tool_use'),
      msg([use('u5', 'verify', {})], 'tool_use'),
      msg([{ type: 'text', text: 'Pronto.' }, use('u6', 'finish', { summary: 'editei', changes: ['título na tese'] })], 'tool_use'),
    ]);
    const events: string[] = [];
    const r = await runDirector({ settings, draft, tools, userText: 'briefing', budgetUsd: 5, maxTurns: 10, signal: new AbortController().signal, onEvent: (e) => events.push(e.type), create: s.create });
    expect(r.stopped).toBe('finished');
    expect(r.turns).toBe(4);
    expect(r.costUsd).toBeCloseTo(costOf('claude-opus-5-5', { input_tokens: 1000, output_tokens: 200 }) * 4, 6);
    expect(tools.state.finished?.summary).toBe('editei');
    expect(Object.values(draft.project.clips).some((c) => c.title?.text === 'frase1')).toBe(true);
    // alternância user/assistant e todos os resultados de um turno numa mensagem só
    expect(r.conversation.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
    const second = r.conversation[2].content as unknown as Block[];
    expect(second.filter((b) => b.type === 'tool_result')).toHaveLength(2);
    // thinking ecoado sem mudanças no turno seguinte
    const req2 = s.calls[1] as { messages: { role: string; content: Block[] }[]; system: Block[] };
    expect(req2.messages[1].content[0]).toMatchObject({ type: 'thinking', thinking: 'vou ler', signature: 'sig' });
    // cache: sistema e só a última mensagem marcados
    expect(req2.system[0].cache_control).toBeDefined();
    const marked = req2.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.cache_control);
    expect(marked).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining(['thinking', 'tool', 'tool_result', 'cost', 'text']));
  });

  it('pedir ajuste continua a mesma conversa (o pedido entra junto do último resultado)', async () => {
    const draft = new Draft(project());
    const tools = new DirectorTools(env(draft));
    const first = await runDirector({ settings, draft, tools, userText: 'briefing', budgetUsd: 5, maxTurns: 5, signal: new AbortController().signal, onEvent: () => {}, create: scripted([msg([use('u1', 'finish', { summary: 'ok', changes: [] })], 'tool_use')]).create });
    const s = scripted([msg([use('u2', 'finish', { summary: 'ajustado', changes: ['menos títulos'] })], 'tool_use')]);
    const r = await runDirector({ settings, draft, tools, userText: 'menos títulos', conversation: first.conversation, budgetUsd: 5, maxTurns: 5, signal: new AbortController().signal, onEvent: () => {}, create: s.create, spentUsd: first.costUsd });
    const req = s.calls[0] as { messages: { role: string; content: Block[] }[] };
    const lastUser = req.messages[req.messages.length - 1];
    expect(lastUser.role).toBe('user');
    expect(lastUser.content.map((b) => b.type)).toEqual(['tool_result', 'text']);
    expect(r.stopped).toBe('finished');
    expect(r.costUsd).toBeGreaterThan(first.costUsd);
  });

  it('para no limite de gasto, no limite de passos e em recusa', async () => {
    const loop = msg([use('u', 'project_overview', {})], 'tool_use', { input_tokens: 400_000, output_tokens: 10_000 });
    const mk = () => ({ draft: new Draft(project()) });
    const a = mk();
    expect((await runDirector({ settings, draft: a.draft, tools: new DirectorTools(env(a.draft)), userText: 'x', budgetUsd: 1, maxTurns: 20, signal: new AbortController().signal, onEvent: () => {}, create: scripted([loop]).create })).stopped).toBe('budget');
    const b = mk();
    expect((await runDirector({ settings, draft: b.draft, tools: new DirectorTools(env(b.draft)), userText: 'x', budgetUsd: 100, maxTurns: 3, signal: new AbortController().signal, onEvent: () => {}, create: scripted([msg([use('u', 'project_overview', {})], 'tool_use')]).create })).stopped).toBe('turns');
    const c = mk();
    expect((await runDirector({ settings, draft: c.draft, tools: new DirectorTools(env(c.draft)), userText: 'x', budgetUsd: 100, maxTurns: 3, signal: new AbortController().signal, onEvent: () => {}, create: scripted([msg([], 'refusal')]).create })).stopped).toBe('refusal');
  });

  it('o prompt traz o método editorial do tipo de vídeo e o formato', () => {
    const p = project();
    p.metadata = { ...p.metadata, workflow: { ...createWorkflow('youtube', 'cristao') } };
    const sys = directorSystem(new Draft(p));
    expect(sys).toMatch(/estudo \/ pregação/);
    expect(sys).toMatch(/FORMATO: youtube/);
    expect(methodFor('short-form', 'venda', true).id).toBe('curto-venda');
  });
});
