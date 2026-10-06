// Estado central do editor fora do React (lido via useSyncExternalStore) + HISTORY ENGINE.
// Toda alteração do projeto é um EditCommand executado por `execute` (um passo de undo)
// ou por um gesto (begin → preview → end: arrastar um clipe gera um único comando).
// O histórico guarda o comando e o patch reversível; undo/redo aplicam o patch.

import type { Clip, Project } from '../../core/types';
import { createProject } from './operations';
import type { EditCommand, CommandJSON } from '../commands/commands';
import { toJSON } from '../commands/commands';
import { applyPatch, diffProjects, isEmptyPatch } from '../commands/patch';
import type { ProjectPatch } from '../commands/patch';

const HISTORY_LIMIT = 500;

export interface EditorState {
  project: Project;
  selection: string[];
  /** Pixels por segundo. */
  zoom: number;
  snapping: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Alterado desde o último salvamento em arquivo. */
  dirty: boolean;
  /** Incrementa a cada alteração do projeto (usado pelo autosave). */
  revision: number;
}

export interface HistoryEntry {
  command: CommandJSON;
  patch: ProjectPatch;
  selectionBefore: string[];
  selectionAfter: string[];
  at: number;
}

type Listener = () => void;

export class EditorStore {
  private state: EditorState;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private gesture: { base: Project; selection: string[]; last: EditCommand | null } | null = null;
  private listeners = new Set<Listener>();
  private clipboard: Clip[] = [];

  constructor(project: Project = createProject()) {
    this.state = {
      project,
      selection: [],
      zoom: 40,
      snapping: true,
      canUndo: false,
      canRedo: false,
      dirty: false,
      revision: 0,
    };
  }

  // --- assinatura -----------------------------------------------------------

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = () => this.state;

  private set(patch: Partial<EditorState>) {
    this.state = {
      ...this.state,
      ...patch,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
    for (const l of this.listeners) l();
  }

  // --- comandos -------------------------------------------------------------

  /**
   * Executa um comando como um passo de histórico. Devolve o patch (ou null se nada mudou).
   * `selection` pode ser uma lista ou uma função do patch (ex.: selecionar o que foi criado).
   */
  execute(command: EditCommand, selection?: string[] | ((patch: ProjectPatch) => string[])): ProjectPatch | null {
    if (this.gesture) this.endGesture();
    const before = this.state.project;
    const after = command.execute(before);
    const patch = diffProjects(before, after);
    if (isEmptyPatch(patch)) return null;
    const sel = typeof selection === 'function' ? selection(patch) : (selection ?? this.pruneSelection(after, this.state.selection));
    this.record(command, patch, this.state.selection, sel);
    this.commit(after, sel);
    return patch;
  }

  /** Início de um gesto contínuo (arrastar clipe, slider…). */
  beginGesture() {
    if (this.gesture) return;
    this.gesture = { base: this.state.project, selection: this.state.selection, last: null };
  }

  /** Mostra o resultado do comando a partir do estado do início do gesto (não acumula erro). */
  preview(command: EditCommand) {
    if (!this.gesture) this.beginGesture();
    const g = this.gesture!;
    g.last = command;
    const next = command.execute(g.base);
    this.set({ project: next, selection: this.pruneSelection(next, this.state.selection) });
  }

  /** Fecha o gesto registrando o último comando mostrado como um único passo. */
  endGesture() {
    const g = this.gesture;
    this.gesture = null;
    if (!g || !g.last || g.base === this.state.project) return;
    const patch = diffProjects(g.base, this.state.project);
    if (isEmptyPatch(patch)) return;
    this.record(g.last, patch, g.selection, this.state.selection);
    this.commit(this.state.project, this.state.selection);
  }

  cancelGesture() {
    const g = this.gesture;
    this.gesture = null;
    if (g) this.set({ project: g.base, selection: g.selection });
  }

  get inGesture() {
    return this.gesture !== null;
  }

  private record(command: EditCommand, patch: ProjectPatch, selectionBefore: string[], selectionAfter: string[]) {
    this.undoStack.push({ command: toJSON(command), patch, selectionBefore, selectionAfter, at: Date.now() });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private commit(project: Project, selection: string[]) {
    this.set({
      project: { ...project, updatedAt: Date.now() },
      selection,
      dirty: true,
      revision: this.state.revision + 1,
    });
  }

  private pruneSelection(p: Project, sel: string[]) {
    const kept = sel.filter((id) => p.clips[id]);
    return kept.length === sel.length ? sel : kept;
  }

  undo() {
    if (this.gesture) this.cancelGesture();
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(entry);
    this.commit(applyPatch(this.state.project, entry.patch, 'backward'), entry.selectionBefore);
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(entry);
    this.commit(applyPatch(this.state.project, entry.patch, 'forward'), entry.selectionAfter);
  }

  get undoLabel() {
    return this.undoStack.at(-1)?.command.label;
  }

  get redoLabel() {
    return this.redoStack.at(-1)?.command.label;
  }

  /** Histórico de comandos (mais antigo primeiro). */
  get history(): readonly HistoryEntry[] {
    return this.undoStack;
  }

  /** Troca o projeto inteiro (novo/abrir). Zera o histórico. */
  load(project: Project, opts: { dirty?: boolean } = {}) {
    this.undoStack = [];
    this.redoStack = [];
    this.gesture = null;
    this.set({ project, selection: [], dirty: opts.dirty ?? false, revision: this.state.revision + 1 });
  }

  markSaved() {
    this.set({ dirty: false });
  }

  // --- estado de UI (não entra no histórico) --------------------------------

  select(ids: string[]) {
    this.set({ selection: ids });
  }

  setZoom(zoom: number) {
    this.set({ zoom: Math.min(800, Math.max(0.02, zoom)) });
  }

  setSnapping(snapping: boolean) {
    this.set({ snapping });
  }

  copy(ids: string[]) {
    this.clipboard = ids.map((id) => this.state.project.clips[id]).filter(Boolean);
  }

  get clipboardContents() {
    return this.clipboard;
  }
}
