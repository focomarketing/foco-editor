// Barra lateral esquerda: ferramentas por categoria. As que ainda não existem aparecem
// desativadas com a fase em que chegam — nada de botão falso.

import { useState } from 'react';
import { AudioLines, Blend, Captions, Film, LayoutTemplate, Shapes, Sparkles, Type, Wand } from 'lucide-react';
import { MediaBin } from './MediaBin';
import { AIPanel } from './AIPanel';
import { TextPanel } from './TextPanel';

type ToolId = 'media' | 'audio' | 'text' | 'captions' | 'ai';

const TOOLS: { id: ToolId | null; label: string; icon: typeof Film; phase?: string }[] = [
  { id: 'media', label: 'Mídia', icon: Film },
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
