import type { CaptionStyle, Clip, Transform } from '../core/types';
import { DEFAULT_TRANSFORM, NO_CROP, SEQUENCE_PRESETS } from '../core/types';
import type { BlendMode } from '../core/types';
import { hasTimeLimit } from '../engine/timeline/operations';
import { formatBytes, formatTimecode } from '../core/time';
import { sourceEnd } from '../core/clipTime';
import { actions, store } from '../app/editor';
import { Cmd } from '../engine/commands/commands';
import { CAPTION_PRESETS, captionText, getPreset } from '../engine/captions/captions';
import { useEditor } from './hooks';
import { FontSelect } from './FontSelect';
import { AnimationSection, AudioSection, ColorSection, TitleInspector } from './InspectorFx';
import { TransitionInspector } from './TransitionsPanel';

export function Inspector() {
  const { project, selection } = useEditor();
  const clip = selection.length === 1 ? project.clips[selection[0]] : undefined;
  const title = clip ? (clip.caption ? 'Legenda' : clip.title ? 'Gráfico' : 'Clipe') : selection.length > 1 ? `${selection.length} clipes` : 'Sequência';

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
      </div>
      <div className="panel-body">
        {clip?.caption ? (
          <CaptionInspector clip={clip} />
        ) : clip?.title ? (
          <TitleInspector clip={clip} />
        ) : clip ? (
          <ClipInspector clip={clip} />
        ) : (
          <SequenceInspector />
        )}
      </div>
    </section>
  );
}

function CaptionInspector({ clip }: { clip: Clip }) {
  const cap = clip.caption!;
  const s = cap.style;
  const fps = store.getState().project.settings.fps;

  const setStyle = (patch: Partial<CaptionStyle>, label = 'Estilo da legenda') => {
    const c = store.getState().project.clips[clip.id];
    if (c?.caption) store.execute(Cmd.setCaption(clip.id, { ...c.caption, style: { ...c.caption.style, ...patch } }, label));
  };

  const setText = (text: string) => {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || text.trim() === captionText(clip)) return;
    const words = cap.words;
    let next;
    if (tokens.length === words.length) {
      next = words.map((w, i) => ({ ...w, text: tokens[i] }));
    } else {
      // Quantidade mudou: redistribui o tempo do bloco proporcionalmente ao tamanho das palavras.
      const a = words[0]?.start ?? clip.sourceIn;
      const b = words.at(-1)?.end ?? sourceEnd(clip);
      const total = tokens.reduce((acc, t) => acc + t.length + 1, 0);
      let t = a;
      next = tokens.map((tk) => {
        const d = ((tk.length + 1) / total) * (b - a);
        const w = { text: tk, start: t, end: t + d };
        t += d;
        return w;
      });
    }
    store.execute(Cmd.setCaption(clip.id, { ...cap, words: next }, 'Editar legenda'));
  };

  return (
    <div className="insp">
      <div>
        <h4>Texto</h4>
        <textarea
          key={clip.id + captionText(clip)}
          className="text-input area"
          defaultValue={captionText(clip)}
          onBlur={(e) => setText(e.target.value)}
          data-testid="caption-text"
        />
        <div className="muted">{formatTimecode(clip.start, fps)} · {clip.duration.toFixed(2)} s · {cap.words.length} palavras</div>
      </div>
      <div>
        <h4>Estilo</h4>
        <div className="field wide">
          <label>Preset</label>
          <select value={s.preset} onChange={(e) => setStyle({ ...getPreset(e.target.value).style }, 'Preset da legenda')}>
            {CAPTION_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <FontSelect value={s.fontFamily} onChange={(fontFamily) => setStyle({ fontFamily }, 'Fonte da legenda')} />
        <div className="field wide">
          <label>Animação</label>
          <select value={s.mode} onChange={(e) => setStyle({ mode: e.target.value as CaptionStyle['mode'] })}>
            <option value="block">Bloco inteiro</option>
            <option value="karaoke">Destaca a palavra falada</option>
            <option value="word">Uma palavra por vez</option>
          </select>
        </div>
        <div className="field wide">
          <label>Cores</label>
          <span className="colors">
            <input type="color" value={s.color} title="Texto" onChange={(e) => setStyle({ color: e.target.value })} />
            <input type="color" value={s.highlightColor} title="Destaque" onChange={(e) => setStyle({ highlightColor: e.target.value })} />
            <input type="color" value={s.strokeColor} title="Contorno" onChange={(e) => setStyle({ strokeColor: e.target.value })} />
          </span>
        </div>
        <Slider label="Tamanho" value={s.fontSize * 1000} min={15} max={160} step={1} unit="" onChange={(v) => setStyleLive({ fontSize: v / 1000 })} />
        <Slider label="Contorno" value={s.strokeWidth * 100} min={0} max={30} step={1} unit="%" onChange={(v) => setStyleLive({ strokeWidth: v / 100 })} />
        <Slider label="Altura" value={s.y * 100} min={5} max={95} step={0.5} unit="%" onChange={(v) => setStyleLive({ y: v / 100 })} />
        <label className="check">
          <input type="checkbox" checked={s.uppercase} onChange={(e) => setStyle({ uppercase: e.target.checked })} /> Maiúsculas
        </label>
        <label className="check">
          <input type="checkbox" checked={s.pop} onChange={(e) => setStyle({ pop: e.target.checked })} /> Pop na palavra atual
        </label>
        <label className="check">
          <input type="checkbox" checked={!!s.background} onChange={(e) => setStyle({ background: e.target.checked ? 'rgba(0,0,0,0.6)' : null })} /> Fundo
        </label>
        <button className="btn sm outline" style={{ marginTop: 8 }} onClick={() => actions.styleAllCaptions(s)}>
          Aplicar este estilo a todas as legendas
        </button>
      </div>
    </div>
  );

  function setStyleLive(patch: Partial<CaptionStyle>) {
    const c = store.getState().project.clips[clip.id];
    if (c?.caption) store.preview(Cmd.setCaption(clip.id, { ...c.caption, style: { ...c.caption.style, ...patch } }, 'Estilo da legenda'));
  }
}

function SequenceInspector() {
  const { project } = useEditor();
  const { width, height, fps } = project.settings;
  const preset = SEQUENCE_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? 'custom';
  return (
    <div className="insp">
      <div>
        <h4>Formato</h4>
        <div className="field wide">
          <label>Quadro</label>
          <select
            value={preset}
            onChange={(e) => {
              const p = SEQUENCE_PRESETS.find((x) => x.id === e.target.value);
              if (p) actions.setSequenceSize(p.width, p.height);
            }}
          >
            {SEQUENCE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
            {preset === 'custom' && <option value="custom">{width}×{height}</option>}
          </select>
        </div>
        <div className="field wide">
          <label>FPS</label>
          <select value={fps} onChange={(e) => actions.setSequenceFps(Number(e.target.value))}>
            {[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Selecione um clipe na timeline para ajustar volume, opacidade, escala e posição. Trocar o formato não corta o
        material: cada clipe é encaixado no novo quadro.
      </p>
    </div>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const BLENDS: [BlendMode, string][] = [
  ['normal', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Tela'], ['overlay', 'Sobrepor'], ['soft-light', 'Luz suave'],
  ['hard-light', 'Luz forte'], ['darken', 'Escurecer'], ['lighten', 'Clarear'], ['difference', 'Diferença'],
];

function ClipInspector({ clip }: { clip: Clip }) {
  const { project } = useEditor();
  const asset = project.assets[clip.assetId];
  const fps = project.settings.fps;
  const visual = asset?.kind !== 'audio';

  const tr = clip.transform;
  const crop = clip.crop ?? NO_CROP;
  const setTransform = (patch: Partial<Transform>) => store.preview(Cmd.setTransform({ [clip.id]: patch }));
  const setVolume = (volume: number) => store.preview(Cmd.setVolume({ [clip.id]: volume }));

  return (
    <div className="insp">
      <div>
        <h4>Origem</h4>
        <dl className="kv">
          <dt>Arquivo</dt>
          <dd>{asset?.name ?? '—'}</dd>
          {asset && hasTimeLimit(asset) && (
            <>
              <dt>Codec</dt>
              <dd>{[asset.videoCodec, asset.audioCodec].filter(Boolean).join(' / ') || '—'}</dd>
            </>
          )}
          {asset && (
            <>
              <dt>Tamanho</dt>
              <dd>{formatBytes(asset.size)}</dd>
            </>
          )}
        </dl>
      </div>

      <div>
        <h4>Tempo</h4>
        <div className="field"><label>Início</label><span className="ro">{formatTimecode(clip.start, fps)}</span></div>
        <div className="field"><label>Duração</label><span className="ro">{formatTimecode(clip.duration, fps)}</span></div>
        {asset && hasTimeLimit(asset) && (
          <div className="field"><label>Entrada</label><span className="ro">{formatTimecode(clip.sourceIn, fps)}</span></div>
        )}
      </div>

      {asset && hasTimeLimit(asset) && (
        <div>
          <h4>Velocidade</h4>
          <div className="speed-row">
            {SPEEDS.map((v) => (
              <button
                key={v}
                className={`btn sm${Math.abs(clip.speed - v) < 1e-6 ? ' active' : ''}`}
                onClick={() => store.execute(Cmd.setSpeed([clip.id], v))}
              >
                {v}x
              </button>
            ))}
          </div>
          <p className="note">Mantém o tom da voz (preview e export). Os clipes seguintes da trilha acompanham.</p>
        </div>
      )}

      {asset?.hasAudio && (
        <div>
          <h4>Áudio</h4>
          <Slider label="Volume" value={clip.volume * 100} min={0} max={100} step={1} unit="%" onChange={(v) => setVolume(v / 100)} />
          <Slider label="Fade in" value={clip.fadeIn} min={0} max={Math.min(10, clip.duration / 2)} step={0.05} unit="s" onChange={(v) => store.preview(Cmd.setFades({ [clip.id]: { fadeIn: v } }))} />
          <Slider label="Fade out" value={clip.fadeOut} min={0} max={Math.min(10, clip.duration / 2)} step={0.05} unit="s" onChange={(v) => store.preview(Cmd.setFades({ [clip.id]: { fadeOut: v } }))} />
          <label className="check">
            <input type="checkbox" checked={!!clip.muted} onChange={(e) => store.execute(Cmd.setMute({ [clip.id]: e.target.checked }))} data-testid="clip-mute" />
            Mudo (só este clipe)
          </label>
        </div>
      )}

      {visual && (
        <div>
          <h4>Transformação</h4>
          <Slider label="Posição X" value={tr.x * 100} min={-100} max={100} step={0.5} unit="%" onChange={(v) => setTransform({ x: v / 100 })} />
          <Slider label="Posição Y" value={tr.y * 100} min={-100} max={100} step={0.5} unit="%" onChange={(v) => setTransform({ y: v / 100 })} />
          <Slider label="Escala" value={tr.scale * 100} min={10} max={400} step={1} unit="%" onChange={(v) => setTransform({ scale: v / 100 })} />
          <Slider label="Escala X" value={tr.scaleX * 100} min={10} max={400} step={1} unit="%" onChange={(v) => setTransform({ scaleX: v / 100 })} />
          <Slider label="Escala Y" value={tr.scaleY * 100} min={10} max={400} step={1} unit="%" onChange={(v) => setTransform({ scaleY: v / 100 })} />
          <Slider label="Rotação" value={tr.rotation} min={-180} max={180} step={0.5} unit="°" onChange={(v) => setTransform({ rotation: v })} />
          <Slider label="Opacidade" value={tr.opacity * 100} min={0} max={100} step={1} unit="%" onChange={(v) => setTransform({ opacity: v / 100 })} />
          <Slider label="Âncora X" value={tr.anchorX * 100} min={0} max={100} step={1} unit="%" onChange={(v) => setTransform({ anchorX: v / 100 })} />
          <Slider label="Âncora Y" value={tr.anchorY * 100} min={0} max={100} step={1} unit="%" onChange={(v) => setTransform({ anchorY: v / 100 })} />
          <div className="field wide">
            <label>Mesclagem</label>
            <select
              value={clip.blendMode ?? 'normal'}
              onChange={(e) => store.execute(Cmd.setBlend({ [clip.id]: e.target.value === 'normal' ? undefined : (e.target.value as BlendMode) }))}
            >
              {BLENDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <button
            className="btn sm outline"
            style={{ marginTop: 6 }}
            onClick={() => store.execute(Cmd.setTransform({ [clip.id]: { ...DEFAULT_TRANSFORM } }, 'Redefinir transformação'))}
          >
            Redefinir
          </button>
        </div>
      )}

      {visual && (
        <div>
          <h4>Crop</h4>
          {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
            <Slider
              key={side}
              label={{ left: 'Esquerda', right: 'Direita', top: 'Topo', bottom: 'Base' }[side]}
              value={crop[side] * 100}
              min={0}
              max={90}
              step={0.5}
              unit="%"
              onChange={(v) => store.preview(Cmd.setCrop({ [clip.id]: { ...(store.getState().project.clips[clip.id]?.crop ?? NO_CROP), [side]: v / 100 } }))}
            />
          ))}
          {clip.crop && (
            <button className="btn sm outline" onClick={() => store.execute(Cmd.setCrop({ [clip.id]: undefined }))}>Remover crop</button>
          )}
        </div>
      )}
      {visual && <TransitionInspector clip={clip} />}
      {visual && <AnimationSection clip={clip} />}
      {visual && <ColorSection clip={clip} />}
      {asset?.hasAudio && <AudioSection clip={clip} />}
    </div>
  );
}

/** Slider + campo numérico. Arrastar o slider vira um único passo de undo. */
function Slider(props: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  const round = (v: number) => Math.round(v * 100) / 100;
  const commitNumber = (raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || round(v) === round(props.value)) return;
    store.beginGesture();
    props.onChange(Math.min(props.max, Math.max(props.min, v)));
    store.endGesture();
  };
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
          props.onChange(Number(e.target.value));
        }}
      />
      <input
        key={round(props.value)}
        type="number"
        defaultValue={round(props.value)}
        step={props.step}
        title={props.unit}
        onBlur={(e) => commitNumber(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commitNumber((e.target as HTMLInputElement).value)}
      />
    </div>
  );
}
