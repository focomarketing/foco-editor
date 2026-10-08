// App instalado (Electron): o preload expõe `window.focoDesktop`. Com ele, todo arquivo
// escolhido ou arrastado traz o caminho real no PC — a mídia é relida do disco ao reabrir,
// sem pedir permissão de novo. No navegador comum, `desktop` é null.

export interface FocoDesktop {
  isDesktop: true;
  version: string;
  /** Caminho no PC de um File escolhido/arrastado ("" se não houver). */
  pathForFile(file: File): string;
  /** Abre uma pasta no Explorer (Projetos, Mídia). */
  openFolder?(which: 'projects' | 'media'): void;
}

export const desktop: FocoDesktop | null = (globalThis as { focoDesktop?: FocoDesktop }).focoDesktop ?? null;

/** File + caminho no PC (quando o app sabe). */
export function withPath(file: File): { file: File; path?: string } {
  const p = desktop?.pathForFile(file);
  return p ? { file, path: p } : { file };
}
