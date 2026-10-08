// Tela inicial: projetos em aberto (catálogo no navegador) e "Novo projeto".

import { useEffect, useState } from 'react';
import { Clapperboard, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { actions, projectFile } from '../app/editor';
import { openFromCatalog, removeFromCatalog, startNewProject } from '../app/workflow';
import type { CatalogEntry } from '../engine/project/ProjectEngine';
import { phaseDef, readWorkflow, workflowLabel } from '../core/workflow';
import { formatDuration } from '../core/time';
import { desktop } from '../engine/platform/desktop';

export function ProjectsHome() {
  const [list, setList] = useState<CatalogEntry[] | null>(null);
  const reload = () => void projectFile.catalog().then(setList);
  useEffect(reload, []);

  return (
    <div className="home" data-testid="projects-home">
      <div className="home-head">
        <div>
          <h1>Projetos</h1>
          <p className="muted">Continue de onde parou ou comece um vídeo novo.{desktop ? ' Tudo fica salvo em Documentos\\FOCO Editor.' : ''}</p>
        </div>
        <div className="row">
          {desktop?.openFolder && (
            <button className="btn outline" onClick={() => desktop!.openFolder!('projects')} title="Os projetos ficam salvos como arquivos .foco nesta pasta" data-testid="open-projects-folder">
              <FolderOpen size={14} /> Pasta de projetos
            </button>
          )}
          <button className="btn outline" onClick={() => void actions.openProject()}><FolderOpen size={14} /> Abrir arquivo .foco</button>
          <button className="btn primary" onClick={startNewProject} data-testid="home-new"><Plus size={15} /> Novo projeto</button>
        </div>
      </div>

      {list === null ? (
        <p className="muted">Carregando…</p>
      ) : list.length === 0 ? (
        <div className="home-empty">
          <Clapperboard size={28} />
          <p>Nenhum projeto ainda.</p>
          <button className="btn primary" onClick={startNewProject}><Plus size={15} /> Criar o primeiro</button>
        </div>
      ) : (
        <div className="home-grid">
          {list.map((p) => {
            const wf = readWorkflow({ workflow: p.workflow });
            const done = wf ? wf.phases.filter((id) => wf.status[id] === 'done' || wf.status[id] === 'skipped').length : 0;
            return (
              <div key={p.id} className="proj-card" data-testid="project-card">
                <button className="proj-open" onClick={() => void openFromCatalog(p.id)}>
                  <span className="proj-name">{p.name}</span>
                  <span className="proj-track">{workflowLabel(wf)}</span>
                  {wf && (
                    <span className="proj-phases" title={`Fase atual: ${phaseDef(wf.current).label}`}>
                      {wf.phases.map((id) => (
                        <i key={id} className={id === wf.current ? 'now' : (wf.status[id] ?? '')} />
                      ))}
                    </span>
                  )}
                  <span className="proj-meta">
                    {wf ? `${phaseDef(wf.current).label} · ${done}/${wf.phases.length} fases` : 'Editor'}
                    {p.duration > 0 && ` · ${formatDuration(p.duration)}`} · {new Date(p.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
                <button
                  className="btn icon sm proj-del"
                  title="Remover da lista (os arquivos de vídeo não são apagados)"
                  onClick={async () => {
                    if (!confirm(`Remover "${p.name}" da lista de projetos? Os vídeos originais não são apagados.`)) return;
                    await removeFromCatalog(p.id);
                    reload();
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
