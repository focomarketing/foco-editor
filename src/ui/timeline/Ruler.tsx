import { useEffect, useRef } from 'react';
import type { Marker } from '../../core/types';
import { formatTimecode } from '../../core/time';
import { playback, store } from '../../app/editor';
import { Cmd } from '../../engine/commands/commands';

const STEPS = [1 / 30, 1 / 10, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** Régua desenhada só na área visível (timelines de horas não cabem num canvas único). */
export function Ruler(props: {
  zoom: number;
  view: { left: number; width: number };
  fps: number;
  timeAt: (clientX: number) => number;
  markers: Marker[];
  /** Snap do playhead ao arrastar (clipes, marcadores, início). */
  snapTime: (t: number) => number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { zoom, view, fps } = props;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(view.width * dpr);
    c.height = Math.round(28 * dpr);
    c.style.width = `${view.width}px`;
    c.style.height = '28px';
    c.style.left = `${view.left}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, 28);

    const major = STEPS.find((s) => s * zoom >= 90) ?? 7200;
    const minor = major / (major >= 60 ? 6 : major >= 1 ? 5 : 3);
    const t0 = view.left / zoom;
    const t1 = (view.left + view.width) / zoom;

    ctx.strokeStyle = '#3a3f4b';
    ctx.beginPath();
    for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) {
      const x = Math.round(t * zoom - view.left) + 0.5;
      ctx.moveTo(x, 22);
      ctx.lineTo(x, 28);
    }
    ctx.stroke();

    ctx.strokeStyle = '#59606e';
    ctx.fillStyle = '#8b919d';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.beginPath();
    for (let t = Math.floor(t0 / major) * major; t <= t1; t += major) {
      const x = Math.round(t * zoom - view.left) + 0.5;
      ctx.moveTo(x, 12);
      ctx.lineTo(x, 28);
      const label = major < 1 ? formatTimecode(t, fps) : formatTimecode(t, fps).slice(0, 8);
      ctx.fillText(label, x + 4, 11);
    }
    ctx.stroke();
  }, [zoom, view, fps]);

  const scrub = (e: React.PointerEvent, snap: boolean) => {
    const t = props.timeAt(e.clientX);
    playback.seek(snap ? props.snapTime(t) : t);
  };

  return (
    <div
      className="ruler"
      data-testid="ruler"
      title="Clique ou arraste para mover o playhead (Alt: sem snap) · M: adicionar marcador"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        if (playback.getSnapshot().playing) playback.pause();
        playback.setScrubbing(true);
        scrub(e, !e.altKey);
      }}
      onPointerMove={(e) => e.buttons & 1 && scrub(e, !e.altKey)}
      onPointerUp={() => playback.setScrubbing(false)}
      onPointerCancel={() => playback.setScrubbing(false)}
    >
      <canvas ref={ref} />
      {props.markers.map((m) => (
        <button
          key={m.id}
          className="marker"
          style={{ left: m.time * zoom, color: m.color }}
          title={`${m.label || 'Marcador'} · clique: ir · duplo clique: renomear · botão direito: apagar`}
          onPointerDown={(e) => {
            e.stopPropagation();
            playback.seek(m.time);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            const label = prompt('Nome do marcador:', m.label);
            if (label !== null && label !== m.label) store.execute(Cmd.updateMarker(m.id, { label }));
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            store.execute(Cmd.removeMarker(m.id));
          }}
        >
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}
