// Barra de fases no topo do projeto: cada etapa do fluxo, com a atual destacada.
// Clicar leva à fase; fases ainda não construídas aparecem como "em breve" e podem ser puladas.

import { Check } from 'lucide-react';
import { phaseDef } from '../core/workflow';
import type { Workflow } from '../core/workflow';
import { setPhase } from '../app/workflow';
import { usePhaseRun } from './hooks';

export function PhaseBar({ wf }: { wf: Workflow }) {
  const run = usePhaseRun();
  const pct = run?.running && run.total > 0 ? Math.min(100, (run.done / run.total) * 100) : run?.running ? 4 : 0;
  return (
    <nav className="phasebar" aria-label="Fases do projeto" data-testid="phasebar">
      {run?.running && <div className="phasebar-progress" title={run.step}><i style={{ width: `${pct}%` }} /></div>}
      {wf.phases.map((id, i) => {
        const def = phaseDef(id);
        const st = wf.status[id];
        const cls = [id === wf.current ? 'now' : '', st === 'done' ? 'done' : '', st === 'skipped' ? 'skipped' : '', def.ready ? '' : 'soon'].join(' ');
        const working = run?.running && run.phase === id;
        return (
          <button key={id} className={`phase ${cls}${working ? ' working' : ''}`} onClick={() => setPhase(id)} title={def.ready ? def.hint : `${def.hint} — em breve`} data-testid={`phase-${id}`}>
            <span className="num">{st === 'done' ? <Check size={11} /> : i + 1}</span>
            <span className="lbl">{def.label}</span>
            {!def.ready && <em>em breve</em>}
          </button>
        );
      })}
    </nav>
  );
}
