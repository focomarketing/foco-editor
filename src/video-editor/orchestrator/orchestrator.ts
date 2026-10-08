// video-editor-orchestrator: recebe a etapa, carrega preset e modo do projeto, roda as skills
// habilitadas, junta as sugestões numa EditOperation (preview), aplica as de confiança alta
// quando a etapa é automática, registra logs e regenera uma etapa sem tocar no que é manual.

import type { Project } from '../../core/types';
import { readWorkflow } from '../../core/workflow';
import type { PhaseId, Workflow } from '../../core/workflow';
import type { AISettings } from '../../engine/ai/providers';
import type { TlWord } from '../../engine/cut/smartCut';
import type { EditCommand, EditOperation } from '../commands/types';
import type { EditMode } from '../presets';
import { applyOperation, createOperation, readOperations, revertOperation } from '../history/operations';
import type { EditorPort } from '../history/operations';

export interface SkillContext {
  project: () => Project;
  workflow: Workflow | null;
  mode: EditMode;
  /** Fala da timeline (palavras com tempo); vazio se não há transcrição. */
  words: () => TlWord[];
  ai: AISettings;
  signal: AbortSignal;
  progress(step: string, done?: number, total?: number): void;
  log(msg: string): void;
  /** Sugestões já feitas por skills anteriores desta etapa (para não disputar o mesmo trecho). */
  planned: EditCommand[];
  /** Serviços do app que a skill pode usar (transcrever, importar mídia, níveis do áudio...). */
  services: SkillServices;
}

export interface SkillServices {
  ensureTranscripts(progress: (step: string, done?: number, total?: number) => void): Promise<void>;
  importFiles(files: File[]): Promise<Map<string, { id: string; width: number; height: number; duration: number }>>;
  levels(assetId: string): Promise<Float32Array | null>;
  /** Quadros JPEG (base64) de uma mídia nos tempos pedidos (para a IA enxergar o take). */
  frames?(assetId: string, times: number[]): Promise<string[]>;
  /** Pixels RGBA de um quadro (largura pedida): análise de movimento e cor das transições. */
  pixels?(assetId: string, time: number, width: number): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null>;
}

export interface SkillOutput {
  commands: EditCommand[];
  notes?: string[];
  warnings?: string[];
}

export interface Skill {
  id: string;
  stage: PhaseId;
  label: string;
  /** Modos em que a skill roda. */
  modes: EditMode[];
  /** Habilitada mesmo que o preset não a liste (ex.: transcrição). */
  core?: boolean;
  /** Roda só se esta condição for verdadeira (ex.: há takes de apoio). */
  when?: (ctx: SkillContext) => boolean;
  run(ctx: SkillContext): Promise<SkillOutput>;
}

const registry: Skill[] = [];
export function registerSkill(s: Skill) {
  const i = registry.findIndex((x) => x.id === s.id);
  if (i >= 0) registry[i] = s;
  else registry.push(s);
}
export const skillsFor = (stage: PhaseId) => registry.filter((s) => s.stage === stage);

/** Skills que rodam nesta etapa para este projeto (preset + modo + condição). */
export function plannedSkills(stage: PhaseId, ctx: SkillContext): Skill[] {
  const enabled = new Set(ctx.workflow?.enabledSkills ?? []);
  return skillsFor(stage).filter((s) => s.modes.includes(ctx.mode) && (s.core || enabled.has(s.id)) && (!s.when || s.when(ctx)));
}

export interface RunOptions {
  /** Aplicar sozinho o que tem confiança alta (etapa automática). */
  autoApply: boolean;
  /** Antes de rodar, desfaz as operações anteriores desta etapa (só itens da IA não editados). */
  regenerate?: boolean;
}

export interface StageResult {
  op: EditOperation | null;
  skills: string[];
  messages: string[];
}

export async function runStage(port: EditorPort, stage: PhaseId, deps: Omit<SkillContext, 'project' | 'workflow' | 'mode' | 'log' | 'planned'> & { log?: (m: string) => void }, opts: RunOptions): Promise<StageResult> {
  const messages: string[] = [];
  const log = (m: string) => {
    messages.push(m);
    deps.log?.(m);
    appendLog(port, `[${stage}] ${m}`);
  };
  if (opts.regenerate) {
    for (const op of readOperations(port.getProject()).filter((o) => o.stage === stage && o.status === 'applied')) {
      const r = revertOperation(port, op.id);
      log(r.ok ? `regenerar: ${r.message}` : `regenerar: ${r.message}`);
      if (!r.ok) return { op: null, skills: [], messages };
    }
  }
  const wf = readWorkflow(port.getProject().metadata);
  const commands: EditCommand[] = [];
  const ctx: SkillContext = { ...deps, project: port.getProject, workflow: wf, mode: wf?.mode ?? 'manual-assisted', log, planned: commands };
  const skills = plannedSkills(stage, ctx);
  if (!skills.length) {
    log('nenhuma skill habilitada para esta etapa neste projeto');
    return { op: null, skills: [], messages };
  }
  const notes: string[] = [];
  const warnings: string[] = [];
  for (const s of skills) {
    deps.signal.throwIfAborted();
    log(`skill ${s.id}`);
    const out = await s.run(ctx);
    commands.push(...out.commands);
    notes.push(...(out.notes ?? []));
    warnings.push(...(out.warnings ?? []));
  }
  if (!commands.length) {
    notes.forEach(log);
    warnings.forEach(log);
    return { op: null, skills: skills.map((s) => s.id), messages: [...notes, ...warnings] };
  }
  let op = createOperation(port, { stage, skill: skills.filter((s) => !s.core).map((s) => s.id).join(' + ') || skills[0].id, commands, notes, warnings });
  if (opts.autoApply && op.selected?.length) {
    const r = applyOperation(port, op.id, 'selected');
    op = r.op ?? op;
    log(`aplicado: ${op.selected?.length ?? 0} de ${commands.length} sugestões${r.rejected.length ? ` (${r.rejected.length} recusadas na validação)` : ''}`);
  }
  return { op, skills: skills.map((s) => s.id), messages: [...notes, ...warnings] };
}

function appendLog(port: EditorPort, line: string) {
  const p = port.getProject();
  const prev = Array.isArray(p.metadata?.aiLog) ? (p.metadata.aiLog as string[]) : [];
  port.setMeta('aiLog', [...prev, `${new Date().toISOString()} ${line}`].slice(-200));
}
