// File System Access API (Chrome/Edge). É o que permite salvar o projeto num arquivo
// de verdade, exportar direto para o disco sem segurar o vídeo na RAM e reabrir
// mídias depois de recarregar a página. Em outros navegadores há fallback.

interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface PickerWindow {
  showOpenFilePicker?: (opts?: {
    multiple?: boolean;
    types?: FilePickerType[];
    excludeAcceptAllOption?: boolean;
    id?: string;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (opts?: { suggestedName?: string; types?: FilePickerType[]; id?: string }) => Promise<FileSystemFileHandle>;
}

type PermissionHandle = FileSystemFileHandle & {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

const w = (typeof window !== 'undefined' ? window : {}) as unknown as PickerWindow;

export const fsAccessSupported = typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function';

export const MEDIA_TYPES: FilePickerType[] = [
  {
    description: 'Vídeo, áudio, imagem, SVG e fontes',
    accept: {
      'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.mkv'],
      'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'],
      'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'],
      'font/*': ['.ttf', '.otf', '.woff', '.woff2'],
    },
  },
];

export const PROJECT_TYPES: FilePickerType[] = [
  { description: 'Projeto FOCO Editor', accept: { 'application/json': ['.foco'] } },
];

/** true quando o usuário fechou o seletor (não é erro). */
export function isAbort(e: unknown) {
  return e instanceof DOMException && e.name === 'AbortError';
}

export async function pickFiles(types: FilePickerType[], multiple: boolean, id: string): Promise<FileSystemFileHandle[]> {
  return w.showOpenFilePicker!({ multiple, types, id });
}

export async function pickSaveFile(suggestedName: string, types: FilePickerType[], id: string): Promise<FileSystemFileHandle> {
  return w.showSaveFilePicker!({ suggestedName, types, id });
}

export async function hasReadPermission(h: FileSystemFileHandle): Promise<boolean> {
  const ph = h as PermissionHandle;
  if (!ph.queryPermission) return true;
  return (await ph.queryPermission({ mode: 'read' })) === 'granted';
}

/** Precisa ser chamado dentro de um clique do usuário. */
export async function requestReadPermission(h: FileSystemFileHandle): Promise<boolean> {
  const ph = h as PermissionHandle;
  if (!ph.requestPermission) return true;
  return (await ph.requestPermission({ mode: 'read' })) === 'granted';
}

export async function requestWritePermission(h: FileSystemFileHandle): Promise<boolean> {
  const ph = h as PermissionHandle;
  if (!ph.queryPermission || !ph.requestPermission) return true;
  if ((await ph.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await ph.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function writeTextFile(h: FileSystemFileHandle, text: string) {
  const writable = await h.createWritable();
  await writable.write(text);
  await writable.close();
}

/** Fallback para navegadores sem File System Access. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Fallback: seletor clássico via <input type=file>. */
export function pickWithInput(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
