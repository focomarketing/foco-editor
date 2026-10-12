// Inspector de elementos (grupo de camadas) e seção de máscara dos clipes de vídeo/imagem.
// Cada ajuste é um passo de undo; sliders viram um passo só por arraste.

import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import type { Clip, ClipMask, ElementAnim, ElementLayer, ElementLoop, ElementShape, ParticlePreset } from '../core/types';
import { newId } from '../core/time';
import { layer } from '../engine/motion/elementLibrary';
import { PARTICLE_PRESETS } from '../engine/motion/elements';
import { AnimationSection, Range } from './InspectorFx';
import { commit, live } from './clipEdit';
import { FontSelect } from './FontSelect';

const SHAPE_LABEL: Record<ElementShape, string> = {
  rect: 'Retângulo', ellipse: 'Elipse', line: 'Linha', arrow: 'Seta', star: 'Estrela', polygon: 'Polígono', text: 'Texto', particles: 'Partículas',
};
const ANIM_LABEL: Record<ElementAnim, string> = {
  none: 'Nenhuma', fade: 'Fade', pop: 'Pop', slideLeft: 'Vem da direita', slideRight: 'Vem da esquerda', slideUp: 'Sobe', slideDown: 'Desce', draw: 'Desenhar traço', wipe: 'Revelar', spin: 'Girar',
};
const LOOP_LABEL: Record<ElementLoop, string> = { none: 'Nenhum', pulse: 'Pulsar', rotate: 'Girar', float: 'Flutuar', blink: 'Piscar', wiggle: 'Balançar' };

/** Nova camada de cada tipo, no centro, já com uma entrada suave. */
function newLayer(kind: ElementShape): ElementLayer {
  const base = { animIn: 'fade' as ElementAnim, animDuration: 0.35 };
  const byKind: Record<ElementShape, Partial<ElementLayer>> = {
    rect: { w: 0.3, h: 0.16, radius: 0.12, fill: '#4f8cff' },
    ellipse: { w: 0.2, h: 0.2, fill: '#ffd400' },
    line: { w: 0.3, h: 0.02, fill: '#ffffff', strokeWidth: 0.01, animIn: 'draw' },
    arrow: { w: 0.26, h: 0.08, fill: '#ffffff', strokeWidth: 0.012, animIn: 'draw' },
    star: { w: 0.18, h: 0.18, fill: '#ffd400', points: 5, innerRatio: 0.45, animIn: 'pop' },
    polygon: { w: 0.2, h: 0.2, fill: '#22c55e', points: 6 },
    text: { w: 0.5, h: 0.07, text: 'Seu texto', fill: '#ffffff', fontWeight: 800, shadow: true },
    particles: { w: 1, h: 1, fill: null, particles: { preset: 'confetti', count: 60, colors: [...PARTICLE_PRESETS.confetti.colors], speed: 1, size: 1, seed: Math.floor(Math.random() * 1000) } },
  };
  return { ...layer(kind, { ...base, ...byKind[kind] }), id: newId('l') };
}

export function ElementInspector({ clip }: { clip: Clip }) {
  const el = clip.element!;
  const [selId, setSelId] = useState<string | null>(el.layers[0]?.id ?? null);
  const sel = el.layers.find((l) => l.id === selId) ?? el.layers[0];
  const [adding, setAdding] = useState(false);

  const setLayers = (fn: (ls: ElementLayer[]) => ElementLayer[], label: string) => commit(clip.id, label, (c) => ({ element: { ...c.element!, layers: fn(c.element!.layers) } }));
  const patchLayer = (id: string, patch: Partial<ElementLayer>, label: string) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)), label);
  const liveLayer = (id: string, patch: Partial<ElementLayer>) => live(clip.id, (c) => ({ element: { ...c.element!, layers: c.element!.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) } }));
  const move = (id: string, dir: -1 | 1) =>
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }, 'Ordem das camadas');

  return (
    <div className="insp">
      <div>
        <h4>Elemento</h4>
        <div className="field wide">
          <label>Nome</label>
          <input className="text-input" key={el.name} defaultValue={el.name} onBlur={(e) => e.target.value.trim() && e.target.value !== el.name && commit(clip.id, 'Nome do elemento', (c) => ({ element: { ...c.element!, name: e.target.value.trim() } }))} />
        </div>
      </div>

      <div>
        <div className="row-between">
          <h4 style={{ margin: 0 }}>Camadas ({el.layers.length})</h4>
          <button className="btn sm outline" onClick={() => setAdding((a) => !a)} data-testid="el-add-layer"><Plus size={12} /> Camada</button>
        </div>
        {adding && (
          <div className="el-add">
            {(Object.keys(SHAPE_LABEL) as ElementShape[]).map((k) => (
              <button
                key={k}
                className="font-chip"
                onClick={() => {
                  const l = newLayer(k);
                  setLayers((ls) => [...ls, l], `Adicionar ${SHAPE_LABEL[k].toLowerCase()}`);
                  setSelId(l.id);
                  setAdding(false);
                }}
                data-testid={`el-add-${k}`}
              >
                {SHAPE_LABEL[k]}
              </button>
            ))}
          </div>
        )}
        <div className="el-layers">
          {/* a última camada fica por cima: lista de cima para baixo */}
          {[...el.layers].reverse().map((l) => (
            <div key={l.id} className={`el-layer${l.id === sel?.id ? ' on' : ''}`} onClick={() => setSelId(l.id)} data-testid={`el-layer-${l.kind}`}>
              <span className="el-swatch" style={{ background: l.kind === 'particles' ? 'conic-gradient(#ff4d6d,#ffd400,#3dd5f3,#ff4d6d)' : (l.fill ?? l.stroke ?? 'transparent') }} />
              <span className="el-name">{l.name ?? (l.kind === 'text' ? `“${l.text}”` : l.kind === 'particles' ? PARTICLE_PRESETS[l.particles!.preset].label : SHAPE_LABEL[l.kind])}</span>
              <span className="el-tools" onClick={(e) => e.stopPropagation()}>
                <button className="btn icon sm" title="Subir (fica por cima)" onClick={() => move(l.id, 1)}><ArrowUp size={11} /></button>
                <button className="btn icon sm" title="Descer" onClick={() => move(l.id, -1)}><ArrowDown size={11} /></button>
                <button
                  className="btn icon sm"
                  title="Duplicar"
                  onClick={() => {
                    const copy = { ...structuredClone(l), id: newId('l'), x: Math.min(0.95, l.x + 0.03), y: Math.min(0.95, l.y + 0.03) };
                    setLayers((ls) => [...ls, copy], 'Duplicar camada');
                    setSelId(copy.id);
                  }}
                >
                  <Copy size={11} />
                </button>
                <button className="btn icon sm danger" title="Apagar camada" disabled={el.layers.length < 2} onClick={() => setLayers((ls) => ls.filter((x) => x.id !== l.id), 'Apagar camada')}>
                  <Trash2 size={11} />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      {sel && <LayerEditor key={sel.id} l={sel} patch={(p, label) => patchLayer(sel.id, p, label)} livePatch={(p) => liveLayer(sel.id, p)} />}

      <AnimationSection clip={clip} />
      <p className="note">Os keyframes acima movem o elemento inteiro (todas as camadas juntas).</p>
    </div>
  );
}

function LayerEditor({ l, patch, livePatch }: { l: ElementLayer; patch: (p: Partial<ElementLayer>, label: string) => void; livePatch: (p: Partial<ElementLayer>) => void }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const isShape = l.kind !== 'text' && l.kind !== 'particles';
  const open = l.kind === 'line' || l.kind === 'arrow';
  return (
    <>
      <details className="insp-group" open>
        <summary>{SHAPE_LABEL[l.kind]}</summary>
        {l.kind === 'text' && (
          <>
            <div className="field wide">
              <label>Texto</label>
              <input className="text-input" key={l.text} defaultValue={l.text} onBlur={(e) => e.target.value !== l.text && patch({ text: e.target.value }, 'Texto da camada')} data-testid="el-text" />
            </div>
            <FontSelect value={l.fontFamily ?? '"Segoe UI", Arial, sans-serif'} onChange={(fontFamily) => patch({ fontFamily }, 'Fonte da camada')} />
            <div className="field wide">
              <label>Peso</label>
              <select value={l.fontWeight ?? 800} onChange={(e) => patch({ fontWeight: Number(e.target.value) }, 'Peso da fonte')}>
                {[400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          </>
        )}
        {l.kind === 'particles' && l.particles && (
          <>
            <div className="field wide">
              <label>Tipo</label>
              <select
                value={l.particles.preset}
                onChange={(e) => {
                  const preset = e.target.value as ParticlePreset;
                  patch({ particles: { ...l.particles!, preset, colors: [...PARTICLE_PRESETS[preset].colors] } }, 'Tipo de partícula');
                }}
                data-testid="el-particle-preset"
              >
                {(Object.keys(PARTICLE_PRESETS) as ParticlePreset[]).map((k) => <option key={k} value={k}>{PARTICLE_PRESETS[k].label}</option>)}
              </select>
            </div>
            <div className="field wide">
              <label>Cores</label>
              <span className="colors">
                {l.particles.colors.map((c, i) => (
                  <input key={i} type="color" value={c} onChange={(e) => patch({ particles: { ...l.particles!, colors: l.particles!.colors.map((x, k) => (k === i ? e.target.value : x)) } }, 'Cor das partículas')} />
                ))}
              </span>
            </div>
            <Range label="Quantidade" value={l.particles.count} min={5} max={300} step={1} fmt={(v) => String(v)} onLive={(v) => livePatch({ particles: { ...l.particles!, count: v } })} />
            <Range label="Velocidade" value={l.particles.speed} min={0.2} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onLive={(v) => livePatch({ particles: { ...l.particles!, speed: v } })} />
            <Range label="Tamanho" value={l.particles.size} min={0.3} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onLive={(v) => livePatch({ particles: { ...l.particles!, size: v } })} />
            <button className="btn sm outline" onClick={() => patch({ particles: { ...l.particles!, seed: Math.floor(Math.random() * 100000) } }, 'Embaralhar partículas')}>Embaralhar</button>
          </>
        )}
        {l.kind !== 'particles' && (
          <div className="field wide">
            <label>{open ? 'Cor' : 'Preench.'}</label>
            <span className="colors">
              <label className="check"><input type="checkbox" checked={!!l.fill} onChange={(e) => patch({ fill: e.target.checked ? '#ffffff' : null }, 'Preenchimento')} /></label>
              {l.fill && <input type="color" value={hex(l.fill)} onChange={(e) => patch({ fill: e.target.value }, 'Cor da camada')} data-testid="el-fill" />}
              {l.fill && !open && (
                <>
                  <label className="check" title="Gradiente"><input type="checkbox" checked={!!l.fill2} onChange={(e) => patch({ fill2: e.target.checked ? '#ff9500' : null }, 'Gradiente')} />grad.</label>
                  {l.fill2 && <input type="color" value={hex(l.fill2)} onChange={(e) => patch({ fill2: e.target.value }, 'Gradiente')} />}
                </>
              )}
            </span>
          </div>
        )}
        {l.kind !== 'particles' && (
          <div className="field wide">
            <label>Contorno</label>
            <span className="colors">
              <label className="check"><input type="checkbox" checked={!!l.stroke} onChange={(e) => patch({ stroke: e.target.checked ? '#000000' : null, strokeWidth: e.target.checked ? Math.max(l.strokeWidth, 0.006) : l.strokeWidth }, 'Contorno')} /></label>
              {l.stroke && <input type="color" value={hex(l.stroke)} onChange={(e) => patch({ stroke: e.target.value }, 'Cor do contorno')} />}
            </span>
          </div>
        )}
        {(l.stroke || open) && l.kind !== 'particles' && <Range label="Espessura" value={l.strokeWidth} min={0} max={0.05} step={0.001} fmt={pct} onLive={(v) => livePatch({ strokeWidth: v })} />}
        {l.kind === 'rect' && <Range label="Cantos" value={l.radius ?? 0} min={0} max={0.5} step={0.01} fmt={pct} onLive={(v) => livePatch({ radius: v })} />}
        {(l.kind === 'star' || l.kind === 'polygon') && (
          <Range label={l.kind === 'star' ? 'Pontas' : 'Lados'} value={l.points ?? (l.kind === 'star' ? 5 : 6)} min={3} max={16} step={1} fmt={(v) => String(v)} onLive={(v) => livePatch({ points: v })} />
        )}
        {l.kind === 'star' && <Range label="Miolo" value={l.innerRatio ?? 0.45} min={0.15} max={0.95} step={0.01} fmt={pct} onLive={(v) => livePatch({ innerRatio: v })} />}
        {isShape || l.kind === 'text' ? (
          <label className="check"><input type="checkbox" checked={!!l.shadow} onChange={(e) => patch({ shadow: e.target.checked }, 'Sombra')} /> Sombra</label>
        ) : null}
      </details>

      <details className="insp-group" open>
        <summary>Posição e tamanho</summary>
        <Range label="X" value={l.x} min={-0.2} max={1.2} step={0.005} fmt={pct} onLive={(v) => livePatch({ x: v })} />
        <Range label="Y" value={l.y} min={-0.2} max={1.2} step={0.005} fmt={pct} onLive={(v) => livePatch({ y: v })} />
        <Range label="Largura" value={l.w} min={0.01} max={l.frameUnits || l.kind === 'particles' ? 1.2 : 2} step={0.005} fmt={pct} onLive={(v) => livePatch({ w: v })} />
        <Range label="Altura" value={l.h} min={0.01} max={l.frameUnits || l.kind === 'particles' ? 1.2 : 2} step={0.005} fmt={pct} onLive={(v) => livePatch({ h: v })} />
        {l.kind !== 'particles' && <Range label="Rotação" value={l.rotation} min={-180} max={180} step={1} fmt={(v) => `${Math.round(v)}°`} onLive={(v) => livePatch({ rotation: v })} />}
        <Range label="Opacidade" value={l.opacity} min={0} max={1} step={0.01} fmt={pct} onLive={(v) => livePatch({ opacity: v })} />
      </details>

      <details className="insp-group" open>
        <summary>Animação da camada</summary>
        <div className="field wide">
          <label>Entrada</label>
          <select value={l.animIn ?? 'none'} onChange={(e) => patch({ animIn: e.target.value as ElementAnim }, 'Entrada da camada')} data-testid="el-anim-in">
            {Object.entries(ANIM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field wide">
          <label>Saída</label>
          <select value={l.animOut ?? 'none'} onChange={(e) => patch({ animOut: e.target.value as ElementAnim }, 'Saída da camada')}>
            {Object.entries(ANIM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <Range label="Duração" value={l.animDuration ?? 0.4} min={0.1} max={2} step={0.05} fmt={(v) => `${v.toFixed(2)} s`} onLive={(v) => livePatch({ animDuration: v })} />
        <Range label="Atraso" value={l.delay ?? 0} min={0} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)} s`} onLive={(v) => livePatch({ delay: v })} />
        <div className="field wide">
          <label>Contínuo</label>
          <select value={l.loop ?? 'none'} onChange={(e) => patch({ loop: e.target.value as ElementLoop }, 'Movimento contínuo')} data-testid="el-loop">
            {Object.entries(LOOP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {(l.loop ?? 'none') !== 'none' && <Range label="Ritmo" value={l.loopSpeed ?? 1} min={0.1} max={4} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onLive={(v) => livePatch({ loopSpeed: v })} />}
      </details>
    </>
  );
}

/** Cor CSS → #rrggbb para o seletor (rgba perde só a transparência na amostra). */
function hex(css: string): string {
  if (/^#[0-9a-f]{6}$/i.test(css)) return css;
  if (/^#[0-9a-f]{3}$/i.test(css)) return `#${[...css.slice(1)].map((c) => c + c).join('')}`;
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(css);
  return m ? `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : '#ffffff';
}

// --- Máscara (clipes de vídeo/imagem) ---------------------------------------------------

const MASK_PRESETS: { id: string; label: string; mask: ClipMask }[] = [
  { id: 'circle', label: 'Círculo', mask: { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.56, h: 1, radius: 0, feather: 0, invert: false } },
  { id: 'rounded', label: 'Cantos arredondados', mask: { shape: 'rect', x: 0.5, y: 0.5, w: 1, h: 1, radius: 0.12, feather: 0, invert: false } },
  { id: 'vignette', label: 'Oval suave', mask: { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.9, h: 0.9, radius: 0, feather: 0.12, invert: false } },
  { id: 'band', label: 'Faixa central', mask: { shape: 'rect', x: 0.5, y: 0.5, w: 1, h: 0.5, radius: 0, feather: 0.02, invert: false } },
];

export function MaskSection({ clip }: { clip: Clip }) {
  const m = clip.mask;
  const set = (mask: ClipMask | undefined, label: string) => commit(clip.id, label, () => ({ mask }));
  const liveMask = (patch: Partial<ClipMask>) => live(clip.id, (c) => ({ mask: c.mask ? { ...c.mask, ...patch } : undefined }));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div>
      <h4>Máscara</h4>
      <div className="font-cats">
        <button className={`font-chip${!m ? ' on' : ''}`} onClick={() => set(undefined, 'Sem máscara')}>Nenhuma</button>
        {MASK_PRESETS.map((p) => (
          <button key={p.id} className="font-chip" onClick={() => set({ ...p.mask }, `Máscara ${p.label}`)} data-testid={`mask-${p.id}`}>{p.label}</button>
        ))}
      </div>
      {m && (
        <>
          <div className="field wide" style={{ marginTop: 6 }}>
            <label>Forma</label>
            <select value={m.shape} onChange={(e) => set({ ...m, shape: e.target.value as ClipMask['shape'] }, 'Forma da máscara')}>
              <option value="ellipse">Elipse</option>
              <option value="rect">Retângulo</option>
            </select>
          </div>
          <Range label="Centro X" value={m.x} min={0} max={1} step={0.005} fmt={pct} onLive={(v) => liveMask({ x: v })} />
          <Range label="Centro Y" value={m.y} min={0} max={1} step={0.005} fmt={pct} onLive={(v) => liveMask({ y: v })} />
          <Range label="Largura" value={m.w} min={0.05} max={1.2} step={0.005} fmt={pct} onLive={(v) => liveMask({ w: v })} />
          <Range label="Altura" value={m.h} min={0.05} max={1.2} step={0.005} fmt={pct} onLive={(v) => liveMask({ h: v })} />
          {m.shape === 'rect' && <Range label="Cantos" value={m.radius} min={0} max={0.5} step={0.01} fmt={pct} onLive={(v) => liveMask({ radius: v })} />}
          <Range label="Borda suave" value={m.feather} min={0} max={0.3} step={0.005} fmt={pct} onLive={(v) => liveMask({ feather: v })} />
          <label className="check"><input type="checkbox" checked={m.invert} onChange={(e) => set({ ...m, invert: e.target.checked }, 'Inverter máscara')} /> Inverter (mostra o lado de fora)</label>
          <p className="note">A máscara acompanha o clipe: diminua a escala e mova para fazer uma câmera redonda no canto.</p>
        </>
      )}
    </div>
  );
}
