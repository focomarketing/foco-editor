// Project Engine: arquivo de projeto (.foco = JSON), autosave e projetos recentes.
// O projeto guarda metadados das mídias; os arquivos em si ficam no disco do usuário
// e são religados pelo MediaEngine (handles no IndexedDB ou relink manual).

import type { Project, Transcript } from '../../core/types';
import { migrateProject } from '../../core/migrate';
import { idb, safe } from '../platform/idb';
import { diskProjects } from '../platform/localFiles';
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

/** Projeto no catálogo "Projetos" (tela inicial): o projeto inteiro + resumo para a lista. */
export interface CatalogEntry {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Fluxo guiado (trilha, fase atual), se houver. */
  workflow: unknown;
  duration: number;
  clipCount: number;
  project: Project;
  transcripts: Transcript[];
}

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

/** Entrada do catálogo a partir de um projeto aberto de arquivo. */
function entryOf(p: Project, transcripts: Transcript[], updatedAt: number): CatalogEntry {
  const duration = Math.max(0, ...Object.values(p.clips).map((c) => c.start + c.duration));
  return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt, workflow: p.metadata?.workflow ?? null, duration, clipCount: Object.keys(p.clips).length, project: p, transcripts };
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

  // --- catálogo de projetos (tela inicial) -----------------------------------

  /** Guarda o projeto no catálogo. Projetos vazios (sem mídia) não entram. */
  async catalogSave(p: Project, transcripts: Transcript[], duration: number) {
    if (!Object.keys(p.assets).length) return;
    const assetIds = new Set(Object.keys(p.assets));
    const rec: CatalogEntry = {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: Date.now(),
      workflow: p.metadata?.workflow ?? null,
      duration,
      clipCount: Object.keys(p.clips).length,
      project: p,
      transcripts: transcripts.filter((t) => assetIds.has(t.assetId)),
    };
    await safe(idb.set('projects', p.id, rec));
    this.toDisk(p, rec.transcripts);
  }

  // Cópia de cada projeto em Documentos\FOCO Editor\Projetos (.foco): sobrevive a limpar o
  // navegador, a trocar de endereço e ao app instalado. Gravação agrupada (no máximo a cada 2 s).
  private diskTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private diskPending = new Map<string, { p: Project; transcripts: Transcript[] }>();
  private toDisk(p: Project, transcripts: Transcript[]) {
    this.diskPending.set(p.id, { p, transcripts });
    if (this.diskTimers.has(p.id)) return;
    this.diskTimers.set(
      p.id,
      setTimeout(() => {
        this.diskTimers.delete(p.id);
        const x = this.diskPending.get(p.id);
        this.diskPending.delete(p.id);
        if (x) void safe(diskProjects.write(x.p.id, x.p.name, serialize(x.p, x.transcripts)));
      }, 2000),
    );
  }

  /** Grava já o que estiver pendente (ao sair do projeto / fechar o app). */
  async flushDisk() {
    for (const [id, t] of this.diskTimers) {
      clearTimeout(t);
      this.diskTimers.delete(id);
      const x = this.diskPending.get(id);
      this.diskPending.delete(id);
      if (x) await safe(diskProjects.write(x.p.id, x.p.name, serialize(x.p, x.transcripts)));
    }
  }

  private synced: Promise<void> | null = null;
  /**
   * Junta o catálogo do navegador com a pasta Projetos do PC (uma vez por sessão): o que só
   * está no disco (ou está mais novo lá) entra no catálogo; o que só está no navegador vai
   * para o disco.
   */
  syncWithDisk(): Promise<void> {
    this.synced ??= (async () => {
      const disk = await safe(diskProjects.list());
      if (!disk) return;
      const local = new Map(((await safe(idb.all<CatalogEntry>('projects'))) ?? []).map((e) => [e.id, e]));
      for (const d of disk) {
        const mine = local.get(d.id);
        if (mine && mine.updatedAt >= d.mtimeMs - 1000) continue;
        const text = await safe(diskProjects.read(d.id));
        if (!text) continue;
        try {
          const { project, transcripts } = deserialize(text);
          await safe(idb.set('projects', project.id, entryOf(project, transcripts, d.mtimeMs)));
        } catch (e) {
          console.warn('[projetos] arquivo inválido na pasta Projetos', d.file, e);
        }
      }
      const onDisk = new Set(disk.map((d) => d.id));
      for (const e of local.values()) if (!onDisk.has(e.id)) await safe(diskProjects.write(e.id, e.name, serialize(e.project, e.transcripts)));
    })();
    return this.synced;
  }

  async catalog(): Promise<CatalogEntry[]> {
    await this.syncWithDisk();
    const all = (await safe(idb.all<CatalogEntry>('projects'))) ?? [];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async catalogGet(id: string): Promise<CatalogEntry | undefined> {
    return safe(idb.get<CatalogEntry>('projects', id));
  }

  async catalogRemove(id: string) {
    await safe(idb.del('projects', id));
    // no disco o arquivo vai para Projetos\.lixeira (nada é apagado de vez)
    await safe(diskProjects.remove(id));
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
