// Rascunho do Diretor: uma cópia do projeto com histórico próprio. O Diretor monta, mede e
// corrige aqui; a timeline real só muda quando a pessoa aprova (um passo de undo).

import type { Asset, Project } from '../../core/types';
import { Cmd } from '../../engine/commands/commands';
import { EditorStore } from '../../engine/timeline/EditorStore';
import type { EditorPort } from '../history/operations';

export class Draft {
  readonly store: EditorStore;
  readonly port: EditorPort;
  /** Revisão da timeline real quando o Diretor começou (para avisar de edições no meio). */
  readonly baseRevision: number;

  constructor(live: Project, baseRevision = 0) {
    this.store = new EditorStore(structuredClone(live));
    this.baseRevision = baseRevision;
    const s = this.store;
    this.port = {
      getProject: () => s.getState().project,
      execute: (c) => s.execute(c) !== null,
      undoLabel: () => s.undoLabel,
      undo: () => s.undo(),
      setMeta: (k, v) => s.setMeta(k, v),
    };
  }

  get project(): Project {
    return this.store.getState().project;
  }

  /** Mídias que entraram no projeto real durante o trabalho (ex.: imagens de acervo). */
  addAssets(assets: Asset[]) {
    const missing = assets.filter((a) => !this.project.assets[a.id]);
    if (missing.length) this.store.execute(Cmd.importAssets(missing));
  }

  /** Quantos passos o Diretor fez no rascunho. */
  get steps(): number {
    return this.store.history.length;
  }
}
