// Diálogos que pedem uma decisão ao usuário (duplicata, proxy, recuperação...).
// `ask` devolve uma promessa com a opção escolhida; a UI (Dialogs.tsx) mostra um por vez.

export interface DialogOption {
  id: string;
  label: string;
  primary?: boolean;
}

export interface DialogRequest {
  id: number;
  title: string;
  message: string;
  options: DialogOption[];
  resolve: (optionId: string) => void;
}

let queue: DialogRequest[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const dialogStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => queue,
  answer(id: number, optionId: string) {
    const d = queue.find((x) => x.id === id);
    queue = queue.filter((x) => x.id !== id);
    emit();
    d?.resolve(optionId);
  },
};

/** Testes automatizados podem responder sozinhos (window.__autoDialog = (title) => optionId). */
export function ask(title: string, message: string, options: DialogOption[]): Promise<string> {
  const auto = (window as unknown as { __autoDialog?: (title: string) => string | undefined }).__autoDialog?.(title);
  if (auto) return Promise.resolve(auto);
  return new Promise((resolve) => {
    queue = [...queue, { id: ++seq, title, message, options, resolve }];
    emit();
  });
}
