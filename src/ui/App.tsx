import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FolderOpen, LayoutGrid } from 'lucide-react';
import { actions, playback, projectFile } from '../app/editor';
import type { RecentProject } from '../engine/project/ProjectEngine';
import { fsAccessSupported } from '../engine/platform/fs';
import { projectDuration } from '../engine/timeline/operations';
import { useEditor, usePrefs, useToasts, useView } from './hooks';
import { ProjectsHome } from './ProjectsHome';
import { NewProject } from './NewProject';
import { PhaseBar } from './PhaseBar';
import { readWorkflow } from '../core/workflow';
import { goHome } from '../app/workflow';
import { SettingsDialog } from './SettingsDialog';
import { VersionHistory } from './VersionHistory';
import { PerformancePanel } from './PerformancePanel';
import { toastStore } from '../app/notify';
import { Sidebar } from './Sidebar';
import { Dialogs } from './Dialogs';
import { JobsPanel } from './JobsPanel';
import { Viewer } from './Viewer';
import { Inspector } from './Inspector';
import { Timeline } from './timeline/Timeline';
import { ExportDialog } from './ExportDialog';
import { useShortcuts } from './shortcuts';

export function App() {
  const view = useView();
  if (view !== 'project') {
    return (
      <div className="app home-app">
        <header className="header">
          <div className="brand">FOCO <span>EDITOR</span></div>
        </header>
        {view === 'home' ? <ProjectsHome /> : <NewProject />}
        <Dialogs />
        <Toasts />
      </div>
    );
  }
  return <ProjectApp />;
}

function ProjectApp() {
  const { project } = useEditor();
  const wf = readWorkflow(project.metadata);
  const [exporting, setExporting] = useState(false);
  const [panel, setPanel] = useState<'settings' | 'history' | null>(null);
  const prefs = usePrefs();
  const [timelineH, setTimelineH] = useState(() => Math.round(window.innerHeight * 0.42));
  const [fileDrag, setFileDrag] = useState(false);
  useShortcuts({ openExport: () => setExporting(true), exporting });

  // Arrastar arquivos do sistema em qualquer lugar importa para o projeto.
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth++;
      setFileDrag(true);
    };
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setFileDrag(false);
    };
    const over = (e: DragEvent) => isFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      depth = 0;
      setFileDrag(false);
      if (!isFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      actions.importDataTransfer(e.dataTransfer!);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = timelineH;
    const move = (ev: PointerEvent) => setTimelineH(Math.min(window.innerHeight - 220, Math.max(150, h0 - (ev.clientY - y0))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`app${wf ? ' with-phases' : ''}`} style={{ '--timeline-h': `${timelineH}px` } as React.CSSProperties}>
      <Header onExport={() => setExporting(true)} onSettings={() => setPanel('settings')} onHistory={() => setPanel('history')} />
      {wf && <PhaseBar wf={wf} />}
      <main className="workspace">
        <Sidebar />
        <Viewer />
        <Inspector />
      </main>
      <div className="splitter" onPointerDown={startResize} />
      <Timeline />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {panel === 'settings' && <SettingsDialog onClose={() => setPanel(null)} />}
      {panel === 'history' && <VersionHistory onClose={() => setPanel(null)} />}
      {prefs.showPerformancePanel && <PerformancePanel />}
      {fileDrag && <div className="drop-overlay">Solte para importar</div>}
      <Dialogs />
      <Toasts />
    </div>
  );
}

function Header({ onExport, onSettings, onHistory }: { onExport: () => void; onSettings: () => void; onHistory: () => void }) {
  const { project, dirty } = useEditor();
  const [menu, setMenu] = useState(false);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const empty = projectDuration(project) <= 0;

  useEffect(() => {
    if (!menu) return;
    void projectFile.recents().then(setRecents);
    const close = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const run = (fn: () => unknown) => () => {
    setMenu(false);
    void fn();
  };

  return (
    <header className="header">
      <div className="brand">FOCO <span>EDITOR</span></div>
      <button className="btn" onClick={() => void goHome()} title="Voltar para a lista de projetos" data-testid="go-home"><LayoutGrid size={13} /> Projetos</button>
      <div className="menu" ref={menuRef}>
        <button className={`btn${menu ? ' active' : ''}`} onClick={() => setMenu(!menu)}>
          Arquivo <ChevronDown size={13} />
        </button>
        {menu && (
          <div className="menu-pop">
            <button className="menu-item" onClick={run(actions.newProject)}>Novo projeto</button>
            <button className="menu-item" onClick={run(actions.openProject)}>Abrir projeto… <kbd>Ctrl+O</kbd></button>
            <button className="menu-item" onClick={run(() => actions.save(false))}>Salvar <kbd>Ctrl+S</kbd></button>
            <button className="menu-item" onClick={run(() => actions.save(true))}>Salvar como… <kbd>Ctrl+Shift+S</kbd></button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={run(actions.importMedia)}>Importar mídia… <kbd>Ctrl+I</kbd></button>
            <button className="menu-item" disabled={empty} onClick={run(onExport)}>Exportar… <kbd>Ctrl+E</kbd></button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={run(onHistory)}>Histórico de versões…</button>
            <button className="menu-item" onClick={run(onSettings)} data-testid="menu-settings">Configurações…</button>
            {recents.length > 0 && (
              <>
                <div className="menu-sep" />
                <div className="menu-label">Recentes</div>
                {recents.map((r) => (
                  <button key={r.id} className="menu-item" onClick={run(() => actions.openRecent(r))}>
                    <span><FolderOpen size={12} /> {r.name}</span>
                    <kbd>{new Date(r.savedAt).toLocaleDateString()}</kbd>
                  </button>
                ))}
              </>
            )}
            {!fsAccessSupported && (
              <>
                <div className="menu-sep" />
                <div className="menu-label">Use Chrome ou Edge para salvar direto no disco</div>
              </>
            )}
          </div>
        )}
      </div>
      <span className="sep" />
      <input
        className="project-name"
        key={project.name}
        defaultValue={project.name}
        title="Nome do projeto"
        onBlur={(e) => actions.rename(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="save-state" title="O projeto também é salvo automaticamente no navegador">
        {projectFile.fileName ? `${projectFile.fileName}${dirty ? ' · alterações não salvas' : ' · salvo'}` : dirty ? 'não salvo em arquivo · autosave ativo' : ''}
      </span>
      <span className="spacer" />
      <JobsPanel />
      <span className="sep" />
      <button
        className="btn primary"
        disabled={empty}
        onClick={() => {
          if (playback.getSnapshot().playing) playback.pause();
          onExport();
        }}
      >
        <Download size={15} /> Exportar
      </button>
    </header>
  );
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => toastStore.dismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
