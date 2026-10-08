// App instalado (Electron): o preload expõe `window.focoDesktop`. Com ele, todo arquivo
// escolhido ou arrastado traz o caminho real no PC — a mídia é relida do disco ao reabrir,
// sem pedir permissão de novo. No navegador comum, `desktop` é null.

export interface UpdateInfo {
  version: string;
}

export interface FocoDesktop {
  isDesktop: true;
  /** Versão do Electron. */
  version: string;
  /** Versão do app instalado (ex.: 1.0.6). */
  appVersion?: string;
  /** Caminho no PC de um File escolhido/arrastado ("" se não houver). */
  pathForFile(file: File): string;
  /** Abre uma pasta no Explorer (Projetos, Mídia). */
  openFolder?(which: 'projects' | 'media'): void;
  // atualização automática (GitHub Releases)
  checkForUpdates?(): void;
  applyUpdate?(): void;
  openReleases?(): void;
  onUpdateChecking?(cb: () => void): void;
  onUpdateAvailable?(cb: (info: UpdateInfo) => void): void;
  onUpdateNone?(cb: (info: { version: string; dev?: boolean }) => void): void;
  onUpdateProgress?(cb: (p: { percent: number }) => void): void;
  onUpdateReady?(cb: (info: UpdateInfo) => void): void;
  onUpdateError?(cb: (e: { message: string }) => void): void;
}

export const desktop: FocoDesktop | null = (globalThis as { focoDesktop?: FocoDesktop }).focoDesktop ?? null;

/** File + caminho no PC (quando o app sabe). */
export function withPath(file: File): { file: File; path?: string } {
  const p = desktop?.pathForFile(file);
  return p ? { file, path: p } : { file };
}

// --- estado da atualização (para a tela) ---------------------------------------------------------

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; dev?: boolean }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number; version?: string }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string };

let status: UpdateStatus = { kind: 'idle' };
let available: string | undefined;
const listeners = new Set<() => void>();
const set = (s: UpdateStatus) => {
  status = s;
  for (const l of listeners) l();
};

export const updateStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => status,
};

if (desktop) {
  desktop.onUpdateChecking?.(() => set({ kind: 'checking' }));
  desktop.onUpdateNone?.((i) => set({ kind: 'none', dev: i?.dev }));
  desktop.onUpdateAvailable?.((i) => {
    available = i.version;
    set({ kind: 'available', version: i.version });
  });
  desktop.onUpdateProgress?.((p) => set({ kind: 'downloading', percent: p.percent, version: available }));
  desktop.onUpdateReady?.((i) => set({ kind: 'ready', version: i.version }));
  desktop.onUpdateError?.((e) => set({ kind: 'error', message: e.message }));
}
