import { useState } from 'react';
import type { CaptionAnim, CaptionStyle, CaptionWordAnim, Clip, Transform, TranscriptWord } from '../core/types';
import { DEFAULT_TRANSFORM, NO_CROP, SEQUENCE_PRESETS } from '../core/types';
import type { BlendMode } from '../core/types';
import { hasTimeLimit } from '../engine/timeline/operations';
import { formatBytes, formatTimecode } from '../core/time';
import { sourceEnd } from '../core/clipTime';
import { actions, store } from '../app/editor';
import { Cmd } from '../engine/commands/commands';
import { autoEmphasis, captionText, getPreset } from '../engine/captions/captions';
import { wordAnimOf } from '../engine/captions/renderCaption';
import { captionStylesStore } from '../app/captionStyles';
import { notify } from '../app/notify';
import { CaptionGallery } from './CaptionGallery';
import { useEditor } from './hooks';
import { FontSelect } from './FontSelect';
import { AnimationSection, AudioSection, ColorSection, TitleInspector } from './InspectorFx';
import { ElementInspector, MaskSection } from './ElementInspector';
import { TransitionInspector } from './TransitionsPanel';

export function Inspector() {
  const { project, selection } = useEditor();
  const clip = selection.length === 1 ? project.clips[selection[0]] : undefined;
  const title = clip ? (clip.caption ? 'Legenda' : clip.title ? 'Gráfico' : clip.element ? 'Elemento' : 'Clipe') : selection.length > 1 ? `${selection.length} clipes` : 'Sequência';

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
        ) : clip?.element ? (
          <ElementInspector key={clip.id} clip={clip} />
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
  const [gallery, setGallery] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);

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

  const setWords = (words: TranscriptWord[], label: string) => {
    const c = store.getState().project.clips[clip.id];
    if (c?.caption) store.execute(Cmd.setCaption(clip.id, { ...c.caption, words }, label));
  };
  const visibleWords = cap.words.map((w, i) => ({ w, i })).filter(({ w }) => w.end > clip.sourceIn && w.start < sourceEnd(clip));
  const anim = wordAnimOf(s);
  const bg = splitColor(s.background ?? 'rgba(0,0,0,0.6)');
  const shadow = splitColor(s.shadowColor ?? 'rgba(0,0,0,0.65)');

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
        <div className="row-between" style={{ marginTop: 6 }}>
          <span className="muted">Destaque: clique nas palavras</span>
          <button className="btn sm" onClick={() => setWords(autoEmphasis(cap.words), 'Destaque automático')} title="Marca números e palavras de ênfase">Automático</button>
        </div>
        <div className="cap-words">
          {visibleWords.map(({ w, i }) => (
            <button
              key={i}
              className={`cap-word${w.emphasis ? ' on' : ''}`}
              style={w.emphasis ? { color: s.emphasisColor ?? s.highlightColor } : undefined}
              onClick={() => setWords(cap.words.map((x, k) => (k === i ? { ...x, emphasis: !x.emphasis || undefined } : x)), 'Destacar palavra')}
              data-testid={`cap-word-${i}`}
            >
              {w.text}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="row-between">
          <h4 style={{ margin: 0 }}>Estilo · {getPreset(s.preset).id === s.preset ? getPreset(s.preset).label : 'personalizado'}</h4>
          <button className="btn sm outline" onClick={() => setGallery((g) => !g)} data-testid="cap-gallery-toggle">
            {gallery ? 'Fechar' : 'Banco de estilos'}
          </button>
        </div>
        {gallery && (
          <CaptionGallery
            value={s.preset}
            onPick={(p) => {
              const c = store.getState().project.clips[clip.id];
              if (!c?.caption) return;
              // estilos com cor de ênfase destacam as palavras-chave se nada estiver marcado
              const words = p.style.emphasisColor && !c.caption.words.some((w) => w.emphasis) ? autoEmphasis(c.caption.words) : c.caption.words;
              store.execute(Cmd.setCaption(clip.id, { words, style: { ...p.style } }, `Estilo ${p.label}`));
            }}
          />
        )}
      </div>

      <details className="insp-group" open>
        <summary>Fonte</summary>
        <FontSelect value={s.fontFamily} onChange={(fontFamily) => setStyle({ fontFamily }, 'Fonte da legenda')} />
        <div className="field wide">
          <label>Peso</label>
          <select value={s.fontWeight} onChange={(e) => setStyle({ fontWeight: Number(e.target.value) }, 'Peso da fonte')}>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>{WEIGHT_LABEL[w]} ({w})</option>
            ))}
          </select>
        </div>
        <Slider label="Tamanho" value={s.fontSize * 1000} min={15} max={160} step={1} unit="" onChange={(v) => setStyleLive({ fontSize: v / 1000 })} />
        <Slider label="Espaço letras" value={(s.letterSpacing ?? 0) * 100} min={-5} max={30} step={1} unit="%" onChange={(v) => setStyleLive({ letterSpacing: v / 100 })} />
        <label className="check">
          <input type="checkbox" checked={s.uppercase} onChange={(e) => setStyle({ uppercase: e.target.checked })} /> Maiúsculas
        </label>
      </details>

      <details className="insp-group" open>
        <summary>Cores</summary>
        <div className="field wide">
          <label>Texto · fala</label>
          <span className="colors">
            <input type="color" value={s.color} title="Texto" onChange={(e) => setStyle({ color: e.target.value })} />
            <input type="color" value={s.highlightColor} title="Palavra falada" onChange={(e) => setStyle({ highlightColor: e.target.value })} />
            <input type="color" value={s.emphasisColor ?? s.highlightColor} title="Palavras em destaque" onChange={(e) => setStyle({ emphasisColor: e.target.value })} />
          </span>
        </div>
        <div className="field wide">
          <label>Contorno</label>
          <span className="colors">
            <input type="color" value={s.strokeColor} title="Contorno" onChange={(e) => setStyle({ strokeColor: e.target.value })} />
          </span>
        </div>
        <Slider label="Espessura" value={s.strokeWidth * 100} min={0} max={30} step={1} unit="%" onChange={(v) => setStyleLive({ strokeWidth: v / 100 })} />
        <label className="check">
          <input type="checkbox" checked={!!s.highlightBg} onChange={(e) => setStyle({ highlightBg: e.target.checked ? '#7c3aed' : null })} /> Caixa atrás da palavra falada
          {s.highlightBg && <input type="color" className="inline-color" value={s.highlightBg} onChange={(e) => setStyle({ highlightBg: e.target.value })} />}
        </label>
      </details>

      <details className="insp-group">
        <summary>Sombra e brilho</summary>
        <label className="check">
          <input type="checkbox" checked={s.shadow} onChange={(e) => setStyle({ shadow: e.target.checked })} /> Sombra
          {s.shadow && <input type="color" className="inline-color" value={shadow.hex} onChange={(e) => setStyle({ shadowColor: joinColor(e.target.value, shadow.a) })} />}
        </label>
        {s.shadow && (
          <>
            <Slider label="Opacidade" value={Math.round(shadow.a * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setStyleLive({ shadowColor: joinColor(shadow.hex, v / 100) })} />
            <Slider label="Desfoque" value={Math.round((s.shadowBlur ?? 0.12) * 100)} min={0} max={80} step={1} unit="%" onChange={(v) => setStyleLive({ shadowBlur: v / 100 })} />
            <Slider label="Distância" value={Math.round((s.shadowOffset ?? 0.05) * 100)} min={0} max={30} step={1} unit="%" onChange={(v) => setStyleLive({ shadowOffset: v / 100 })} />
          </>
        )}
      </details>

      <details className="insp-group">
        <summary>Fundo</summary>
        <label className="check">
          <input type="checkbox" checked={!!s.background} onChange={(e) => setStyle({ background: e.target.checked ? 'rgba(0,0,0,0.6)' : null })} /> Fundo atrás do bloco
          {s.background && <input type="color" className="inline-color" value={bg.hex} onChange={(e) => setStyle({ background: joinColor(e.target.value, bg.a) })} />}
        </label>
        {s.background && (
          <>
            <Slider label="Opacidade" value={Math.round(bg.a * 100)} min={5} max={100} step={1} unit="%" onChange={(v) => setStyleLive({ background: joinColor(bg.hex, v / 100) })} />
            <Slider label="Folga" value={Math.round((s.backgroundPadding ?? 0.45) * 100)} min={10} max={120} step={1} unit="%" onChange={(v) => setStyleLive({ backgroundPadding: v / 100 })} />
            <Slider label="Cantos" value={Math.round((s.backgroundRadius ?? 0.25) * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setStyleLive({ backgroundRadius: v / 100 })} />
          </>
        )}
      </details>

      <details className="insp-group" open>
        <summary>Animação</summary>
        <div className="field wide">
          <label>Modo</label>
          <select value={s.mode} onChange={(e) => setStyle({ mode: e.target.value as CaptionStyle['mode'] }, 'Modo da legenda')} data-testid="cap-mode">
            <option value="block">Bloco inteiro</option>
            <option value="karaoke">Destaca a palavra falada</option>
            <option value="word">Uma palavra por vez</option>
            <option value="reveal">Aparece conforme a fala</option>
          </select>
        </div>
        <div className="field wide">
          <label>Palavra</label>
          <select value={anim} onChange={(e) => setStyle({ wordAnim: e.target.value as CaptionWordAnim, pop: e.target.value === 'pop' }, 'Animação da palavra')} data-testid="cap-word-anim">
            {Object.entries(WORD_ANIM_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="field wide">
          <label>Entrada</label>
          <select value={s.animIn ?? 'none'} onChange={(e) => setStyle({ animIn: e.target.value as CaptionAnim }, 'Entrada da legenda')} data-testid="cap-anim-in">
            {Object.entries(BLOCK_ANIM_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="field wide">
          <label>Saída</label>
          <select value={s.animOut ?? 'none'} onChange={(e) => setStyle({ animOut: e.target.value as CaptionAnim }, 'Saída da legenda')}>
            {Object.entries(BLOCK_ANIM_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        {(s.animIn ?? 'none') !== 'none' || (s.animOut ?? 'none') !== 'none' ? (
          <Slider label="Duração" value={Math.round((s.animDuration ?? 0.18) * 100) / 100} min={0.05} max={0.8} step={0.01} unit="s" onChange={(v) => setStyleLive({ animDuration: v })} />
        ) : null}
      </details>

      <details className="insp-group">
        <summary>Posição e linhas</summary>
        <Slider label="Altura" value={s.y * 100} min={5} max={95} step={0.5} unit="%" onChange={(v) => setStyleLive({ y: v / 100 })} />
        <Slider label="Largura máx." value={Math.round((s.maxWidth ?? 0.86) * 100)} min={30} max={98} step={1} unit="%" onChange={(v) => setStyleLive({ maxWidth: v / 100 })} />
        <Slider label="Entrelinha" value={Math.round((s.lineHeight ?? 1.18) * 100) / 100} min={0.8} max={2} step={0.02} unit="×" onChange={(v) => setStyleLive({ lineHeight: v })} />
      </details>

      <div className="cap-actions">
        <button className="btn sm outline" onClick={() => actions.styleAllCaptions(s)} data-testid="cap-apply-all">
          Aplicar este estilo a todas as legendas
        </button>
        {naming === null ? (
          <button className="btn sm" onClick={() => setNaming('')} data-testid="cap-save-style">Salvar como meu estilo</button>
        ) : (
          <form
            className="cap-save"
            onSubmit={(e) => {
              e.preventDefault();
              const id = captionStylesStore.save(naming, s);
              setStyle({ preset: id }, 'Salvar estilo');
              setNaming(null);
              notify(`Estilo "${naming.trim() || 'Meu estilo'}" salvo em Meus estilos.`, 'success');
            }}
          >
            <input className="text-input" autoFocus placeholder="Nome do estilo" value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} data-testid="cap-style-name" />
            <button className="btn sm primary" type="submit">Salvar</button>
          </form>
        )}
      </div>
    </div>
  );

  function setStyleLive(patch: Partial<CaptionStyle>) {
    const c = store.getState().project.clips[clip.id];
    if (c?.caption) store.preview(Cmd.setCaption(clip.id, { ...c.caption, style: { ...c.caption.style, ...patch } }, 'Estilo da legenda'));
  }
}

const WEIGHT_LABEL: Record<number, string> = { 300: 'Fina', 400: 'Normal', 500: 'Média', 600: 'Semi-negrito', 700: 'Negrito', 800: 'Extra-negrito', 900: 'Black' };
const WORD_ANIM_LABEL: Record<CaptionWordAnim, string> = { none: 'Nenhuma', pop: 'Pop', bounce: 'Quique', rise: 'Sobe', fade: 'Surge', shake: 'Tremida' };
const BLOCK_ANIM_LABEL: Record<CaptionAnim, string> = { none: 'Nenhuma', fade: 'Fade', pop: 'Pop', zoom: 'Zoom', slideUp: 'Sobe', slideDown: 'Desce', blur: 'Desfoque' };

/** "#rrggbb" ou "rgba(r,g,b,a)" → cor + opacidade (para os controles). */
function splitColor(css: string): { hex: string; a: number } {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(css);
  if (m) return { hex: `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`, a: m[4] === undefined ? 1 : Number(m[4]) };
  if (/^#[0-9a-f]{6}$/i.test(css)) return { hex: css, a: 1 };
  return { hex: '#000000', a: 1 };
}
const joinColor = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 100) / 100})`;
};

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
      {visual && <MaskSection clip={clip} />}
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
