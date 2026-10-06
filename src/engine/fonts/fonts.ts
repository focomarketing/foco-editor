// Font Engine (fundação): fontes do sistema + fontes importadas pelo usuário.
// A biblioteca própria da plataforma (source: 'library') entra numa fase futura
// sem mudar este modelo.

import type { FontInfo, Project } from '../../core/types';

const SYSTEM_FAMILIES = [
  'Segoe UI', 'Segoe UI Black', 'Arial', 'Arial Black', 'Impact', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Georgia', 'Times New Roman', 'Palatino Linotype', 'Courier New', 'Consolas', 'Comic Sans MS',
];

/** Fontes do sistema realmente instaladas (checadas pelo navegador). */
export function systemFonts(): FontInfo[] {
  const has = (f: string) => {
    try {
      return document.fonts.check(`16px "${f}"`);
    } catch {
      return true;
    }
  };
  return SYSTEM_FAMILIES.filter(has).map((family) => ({ id: `sys:${family}`, family, style: 'normal', weight: 400, source: 'system' as const }));
}

export function importedFonts(p: Project): FontInfo[] {
  return Object.values(p.assets)
    .filter((a) => a.kind === 'font' && a.fontFamily)
    .map((a) => ({ id: `asset:${a.id}`, family: a.fontFamily!, style: 'normal', weight: 400, source: 'imported' as const, assetId: a.id }));
}

export function availableFonts(p: Project): FontInfo[] {
  return [...importedFonts(p), ...systemFonts()];
}

/** Valor de CSS font-family com fallback. */
export const fontStack = (family: string) => `"${family}", "Segoe UI", Arial, sans-serif`;

/** Família principal de um font-family CSS ("Arial Black", Impact → Arial Black). */
export const primaryFamily = (stack: string) => stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
