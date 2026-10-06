// Seções do Inspector para cor, áudio, keyframes e gráficos. Tudo que a IA cria aparece
// aqui e pode ser ajustado à mão (cada ajuste é um passo de undo).

import { Diamond, Trash2, Wand2 } from 'lucide-react';
import type { AnimProp, AudioFx, Clip, ColorSettings, Ease, TitleData } from '../core/types';
import { ANIM_PROPS, removeKeyframe, setKeyframe, transformAt } from '../core/animation';
import { formatTimecode } from '../core/time';
import { toSource, toTimeline } from '../core/clipTime';
import { media, playback, store } from '../app/editor';
import { runManual } from '../app/aiEditor';
import { clipPatchCommand } from '../engine/commands/commands';
import { COLOR_PRESETS, NEUTRAL_COLOR, colorPreset } from '../engine/color/color';
import { AUDIO_PRESETS, audioFxFromPreset } from '../engine/audio/audioFx';
import { TITLE_TEMPLATES, defaultTitle } from '../engine/motion/titles';
import { useAI } from './hooks';
import { usePlayback } from './hooks';
import { FontSelect } from './FontSelect';

/** Durante um gesto (slider): mostra o resultado; o gesto vira um único comando. */
function live(clipId: string, fn: (c: Clip) => Partial<Clip>, label?: string) {
  const c = store.getState().project.clips[clipId];
  if (c) store.preview(clipPatchCommand(clipId, fn(c), label));
}

function commit(clipId: string, label: string, fn: (c: Clip) => Partial<Clip>) {
  const c = store.getState().project.clips[clipId];
  if (c) store.execute(clipPatchCommand(clipId, fn(c), label));
}

/** Slider que vira um único passo de undo por arraste. */
function Range(props: { label: string; value: number; min: number; max: number; step: number; fmt?: (v: number) => string; onLive: (v: number) => void }) {
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
        onKeyUp={() => store.endGesture()}
        onChange={(e) => {
          if (!store.inGesture) store.beginGesture();
          props.onLive(Number(e.target.value));
        }}
      />
      <span className="val">{props.fmt ? props.fmt(props.value) : props.value.toFixed(2)}</span>
    </div>
  );
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

// --- Cor ----------------------------------------------------------------------------

const COLOR_FIELDS: { key: keyof Omit<ColorSettings, 'preset'>; label: string; min: number; max: number }[] = [
  { key: 'exposure', label: 'Exposição', min: -2, max: 2 },
  { key: 'contrast', label: 'Contraste', min: -1, max: 1 },
  { key: 'highlights', label: 'Altas luzes', min: -1, max: 1 },
  { key: 'shadows', label: 'Sombras', min: -1, max: 1 },
  { key: 'temperature', label: 'Temperatura', min: -1, max: 1 },
  { key: 'tint', label: 'Tint', min: -1, max: 1 },
  { key: 'saturation', label: 'Saturação', min: -1, max: 1 },
  { key: 'vibrance', label: 'Vibrance', min: -1, max: 1 },
  { key: 'vignette', label: 'Vinheta', min: 0, max: 1 },
];

export function ColorSection({ clip }: { clip: Clip }) {
  const ai = useAI();
  const c = clip.color ?? NEUTRAL_COLOR;
  return (
    <div>
      <h4>Cor</h4>
      <div className="field wide">
        <label>Preset</label>
        <select
          value={COLOR_PRESETS.some((p) => p.id === c.preset) ? c.preset : c.preset === 'auto' ? 'auto' : 'none'}
          onChange={(e) => commit(clip.id, 'Preset de cor', () => ({ color: e.target.value === 'none' ? undefined : { ...colorPreset(e.target.value) } }))}
        >
          <option value="none">Original</option>
          {c.preset === 'auto' && <option value="auto">Automática (IA)</option>}
          {c.preset === 'custom' && <option value="custom">Personalizada</option>}
          {COLOR_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      {COLOR_FIELDS.map((f) => (
        <Range
          key={f.key}
          label={f.label}
          value={c[f.key]}
          min={f.min}
          max={f.max}
          step={0.01}
          fmt={signed}
          onLive={(v) => live(clip.id, (cl) => ({ color: { ...(cl.color ?? NEUTRAL_COLOR), [f.key]: v, preset: 'custom' } }))}
        />
      ))}
      <div className="row-between" style={{ marginTop: 6 }}>
        <button className="btn sm outline" disabled={!!ai.busy} onClick={() => void runManual({ type: 'auto_color' })}>
          <Wand2 size={12} /> Cor automática
        </button>
        <button
          className={`btn sm${playback.compareOriginal ? ' active' : ''}`}
          title="Segure para ver sem correção de cor"
          onPointerDown={() => playback.setCompareOriginal(true)}
          onPointerUp={() => playback.setCompareOriginal(false)}
          onPointerLeave={() => playback.setCompareOriginal(false)}
        >
          Segurar: original
        </button>
      </div>
    </div>
  );
}

// --- Áudio --------------------------------------------------------------------------

export function AudioSection({ clip }: { clip: Clip }) {
  const fx = clip.audio;
  const set = (patch: Partial<AudioFx>) => live(clip.id, (c) => ({ audio: { ...(c.audio ?? audioFxFromPreset('voice', null)), ...patch, preset: 'custom' } }));
  return (
    <div>
      <h4>Processamento de áudio</h4>
      <div className="field wide">
        <label>Preset</label>
        <select
          value={fx?.preset ?? 'none'}
          onChange={(e) =>
            commit(clip.id, 'Preset de áudio', () => ({
              audio: e.target.value === 'none' ? undefined : audioFxFromPreset(e.target.value, media.get(clip.assetId)?.levels ?? null),
            }))
          }
        >
          <option value="none">Sem processamento</option>
          {fx?.preset === 'custom' && <option value="custom">Personalizado</option>}
          {AUDIO_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      {fx && (
        <>
          <Range label="Ganho" value={fx.gainDb} min={-12} max={18} step={0.5} fmt={(v) => `${v > 0 ? '+' : ''}${v} dB`} onLive={(v) => set({ gainDb: v })} />
          <Range label="Corte graves" value={fx.highpass} min={0} max={200} step={5} fmt={(v) => (v ? `${v} Hz` : 'off')} onLive={(v) => set({ highpass: v })} />
          <Range label="Graves" value={fx.low} min={-12} max={12} step={0.5} fmt={(v) => `${v} dB`} onLive={(v) => set({ low: v })} />
          <Range label="Presença" value={fx.presence} min={-12} max={12} step={0.5} fmt={(v) => `${v} dB`} onLive={(v) => set({ presence: v })} />
          <Range label="Brilho" value={fx.air} min={-12} max={12} step={0.5} fmt={(v) => `${v} dB`} onLive={(v) => set({ air: v })} />
          <label className="check">
            <input type="checkbox" checked={fx.compressor} onChange={(e) => commit(clip.id, 'Compressor', (c) => ({ audio: { ...c.audio!, compressor: e.target.checked, preset: 'custom' } }))} />
            Compressor
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={fx.gateDb !== null}
              onChange={(e) => commit(clip.id, 'Redução de ruído', (c) => ({ audio: { ...c.audio!, gateDb: e.target.checked ? -55 : null, preset: 'custom' } }))}
            />
            Redução de ruído (gate){fx.gateDb !== null ? ` · ${fx.gateDb} dB` : ''}
          </label>
        </>
      )}
    </div>
  );
}

// --- Animação -----------------------------------------------------------------------

const PROP_LABEL: Record<AnimProp, string> = { scale: 'Escala', x: 'Posição X', y: 'Posição Y', rotation: 'Rotação', opacity: 'Opacidade' };
const EASES: { id: Ease; label: string }[] = [
  { id: 'easeInOut', label: 'Suave' },
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Acelera' },
  { id: 'easeOut', label: 'Desacelera' },
  { id: 'hold', label: 'Segura' },
];

export function AnimationSection({ clip }: { clip: Clip }) {
  usePlayback(); // os botões dependem da posição do playhead
  const fps = store.getState().project.settings.fps;
  const playheadSrc = toSource(clip, playback.time);
  const inside = playback.time >= clip.start && playback.time < clip.start + clip.duration;
  const current = transformAt(clip, playheadSrc);
  const all = ANIM_PROPS.flatMap((prop) => (clip.keyframes?.[prop] ?? []).map((k) => ({ prop, k })));
  all.sort((a, b) => a.k.t - b.k.t);

  return (
    <div>
      <h4><Diamond size={11} /> Keyframes</h4>
      <div className="kf-add">
        {ANIM_PROPS.map((prop) => (
          <button
            key={prop}
            className="btn sm outline"
            disabled={!inside}
            title={inside ? `Grava ${PROP_LABEL[prop]} = ${current[prop].toFixed(2)} no playhead` : 'Posicione o playhead sobre o clipe'}
            onClick={() => commit(clip.id, 'Adicionar keyframe', (c) => ({ keyframes: setKeyframe(c.keyframes, prop, { t: playheadSrc, v: current[prop], ease: 'easeInOut' }) }))}
          >
            + {PROP_LABEL[prop]}
          </button>
        ))}
      </div>
      {all.length === 0 ? (
        <p className="note">Sem keyframes. Mova o playhead, ajuste a transformação e grave um keyframe — ou use o Smart zoom da IA.</p>
      ) : (
        <div className="kf-list">
          {all.map(({ prop, k }, i) => (
            <div key={`${prop}-${k.t}-${i}`} className="kf-row">
              <button className="kf-time" title="Ir para o keyframe" onClick={() => playback.seek(toTimeline(clip, k.t))}>
                {formatTimecode(toTimeline(clip, k.t), fps).slice(3)}
              </button>
              <span className="kf-prop">{PROP_LABEL[prop]}</span>
              <input
                type="number"
                step={0.01}
                defaultValue={Math.round(k.v * 1000) / 1000}
                key={`${k.v}`}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v !== k.v) commit(clip.id, 'Editar keyframe', (c) => ({ keyframes: setKeyframe(c.keyframes, prop, { ...k, v }) }));
                }}
              />
              <select value={k.ease} onChange={(e) => commit(clip.id, 'Curva do keyframe', (c) => ({ keyframes: setKeyframe(c.keyframes, prop, { ...k, ease: e.target.value as Ease }) }))}>
                {EASES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <button className="btn icon sm danger" title="Apagar keyframe" onClick={() => commit(clip.id, 'Apagar keyframe', (c) => ({ keyframes: removeKeyframe(c.keyframes, prop, k.t) }))}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button className="btn sm outline" onClick={() => commit(clip.id, 'Limpar keyframes', () => ({ keyframes: undefined }))}>Limpar todos</button>
        </div>
      )}
    </div>
  );
}

// --- Gráfico (título animado) ------------------------------------------------------

export function TitleInspector({ clip }: { clip: Clip }) {
  const d = clip.title!;
  const set = (patch: Partial<TitleData>, label: string) => commit(clip.id, label, (c) => ({ title: { ...c.title!, ...patch } }));
  return (
    <div className="insp">
      <div>
        <h4>Gráfico</h4>
        <div className="field wide">
          <label>Template</label>
          <select
            value={d.template}
            onChange={(e) => {
              const t = e.target.value as TitleData['template'];
              const base = defaultTitle(t, d.text);
              set({ template: t, y: base.y, accent: base.accent, fontFamily: base.fontFamily }, 'Template do gráfico');
            }}
          >
            {TITLE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <FontSelect value={d.fontFamily} onChange={(fontFamily) => set({ fontFamily }, 'Fonte do gráfico')} />
        <div className="field wide">
          <label>Texto</label>
          <input className="text-input" key={`t${d.text}`} defaultValue={d.text} onBlur={(e) => e.target.value.trim() && e.target.value !== d.text && set({ text: e.target.value.trim() }, 'Texto do gráfico')} data-testid="title-text" />
        </div>
        <div className="field wide">
          <label>Subtítulo</label>
          <input className="text-input" key={`s${d.subtitle}`} defaultValue={d.subtitle} onBlur={(e) => e.target.value !== d.subtitle && set({ subtitle: e.target.value }, 'Subtítulo do gráfico')} />
        </div>
        <div className="field wide">
          <label>Cores</label>
          <span className="colors">
            <input type="color" value={d.color} title="Texto" onChange={(e) => set({ color: e.target.value }, 'Cor do gráfico')} />
            <input type="color" value={d.accent} title="Destaque" onChange={(e) => set({ accent: e.target.value }, 'Cor do gráfico')} />
          </span>
        </div>
        <Range label="Altura" value={d.y} min={0.05} max={0.95} step={0.005} fmt={(v) => `${Math.round(v * 100)}%`} onLive={(v) => live(clip.id, (c) => ({ title: { ...c.title!, y: v } }))} />
      </div>
      <AnimationSection clip={clip} />
    </div>
  );
}

