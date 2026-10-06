import { useEffect, useRef, useState } from 'react';
import { ChevronFirst, ChevronLast, Pause, Play, StepBack, StepForward } from 'lucide-react';
import { actions, playback } from '../app/editor';
import { formatTime, prefsStore } from '../app/prefs';
import type { PreviewQuality } from '../app/prefs';
import { ASSET_MIME } from './MediaBin';
import { projectDuration } from '../engine/timeline/operations';
import { useEditor, usePlayback, usePrefs } from './hooks';
import { useAI } from './hooks';
import { acceptSession, rejectSession, setComparing } from '../app/aiEditor';

export function Viewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { project } = useEditor();
  const { time, playing, rate } = usePlayback();
  const prefs = usePrefs();
  const { timeMode } = prefs;
  const [dropOver, setDropOver] = useState(false);
  const duration = projectDuration(project);
  const fps = project.settings.fps;

  useEffect(() => {
    playback.attachCanvas(canvasRef.current);
    return () => playback.attachCanvas(null);
  }, []);

  return (
    <section className="viewer">
      <div className="panel-head" style={{ background: 'var(--bg-1)' }}>
        <span className="panel-title">Preview</span>
        <span className="muted" style={{ marginLeft: 8 }}>
          {project.settings.width}×{project.settings.height} · {fps} fps
        </span>
        <span className="spacer" />
        <select
          className="mini-select"
          title="Qualidade do preview (não afeta o export)"
          value={prefs.previewQuality}
          onChange={(e) => prefsStore.set({ previewQuality: e.target.value as PreviewQuality })}
          data-testid="preview-quality"
        >
          <option value="auto">Auto</option>
          <option value="full">Full</option>
          <option value="1/2">1/2</option>
          <option value="1/4">1/4</option>
          <option value="1/8">1/8</option>
        </select>
        <button
          className={`btn sm${prefs.useProxies ? ' active' : ''}`}
          title="Usar proxies no preview quando existirem (o export sempre usa o original)"
          onClick={() => prefsStore.set({ useProxies: !prefs.useProxies })}
          data-testid="proxy-toggle"
        >
          Proxy {prefs.useProxies ? 'ON' : 'OFF'}
        </button>
      </div>
      <AISessionBar />
      <div
        className={`viewer-stage${dropOver ? ' drop-ok' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(ASSET_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDropOver(true);
          }
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={(e) => {
          setDropOver(false);
          const id = e.dataTransfer.getData(ASSET_MIME);
          if (!id) return;
          e.preventDefault();
          e.stopPropagation();
          // Solta no preview = insere no playhead, na trilha padrão do tipo (sobrescrevendo).
          actions.addAssetToTimeline(id, undefined, playback.time);
        }}
        title="Solte mídia aqui para inserir no playhead"
      >
        <canvas ref={canvasRef} onClick={() => playback.toggle()} />
        <CompareBadge />
      </div>
      <div className="transport">
        <span className="tc">
          {formatTime(time, fps, timeMode)}
          {playing && rate !== 1 && <em className="rate">{rate < 0 ? '◀◀' : '▶▶'} {Math.abs(rate)}x</em>}
        </span>
        <div className="controls">
          <button className="btn icon" title="Início (Home)" onClick={() => playback.seek(0)}>
            <ChevronFirst size={16} />
          </button>
          <button className="btn icon" title="Quadro anterior (←)" onClick={() => playback.stepFrames(-1)}>
            <StepBack size={16} />
          </button>
          <button className="btn icon" title="Play/Pause (Espaço)" onClick={() => playback.toggle()} disabled={duration <= 0}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="btn icon" title="Próximo quadro (→)" onClick={() => playback.stepFrames(1)}>
            <StepForward size={16} />
          </button>
          <button className="btn icon" title="Fim (End)" onClick={() => playback.seek(duration)}>
            <ChevronLast size={16} />
          </button>
        </div>
        <span className="tc dim">{formatTime(duration, fps, timeMode)}</span>
      </div>
    </section>
  );
}

/** ORIGINAL vs EDIÇÃO DA IA: comparar, aceitar ou desfazer a última edição automática. */
function AISessionBar() {
  const ai = useAI();
  const s = ai.session;
  if (!s) return null;
  return (
    <div className="ai-bar" data-testid="ai-session">
      <span className="ai-bar-label">
        Edição da IA: <b>{s.label}</b>
      </span>
      <button
        className={`btn sm${ai.comparing ? ' active' : ''}`}
        title="Alterna o preview entre o original e a edição da IA"
        onClick={() => setComparing(!ai.comparing)}
      >
        {ai.comparing ? 'Vendo: ORIGINAL' : 'Vendo: EDIÇÃO DA IA'}
      </button>
      <button className="btn sm primary" onClick={acceptSession}>Aceitar</button>
      <button className="btn sm outline" onClick={rejectSession}>Desfazer</button>
    </div>
  );
}

function CompareBadge() {
  const ai = useAI();
  return ai.comparing ? <div className="compare-badge">ORIGINAL</div> : null;
}
