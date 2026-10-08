// Ferramentas do Diretor: o que ele pode olhar e fazer no rascunho. Cada ferramenta devolve texto
// (ou imagem, em view_frames) para o modelo, e toda edição passa pela mesma validação das skills.

import type Anthropic from '@anthropic-ai/sdk';
import type { Asset, Clip, Project, TitleTemplate } from '../../core/types';
import { newId } from '../../core/time';
import { clipEnd, projectDuration } from '../../engine/timeline/operations';
import { defaultTitle } from '../../engine/motion/titles';
import { coverScale, kenBurns } from '../../engine/images/broll';
import type { CutMode, TlWord } from '../../engine/cut/smartCut';
import type { AISettings } from '../../engine/ai/providers';
import { Cmd } from '../../engine/commands/commands';
import { readWorkflow } from '../../core/workflow';
import type { PhaseId } from '../../core/workflow';
import type { EditCommand } from '../commands/types';
import { applyOperation, createOperation, readOperations, setSelected } from '../history/operations';
import { runStage } from '../orchestrator/orchestrator';
import type { SkillServices } from '../orchestrator/orchestrator';
import { presetFor, transitionById } from '../transitions/library';
import { formatFor } from '../transitions/director';
import { zoomKeyframes } from '../skills/motion';
import { sentences } from '../skills/common';
import { contactSheet } from './still';
import type { FrameReader } from './still';
import { issuesText, verifyProject } from './verify';
import type { Issue } from './verify';
import type { Draft } from './draft';

export interface DirectorPlan {
  summary: string;
  targetDuration?: number;
  structure: { start: number; end: number; part: string; note?: string }[];
}

export interface DirectorFinish {
  summary: string;
  changes: string[];
  openQuestions: string[];
}

/** Tudo o que as ferramentas precisam do app (injetado: os testes usam versões falsas). */
export interface DirectorEnv {
  draft: Draft;
  ai: AISettings;
  signal: AbortSignal;
  frames: FrameReader;
  levels(assetId: string): Promise<Float32Array | null>;
  /** Níveis por segundo dos arrays de levels. */
  levelRate: number;
  /** Fala da timeline de um projeto (transcrições já feitas). */
  words(p: Project): TlWord[];
  /** Serviços das skills (transcrever, importar mídia...). */
  services: SkillServices;
  /** Mídias que entraram no projeto real (para copiar no rascunho depois de importar). */
  liveAssets(): Asset[];
  setCutMode?(m: CutMode): void;
  progress(step: string): void;
}

export interface DirectorState {
  plan?: DirectorPlan;
  finished?: DirectorFinish;
  lastIssues?: Issue[];
  framesSeen: number;
}

export type ToolOutput = { content: string | Anthropic.Beta.Messages.BetaToolResultBlockParam['content']; isError?: boolean; image?: string };

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required, additionalProperties: false });

export const DIRECTOR_TOOLS: Anthropic.Beta.Messages.BetaTool[] = [
  { name: 'project_overview', description: 'Resumo do projeto: formato, tipo de vídeo, duração, faixas, mídias (com o que cada take mostra), roteiro e o que já foi feito. Comece por aqui.', input_schema: obj({}) },
  {
    name: 'read_transcript',
    description: 'Frases da fala na timeline do rascunho, com tempo (m:ss.s), e as pausas maiores que 0,6 s entre elas. Use from/to (segundos) para trechos de vídeos longos.',
    input_schema: obj({ from: { type: 'number' }, to: { type: 'number' } }),
  },
  { name: 'audio_report', description: 'Medição do áudio do rascunho: nível médio e pico da voz, segundos estourados, ruído de fundo, faixas de música e volumes.', input_schema: obj({}) },
  {
    name: 'view_frames',
    description: 'Renderiza quadros do rascunho (com B-roll, títulos, legendas e transições, como sai no vídeo final) e devolve uma folha de contato. Até 12 tempos por chamada. Use para conferir enquadramento, legibilidade, se o B-roll combina e se não há tela preta.',
    input_schema: obj({ times: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 12 } }, ['times']),
  },
  {
    name: 'list_clips',
    description: 'Clipes do rascunho com id, faixa, início–fim, mídia ou texto, origem (você/IA/usuário) e transição. Filtre por tempo (from/to) ou nome da faixa.',
    input_schema: obj({ from: { type: 'number' }, to: { type: 'number' }, track: { type: 'string' } }),
  },
  {
    name: 'run_skill',
    description: 'Roda uma skill especializada do FOCO no rascunho e devolve as sugestões dela (sem aplicar): cut = corte de pausas/erros/tomadas pela onda do áudio (cut_mode natural|dynamic|dry); images = takes de apoio e imagens de acervo pela fala; transitions = transições por análise de movimento/cor/batida; motion = títulos animados e zoom. Depois use accept_suggestions com os ids que fizerem sentido.',
    input_schema: obj({ stage: { type: 'string', enum: ['cut', 'images', 'transitions', 'motion'] }, cut_mode: { type: 'string', enum: ['natural', 'dynamic', 'dry'] } }, ['stage']),
  },
  {
    name: 'accept_suggestions',
    description: 'Aplica no rascunho as sugestões escolhidas de uma operação devolvida por run_skill (ids) ou todas (all: true).',
    input_schema: obj({ operation_id: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' } }, ['operation_id']),
  },
  {
    name: 'edit_timeline',
    description: [
      'Edita o rascunho com comandos seus (todos validados; os recusados voltam com o motivo). Tempos em segundos na timeline ATUAL do rascunho. Ações:',
      '- cut {ranges:[[ini,fim],...]}: remove trechos e fecha o buraco (aplicado por último na mesma chamada);',
      '- title {start,end,text,template: title|lowerThird|callout|cta, subtitle?}: texto animado (use palavras da fala);',
      '- broll {asset_id,start,end,source_in?}: take/imagem de apoio por cima da fala (mudo);',
      '- music {asset_id,start,end,volume}: trilha (0..1, sob fala ≤ 0,2);',
      '- transition {clip_id,preset_id,duration?,intensity?,direction?}: transição de entrada no clipe que entra (preset_id da biblioteca: cross-dissolve, dip-black, zoom-clean, punch-in, whip-transition, beat-zoom, flash-cut, light-sweep...);',
      '- zoom {clip_id,start,end,amount (1.03–1.3),style: punch|push}: aproximação no rosto nas frases indicadas;',
      '- volume {clip_id,volume}; trim {clip_id,edge:start|end,time}; remove {clip_id} (só itens criados pela IA).',
      'Toda ação leva reason (o porquê editorial).',
    ].join('\n'),
    input_schema: obj(
      {
        edits: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['cut', 'title', 'broll', 'music', 'transition', 'zoom', 'volume', 'trim', 'remove'] },
              reason: { type: 'string' },
              ranges: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
              start: { type: 'number' },
              end: { type: 'number' },
              text: { type: 'string' },
              template: { type: 'string', enum: ['title', 'lowerThird', 'callout', 'cta'] },
              subtitle: { type: 'string' },
              asset_id: { type: 'string' },
              source_in: { type: 'number' },
              clip_id: { type: 'string' },
              preset_id: { type: 'string' },
              duration: { type: 'number' },
              intensity: { type: 'number' },
              direction: { type: 'string', enum: ['left', 'right', 'up', 'down'] },
              amount: { type: 'number' },
              style: { type: 'string', enum: ['punch', 'push'] },
              volume: { type: 'number' },
              edge: { type: 'string', enum: ['start', 'end'] },
              time: { type: 'number' },
            },
            required: ['action', 'reason'],
          },
        },
      },
      ['edits'],
    ),
  },
  { name: 'undo_last', description: 'Desfaz a última alteração feita no rascunho (sua ou de uma skill aceita).', input_schema: obj({}) },
  { name: 'verify', description: 'Conferência automática do rascunho: corte no meio de palavra, tela preta, B-roll no gancho, títulos sobrepostos, transições demais, voz estourada/baixa, música alta, duração e trechos parados. Rode antes de entregar e corrija os erros.', input_schema: obj({}) },
  {
    name: 'set_plan',
    description: 'Registra o plano editorial (mostrado à pessoa): resumo, duração alvo e a estrutura em partes com tempos.',
    input_schema: obj(
      {
        summary: { type: 'string' },
        target_duration: { type: 'number' },
        structure: { type: 'array', items: { type: 'object', properties: { start: { type: 'number' }, end: { type: 'number' }, part: { type: 'string' }, note: { type: 'string' } }, required: ['start', 'end', 'part'] } },
      },
      ['summary', 'structure'],
    ),
  },
  {
    name: 'finish',
    description: 'Entrega o rascunho para a pessoa aprovar. Só chame depois de verify sem erros (ou explique por que um erro ficou). Liste as mudanças principais e dúvidas que a pessoa precisa decidir.',
    input_schema: obj({ summary: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } }, open_questions: { type: 'array', items: { type: 'string' } } }, ['summary', 'changes']),
  },
];

const trackName = (p: Project, c: Clip) => p.tracks.find((t) => t.id === c.trackId)?.name ?? '?';

function originLabel(c: Clip) {
  if (!c.origin) return 'usuário';
  return c.origin.skill === 'director' ? 'você' : `IA (${c.origin.skill ?? 'skill'})`;
}

export class DirectorTools {
  readonly state: DirectorState = { framesSeen: 0 };
  private env: DirectorEnv;
  constructor(env: DirectorEnv) {
    this.env = env;
  }

  private get p() {
    return this.env.draft.project;
  }

  async run(name: string, input: Record<string, unknown>): Promise<ToolOutput> {
    this.env.signal.throwIfAborted();
    try {
      switch (name) {
        case 'project_overview':
          return { content: this.overview() };
        case 'read_transcript':
          return { content: this.transcript(num(input.from) ? input.from : undefined, num(input.to) ? input.to : undefined) };
        case 'audio_report':
          return { content: await this.audio() };
        case 'view_frames':
          return await this.frames(Array.isArray(input.times) ? input.times.filter(num) : []);
        case 'list_clips':
          return { content: this.clips(input) };
        case 'run_skill':
          return { content: await this.skill(String(input.stage), input.cut_mode as CutMode | undefined) };
        case 'accept_suggestions':
          return { content: this.accept(String(input.operation_id), Array.isArray(input.ids) ? input.ids.map(String) : [], input.all === true) };
        case 'edit_timeline':
          return { content: this.edit(Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []) };
        case 'undo_last':
          return { content: this.undo() };
        case 'verify':
          return { content: await this.verify() };
        case 'set_plan':
          return { content: this.setPlan(input) };
        case 'finish':
          return { content: this.finish(input) };
        default:
          return { content: `Ferramenta desconhecida: ${name}`, isError: true };
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      return { content: `Erro em ${name}: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }

  // --- leitura ----------------------------------------------------------------------------------

  overview(): string {
    const p = this.p;
    const wf = readWorkflow(p.metadata);
    const dur = projectDuration(p);
    const used = new Set(Object.values(p.clips).map((c) => c.assetId));
    const lines = [
      `Projeto "${p.name}" · ${p.settings.width}×${p.settings.height} · ${p.settings.fps} fps · duração ${fmt(dur)} (${dur.toFixed(1)} s)`,
      wf ? `Trilha: ${wf.template ?? wf.track}${wf.subtype ? ` · tipo ${wf.subtype}` : ''} · modo ${wf.mode ?? '—'}` : 'Projeto manual (sem trilha guiada).',
      `Formato editorial: ${formatFor(wf?.template, wf?.subtype, p.settings.height > p.settings.width)}`,
      '',
      'Faixas:',
      ...p.tracks.map((t) => {
        const cs = Object.values(p.clips).filter((c) => c.trackId === t.id);
        return `- ${t.name} (${t.kind}${t.hidden ? ', oculta' : ''}${t.muted ? ', muda' : ''}${t.locked ? ', bloqueada' : ''}): ${cs.length} clipe(s)`;
      }),
      '',
      'Mídias:',
      ...Object.values(p.assets).map((a) => `- ${a.id} · ${a.name} · ${a.kind}${a.duration ? ` ${a.duration.toFixed(1)} s` : ''}${a.width ? ` ${a.width}×${a.height}` : ''}${a.hasAudio ? ' · com som' : ''}${used.has(a.id) ? ' · na timeline' : ' · NÃO usada (take de apoio)'}`),
    ];
    if (wf?.script) lines.push('', 'Roteiro:', wf.script.slice(0, 4000));
    const ops = readOperations(p).slice(-8);
    if (ops.length) lines.push('', 'Últimas operações:', ...ops.map((o) => `- ${o.id} · ${o.stage ?? ''} · ${o.skill ?? ''} · ${o.status} · ${o.commands.length} item(ns)`));
    if (!this.env.words(p).length) lines.push('', 'Atenção: a fala ainda não foi transcrita (run_skill cut transcreve).');
    return lines.join('\n');
  }

  transcript(from = 0, to = Infinity): string {
    const words = this.env.words(this.p).filter((w) => w.end > from && w.start < to);
    if (!words.length) return 'Sem fala transcrita neste trecho. Rode run_skill {stage:"cut"} para transcrever e cortar, ou confira se há áudio.';
    const list = sentences(words);
    const out: string[] = [];
    for (const [i, s] of list.entries()) {
      out.push(`[${fmt(s.start)}–${fmt(s.end)}] ${s.text}`);
      const next = list[i + 1];
      if (next && next.start - s.end >= 0.6) out.push(`   (pausa ${(next.start - s.end).toFixed(1)} s)`);
    }
    const text = out.join('\n');
    return text.length > 30_000 ? `${text.slice(0, 30_000)}\n… (cortado: peça um trecho com from/to)` : text;
  }

  async audio(): Promise<string> {
    const p = this.p;
    const words = this.env.words(p);
    const rate = this.env.levelRate;
    const out: string[] = [];
    const assets = [...new Set(words.map((w) => w.assetId))];
    for (const id of assets) {
      const lv = await this.env.levels(id);
      if (!lv) continue;
      const vals: number[] = [];
      for (const w of words.filter((x) => x.assetId === id)) for (let t = w.srcStart; t < w.srcEnd; t += 1 / rate) vals.push(lv[Math.floor(t * rate)]);
      const finite = vals.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
      if (!finite.length) continue;
      const avg = finite.reduce((a, b) => a + b, 0) / finite.length;
      const all = Array.from(lv).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
      const floor = all[Math.floor(all.length * 0.1)];
      const clipped = finite.filter((x) => x > -1).length / rate;
      out.push(`- ${p.assets[id]?.name ?? id}: voz média ${avg.toFixed(1)} dBFS, pico ${finite[finite.length - 1].toFixed(1)} dBFS, ${clipped.toFixed(1)} s estourados, ruído de fundo ~${floor.toFixed(0)} dBFS`);
    }
    const music = Object.values(p.clips).filter((c) => /m[uú]sica|music/i.test(trackName(p, c)));
    out.push(music.length ? `Música: ${music.map((c) => `${p.assets[c.assetId]?.name ?? c.assetId} ${fmt(c.start)}–${fmt(clipEnd(c))} volume ${Math.round(c.volume * 100)}%`).join('; ')}` : 'Sem música na timeline.');
    out.push('Referência: voz média entre −22 e −14 dBFS; nada acima de −1 dBFS; música sob fala ≤ 20%.');
    return out.join('\n');
  }

  async frames(times: number[]): Promise<ToolOutput> {
    const dur = projectDuration(this.p);
    const ts = [...new Set(times.map((t) => +Math.max(0, Math.min(dur - 0.05, t)).toFixed(2)))].sort((a, b) => a - b).slice(0, 12);
    if (!ts.length) return { content: 'Informe tempos dentro do vídeo.', isError: true };
    this.env.progress(`Olhando ${ts.length} quadro(s)…`);
    const sheet = await contactSheet(this.p, ts, this.env.frames);
    this.state.framesSeen += ts.length;
    return {
      image: sheet.base64,
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: sheet.base64 } },
        { type: 'text', text: `Folha de contato ${sheet.cols}×${sheet.rows}, na ordem: ${ts.map((t, i) => `${i + 1}=${fmt(t)}`).join(', ')}.` },
      ],
    };
  }

  clips(input: Record<string, unknown>): string {
    const p = this.p;
    const from = num(input.from) ? input.from : 0;
    const to = num(input.to) ? input.to : Infinity;
    const track = str(input.track) ? input.track.toLowerCase() : null;
    const list = Object.values(p.clips)
      .filter((c) => clipEnd(c) > from && c.start < to && (!track || trackName(p, c).toLowerCase().includes(track)))
      .sort((a, b) => a.start - b.start);
    if (!list.length) return 'Nenhum clipe nesse filtro.';
    const lines = list.slice(0, 300).map((c) => {
      const what = c.title ? `título "${c.title.text}" (${c.title.template})` : c.caption ? 'legenda' : (p.assets[c.assetId]?.name ?? c.assetId);
      const tr = c.transitionIn ? ` · transição ${presetFor(c.transitionIn.type)?.name ?? c.transitionIn.type} ${c.transitionIn.duration}s` : '';
      const kf = c.keyframes?.scale?.length ? ' · zoom' : '';
      return `${c.id} | ${trackName(p, c)} | ${fmt(c.start)}–${fmt(clipEnd(c))} | ${what} | src ${c.sourceIn.toFixed(2)} | vol ${Math.round(c.volume * 100)}% | ${originLabel(c)}${tr}${kf}`;
    });
    return `${lines.join('\n')}${list.length > 300 ? `\n… ${list.length - 300} a mais (filtre por tempo)` : ''}`;
  }

  // --- skills -----------------------------------------------------------------------------------

  async skill(stage: string, cutMode?: CutMode): Promise<string> {
    if (!['cut', 'images', 'transitions', 'motion'].includes(stage)) return `Etapa inválida: ${stage}`;
    if (cutMode) this.env.setCutMode?.(cutMode);
    const env = this.env;
    const draft = env.draft;
    const services: SkillServices = {
      ...env.services,
      async importFiles(files) {
        const r = await env.services.importFiles(files);
        draft.addAssets(env.liveAssets());
        return r;
      },
    };
    const r = await runStage(draft.port, stage as PhaseId, { ai: env.ai, signal: env.signal, progress: (s) => env.progress(s), words: () => env.words(draft.project), services }, { autoApply: false });
    draft.addAssets(env.liveAssets());
    if (!r.op) return `Nenhuma sugestão (${r.skills.join(', ') || 'nenhuma skill'}): ${r.messages.join(' ') || 'nada a fazer.'}`;
    const lines = r.op.commands.map((c) => {
      const what = c.payload.title ? `título "${c.payload.title.text}"` : String(c.payload.label ?? c.payload.transitionId ?? (c.type === 'ripple_remove' ? `corte ${(c.payload.ranges ?? []).map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(', ')}` : ''));
      return `${c.id} | ${c.type} | ${c.start !== undefined ? fmt(c.start) : ''}${c.end !== undefined ? `–${fmt(c.end)}` : ''} | ${what} | ${Math.round((c.confidence ?? 1) * 100)}% | ${c.reason ?? ''}`;
    });
    return [`Operação ${r.op.id} (${r.skills.join(' + ')}) — ${r.op.commands.length} sugestão(ões), nada aplicado ainda:`, ...lines, ...(r.op.notes ?? []), ...(r.op.warnings ?? []).map((w) => `aviso: ${w}`)].join('\n');
  }

  accept(opId: string, ids: string[], all: boolean): string {
    const port = this.env.draft.port;
    const op = readOperations(port.getProject()).find((o) => o.id === opId);
    if (!op) return `Operação ${opId} não encontrada.`;
    if (op.status !== 'preview') return `Operação ${opId} já está ${op.status}.`;
    if (!all) {
      const valid = ids.filter((id) => op.commands.some((c) => c.id === id));
      if (!valid.length) return 'Nenhum id válido dessa operação.';
      setSelected(port, opId, valid);
    }
    const before = projectDuration(port.getProject());
    const r = applyOperation(port, opId, all ? 'all' : 'selected');
    const after = projectDuration(port.getProject());
    return `Aplicado: ${(all ? op.commands.length : ids.length) - r.rejected.length} item(ns). Duração ${before.toFixed(1)} → ${after.toFixed(1)} s.${r.rejected.length ? `\nRecusados: ${r.rejected.map((x) => `${x.id}: ${x.reason}`).join('; ')}` : ''}`;
  }

  // --- edição própria ------------------------------------------------------------------------------

  edit(edits: Record<string, unknown>[]): string {
    const draft = this.env.draft;
    const p = this.p;
    const commands: EditCommand[] = [];
    const errors: string[] = [];
    const notes: string[] = [];
    const base = (e: Record<string, unknown>) => ({ id: newId('k'), projectId: p.id, createdBy: 'ai' as const, skill: 'director', confidence: 0.9, reason: str(e.reason) ? e.reason.slice(0, 200) : 'decisão do Diretor', reversible: true });
    const zoomSpans = new Map<string, { clip: Clip; spans: [number, number][]; amount: number; punch: boolean; reason: string }>();
    for (const [i, e] of edits.entries()) {
      const tag = `#${i + 1} ${String(e.action)}`;
      const clip = str(e.clip_id) ? p.clips[e.clip_id] : undefined;
      switch (e.action) {
        case 'cut': {
          const ranges = (Array.isArray(e.ranges) ? e.ranges : []).filter((r): r is [number, number] => Array.isArray(r) && num(r[0]) && num(r[1]) && r[1] > r[0]);
          if (!ranges.length) errors.push(`${tag}: ranges vazio`);
          else commands.push({ ...base(e), type: 'ripple_remove', payload: { ranges, label: 'corte' } });
          break;
        }
        case 'title': {
          if (!num(e.start) || !num(e.end) || !str(e.text)) {
            errors.push(`${tag}: precisa de start, end e text`);
            break;
          }
          const template = (['title', 'lowerThird', 'callout', 'cta'].includes(String(e.template)) ? e.template : 'callout') as TitleTemplate;
          const title = { ...defaultTitle(template, e.text.slice(0, 80)), subtitle: str(e.subtitle) ? e.subtitle.slice(0, 80) : '' };
          commands.push({ ...base(e), type: 'add_overlay', start: e.start, end: e.end, payload: { role: 'overlay', title, label: e.text } });
          break;
        }
        case 'broll':
        case 'music': {
          const a = str(e.asset_id) ? p.assets[e.asset_id] : undefined;
          if (!a || !num(e.start) || !num(e.end)) {
            errors.push(`${tag}: precisa de asset_id válido, start e end`);
            break;
          }
          if (e.action === 'music') {
            commands.push({ ...base(e), type: 'add_music', start: e.start, end: e.end, payload: { assetId: a.id, role: 'music', sourceIn: num(e.source_in) ? e.source_in : 0, volume: num(e.volume) ? Math.max(0, Math.min(1, e.volume)) : 0.15, fadeIn: 1.5, fadeOut: 2, label: a.name } });
          } else if (a.kind === 'image') {
            const kb = kenBurns(a.width, a.height, p.settings.width, p.settings.height, e.end - e.start, i);
            commands.push({ ...base(e), type: 'add_overlay', start: e.start, end: e.end, payload: { assetId: a.id, role: 'broll', scale: kb.scale, keyframes: kb.keyframes, label: a.name } });
          } else {
            const scale = a.width && a.height ? +coverScale(a.width, a.height, p.settings.width, p.settings.height).toFixed(3) : 1;
            commands.push({ ...base(e), type: 'add_clip', start: e.start, end: e.end, payload: { assetId: a.id, role: 'broll', sourceIn: num(e.source_in) ? e.source_in : 0, volume: 0, scale, label: a.name } });
          }
          break;
        }
        case 'transition': {
          const preset = str(e.preset_id) ? transitionById(e.preset_id) : undefined;
          if (!clip || !preset) {
            errors.push(`${tag}: clip_id ou preset_id inválido`);
            break;
          }
          const transition = {
            type: preset.id,
            duration: num(e.duration) ? e.duration : preset.duration.recommended,
            intensity: num(e.intensity) ? Math.max(0, Math.min(1, e.intensity)) : preset.parameters.intensity,
            easing: preset.parameters.easing,
            ...(str(e.direction) ? { params: { direction: e.direction } } : {}),
          };
          commands.push({ ...base(e), type: 'add_transition', start: clip.start, end: clip.start + transition.duration, payload: { clipId: clip.id, transitionId: preset.id, transition, prevTransition: clip.transitionIn ?? null, label: preset.name } });
          break;
        }
        case 'zoom': {
          if (!clip || !num(e.start) || !num(e.end)) {
            errors.push(`${tag}: precisa de clip_id, start e end`);
            break;
          }
          const z = zoomSpans.get(clip.id) ?? { clip, spans: [], amount: num(e.amount) ? Math.max(1.02, Math.min(1.35, e.amount)) : 1.08, punch: e.style !== 'push', reason: base(e).reason };
          z.spans.push([e.start, e.end]);
          zoomSpans.set(clip.id, z);
          break;
        }
        case 'volume': {
          if (!clip || !num(e.volume)) {
            errors.push(`${tag}: precisa de clip_id e volume`);
            break;
          }
          draft.store.execute(Cmd.setVolume({ [clip.id]: Math.max(0, Math.min(1, e.volume)) }));
          notes.push(`${tag}: volume de ${clip.id} = ${Math.round(e.volume * 100)}%`);
          break;
        }
        case 'trim':
          if (!clip || !num(e.time) || (e.edge !== 'start' && e.edge !== 'end')) errors.push(`${tag}: precisa de clip_id, edge e time`);
          else commands.push({ ...base(e), type: 'trim_clip', payload: { clipId: clip.id, edge: e.edge, time: e.time } });
          break;
        case 'remove':
          if (!clip) errors.push(`${tag}: clip_id inválido`);
          else commands.push({ ...base(e), type: 'remove_clip', payload: { clipId: clip.id } });
          break;
        default:
          errors.push(`${tag}: ação desconhecida`);
      }
    }
    for (const z of zoomSpans.values()) {
      const scale = zoomKeyframes(z.clip, z.spans, { every: 0, max: 0, zoom: z.amount, punch: z.punch, accent: '', maxWords: 0 });
      if (!scale.length) {
        errors.push(`zoom em ${z.clip.id}: trechos fora do clipe ou curtos demais`);
        continue;
      }
      commands.push({ id: newId('k'), projectId: p.id, createdBy: 'ai', skill: 'director', confidence: 0.9, reason: z.reason, reversible: true, type: 'add_effect', start: z.spans[0][0], payload: { clipId: z.clip.id, keyframes: { scale }, prevKeyframes: z.clip.keyframes ?? null, label: 'Zoom' } });
    }
    let applied = 0;
    const rejected: string[] = [];
    if (commands.length) {
      const op = createOperation(draft.port, { stage: 'director', skill: 'director', commands });
      const r = applyOperation(draft.port, op.id, 'all');
      applied = commands.length - r.rejected.length;
      for (const x of r.rejected) rejected.push(`${commands.findIndex((c) => c.id === x.id) + 1}: ${x.reason}`);
    }
    const dur = projectDuration(this.p);
    return [`Aplicado: ${applied + notes.length} de ${edits.length}. Duração agora ${fmt(dur)} (${dur.toFixed(1)} s).`, ...notes, ...errors.map((x) => `erro ${x}`), ...rejected.map((x) => `recusado item ${x}`)].join('\n');
  }

  undo(): string {
    const s = this.env.draft.store;
    const label = s.undoLabel;
    if (!label) return 'Nada para desfazer.';
    s.undo();
    return `Desfeito: ${label}. Duração ${projectDuration(this.p).toFixed(1)} s.`;
  }

  async verify(): Promise<string> {
    const p = this.p;
    const words = this.env.words(p);
    const levels = new Map<string, Float32Array>();
    for (const id of new Set(words.map((w) => w.assetId))) {
      const lv = await this.env.levels(id);
      if (lv) levels.set(id, lv);
    }
    const wf = readWorkflow(p.metadata);
    const issues = verifyProject({ project: p, words, levels, rate: this.env.levelRate, format: formatFor(wf?.template, wf?.subtype, p.settings.height > p.settings.width), targetDuration: this.state.plan?.targetDuration });
    this.state.lastIssues = issues;
    return issuesText(issues);
  }

  setPlan(input: Record<string, unknown>): string {
    const structure = (Array.isArray(input.structure) ? input.structure : [])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .filter((x) => num(x.start) && num(x.end) && str(x.part))
      .map((x) => ({ start: x.start as number, end: x.end as number, part: String(x.part).slice(0, 80), note: str(x.note) ? x.note.slice(0, 200) : undefined }));
    this.state.plan = { summary: str(input.summary) ? input.summary.slice(0, 2000) : '', targetDuration: num(input.target_duration) ? input.target_duration : undefined, structure };
    return `Plano registrado (${structure.length} parte(s)).`;
  }

  finish(input: Record<string, unknown>): string {
    const list = (v: unknown) => (Array.isArray(v) ? v.filter(str).map((s) => s.slice(0, 300)) : []);
    this.state.finished = { summary: str(input.summary) ? input.summary.slice(0, 3000) : '', changes: list(input.changes), openQuestions: list(input.open_questions) };
    return 'Entregue para aprovação.';
  }
}
