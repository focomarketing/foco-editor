import { useSyncExternalStore } from 'react';
import { dialogStore } from '../app/dialogs';

/** Mostra o diálogo de decisão mais antigo da fila (duplicata, proxy, recuperação…). */
export function Dialogs() {
  const queue = useSyncExternalStore(dialogStore.subscribe, dialogStore.get);
  const d = queue[0];
  if (!d) return null;
  return (
    <div className="backdrop" style={{ zIndex: 300 }}>
      <div className="dialog" role="alertdialog" aria-label={d.title} data-testid="decision-dialog">
        <div className="dialog-head">{d.title}</div>
        <div className="dialog-body"><p style={{ margin: 0, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{d.message}</p></div>
        <div className="dialog-foot">
          {d.options.map((o) => (
            <button key={o.id} className={`btn ${o.primary ? 'primary' : 'outline'}`} onClick={() => dialogStore.answer(d.id, o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
