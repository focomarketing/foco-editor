import { useEffect, useRef, useState } from 'react';
import type { Clip } from '../core/types';
import { DEFAULT_TRANSFORM, NO_ASSET } from '../core/types';
import { snapToFrame } from '../core/time';
import { playback, store } from '../app/editor';
import { Cmd } from '../engine/commands/commands';
import { createdIds } from '../engine/commands/patch';
import { drawElement } from '../engine/motion/elements';
import { ELEMENT_CATEGORIES, ELEMENT_PRESETS, elementFromPreset } from '../engine/motion/elementLibrary';
import type { ElementPreset } from '../engine/motion/elementLibrary';
import { useEditor } from './hooks';

const W = 192;
const H = 108;

function PreviewCard({ preset, onPick }: { preset: ElementPreset; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const clip: Clip = {
      id: `pv-${preset.id}`, assetId: NO_ASSET, trackId: '', start: 0, duration: preset.duration, sourceIn: 0, volume: 0, speed: 1, fadeIn: 0, fadeOut: 0,
      transform: { ...DEFAULT_TRANSFORM }, element: elementFromPreset(preset),
    };
    const draw = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      g.addColorStop(0, '#41506b');
      g.addColorStop(1, '#161a24');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawElement(ctx, canvas.width, canvas.height, clip, t);
    };
    let raf = 0;
    if (hover) {
      const t0 = performance.now();
      // repete a animação de entrada até o meio do clipe
      const loop = () => {
        draw(((performance.now() - t0) / 1000) % Math.min(preset.duration - 0.3, 2.4));
        raf = requestAnimationFrame(loop);
      };
      loop();
    } else draw(Math.min(1.2, preset.duration / 2));
    return () => cancelAnimationFrame(raf);
  }, [preset, hover]);
  return (
    <div
      className="cap-card"
      role="button"
      tabIndex={0}
      title={`${preset.label} · clique para inserir no playhead`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick())}
      data-testid={`el-preset-${preset.id}`}
    >
      <canvas ref={ref} style={{ width: '100%', aspectRatio: `${W} / ${H}` }} />
      <span className="cap-name">{preset.label}</span>
    </div>
  );
}

/** Biblioteca de elementos: formas, setas, selos, partículas e molduras animadas. */
export function ElementsPanel() {
  const { project } = useEditor();
  const [cat, setCat] = useState<string>('Todos');
  const list = ELEMENT_PRESETS.filter((p) => cat === 'Todos' || p.category === cat);
  const insert = (p: ElementPreset) => {
    const at = snapToFrame(playback.time, project.settings.fps);
    store.execute({ ...Cmd.addElement({ element: elementFromPreset(p), at, duration: p.duration }) }, (patch) => createdIds(patch, 'clips'));
  };
  return (
    <section className="panel">
      <div className="panel-head"><span className="panel-title">Elementos</span></div>
      <div className="panel-body insp">
        <div className="cap-gallery" style={{ marginTop: 0 }}>
          <div className="font-cats">
            {['Todos', ...ELEMENT_CATEGORIES].map((c) => (
              <button key={c} className={`font-chip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
          <div className="cap-grid" style={{ maxHeight: 'none' }}>
            {list.map((p) => <PreviewCard key={p.id} preset={p} onPick={() => insert(p)} />)}
          </div>
        </div>
        <p className="note">
          Clique para inserir no playhead (trilha "Gráficos"). No Inspector: camadas (formas, texto, partículas), cores, gradiente, animação de cada camada e keyframes do grupo.
          Máscaras ficam no Inspector de qualquer clipe de vídeo ou imagem.
        </p>
      </div>
    </section>
  );
}
