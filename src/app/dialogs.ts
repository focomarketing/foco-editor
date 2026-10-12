// Diálogos que pedem uma decisão ao usuário (duplicata, proxy, recuperação...).
// `ask` devolve uma promessa com a opção escolhida; `askText` pede um texto (no lugar do
// prompt() do navegador, que não existe no app instalado). A UI (Dialogs.tsx) mostra um por vez.

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
  /** Campo de texto (askText): valor inicial. */
  input?: { value: string; placeholder?: string };
  resolve: (optionId: string, text?: string) => void;
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
  answer(id: number, optionId: string, text?: string) {
    const d = queue.find((x) => x.id === id);
    queue = queue.filter((x) => x.id !== id);
    emit();
    d?.resolve(optionId, text);
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

/** Pede um texto. Devolve o texto digitado, ou null se a pessoa cancelar. */
export function askText(title: string, message: string, value = '', placeholder?: string): Promise<string | null> {
  const auto = (window as unknown as { __autoDialog?: (title: string) => string | undefined }).__autoDialog?.(title);
  if (auto !== undefined) return Promise.resolve(auto);
  return new Promise((resolve) => {
    const options = [
      { id: 'cancel', label: 'Cancelar' },
      { id: 'ok', label: 'OK', primary: true },
    ];
    queue = [...queue, { id: ++seq, title, message, options, input: { value, placeholder }, resolve: (o, text) => resolve(o === 'ok' ? (text ?? '') : null) }];
    emit();
  });
}
