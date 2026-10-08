// Histórico de operações da IA: criar (preview), escolher itens, aplicar (um passo de undo),
// rejeitar e desfazer. Fica em project.metadata.operations (vai no .foco; fora do undo).

import type { Project } from '../../core/types';
import { newId } from '../../core/time';
import { Cmd } from '../../engine/commands/commands';
import type { EditCommand, EditOperation } from '../commands/types';
import { MIN_AUTO_CONFIDENCE } from '../commands/types';
import { removableClips, toEditorCommands } from '../commands/apply';

/** Porta mínima para o editor (permite testar sem a interface). */
export interface EditorPort {
  getProject(): Project;
  execute(command: ReturnType<typeof Cmd.batch>): boolean;
  undoLabel(): string | undefined;
  undo(): void;
  setMeta(key: string, value: unknown): void;
}

export const readOperations = (p: Project): EditOperation[] => (Array.isArray(p.metadata?.operations) ? (p.metadata.operations as EditOperation[]) : []);

function save(port: EditorPort, ops: EditOperation[]) {
  // mantém as 60 mais recentes (o projeto não cresce sem limite)
  port.setMeta('operations', ops.slice(-60));
}

function update(port: EditorPort, id: string, patch: Partial<EditOperation>): EditOperation | null {
  const ops = readOperations(port.getProject());
  const i = ops.findIndex((o) => o.id === id);
  if (i < 0) return null;
  const next = { ...ops[i], ...patch };
  save(port, [...ops.slice(0, i), next, ...ops.slice(i + 1)]);
  return next;
}

export function createOperation(port: EditorPort, init: { stage?: string; skill?: string; commands: EditCommand[]; notes?: string[]; warnings?: string[] }): EditOperation {
  const p = port.getProject();
  const op: EditOperation = {
    id: newId('op'),
    projectId: p.id,
    commands: init.commands,
    status: 'preview',
    createdBy: 'ai',
    skill: init.skill,
    stage: init.stage,
    createdAt: new Date().toISOString(),
    // baixa confiança nunca vem marcada
    selected: init.commands.filter((c) => (c.confidence ?? 1) >= MIN_AUTO_CONFIDENCE).map((c) => c.id),
    notes: init.notes ?? [],
    warnings: init.warnings ?? [],
  };
  save(port, [...readOperations(p), op]);
  return op;
}

export function setSelected(port: EditorPort, opId: string, ids: string[]) {
  return update(port, opId, { selected: ids });
}

/** O projeto como ficaria com os itens selecionados (para o preview), sem tocar no histórico. */
export function previewProject(p: Project, op: EditOperation): { project: Project; rejected: { id: string; reason: string }[] } {
  const chosen = op.commands.filter((c) => op.selected?.includes(c.id));
  const conv = toEditorCommands(p, chosen, op.id);
  let next = p;
  for (const c of conv.commands) next = c.execute(next);
  return { project: next, rejected: conv.rejected };
}

/** Aplica os itens selecionados (ou todos) como um passo de undo. */
export function applyOperation(port: EditorPort, opId: string, which: 'selected' | 'all' = 'selected'): { op: EditOperation | null; rejected: { id: string; reason: string }[] } {
  const op = readOperations(port.getProject()).find((o) => o.id === opId);
  if (!op || op.status !== 'preview') return { op: op ?? null, rejected: [] };
  const chosen = which === 'all' ? op.commands : op.commands.filter((c) => op.selected?.includes(c.id));
  if (!chosen.length) return { op, rejected: [] };
  const conv = toEditorCommands(port.getProject(), chosen, op.id);
  const label = `IA · ${op.skill ?? op.stage ?? 'edição'} (${chosen.length - conv.rejected.length})`;
  if (conv.commands.length) port.execute(Cmd.batch(label, conv.commands, 'AI_OPERATION'));
  const warnings = [...(op.warnings ?? []), ...conv.rejected.map((r) => `não aplicado: ${r.reason}`)];
  const next = update(port, opId, { status: 'applied', createdClipIds: conv.createdClipIds, undoLabel: conv.commands.length ? label : undefined, selected: chosen.map((c) => c.id), warnings });
  return { op: next, rejected: conv.rejected };
}

export function rejectOperation(port: EditorPort, opId: string) {
  return update(port, opId, { status: 'rejected' });
}

export interface RevertResult {
  ok: boolean;
  /** Clipes da IA que foram editados à mão e, sem confirmação, ficaram. */
  keptEdited: number;
  message: string;
}

/**
 * Desfaz uma operação aplicada. Se ainda é o último passo, usa o undo do editor (exato).
 * Senão, remove só os clipes que ela criou e que ninguém mexeu; os editados à mão só saem
 * com confirmação explícita (includeEdited). Cortes (ripple) só voltam pelo undo.
 */
export function revertOperation(port: EditorPort, opId: string, opts: { includeEdited?: boolean } = {}): RevertResult {
  const op = readOperations(port.getProject()).find((o) => o.id === opId);
  if (!op || op.status !== 'applied') return { ok: false, keptEdited: 0, message: 'Esta operação não está aplicada.' };
  if (op.undoLabel && port.undoLabel() === op.undoLabel) {
    port.undo();
    update(port, opId, { status: 'reverted' });
    return { ok: true, keptEdited: 0, message: 'Desfeito.' };
  }
  // Só adições podem ser desfeitas "tirando o que a IA criou"; cortes, aparos e movimentos só voltam pelo undo.
  const ADDS = new Set(['add_clip', 'add_overlay', 'add_music', 'add_sound_effect', 'add_caption']);
  const destructive = op.commands.some((c) => !ADDS.has(c.type) && op.selected?.includes(c.id));
  if (destructive) return { ok: false, keptEdited: 0, message: 'Esta operação cortou ou alterou clipes e já houve edições depois: use Ctrl+Z ou o histórico de versões.' };
  const { untouched, edited } = removableClips(port.getProject(), op.id);
  const remove = opts.includeEdited ? [...untouched, ...edited] : untouched;
  if (remove.length) port.execute(Cmd.batch(`Desfazer IA · ${op.skill ?? op.stage ?? ''}`, [Cmd.deleteClips(remove.map((c) => c.id))], 'AI_REVERT'));
  update(port, opId, { status: 'reverted' });
  const kept = opts.includeEdited ? 0 : edited.length;
  return { ok: true, keptEdited: kept, message: kept ? `Desfeito. ${kept} item(ns) que você editou foram mantidos.` : 'Desfeito.' };
}
