// Arquivos do PC pelo servidor local do editor (desenvolvimento) ou pelo app instalado: mídia
// relida do disco pelo caminho, mídia sem vínculo gravada na pasta do FOCO e projetos .foco na
// pasta Projetos. Sem o servidor local (editor publicado na web), tudo devolve "indisponível".

import { idb } from './idb';

const LOCAL = '/__foco/local';
let localOk: Promise<boolean> | null = null;
const hasLocalFiles = () => (localOk ??= fetch(`${LOCAL}/ping`).then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('json')).catch(() => false));

/** Grava na pasta de mídia do FOCO no PC e devolve o caminho (null sem o servidor local). */
export async function saveToDisk(assetId: string, file: File): Promise<string | null> {
  if (!(await hasLocalFiles())) return null;
  const res = await fetch(`${LOCAL}/save?name=${encodeURIComponent(`${assetId}-${file.name}`)}`, { method: 'POST', body: file });
  if (!res.ok) return null;
  return ((await res.json()) as { path?: string }).path ?? null;
}

/** Relê do disco a mídia com caminho conhecido (com o nome e a data originais). */
export async function loadFromDisk(assetId: string): Promise<File | null> {
  const p = await idb.get<string>('kv', `mediaPath:${assetId}`);
  return p ? loadPath(p, assetId) : null;
}

/** Lê um arquivo do PC pelo servidor local (com o nome e a data originais). */
export async function loadPath(p: string, stripPrefix?: string): Promise<File | null> {
  if (!(await hasLocalFiles())) return null;
  const res = await fetch(`${LOCAL}/file?p=${encodeURIComponent(p)}`);
  if (!res.ok) return null;
  const blob = await res.blob();
  let name = p.split(/[\\/]/).pop() ?? 'midia';
  // mídia gravada pelo editor: "<assetId>-<nome original>"
  if (stripPrefix) name = name.replace(new RegExp(`^${stripPrefix}-`), '');
  return new File([blob], name, { type: blob.type, lastModified: Number(res.headers.get('X-Last-Modified-Ms')) || Date.now() });
}

/** O editor tem acesso aos arquivos do PC (servidor local do editor ou app instalado)? */
export const localFilesAvailable = () => hasLocalFiles();

/** Lista, lê, grava e arquiva projetos na pasta Projetos do PC. */
export const diskProjects = {
  async list(): Promise<{ id: string; name: string; file: string; mtimeMs: number }[]> {
    if (!(await hasLocalFiles())) return [];
    const res = await fetch(`${LOCAL}/projects`);
    return res.ok ? res.json() : [];
  },
  async read(id: string): Promise<string | null> {
    const res = await fetch(`${LOCAL}/projects/${encodeURIComponent(id)}`);
    return res.ok ? res.text() : null;
  },
  async write(id: string, name: string, text: string): Promise<boolean> {
    if (!(await hasLocalFiles())) return false;
    const res = await fetch(`${LOCAL}/projects/${encodeURIComponent(id)}?name=${encodeURIComponent(name)}`, { method: 'PUT', body: text, headers: { 'Content-Type': 'application/json' } });
    return res.ok;
  },
  async remove(id: string) {
    if (await hasLocalFiles()) await fetch(`${LOCAL}/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
