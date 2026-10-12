import { useEffect, useRef, useState } from 'react';
import type { EffectType } from '../core/types';
import { isGraphic } from '../core/types';
import { snapToFrame } from '../core/time';
import { playback, store } from '../app/editor';
import { Cmd } from '../engine/commands/commands';
import { createdIds } from '../engine/commands/patch';
import { applyEffects, EFFECT_CATEGORIES, EFFECTS, makeEffect } from '../engine/effects/effects';
import { notify } from '../app/notify';
import { useEditor } from './hooks';

const W = 192;
const H = 108;

let sceneCache: OffscreenCanvas | null = null;
/** Cena de exemplo (céu, sol, morros, texto) para as prévias. */
function scene(w: number, h: number): OffscreenCanvas {
  if (sceneCache && sceneCache.width === w && sceneCache.height === h) return sceneCache;
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d')!;
  const sky = x.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#2b6cb0');
  sky.addColorStop(0.65, '#f6ad55');
  sky.addColorStop(1, '#c05621');
  x.fillStyle = sky;
  x.fillRect(0, 0, w, h);
  x.fillStyle = '#fff3c4';
  x.beginPath();
  x.arc(w * 0.7, h * 0.45, h * 0.16, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#2f855a';
  x.beginPath();
  x.moveTo(0, h);
  x.quadraticCurveTo(w * 0.25, h * 0.55, w * 0.55, h * 0.8);
  x.quadraticCurveTo(w * 0.8, h * 0.62, w, h * 0.75);
  x.lineTo(w, h);
  x.fill();
  x.fillStyle = '#ffffff';
  x.font = `900 ${Math.round(h * 0.2)}px "Segoe UI", Arial, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('FOCO', w * 0.3, h * 0.36);
  sceneCache = c;
  return c;
}

function EffectCard({ type, onPick }: { type: EffectType; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const work = new OffscreenCanvas(canvas.width, canvas.height);
    const w = work.getContext('2d')!;
    const fx = [makeEffect(type)];
    const draw = (t: number) => {
      w.setTransform(1, 0, 0, 1, 0, 0);
      w.clearRect(0, 0, work.width, work.height);
      w.drawImage(scene(work.width, work.height), 0, 0);
      applyEffects(work, fx, t);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(work, 0, 0);
    };
    let raf = 0;
    if (hover) {
      const t0 = performance.now();
      const loop = () => {
        draw((performance.now() - t0) / 1000);
        raf = requestAnimationFrame(loop);
      };
      loop();
    } else draw(0.02); // perto do início: pulso/flash/glitch aparecem já parados
    return () => cancelAnimationFrame(raf);
  }, [type, hover]);
  return (
    <div
      className="cap-card"
      role="button"
      tabIndex={0}
      title={EFFECTS[type].hint}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick())}
      data-testid={`fx-card-${type}`}
    >
      <canvas ref={ref} style={{ width: '100%', aspectRatio: `${W} / ${H}` }} />
      <span className="cap-name">{EFFECTS[type].label}</span>
    </div>
  );
}

/** Biblioteca de efeitos: aplica no clipe selecionado ou cria uma camada de efeito no playhead. */
export function EffectsPanel() {
  const { project, selection } = useEditor();
  const [cat, setCat] = useState<string>('Todos');
  const sel = selection.length === 1 ? project.clips[selection[0]] : undefined;
  const asset = sel ? project.assets[sel.assetId] : undefined;
  // alvo: camada de efeito selecionada, ou clipe de vídeo/imagem selecionado
  const target = sel?.adjustment ? sel : sel && !isGraphic(sel) && asset && asset.kind !== 'audio' ? sel : undefined;
  const targetName = target?.adjustment ? 'camada de efeito selecionada' : (asset?.name ?? 'clipe');
  const types = (Object.keys(EFFECTS) as EffectType[]).filter((k) => cat === 'Todos' || EFFECTS[k].category === cat);

  const pick = (type: EffectType) => {
    const fx = makeEffect(type);
    if (target) {
      store.execute(Cmd.setEffects({ [target.id]: [...(target.effects ?? []), fx] }, `Efeito ${EFFECTS[type].label}`));
      notify(`${EFFECTS[type].label} aplicado: ${targetName}.`, 'success');
      return;
    }
    const at = snapToFrame(playback.time, project.settings.fps);
    store.execute(Cmd.addAdjustment({ effects: [fx], at, duration: 3 }), (patch) => createdIds(patch, 'clips'));
  };

  return (
    <section className="panel">
      <div className="panel-head"><span className="panel-title">Efeitos</span></div>
      <div className="panel-body insp">
        <div className="fx-target" data-testid="fx-target">
          {target
            ? <>Aplicar em: <b>{targetName}</b></>
            : <>Nenhum clipe de vídeo selecionado: o clique cria uma <b>camada de efeito</b> de 3 s no playhead (vale para tudo embaixo).</>}
        </div>
        <div className="cap-gallery" style={{ marginTop: 0 }}>
          <div className="font-cats">
            {['Todos', ...EFFECT_CATEGORIES].map((c) => (
              <button key={c} className={`font-chip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
          <div className="cap-grid" style={{ maxHeight: 'none' }}>
            {types.map((k) => <EffectCard key={k} type={k} onPick={() => pick(k)} />)}
          </div>
        </div>
        <p className="note">Intensidade, ritmo, cores, ordem e ligar/desligar ficam no Inspector. Passe o mouse para ver a animação.</p>
      </div>
    </section>
  );
}
