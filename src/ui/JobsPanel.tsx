import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ListChecks, RotateCcw, Square, X } from 'lucide-react';
import { jobs } from '../engine/jobs/JobQueue';
import type { Job } from '../engine/jobs/JobQueue';
import { formatDuration } from '../core/time';

const STATUS: Record<Job['status'], string> = { queued: 'Na fila', processing: 'Processando', completed: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado' };
const PRIORITY: Record<Job['priority'], string> = { high: 'alta', medium: 'média', low: 'baixa' };

/** Indicador de tarefas em segundo plano + lista com progresso, cancelar e tentar de novo. */
export function JobsPanel() {
  useSyncExternalStore(jobs.subscribe, jobs.getVersion);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const all = jobs.jobs;
  const active = jobs.active;
  const failed = all.filter((j) => j.status === 'failed').length;
  const running = active.filter((j) => j.status === 'processing');
  const avg = running.length ? running.reduce((a, j) => a + j.progress, 0) / running.length : 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button className={`btn sm${open ? ' active' : ''}${failed ? ' danger-text' : ''}`} onClick={() => setOpen(!open)} title="Tarefas em segundo plano" data-testid="jobs-button">
        <ListChecks size={14} />
        {active.length ? `${active.length} tarefa${active.length > 1 ? 's' : ''} · ${Math.round(avg * 100)}%` : failed ? `${failed} falha(s)` : 'Tarefas'}
      </button>
      {open && (
        <div className="menu-pop jobs-pop" style={{ left: 'auto', right: 0 }}>
          <div className="row-between" style={{ padding: '4px 6px' }}>
            <span className="menu-label" style={{ padding: 0 }}>Fila de processamento</span>
            <button className="btn sm" onClick={() => jobs.clearFinished()}>Limpar concluídas</button>
          </div>
          {all.length === 0 && <div className="empty" style={{ padding: 12 }}>Nenhuma tarefa.</div>}
          <div className="jobs-list">
            {[...all].reverse().map((j) => (
              <div key={j.id} className={`job-item ${j.status}`} data-testid="job-item">
                <div className="row-between">
                  <span className="job-label" title={j.label}>{j.label}</span>
                  <span className="job-actions">
                    {(j.status === 'queued' || j.status === 'processing') && (
                      <button className="btn icon sm" title="Cancelar" onClick={() => jobs.cancel(j.id)}><Square size={10} /></button>
                    )}
                    {(j.status === 'failed' || j.status === 'cancelled') && (
                      <button className="btn icon sm" title="Tentar de novo" onClick={() => void jobs.retry(j.id)?.catch(() => {})}><RotateCcw size={12} /></button>
                    )}
                  </span>
                </div>
                {j.status === 'processing' && <div className="progress"><div style={{ width: `${Math.round(j.progress * 100)}%` }} /></div>}
                <div className="job-meta">
                  {STATUS[j.status]}
                  {j.status === 'processing' && ` · ${Math.round(j.progress * 100)}%`}
                  {j.detail && j.status === 'processing' ? ` · ${j.detail}` : ''}
                  {` · prioridade ${PRIORITY[j.priority]}`}
                  {j.finishedAt && j.startedAt ? ` · ${formatDuration((j.finishedAt - j.startedAt) / 1000) === '—' ? '<1s' : formatDuration((j.finishedAt - j.startedAt) / 1000)}` : ''}
                </div>
                {j.error && <div className="job-error"><X size={11} /> {j.error}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
