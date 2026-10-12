import { useState, useSyncExternalStore } from 'react';
import { dialogStore } from '../app/dialogs';
import type { DialogRequest } from '../app/dialogs';

/** Mostra o diálogo de decisão mais antigo da fila (duplicata, proxy, recuperação…). */
export function Dialogs() {
  const queue = useSyncExternalStore(dialogStore.subscribe, dialogStore.get);
  const d = queue[0];
  if (!d) return null;
  // key: cada diálogo começa com o próprio valor no campo de texto
  return <Dialog key={d.id} d={d} />;
}

function Dialog({ d }: { d: DialogRequest }) {
  const [text, setText] = useState(d.input?.value ?? '');
  const answer = (optionId: string) => dialogStore.answer(d.id, optionId, d.input ? text : undefined);
  const cancel = d.options.find((o) => !o.primary)?.id;
  return (
    <div className="backdrop" style={{ zIndex: 300 }}>
      <div
        className="dialog"
        role="alertdialog"
        aria-label={d.title}
        data-testid="decision-dialog"
        onKeyDown={(e) => {
          e.stopPropagation(); // atalhos do editor não disparam enquanto se digita
          if (e.key === 'Escape' && cancel) answer(cancel);
        }}
      >
        <div className="dialog-head">{d.title}</div>
        <div className="dialog-body">
          {d.message && <p style={{ margin: 0, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{d.message}</p>}
          {d.input && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                answer('ok');
              }}
            >
              <input
                className="text-input"
                style={{ width: '100%', height: 30, marginTop: d.message ? 10 : 0 }}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                value={text}
                placeholder={d.input.placeholder}
                onChange={(e) => setText(e.target.value)}
                data-testid="dialog-input"
              />
            </form>
          )}
        </div>
        <div className="dialog-foot">
          {d.options.map((o) => (
            <button key={o.id} className={`btn ${o.primary ? 'primary' : 'outline'}`} onClick={() => answer(o.id)} data-testid={`dialog-${o.id}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
