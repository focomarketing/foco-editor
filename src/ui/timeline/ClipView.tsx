import { memo, useEffect, useRef, useSyncExternalStore } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import type { Asset, Clip } from '../../core/types';
import { media } from '../../app/editor';
import { WAVEFORM_RATE } from '../../engine/media/MediaEngine';
import type { Filmstrip as FilmstripData } from '../../engine/media/MediaEngine';
import { captionText } from '../../engine/captions/captions';
import { keyframeTimes } from '../../core/animation';
import { sourceEnd, speedOf, toSource, toTimeline } from '../../core/clipTime';

interface Props {
  clip: Clip;
  asset: Asset | undefined;
  zoom: number;
  view: { left: number; width: number };
  selected: boolean;
  dimmed: boolean;
  onPointerDown: (e: RPointerEvent, clip: Clip, part: 'body' | 'start' | 'end') => void;
}

export const ClipView = memo(function ClipView({ clip, asset, zoom, view, selected, dimmed, onPointerDown }: Props) {
  // Observa só a SUA mídia: progresso de outras mídias não redesenha este clipe.
  const entry = useSyncExternalStore(media.subscribe, () => (asset ? media.get(asset.id) : undefined));
  const left = clip.start * zoom;
  const width = Math.max(2, clip.duration * zoom);
  const kind = clip.caption ? 'caption' : clip.title ? 'title' : (asset?.kind ?? 'video');
  const online = !!clip.caption || !!clip.title || entry?.status === 'ready';
  const label = clip.caption ? captionText(clip) : clip.title ? `◆ ${clip.title.text}` : (asset?.name ?? '?');
  const kfs = keyframeTimes(clip.keyframes).filter((t) => t >= clip.sourceIn && t <= sourceEnd(clip));

  return (
    <div
      className={`clip ${kind}${selected ? ' selected' : ''}${online ? '' : ' offline'}`}
      style={{ left, width, opacity: dimmed ? 0.4 : 1 }}
      data-clip={clip.id}
      title={clip.caption || clip.title ? label : asset ? `${asset.name}${online ? '' : ' (offline)'}` : 'mídia removida'}
      onPointerDown={(e) => onPointerDown(e, clip, 'body')}
    >
      <span className="clip-label">{label}</span>
      {kfs.map((t) => (
        <span key={t} className="kf-dot" style={{ left: (toTimeline(clip, t) - clip.start) * zoom }} />
      ))}
      {kind === 'video' && entry?.filmstrip && asset ? (
        <Filmstrip clip={clip} duration={asset.duration} strip={entry.filmstrip} zoom={zoom} view={view} />
      ) : (
        kind !== 'audio' && kind !== 'caption' && kind !== 'title' && entry?.thumbnail && (
          <div className="clip-strip" style={{ backgroundImage: `url(${entry.thumbnail})` }} />
        )
      )}
      {asset?.hasAudio && entry?.waveform && (
        <Waveform peaks={entry.waveform} mips={entry.waveMips} rev={entry.waveformProgress} clip={clip} zoom={zoom} view={view} height={kind === 'audio' ? 30 : 16} />
      )}
      {width > 16 && (
        <>
          <div className="handle l" onPointerDown={(e) => onPointerDown(e, clip, 'start')} />
          <div className="handle r" onPointerDown={(e) => onPointerDown(e, clip, 'end')} />
        </>
      )}
    </div>
  );
});

/** Miniaturas ao longo do clipe, cada uma do instante de origem correspondente (só a parte visível). */
function Filmstrip({ clip, duration, strip, zoom, view }: { clip: Clip; duration: number; strip: FilmstripData; zoom: number; view: { left: number; width: number } }) {
  const h = 34;
  const tileW = Math.max(8, (strip.frameW * h) / strip.frameH);
  const clipLeft = clip.start * zoom;
  const width = clip.duration * zoom;
  const first = Math.max(0, Math.floor((view.left - clipLeft) / tileW));
  const last = Math.min(Math.ceil(width / tileW), Math.ceil((view.left + view.width - clipLeft) / tileW));
  const tiles = [];
  for (let k = first; k < last; k++) {
    const src = toSource(clip, clip.start + ((k + 0.5) * tileW) / zoom);
    const idx = Math.min(strip.frames - 1, Math.max(0, Math.floor((src / Math.max(0.001, duration)) * strip.frames)));
    tiles.push(
      <span
        key={k}
        className="film-tile"
        style={{
          left: k * tileW,
          width: Math.min(tileW, width - k * tileW),
          backgroundImage: `url(${strip.url})`,
          backgroundSize: `${strip.frames * tileW}px ${h}px`,
          backgroundPosition: `${-idx * tileW}px 0`,
        }}
      />,
    );
  }
  return <div className="clip-film">{tiles}</div>;
}

/** Desenha só o trecho do clipe que está visível na tela. */
function Waveform({ peaks, mips, rev, clip, zoom, view, height }: { peaks: Float32Array; mips?: Float32Array[]; rev?: number; clip: Clip; zoom: number; view: { left: number; width: number }; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const clipLeft = clip.start * zoom;
  const visStart = Math.max(clipLeft, view.left - 200);
  const visEnd = Math.min(clipLeft + clip.duration * zoom, view.left + view.width + 200);
  const w = Math.max(0, Math.floor(visEnd - visStart));

  useEffect(() => {
    const c = ref.current;
    if (!c || w <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.round(height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const offset = visStart - clipLeft; // px desde o começo do clipe
    // Nível da pirâmide com ~1 bloco por pixel: o custo é O(pixels), qualquer que seja o zoom.
    const blocksPerPx = (WAVEFORM_RATE * speedOf(clip)) / zoom;
    const lvl = mips ? Math.max(0, Math.min(mips.length - 1, Math.floor(Math.log2(Math.max(1, blocksPerPx))))) : 0;
    const data = mips ? mips[lvl] : peaks;
    const rate = WAVEFORM_RATE / 2 ** lvl;
    for (let x = 0; x < w; x++) {
      const tA = clip.sourceIn + ((offset + x) / zoom) * speedOf(clip);
      const tB = clip.sourceIn + ((offset + x + 1) / zoom) * speedOf(clip);
      const a = Math.floor(tA * rate);
      const b = Math.max(a + 1, Math.floor(tB * rate));
      let max = 0;
      for (let i = a; i < b && i < data.length; i++) if (data[i] > max) max = data[i];
      const h = Math.max(0.5, Math.min(1, max * clip.volume) * height);
      ctx.fillRect(x, height - h, 1, h);
    }
  }, [peaks, mips, rev, clip, zoom, visStart, clipLeft, w, height]);

  if (w <= 0) return null;
  return <canvas ref={ref} className="wave" style={{ left: visStart - clipLeft, width: w, height }} />;
}
