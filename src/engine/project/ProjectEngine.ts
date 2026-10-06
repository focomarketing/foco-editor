// Project Engine: arquivo de projeto (.foco = JSON), autosave e projetos recentes.
// O projeto guarda metadados das mídias; os arquivos em si ficam no disco do usuário
// e são religados pelo MediaEngine (handles no IndexedDB ou relink manual).

import type { Project, Transcript } from '../../core/types';
import { migrateProject } from '../../core/migrate';
import { idb, safe } from '../platform/idb';
import { PROJECT_TYPES, fsAccessSupported, downloadBlob, pickFiles, pickSaveFile, pickWithInput, requestWritePermission, writeTextFile } from '../platform/fs';

const AUTOSAVE_KEY = 'autosave';

export interface RecentProject {
  id: string;
  name: string;
  fileName: string;
  savedAt: number;
  handle: FileSystemFileHandle;
}

export interface AutosaveRecord {
  project: Project;
  savedAt: number;
  handle?: FileSystemFileHandle;
  /** Havia alterações ainda não salvas no arquivo do projeto. */
  dirty?: boolean;
}

export interface BackupRecord {
  id: string;
  projectId: string;
  projectName: string;
  savedAt: number;
  reason: 'manual' | 'auto' | 'before-restore';
  clipCount: number;
  project: Project;
}

const MAX_BACKUPS_PER_PROJECT = 30;

export interface LoadedProject {
  project: Project;
  transcripts: Transcript[];
}

/** Transcrições vão junto no arquivo (são "decisões de IA" do projeto). */
export function serialize(p: Project, transcripts: Transcript[] = []): string {
  const used = transcripts.filter((t) => p.assets[t.assetId]);
  return JSON.stringify({ format: 'foco-editor-project', ...p, transcripts: used });
}

export function deserialize(text: string): LoadedProject {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é um projeto válido (JSON inválido).');
  }
  const d = data as Partial<Project> & { format?: string };
  if (d.format !== 'foco-editor-project') throw new Error('O arquivo não é um projeto do FOCO Editor.');
  if (!d.settings || !d.tracks || !d.clips || !d.assets) throw new Error('Projeto incompleto ou corrompido.');
  const { format: _format, transcripts, ...project } = d as typeof d & { transcripts?: Transcript[] };
  void _format;
  return { project: migrateProject(project as Record<string, unknown>), transcripts: Array.isArray(transcripts) ? transcripts : [] };
}

export class ProjectFile {
  /** Arquivo .foco atual (null = nunca salvo). */
  handle: FileSystemFileHandle | null = null;

  get fileName() {
    return this.handle?.name ?? null;
  }

  /** Salva no arquivo atual; sem arquivo, cai em "Salvar como". Devolve false se o usuário cancelou. */
  async save(p: Project, transcripts: Transcript[] = []): Promise<boolean> {
    if (!this.handle) return this.saveAs(p, transcripts);
    if (!(await requestWritePermission(this.handle))) return false;
    await writeTextFile(this.handle, serialize(p, transcripts));
    await this.remember(p);
    return true;
  }

  async saveAs(p: Project, transcripts: Transcript[] = []): Promise<boolean> {
    if (!fsAccessSupported) {
      downloadBlob(new Blob([serialize(p, transcripts)], { type: 'application/json' }), `${p.name}.foco`);
      return true;
    }
    const handle = await pickSaveFile(`${p.name}.foco`, PROJECT_TYPES, 'foco-project');
    await writeTextFile(handle, serialize(p, transcripts));
    this.handle = handle;
    await this.remember(p);
    return true;
  }

  async open(): Promise<LoadedProject | null> {
    if (!fsAccessSupported) {
      const [file] = await pickWithInput('.foco,application/json', false);
      if (!file) return null;
      this.handle = null;
      return deserialize(await file.text());
    }
    const [handle] = await pickFiles(PROJECT_TYPES, false, 'foco-project');
    return this.openHandle(handle);
  }

  async openHandle(handle: FileSystemFileHandle): Promise<LoadedProject> {
    const ph = handle as FileSystemFileHandle & { requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState> };
    if (ph.requestPermission && (await ph.requestPermission({ mode: 'read' })) !== 'granted') {
      throw new Error('Permissão de leitura negada.');
    }
    const loaded = deserialize(await (await handle.getFile()).text());
    this.handle = handle;
    await this.remember(loaded.project);
    return loaded;
  }

  private async remember(p: Project) {
    if (!this.handle) return;
    const rec: RecentProject = { id: p.id, name: p.name, fileName: this.handle.name, savedAt: Date.now(), handle: this.handle };
    await safe(idb.set('recents', p.id, rec));
  }

  // --- autosave -------------------------------------------------------------

  async autosave(p: Project, dirty = false) {
    const rec: AutosaveRecord = { project: p, savedAt: Date.now(), handle: this.handle ?? undefined, dirty };
    await safe(idb.set('kv', AUTOSAVE_KEY, rec));
  }

  async discardAutosave() {
    await safe(idb.del('kv', AUTOSAVE_KEY));
  }

  // --- backups / histórico de versões --------------------------------------------

  async backup(p: Project, reason: BackupRecord['reason']) {
    const rec: BackupRecord = {
      id: `${p.id}|${Date.now()}`,
      projectId: p.id,
      projectName: p.name,
      savedAt: Date.now(),
      reason,
      clipCount: Object.keys(p.clips).length,
      project: p,
    };
    await safe(idb.set('backups', rec.id, rec));
    const mine = (await this.backups(p.id)).slice(MAX_BACKUPS_PER_PROJECT);
    for (const old of mine) await safe(idb.del('backups', old.id));
  }

  /** Versões salvas do projeto (mais nova primeiro). */
  async backups(projectId: string): Promise<BackupRecord[]> {
    const all = (await safe(idb.all<BackupRecord>('backups'))) ?? [];
    return all.filter((b) => b.projectId === projectId).sort((a, b) => b.savedAt - a.savedAt);
  }

  async restoreBackup(id: string): Promise<Project | null> {
    const b = await safe(idb.get<BackupRecord>('backups', id));
    return b ? migrateProject(b.project as unknown as Record<string, unknown>) : null;
  }

  async loadAutosave(): Promise<AutosaveRecord | undefined> {
    const rec = await safe(idb.get<AutosaveRecord>('kv', AUTOSAVE_KEY));
    if (rec?.handle) this.handle = rec.handle;
    if (rec?.project) rec.project = migrateProject(rec.project as unknown as Record<string, unknown>);
    return rec;
  }

  async recents(): Promise<RecentProject[]> {
    const all = (await safe(idb.all<RecentProject>('recents'))) ?? [];
    return all.sort((a, b) => b.savedAt - a.savedAt).slice(0, 10);
  }

  async forgetRecent(id: string) {
    await safe(idb.del('recents', id));
  }
}
