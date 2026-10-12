// "Meus estilos" de legenda: estilos salvos pela pessoa, reusados em qualquer projeto
// (por navegador/app, como as preferências). Entram no banco de estilos (getPreset).

import type { CaptionStyle } from '../core/types';
import { newId } from '../core/time';
import { getPreset, setUserCaptionPresets } from '../engine/captions/captions';
import type { CaptionPreset } from '../engine/captions/captions';

const KEY = 'foco.captionStyles';

function load(): CaptionPreset[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as CaptionPreset[];
    return Array.isArray(list) ? list.filter((p) => p?.id && p.style) : [];
  } catch {
    return [];
  }
}

let list = load();
setUserCaptionPresets(list);
const listeners = new Set<() => void>();

function commit(next: CaptionPreset[]) {
  list = next;
  setUserCaptionPresets(list);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ok: fica só nesta sessão */
  }
  for (const l of listeners) l();
}

export const captionStylesStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => list,
  /** Salva o estilo com um nome; a quebra em blocos vem do estilo de origem. Devolve o id. */
  save(name: string, style: CaptionStyle): string {
    const from = getPreset(style.preset);
    const id = `user-${newId('s')}`;
    const p: CaptionPreset = { id, label: name.trim() || 'Meu estilo', category: 'Meus estilos', user: true, maxChars: from.maxChars, maxWords: from.maxWords, style: { ...style, preset: id } };
    commit([...list, p]);
    return id;
  },
  remove(id: string) {
    commit(list.filter((p) => p.id !== id));
  },
};
