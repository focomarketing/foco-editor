// CACHE ENGINE: arquivos temporários regeneráveis (thumbnails, filmstrips, waveforms,
// proxies, renders) gravados no OPFS (disco privado do navegador, fora da RAM) com um
// índice no IndexedDB. Cada entrada tem id, tipo, tamanho, datas, versão e dependências.
// Nunca guarda dados do projeto nem a mídia do usuário (separação de armazenamento).

import { idb, safe } from '../platform/idb';

export type CacheKind = 'thumbnail' | 'filmstrip' | 'preview-thumbs' | 'waveform' | 'proxy' | 'render';

/** Versão do formato de cada tipo: mudar o algoritmo = subir a versão (as antigas são ignoradas e limpas). */
export const CACHE_VERSION: Record<CacheKind, number> = {
  thumbnail: 1,
  filmstrip: 1,
  'preview-thumbs': 1,
  waveform: 3,
  proxy: 1,
  render: 1,
};

export const CACHE_LABEL: Record<CacheKind, string> = {
  thumbnail: 'Thumbnails',
  filmstrip: 'Filmstrips',
  'preview-thumbs': 'Thumbnails de scrubbing',
  waveform: 'Waveforms',
  proxy: 'Proxies',
  render: 'Renders',
};

export interface CacheEntry {
  id: string;
  kind: CacheKind;
  /** Parâmetros que identificam o conteúdo (ex.: hash do asset + resolução). */
  key: string;
  size: number;
  createdAt: number;
  lastUsed: number;
  version: number;
  deps: { assetHash?: string };
  /** Metadados livres (ex.: dimensões do filmstrip). */
  info?: Record<string, unknown>;
}

const MAX_KEY = 'foco.cache.maxBytes';
export const DEFAULT_MAX_BYTES = 10 * 1024 ** 3;

/** Nome seguro para arquivo a partir de qualquer chave (sem barras, sem "..", tamanho fixo). */
async function fileNameFor(kind: CacheKind, key: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}|${key}`));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class CacheEngine {
  private index: Map<string, CacheEntry> | null = null;
  private loading: Promise<Map<string, CacheEntry>> | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  /** Entradas que não podem ser removidas agora (ex.: proxy em uso no projeto aberto). */
  protect: () => Set<string> = () => new Set();

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  get maxBytes(): number {
    try {
      return Number(localStorage.getItem(MAX_KEY)) || DEFAULT_MAX_BYTES;
    } catch {
      return DEFAULT_MAX_BYTES;
    }
  }

  set maxBytes(v: number) {
    try {
      localStorage.setItem(MAX_KEY, String(v));
    } catch {
      /* ok */
    }
    void this.enforceLimit();
    this.emit();
  }

  private async dir(kind: CacheKind) {
    const root = await navigator.storage.getDirectory();
    const cache = await root.getDirectoryHandle('cache', { create: true });
    return cache.getDirectoryHandle(kind, { create: true });
  }

  private async load(): Promise<Map<string, CacheEntry>> {
    if (this.index) return this.index;
    this.loading ??= (async () => {
      const all = (await safe(idb.all<CacheEntry>('cacheIndex'))) ?? [];
      const map = new Map<string, CacheEntry>();
      for (const e of all) map.set(e.id, e);
      this.index = map;
      return map;
    })();
    return this.loading;
  }

  async entries(): Promise<CacheEntry[]> {
    return [...(await this.load()).values()];
  }

  private async find(kind: CacheKind, key: string): Promise<CacheEntry | null> {
    const id = await fileNameFor(kind, key);
    const e = (await this.load()).get(id);
    if (!e) return null;
    if (e.version !== CACHE_VERSION[kind]) {
      await this.remove(e.id);
      return null;
    }
    return e;
  }

  /** Arquivo do cache (lido do disco sob demanda) ou null. */
  async get(kind: CacheKind, key: string): Promise<{ file: File; entry: CacheEntry } | null> {
    const e = await this.find(kind, key);
    if (!e) return null;
    try {
      const fh = await (await this.dir(kind)).getFileHandle(e.id);
      const file = await fh.getFile();
      e.lastUsed = Date.now();
      void safe(idb.set('cacheIndex', e.id, e));
      return { file, entry: e };
    } catch {
      // Índice aponta para arquivo que sumiu: corrige o índice.
      await this.remove(e.id);
      return null;
    }
  }

  async has(kind: CacheKind, key: string) {
    return (await this.find(kind, key)) !== null;
  }

  /** Grava um blob pequeno/médio. */
  async put(kind: CacheKind, key: string, data: Blob, deps: CacheEntry['deps'], info?: CacheEntry['info']): Promise<CacheEntry> {
    const w = await this.openWritable(kind, key, deps, info);
    await w.writable.write(data);
    return w.commit();
  }

  /**
   * Abre um arquivo do cache para escrita em streaming (proxies de vários GB).
   * Só entra no índice depois de `commit`; `abort` apaga o parcial.
   */
  async openWritable(kind: CacheKind, key: string, deps: CacheEntry['deps'], info?: CacheEntry['info']) {
    const id = await fileNameFor(kind, key);
    const dir = await this.dir(kind);
    const fh = await dir.getFileHandle(id, { create: true });
    const writable = await fh.createWritable();
    let closed = false;
    return {
      writable,
      commit: async (): Promise<CacheEntry> => {
        if (!closed) await writable.close().catch(() => {});
        closed = true;
        const file = await fh.getFile();
        const now = Date.now();
        const entry: CacheEntry = { id, kind, key, size: file.size, createdAt: now, lastUsed: now, version: CACHE_VERSION[kind], deps, info };
        (await this.load()).set(id, entry);
        await safe(idb.set('cacheIndex', id, entry));
        this.emit();
        void this.enforceLimit();
        return entry;
      },
      abort: async () => {
        if (!closed) await writable.abort().catch(() => {});
        closed = true;
        await dir.removeEntry(id).catch(() => {});
      },
      /** Marca como fechado quando outro componente (ex.: StreamTarget) já fechou o stream. */
      markClosed: () => {
        closed = true;
      },
    };
  }

  async remove(id: string) {
    const map = await this.load();
    const e = map.get(id);
    map.delete(id);
    await safe(idb.del('cacheIndex', id));
    if (e) await (await this.dir(e.kind)).removeEntry(id).catch(() => {});
    this.emit();
  }

  /** Invalida tudo que depende de um asset (ex.: o arquivo mudou). */
  async invalidateAsset(assetHash: string, kinds?: CacheKind[]) {
    for (const e of await this.entries()) {
      if (e.deps.assetHash === assetHash && (!kinds || kinds.includes(e.kind))) await this.remove(e.id);
    }
  }

  /** Remove o que não pertence a nenhum asset informado (ex.: projetos abertos/recentes). */
  async clearUnused(keepAssetHashes: Set<string>): Promise<number> {
    let freed = 0;
    for (const e of await this.entries()) {
      if (e.deps.assetHash && keepAssetHashes.has(e.deps.assetHash)) continue;
      if (this.protect().has(e.id)) continue;
      freed += e.size;
      await this.remove(e.id);
    }
    return freed;
  }

  async clearAll(kinds?: CacheKind[]): Promise<number> {
    let freed = 0;
    const protectedIds = this.protect();
    for (const e of await this.entries()) {
      if (kinds && !kinds.includes(e.kind)) continue;
      if (protectedIds.has(e.id)) continue;
      freed += e.size;
      await this.remove(e.id);
    }
    return freed;
  }

  /** Respeita o tamanho máximo removendo o que foi usado há mais tempo (LRU). */
  async enforceLimit(): Promise<number> {
    const max = this.maxBytes;
    const all = (await this.entries()).sort((a, b) => a.lastUsed - b.lastUsed);
    let total = all.reduce((acc, e) => acc + e.size, 0);
    let freed = 0;
    const protectedIds = this.protect();
    for (const e of all) {
      if (total <= max) break;
      if (protectedIds.has(e.id)) continue;
      total -= e.size;
      freed += e.size;
      await this.remove(e.id);
    }
    return freed;
  }

  async usage(): Promise<{ total: number; byKind: Record<CacheKind, { count: number; bytes: number }> }> {
    const byKind = Object.fromEntries((Object.keys(CACHE_VERSION) as CacheKind[]).map((k) => [k, { count: 0, bytes: 0 }])) as Record<CacheKind, { count: number; bytes: number }>;
    let total = 0;
    for (const e of await this.entries()) {
      byKind[e.kind].count++;
      byKind[e.kind].bytes += e.size;
      total += e.size;
    }
    return { total, byKind };
  }

  idFor(kind: CacheKind, key: string) {
    return fileNameFor(kind, key);
  }
}

export const cache = new CacheEngine();

/** Espaço do navegador para este site (o navegador limita a uma fração do disco livre). */
export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean }> {
  const est = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
}

/** Pede ao navegador para não apagar o cache sob pressão de espaço. */
export async function requestPersistentStorage() {
  return (await navigator.storage.persist?.()) ?? false;
}
