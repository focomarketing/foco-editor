import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import type { Clip, TranscriptWord } from '../core/types';
import { DEFAULT_TRANSFORM, NO_ASSET } from '../core/types';
import { allCaptionPresets, autoEmphasis, CAPTION_CATEGORIES } from '../engine/captions/captions';
import type { CaptionPreset } from '../engine/captions/captions';
import { drawCaption } from '../engine/captions/renderCaption';
import { ensureFamily } from '../engine/fonts/library';
import { primaryFamily } from '../engine/fonts/fonts';
import { captionStylesStore } from '../app/captionStyles';

const W = 192;
const H = 108;
const LOOP = 2.8;
// frase de exemplo com o ritmo de uma fala real
const SAMPLE: TranscriptWord[] = [
  ['Isso', 0.1, 0.38],
  ['vai', 0.42, 0.6],
  ['mudar', 0.64, 0.98],
  ['100%', 1.04, 1.5],
  ['do', 1.54, 1.64],
  ['seu', 1.68, 1.86],
  ['resultado', 1.9, 2.45],
].map(([text, start, end]) => ({ text: text as string, start: start as number, end: end as number }));

function sampleClip(p: CaptionPreset): Clip {
  return {
    id: `pv-${p.id}`,
    assetId: NO_ASSET,
    trackId: '',
    start: 0,
    duration: LOOP - 0.1,
    sourceIn: 0,
    volume: 0,
    speed: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
    // cartão pequeno: letra maior que no vídeo (a prévia mostra o estilo, não o tamanho exato)
    caption: { style: { ...p.style, fontSize: Math.max(0.12, Math.min(0.2, p.style.fontSize * 2.3)), maxWidth: 0.94, y: 0.56 }, words: p.style.emphasisColor ? autoEmphasis(SAMPLE) : SAMPLE },
  };
}

function PresetCard({ preset, on, onPick }: { preset: CaptionPreset; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const clip = sampleClip(preset);
    let raf = 0;
    const t0 = performance.now();
    const draw = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      g.addColorStop(0, '#3a4256');
      g.addColorStop(1, '#151821');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawCaption(ctx, canvas.width, canvas.height, clip, t);
    };
    // parado: um instante com várias palavras na tela; com o mouse em cima, a animação toda
    const still = () => draw(1.2);
    const loop = () => {
      draw(((performance.now() - t0) / 1000) % LOOP);
      raf = requestAnimationFrame(loop);
    };
    if (hover) loop();
    else still();
    void ensureFamily(primaryFamily(preset.style.fontFamily)).then((ok) => ok && !hover && still());
    return () => cancelAnimationFrame(raf);
  }, [preset, hover]);

  return (
    <div
      className={`cap-card${on ? ' on' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick())}
      data-testid={`cap-preset-${preset.id}`}
      title={preset.label}
    >
      <canvas ref={ref} style={{ width: '100%', aspectRatio: `${W} / ${H}` }} />
      <span className="cap-name">{preset.label}</span>
      {preset.user && (
        <button
          className="cap-del"
          title="Apagar este estilo"
          onClick={(e) => {
            e.stopPropagation();
            captionStylesStore.remove(preset.id);
          }}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

/** Banco de estilos de legenda: galeria por categoria, com prévia animada (passe o mouse). */
export function CaptionGallery({ value, onPick }: { value?: string; onPick: (preset: CaptionPreset) => void }) {
  const mine = useSyncExternalStore(captionStylesStore.subscribe, captionStylesStore.get);
  const [cat, setCat] = useState<string>('Todos');
  const cats = ['Todos', ...CAPTION_CATEGORIES, ...(mine.length ? ['Meus estilos'] : [])];
  const presets = allCaptionPresets().filter((p) => cat === 'Todos' || p.category === cat);
  return (
    <div className="cap-gallery">
      <div className="font-cats">
        {cats.map((c) => (
          <button key={c} className={`font-chip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      <div className="cap-grid">
        {presets.map((p) => (
          <PresetCard key={p.id} preset={p} on={p.id === value} onPick={() => onPick(p)} />
        ))}
      </div>
      <p className="note">Passe o mouse para ver a animação. {mine.length ? '' : 'Ajuste uma legenda no Inspector e salve como "Meu estilo" para reusar.'}</p>
    </div>
  );
}
