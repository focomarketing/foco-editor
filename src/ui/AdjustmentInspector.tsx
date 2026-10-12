import type { Clip } from '../core/types';
import { formatTimecode } from '../core/time';
import { store } from '../app/editor';
import { AnimationSection, Range } from './InspectorFx';
import { EffectsSection } from './EffectsSection';
import { live } from './clipEdit';

/** Camada de efeito: pilha de efeitos + mistura (opacidade, animável por keyframes). */
export function AdjustmentInspector({ clip }: { clip: Clip }) {
  const fps = store.getState().project.settings.fps;
  return (
    <div className="insp">
      <div>
        <h4>Camada de efeito</h4>
        <div className="muted">{formatTimecode(clip.start, fps)} · {clip.duration.toFixed(2)} s — estique ou mova na timeline para mudar o trecho.</div>
        <Range label="Mistura" value={clip.transform.opacity} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onLive={(v) => live(clip.id, (c) => ({ transform: { ...c.transform, opacity: v } }), 'Mistura do efeito')} />
      </div>
      <EffectsSection clip={clip} />
      <AnimationSection clip={clip} />
    </div>
  );
}
