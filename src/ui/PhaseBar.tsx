// Barra de fases no topo do projeto: cada etapa do fluxo, com a atual destacada.
// Clicar leva à fase; fases ainda não construídas aparecem como "em breve" e podem ser puladas.

import { Check } from 'lucide-react';
import { phaseDef } from '../core/workflow';
import type { Workflow } from '../core/workflow';
import { setPhase } from '../app/workflow';

export function PhaseBar({ wf }: { wf: Workflow }) {
  return (
    <nav className="phasebar" aria-label="Fases do projeto" data-testid="phasebar">
      {wf.phases.map((id, i) => {
        const def = phaseDef(id);
        const st = wf.status[id];
        const cls = [id === wf.current ? 'now' : '', st === 'done' ? 'done' : '', st === 'skipped' ? 'skipped' : '', def.ready ? '' : 'soon'].join(' ');
        return (
          <button key={id} className={`phase ${cls}`} onClick={() => setPhase(id)} title={def.ready ? def.hint : `${def.hint} — em breve`} data-testid={`phase-${id}`}>
            <span className="num">{st === 'done' ? <Check size={11} /> : i + 1}</span>
            <span className="lbl">{def.label}</span>
            {!def.ready && <em>em breve</em>}
          </button>
        );
      })}
    </nav>
  );
}
