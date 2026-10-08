// IndexedDB mínimo: autosave, handles de arquivos de mídia, cache de waveform e recentes.

const DB_NAME = 'foco-editor';
const DB_VERSION = 5;
export type StoreName = 'kv' | 'mediaHandles' | 'waveforms' | 'recents' | 'transcripts' | 'thumbs' | 'cacheIndex' | 'backups' | 'projects';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['kv', 'mediaHandles', 'waveforms', 'recents', 'transcripts', 'thumbs', 'cacheIndex', 'backups', 'projects']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const idb = {
  get: <T>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', (s) => s.get(key)),
  set: (store: StoreName, key: string, value: unknown) => run<IDBValidKey>(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: StoreName, key: string) => run<undefined>(store, 'readwrite', (s) => s.delete(key)),
  all: <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll()),
};

/** Falhas de cache/autosave nunca devem quebrar a edição. */
export async function safe<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    console.warn('[storage]', e);
    return undefined;
  }
}
