// Biblioteca de transições (preview animado de cada modelo) e ajuste da transição do clipe
// selecionado: modelo, duração, intensidade, direção, remover e ver no player.

import { useEffect, useRef, useState } from 'react';
import { Play, Trash2 } from 'lucide-react';
import type { Clip, TransitionSpec } from '../core/types';
import { drawTransitionPreview } from './transitionPreview';
import { CATEGORY_LABEL, LEVEL_LABEL, TRANSITIONS, presetFor } from '../video-editor/transitions/library';
import type { TransitionCategory, TransitionPreset } from '../video-editor/transitions/library';
import { applyPresetToSelection, playTransition, previousClip, setClipTransition } from '../app/transitions';
import { notify } from '../app/notify';
import { store } from '../app/editor';
import { useEditor } from './hooks';

function PresetCard({ preset, vertical, onPick }: { preset: TransitionPreset; vertical: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    // miniatura: o meio da transição; com o mouse em cima, a animação em loop
    if (!hover) {
      drawTransitionPreview(ctx, preset, preset.align === 'hold' ? 0.8 : 0.42, vertical);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const cycle = 1600;
      const x = ((now - t0) % cycle) / cycle;
      // 25% em A, 50% transição, 25% em B
      const u = x < 0.25 ? 0 : x > 0.75 ? 1 : (x - 0.25) / 0.5;
      drawTransitionPreview(ctx, preset, preset.align === 'hold' ? x : Math.min(0.999, u), vertical);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hover, preset, vertical]);
  return (
    <button
      className={`tr-card${vertical ? ' vertical' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      onClick={onPick}
      title={`${preset.description}\nUso: ${preset.useCases.join(', ')}\nReferência: ${preset.reference}`}
      data-testid={`tr-${preset.id}`}
    >
      <canvas ref={ref} width={vertical ? 90 : 160} height={vertical ? 160 : 90} />
      <b>{preset.name}</b>
      <span className={`tr-level l${preset.level}`}>{LEVEL_LABEL[preset.level]}{preset.duration.recommended ? ` · ${preset.duration.recommended}s` : ''}</span>
    </button>
  );
}

const CATS = Object.keys(CATEGORY_LABEL) as TransitionCategory[];

/** Biblioteca: clicar aplica no clipe selecionado (o que entra). */
export function TransitionLibrary() {
  const { project } = useEditor();
  const vertical = project.settings.height > project.settings.width;
  const [cat, setCat] = useState<TransitionCategory>(vertical ? 'social' : 'clean');
  const pick = (id: string) => {
    const r = applyPresetToSelection(id);
    if (r.errors.length) notify(r.errors[0], 'error', 6000);
    else if (r.applied) notify(`Transição aplicada em ${r.applied} clipe(s).`, 'success');
  };
  return (
    <div className="tr-library" data-testid="transition-library">
      <div className="tr-tabs">
        {CATS.map((c) => (
          <button key={c} className={`btn sm${c === cat ? ' active' : ''}`} onClick={() => setCat(c)}>{CATEGORY_LABEL[c]}</button>
        ))}
      </div>
      <div className="tr-grid">
        {TRANSITIONS.filter((t) => t.category === cat).map((t) => (
          <PresetCard key={t.id} preset={t} vertical={vertical} onPick={() => pick(t.id)} />
        ))}
      </div>
      <p className="note">Passe o mouse para ver. Clique para aplicar no clipe selecionado (a transição fica no começo dele).</p>
    </div>
  );
}

/** Ajuste da transição de entrada de um clipe (Inspector). */
export function TransitionInspector({ clip }: { clip: Clip }) {
  const [error, setError] = useState<string | null>(null);
  const spec = clip.transitionIn;
  const preset = spec ? presetFor(spec.type) : undefined;
  const hasPrev = !!previousClip(clip.id);
  const update = (patch: Partial<TransitionSpec>, live = false) => {
    if (!spec) return;
    setError(setClipTransition(clip.id, { ...spec, ...patch }, { live }));
  };
  return (
    <div data-testid="transition-inspector">
      <h4>Transição de entrada</h4>
      <div className="field wide">
        <label>Modelo</label>
        <select
          value={spec ? preset?.id ?? spec.type : ''}
          onChange={(e) => {
            if (!e.target.value) return setError(setClipTransition(clip.id, undefined));
            const p = presetFor(e.target.value)!;
            const duration = p.render === 'none' || p.align === 'hold' ? 0 : Math.max(p.duration.min, Math.min(p.duration.recommended, clip.duration / 2));
            setError(setClipTransition(clip.id, { type: p.id, duration: +duration.toFixed(3), intensity: p.parameters.intensity, easing: p.parameters.easing }));
          }}
        >
          <option value="">Corte seco (nenhuma)</option>
          {CATS.map((c) => (
            <optgroup key={c} label={CATEGORY_LABEL[c]}>
              {TRANSITIONS.filter((t) => t.category === c && t.render !== 'none').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {!hasPrev && <p className="note">Este clipe não tem outro colado antes dele: só efeitos de entrada fazem sentido aqui.</p>}
      {spec && preset && preset.render !== 'none' && (
        <>
          {preset.align !== 'hold' && (
            <Range label="Duração" unit="s" value={spec.duration} min={preset.duration.min} max={preset.duration.max} step={0.01} onChange={(v, live) => update({ duration: +v.toFixed(3) }, live)} />
          )}
          <Range label="Intensidade" unit="%" value={(spec.intensity ?? preset.parameters.intensity ?? 0.5) * 100} min={0} max={100} step={1} onChange={(v, live) => update({ intensity: +(v / 100).toFixed(2) }, live)} />
          {preset.parameters.direction && (
            <div className="field wide">
              <label>Direção</label>
              <select value={String(spec.params?.direction ?? preset.parameters.direction)} onChange={(e) => update({ params: { ...spec.params, direction: e.target.value } })}>
                <option value="left">Para a esquerda</option>
                <option value="right">Para a direita</option>
                <option value="up">Para cima</option>
                <option value="down">Para baixo</option>
              </select>
            </div>
          )}
          <div className="field wide">
            <label>Curva</label>
            <select value={spec.easing ?? preset.parameters.easing ?? 'smooth'} onChange={(e) => update({ easing: e.target.value as TransitionSpec['easing'] })}>
              <option value="smooth">Suave</option>
              <option value="snappy">Seca (snappy)</option>
              <option value="linear">Linear</option>
              <option value="elastic">Elástica</option>
            </select>
          </div>
          <p className="note">{spec.by === 'ai' ? 'Escolhida pela IA · ' : 'Escolhida por você (a IA não altera) · '}{preset.description}</p>
          <div className="row">
            <button className="btn sm" onClick={() => playTransition(clip.id)} data-testid="transition-play"><Play size={12} /> Ver no player</button>
            <button className="btn sm danger" onClick={() => setError(setClipTransition(clip.id, undefined))} data-testid="transition-remove"><Trash2 size={12} /> Remover</button>
          </div>
        </>
      )}
      {error && <p className="note bad">{error}</p>}
    </div>
  );
}

/** Slider que vira um passo de undo só ao soltar (enquanto arrasta, mostra ao vivo). */
function Range(props: { label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (v: number, live: boolean) => void }) {
  return (
    <div className="field">
      <label>{props.label}</label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onPointerDown={() => store.beginGesture()}
        onPointerUp={() => store.endGesture()}
        onKeyDown={() => !store.inGesture && store.beginGesture()}
        onKeyUp={() => store.endGesture()}
        onChange={(e) => {
          if (!store.inGesture) store.beginGesture();
          props.onChange(Number(e.target.value), true);
        }}
      />
      <span className="ro">{props.unit === 's' ? props.value.toFixed(2) : Math.round(props.value)}{props.unit}</span>
    </div>
  );
}
