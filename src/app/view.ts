// Qual tela está aberta: Projetos (início), Novo projeto ou o projeto em edição.
// Módulo sem dependências, para o editor e as telas poderem usar sem import circular.

export type View = 'home' | 'new' | 'project';

let view: View = 'home';
const listeners = new Set<() => void>();

export const viewStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => view,
  set(v: View) {
    if (v === view) return;
    view = v;
    for (const l of listeners) l();
  },
};
