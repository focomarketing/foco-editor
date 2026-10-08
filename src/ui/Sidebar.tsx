// Barra lateral esquerda: ferramentas por categoria. As que ainda não existem aparecem
// desativadas com a fase em que chegam — nada de botão falso.

import { useEffect, useState } from 'react';
import { ArrowRight, SkipForward } from 'lucide-react';
import { useEditor } from './hooks';
import { phaseDef, readWorkflow } from '../core/workflow';
import type { Workflow } from '../core/workflow';
import { finishPhase, markRan, setPhase } from '../app/workflow';
import { AUTO_PHASES, phaseRunStore, runPhase } from '../app/phases';
import { PhaseRunCard } from './PhaseRun';
import { AudioLines, Blend, Captions, Film, LayoutTemplate, Scissors, Shapes, Sparkles, Type, Wand } from 'lucide-react';
import { MediaBin } from './MediaBin';
import { AIPanel } from './AIPanel';
import { TextPanel } from './TextPanel';
import { CutPanel } from './CutPanel';

type ToolId = 'media' | 'cut' | 'audio' | 'text' | 'captions' | 'ai';

const TOOLS: { id: ToolId | null; label: string; icon: typeof Film; phase?: string }[] = [
  { id: 'media', label: 'Mídia', icon: Film },
  { id: 'cut', label: 'Corte', icon: Scissors },
  { id: 'audio', label: 'Áudio', icon: AudioLines },
  { id: 'text', label: 'Texto', icon: Type },
  { id: 'captions', label: 'Legendas', icon: Captions },
  { id: null, label: 'Transições', icon: Blend, phase: 'Fase 6' },
  { id: null, label: 'Efeitos', icon: Wand, phase: 'Fase 6' },
  { id: null, label: 'Elementos', icon: Shapes, phase: 'Fase 5' },
  { id: null, label: 'Templates', icon: LayoutTemplate, phase: 'Fase 11' },
  { id: 'ai', label: 'IA', icon: Sparkles },
];

export function Sidebar() {
  const { project } = useEditor();
  const wf = readWorkflow(project.metadata);
  if (wf && wf.current !== 'editor') return <PhasePanel wf={wf} />;
  return <ToolSidebar />;
}

/** Painel da fase guiada atual (ocupa a barra e o painel lateral). */
function PhasePanel({ wf }: { wf: Workflow }) {
  const def = phaseDef(wf.current);
  const { project } = useEditor();
  const hasMedia = Object.keys(project.clips).length > 0;
  const auto = AUTO_PHASES.includes(wf.current);
  // Entrou numa fase automática pela primeira vez (e há vídeo): a IA começa sozinha.
  useEffect(() => {
    if (!auto || !hasMedia || wf.ran?.[wf.current] || phaseRunStore.get()?.running) return;
    markRan(wf.current);
    void runPhase(wf.current);
  }, [auto, hasMedia, wf.current, wf.ran]);
  const last = wf.phases.indexOf(wf.current) === wf.phases.length - 2; // a próxima é o Editor
  return (
    <section className="panel phase-panel" data-testid={`phase-panel-${wf.current}`}>
      <div className="panel-head">
        <span className="panel-title">{wf.phases.indexOf(wf.current) + 1}. {def.label}</span>
      </div>
      <div className="panel-body">
        {auto && <PhaseRunCard phase={wf.current} />}
        {wf.current === 'cut' ? (
          <CutPanel />
        ) : def.ready ? null : (
          <div className="insp">
            <div className="empty">
              <b>{def.label}</b> — {def.hint}.
              <br />
              Esta fase ainda está em construção. Pule para seguir, ou vá direto para o Editor.
            </div>
          </div>
        )}
      </div>
      <div className="phase-foot">
        <button className="btn sm" onClick={() => finishPhase('skipped')} title="Seguir sem esta fase" data-testid="phase-skip">
          <SkipForward size={12} /> Pular
        </button>
        <button className="btn sm primary" onClick={() => finishPhase('done')} data-testid="phase-done">
          {last ? 'Concluir e abrir o Editor' : 'Concluir fase'} <ArrowRight size={12} />
        </button>
        <button className="btn sm link" onClick={() => setPhase('editor')} title="Abrir a timeline completa agora">Ir para o Editor</button>
      </div>
    </section>
  );
}

function ToolSidebar() {
  const [tool, setTool] = useState<ToolId>(() => {
    try {
      return (localStorage.getItem('foco.sidebar') as ToolId) || 'media';
    } catch {
      return 'media';
    }
  });
  const pick = (id: ToolId) => {
    setTool(id);
    try {
      localStorage.setItem('foco.sidebar', id);
    } catch {
      /* ok */
    }
  };

  return (
    <>
      <nav className="rail" aria-label="Ferramentas">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const enabled = t.id !== null;
          return (
            <button
              key={t.label}
              className={`rail-btn${tool === t.id ? ' on' : ''}`}
              disabled={!enabled}
              title={enabled ? t.label : `${t.label} — chega na ${t.phase}`}
              onClick={() => t.id && pick(t.id)}
              data-testid={`rail-${t.id ?? t.label}`}
            >
              <Icon size={17} />
              <span>{t.label}</span>
              {!enabled && <em>{t.phase}</em>}
            </button>
          );
        })}
      </nav>
      <div className="side-panel">
        {tool === 'media' && <MediaBin />}
        {tool === 'cut' && (
          <section className="panel">
            <div className="panel-head"><span className="panel-title">Corte</span></div>
            <div className="panel-body"><CutPanel /></div>
          </section>
        )}
        {tool === 'audio' && <MediaBin only={['audio']} title="Áudio" />}
        {tool === 'text' && <TextPanel />}
        {tool === 'captions' && (
          <section className="panel">
            <div className="panel-head"><span className="panel-title">Legendas</span></div>
            <div className="panel-body"><AIPanel mode="captions" /></div>
          </section>
        )}
        {tool === 'ai' && (
          <section className="panel">
            <div className="panel-head"><span className="panel-title">IA</span></div>
            <div className="panel-body"><AIPanel mode="ai" /></div>
          </section>
        )}
      </div>
    </>
  );
}
