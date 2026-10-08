import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import {
  Eye, EyeOff, Lock, Magnet, MousePointer2, Slice, Type, Maximize2, Plus, Redo2, Scissors, Trash2, Undo2, Unlock, Volume2, VolumeX, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { Clip, Project, Track } from '../../core/types';
import { snapToFrame } from '../../core/time';
import { actions, playback, store } from '../../app/editor';
import {
  clipEnd, findSnap, projectDuration, snapPoints, trackKindForAsset,
} from '../../engine/timeline/operations';
import { useAnalysis, useEditor, usePlayback, usePrefs, useSmartCut } from '../hooks';
import { formatTime, prefsStore } from '../../app/prefs';
import { sourceRangesToTimeline } from '../../engine/timeline/operations';
import { TITLE_TEMPLATES } from '../../engine/motion/titles';
import { Cmd } from '../../engine/commands/commands';
import { createdIds } from '../../engine/commands/patch';
import { ASSET_MIME } from '../MediaBin';
import { ClipView } from './ClipView';
import { Ruler } from './Ruler';

import { RULER_H, trackHeight } from './layout';
const SNAP_PX = 8;
/** 100% de zoom = 40 px por segundo. */
const BASE_ZOOM = 40;
const DRAG_THRESHOLD = 3;

type Gesture =
  | { kind: 'move'; x0: number; y0: number; clipId: string; started: boolean; origins: Map<string, { start: number; trackId: string }> }
  | { kind: 'trim'; clipId: string; edge: 'start' | 'end'; grabOffset: number }
  | { kind: 'marquee'; x0: number; y0: number; additive: string[] };

export function Timeline() {
  const { project, selection, zoom, snapping, canUndo, canRedo } = useEditor();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dropLane, setDropLane] = useState<string | null>(null);
  const [razorX, setRazorX] = useState<number | null>(null);
  const { tool } = usePrefs();

  const duration = projectDuration(project);
  const byTrack = useMemo(() => indexByTrack(project.clips), [project.clips]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const contentWidth = Math.max((duration + 30) * zoom, view.width);
  const lanesHeight = project.tracks.reduce((h, t) => h + trackHeight(t), 0);

  // --- geometria ------------------------------------------------------------

  const timeAt = useCallback(
    (clientX: number) => {
      const el = scrollRef.current!;
      return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft) / zoom);
    },
    [zoom],
  );

  const contentY = (clientY: number) => {
    const el = scrollRef.current!;
    return clientY - el.getBoundingClientRect().top + el.scrollTop;
  };

  const laneAt = (clientY: number): Track | undefined => {
    let y = contentY(clientY) - RULER_H;
    for (const t of project.tracks) {
      const h = trackHeight(t);
      if (y < h) return y >= 0 ? t : undefined;
      y -= h;
    }
    return undefined;
  };

  const snap = (t: number, p: Project, exclude: ReadonlySet<string>): number | null =>
    store.getState().snapping ? findSnap(t, snapPoints(p, exclude, playback.time), SNAP_PX / zoom) : null;

  // --- scroll/zoom ----------------------------------------------------------

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const update = () => {
      setView({ left: el.scrollLeft, width: el.clientWidth });
      if (headsRef.current) headsRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  // Ctrl+roda = zoom ancorado no cursor.
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z = store.getState().zoom;
      const rect = el.getBoundingClientRect();
      const anchorT = (e.clientX - rect.left + el.scrollLeft) / z;
      const nz = Math.min(800, Math.max(0.5, z * Math.exp(-e.deltaY * 0.0015)));
      store.setZoom(nz);
      requestAnimationFrame(() => (el.scrollLeft = anchorT * nz - (e.clientX - rect.left)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (k: number) => {
    const el = scrollRef.current!;
    const center = (el.scrollLeft + el.clientWidth / 2) / zoom;
    const nz = Math.min(800, Math.max(0.5, zoom * k));
    store.setZoom(nz);
    requestAnimationFrame(() => (el.scrollLeft = center * nz - el.clientWidth / 2));
  };

  const fit = () => {
    const el = scrollRef.current!;
    if (duration <= 0) return;
    store.setZoom((el.clientWidth - 40) / duration);
    requestAnimationFrame(() => (el.scrollLeft = 0));
  };

  // --- gestos ---------------------------------------------------------------

  // Callback estável: não invalida o memo dos clipes a cada render.
  const pointerDownRef = useRef<(e: RPointerEvent, clip: Clip, part: 'body' | 'start' | 'end') => void>(() => {});
  const stableClipPointerDown = useCallback((e: RPointerEvent, clip: Clip, part: 'body' | 'start' | 'end') => pointerDownRef.current(e, clip, part), []);

  const onClipPointerDown = (e: RPointerEvent, clip: Clip, part: 'body' | 'start' | 'end') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = store.getState().project;
    const track = p.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;

    if (prefsStore.get().tool === 'razor') {
      // Razor: divide o clipe exatamente onde foi clicado (com snap).
      const t0 = timeAt(e.clientX);
      const t = snap(t0, p, new Set()) ?? snapToFrame(t0, p.settings.fps);
      store.execute({ ...Cmd.splitClips([clip.id], t), label: 'Razor' });
      return;
    }

    let sel = store.getState().selection;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      sel = sel.includes(clip.id) ? sel.filter((id) => id !== clip.id) : [...sel, clip.id];
      store.select(sel);
      if (!sel.includes(clip.id)) return;
    } else if (!sel.includes(clip.id) || part !== 'body') {
      sel = [clip.id];
      store.select(sel);
    }

    lanesRef.current?.setPointerCapture(e.pointerId);
    store.beginGesture();
    if (part === 'body') {
      const origins = new Map<string, { start: number; trackId: string }>();
      for (const id of sel) {
        const c = p.clips[id];
        const t = c && p.tracks.find((tr) => tr.id === c.trackId);
        if (c && !t?.locked) origins.set(id, { start: c.start, trackId: c.trackId });
      }
      gesture.current = { kind: 'move', x0: e.clientX, y0: e.clientY, clipId: clip.id, started: false, origins };
    } else {
      // Mantém a distância entre o ponteiro e a borda no momento do clique.
      const edgeTime = part === 'start' ? clip.start : clipEnd(clip);
      gesture.current = { kind: 'trim', clipId: clip.id, edge: part, grabOffset: edgeTime - timeAt(e.clientX) };
    }
  };

  useEffect(() => {
    pointerDownRef.current = onClipPointerDown;
  });

  const onLanesPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0 || prefsStore.get().tool === 'razor') return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey ? store.getState().selection : [];
    if (!additive.length) store.select([]);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const el = scrollRef.current!;
    gesture.current = { kind: 'marquee', x0: e.clientX - el.getBoundingClientRect().left + el.scrollLeft, y0: contentY(e.clientY), additive };
  };

  const onPointerMove = (e: RPointerEvent) => {
    const g = gesture.current;
    if (!g) {
      if (tool === 'razor') {
        const p = store.getState().project;
        const t0 = timeAt(e.clientX);
        setRazorX((snap(t0, p, new Set()) ?? snapToFrame(t0, p.settings.fps)) * zoom);
      }
      return;
    }
    const p0 = store.getState().project;
    const fps = p0.settings.fps;

    if (g.kind === 'move') {
      if (!g.started && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < DRAG_THRESHOLD) return;
      g.started = true;
      let delta = (e.clientX - g.x0) / zoom;
      const primary = g.origins.get(g.clipId);
      const primaryClip = p0.clips[g.clipId];
      if (!primary || !primaryClip) return;
      // Não deixa nenhum clipe do grupo passar de 0.
      const minStart = Math.min(...[...g.origins.values()].map((o) => o.start));
      delta = Math.max(delta, -minStart);
      let snapped: number | null = null;
      const exclude = new Set(g.origins.keys());
      const s1 = snap(primary.start + delta, p0, exclude);
      const s2 = snap(primary.start + delta + primaryClip.duration, p0, exclude);
      if (s1 !== null && (s2 === null || Math.abs(s1 - primary.start - delta) <= Math.abs(s2 - primary.start - delta - primaryClip.duration))) {
        delta = s1 - primary.start;
        snapped = s1;
      } else if (s2 !== null) {
        delta = s2 - primaryClip.duration - primary.start;
        snapped = s2;
      } else {
        delta = snapToFrame(primary.start + delta, fps) - primary.start;
      }
      setSnapAt(snapped);

      // Troca de trilha só com um clipe selecionado e trilha compatível.
      let targetTrack = primary.trackId;
      if (g.origins.size === 1) {
        const lane = laneAt(e.clientY);
        const asset = p0.assets[primaryClip.assetId];
        const needed = asset ? trackKindForAsset(asset) : primaryClip.caption || primaryClip.title ? 'video' : null;
        if (lane && !lane.locked && needed && lane.kind === needed) targetTrack = lane.id;
      }
      const moves = [...g.origins].map(([id, o]) => ({
        id,
        start: o.start + delta,
        trackId: g.origins.size === 1 ? targetTrack : o.trackId,
      }));
      store.preview(Cmd.moveClips(moves));
    } else if (g.kind === 'trim') {
      let t = timeAt(e.clientX) + g.grabOffset;
      const s = snap(t, p0, new Set([g.clipId]));
      t = s ?? snapToFrame(t, fps);
      setSnapAt(s);
      store.preview(Cmd.trimClip(g.clipId, g.edge, t));
    } else {
      const el = scrollRef.current!;
      const x1 = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
      const y1 = contentY(e.clientY);
      const rect = { x: Math.min(g.x0, x1), y: Math.min(g.y0, y1), w: Math.abs(x1 - g.x0), h: Math.abs(y1 - g.y0) };
      setMarquee(rect);
      const t0 = rect.x / zoom;
      const t1 = (rect.x + rect.w) / zoom;
      const hit: string[] = [];
      let y = RULER_H;
      for (const track of p0.tracks) {
        const h = trackHeight(track);
        if (!track.locked && y + h > rect.y && y < rect.y + rect.h) {
          for (const c of Object.values(p0.clips)) {
            if (c.trackId === track.id && clipEnd(c) > t0 && c.start < t1) hit.push(c.id);
          }
        }
        y += h;
      }
      store.select([...new Set([...g.additive, ...hit])]);
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    setSnapAt(null);
    setMarquee(null);
    if (g?.kind === 'move' || g?.kind === 'trim') store.endGesture();
  };

  // Esc cancela o gesto em andamento.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gesture.current && gesture.current.kind !== 'marquee') {
        gesture.current = null;
        store.cancelGesture();
        setSnapAt(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- drop da mídia --------------------------------------------------------

  const onDragOver = (e: React.DragEvent, track: Track) => {
    if (e.dataTransfer.types.includes(ASSET_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropLane(track.id);
    }
  };

  const onDrop = (e: React.DragEvent, track: Track) => {
    setDropLane(null);
    const assetId = e.dataTransfer.getData(ASSET_MIME);
    if (!assetId) return;
    e.preventDefault();
    e.stopPropagation();
    const p = store.getState().project;
    const t = timeAt(e.clientX);
    const s = snap(t, p, new Set());
    actions.addAssetToTimeline(assetId, track.id, s ?? snapToFrame(t, p.settings.fps));
  };

  // --- render ---------------------------------------------------------------

  // Virtualização: só os clipes na área visível (+ margem) viram elementos na tela.
  const visT0 = Math.max(0, (view.left - 400) / zoom);
  const visT1 = (view.left + view.width + 400) / zoom;
  // As camadas visuais dos clipes (waveform, filmstrip) só mudam quando a rolagem cruza blocos de 512 px.
  const qLeft = Math.floor(view.left / 512) * 512;
  const clipView = useMemo(() => ({ left: qLeft - 512, width: view.width + 1536 }), [qLeft, view.width]);
  const lanes = project.tracks.map((track, i) => ({
    track,
    top: RULER_H + project.tracks.slice(0, i).reduce((h, t) => h + trackHeight(t), 0),
  }));

  return (
    <section className="timeline">
      <div className="tl-toolbar">
        <TimelineTimecode fps={project.settings.fps} />
        <button className="btn icon sm" title="Desfazer (Ctrl+Z)" disabled={!canUndo} onClick={() => store.undo()}><Undo2 size={15} /></button>
        <button className="btn icon sm" title="Refazer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => store.redo()}><Redo2 size={15} /></button>
        <span className="sep" />
        <button className={`btn icon sm${tool === 'select' ? ' active' : ''}`} title="Seleção (V)" onClick={() => prefsStore.set({ tool: 'select' })} data-testid="tool-select"><MousePointer2 size={15} /></button>
        <button className={`btn icon sm${tool === 'razor' ? ' active' : ''}`} title="Razor — clique num clipe para cortar (C)" onClick={() => prefsStore.set({ tool: 'razor' })} data-testid="tool-razor"><Slice size={15} /></button>
        <span className="sep" />
        <button className="btn sm" title="Dividir no playhead (S)" onClick={() => actions.split()}><Scissors size={14} /> Dividir</button>
        <button className="btn sm" title="Apagar (Delete)" disabled={!selection.length} onClick={() => actions.deleteSelection(false)}><Trash2 size={14} /> Apagar</button>
        <button className="btn sm" title="Apagar e fechar o buraco (Shift+Delete)" disabled={!selection.length} onClick={() => actions.deleteSelection(true)}>Ripple</button>
        <span className="sep" />
        <button className={`btn icon sm${snapping ? ' active' : ''}`} title="Snapping (N)" onClick={() => store.setSnapping(!snapping)}><Magnet size={15} /></button>
        <span className="sep" />
        <GraphicsMenu />
        <span className="spacer" />
        <button className="btn sm" title="Nova trilha de vídeo" onClick={() => store.execute(Cmd.addTrack('video'))}><Plus size={13} /> Vídeo</button>
        <button className="btn sm" title="Nova trilha de áudio" onClick={() => store.execute(Cmd.addTrack('audio'))}><Plus size={13} /> Áudio</button>
        <span className="sep" />
        <button className="btn icon sm" title="Afastar (-)" onClick={() => zoomBy(1 / 1.5)}><ZoomOut size={15} /></button>
        <input
          type="range"
          min={Math.log2(0.02)}
          max={Math.log2(800)}
          step={0.01}
          value={Math.log2(zoom)}
          onChange={(e) => store.setZoom(2 ** Number(e.target.value))}
          title="Zoom (Ctrl+roda)"
        />
        <button className="btn icon sm" title="Aproximar (+)" onClick={() => zoomBy(1.5)}><ZoomIn size={15} /></button>
        <select
          className="zoom-pct"
          title="Zoom"
          value=""
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v) zoomBy((BASE_ZOOM * v) / 100 / zoom);
          }}
        >
          <option value="">{Math.round((zoom / BASE_ZOOM) * 100)}%</option>
          {[1, 5, 10, 25, 50, 100, 200, 400, 800, 1600].map((v) => <option key={v} value={v}>{v}%</option>)}
        </select>
        <button className="btn icon sm" title="Encaixar a timeline (\)" onClick={fit}><Maximize2 size={14} /></button>
      </div>

      <div className="tl-body">
        <div className="tl-heads">
          <div className="tl-heads-inner" ref={headsRef}>
            {project.tracks.map((t) => (
              <TrackHead key={t.id} track={t} canRemove={project.tracks.filter((x) => x.kind === t.kind).length > 1} />
            ))}
          </div>
        </div>

        <div className="tl-scroll" ref={scrollRef} data-testid="timeline-scroll">
          <div className="tl-content" style={{ width: contentWidth, height: RULER_H + lanesHeight + 40 }}>
            <Ruler
              zoom={zoom}
              view={view}
              fps={project.settings.fps}
              timeAt={timeAt}
              markers={project.markers}
              snapTime={(t) => (store.getState().snapping ? (findSnap(t, snapPoints(store.getState().project, new Set(), -1), SNAP_PX / zoom) ?? t) : t)}
            />
            {project.markers.map((m) => (
              <div key={m.id} className="marker-line" style={{ left: m.time * zoom, top: RULER_H, height: lanesHeight, borderColor: m.color }} />
            ))}
            {tool === 'razor' && razorX !== null && <div className="razor-line" style={{ left: razorX, top: RULER_H, height: lanesHeight }} />}
            <div
              ref={lanesRef}
              style={{ position: 'absolute', left: 0, right: 0, top: RULER_H, height: lanesHeight + 40 }}
              onPointerDown={onLanesPointerDown}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setRazorX(null)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {lanes.map(({ track, top }) => (
                <div
                  key={track.id}
                  className={`lane ${track.kind}${dropLane === track.id ? ' drop-ok' : ''}${track.locked ? ' locked' : ''}`}
                  data-track={track.name}
                  style={{ position: 'absolute', left: 0, right: 0, top: top - RULER_H, height: trackHeight(track) }}
                  onDragOver={(e) => onDragOver(e, track)}
                  onDragLeave={() => setDropLane(null)}
                  onDrop={(e) => onDrop(e, track)}
                >
                  {visibleClips(byTrack.get(track.id), visT0, visT1).map((c) => (
                    <ClipView
                      key={c.id}
                      clip={c}
                      asset={project.assets[c.assetId]}
                      zoom={zoom}
                      view={clipView}
                      selected={selectedSet.has(c.id)}
                      dimmed={track.hidden && track.kind === 'video'}
                      onPointerDown={stableClipPointerDown}
                    />
                  ))}
                </div>
              ))}
            </div>
            <CutMarks zoom={zoom} top={RULER_H} height={lanesHeight} />
            {snapAt !== null && <div className="snap-line" style={{ left: snapAt * zoom }} />}
            {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
            <Playhead zoom={zoom} scrollRef={scrollRef} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Insere um gráfico animado no playhead (trilha "Gráficos"). */
function GraphicsMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu">
      <button className={`btn sm${open ? ' active' : ''}`} onClick={() => setOpen(!open)} title="Inserir título, lower third, destaque ou CTA">
        <Type size={13} /> Gráfico
      </button>
      {open && (
        <div className="menu-pop" onPointerLeave={() => setOpen(false)}>
          {TITLE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="menu-item"
              onClick={() => {
                setOpen(false);
                const at = snapToFrame(playback.time, store.getState().project.settings.fps);
                const text = t.id === 'lowerThird' ? 'Nome Sobrenome' : t.id === 'cta' ? 'Inscreva-se' : 'Seu texto aqui';
                store.execute({ ...Cmd.addTitle({ template: t.id, text, at, duration: t.duration }), label: `Inserir ${t.label}` }, (patch) => createdIds(patch, 'clips'));
              }}
            >
              {t.label} <kbd>{t.duration}s</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sugestões de corte em revisão (aba IA e aba Corte), desenhadas sobre a timeline. */
function CutMarks({ zoom, top, height }: { zoom: number; top: number; height: number }) {
  const { project } = useEditor();
  const a = useAnalysis();
  const sc = useSmartCut();
  const marks = [
    ...(a.assetId
      ? a.suggestions.flatMap((s) =>
          sourceRangesToTimeline(project, a.assetId!, [[s.start, s.end]]).map(([x, y]) => ({ id: s.id, x, y, on: a.selected.has(s.id) })),
        )
      : []),
    // a aba Corte já planeja em tempo da timeline
    ...sc.cuts.map((c) => ({ id: `sc-${c.id}`, x: c.start, y: c.end, on: sc.selected.has(c.id) })),
  ];
  if (!marks.length) return null;
  return (
    <>
      {marks.map((m, i) => (
        <div
          key={`${m.id}-${i}`}
          className={`cut-mark${m.on ? ' on' : ''}`}
          style={{ left: m.x * zoom, width: Math.max(1, (m.y - m.x) * zoom), top, height }}
        />
      ))}
    </>
  );
}

function TimelineTimecode({ fps }: { fps: number }) {
  const { time } = usePlayback();
  const { timeMode } = usePrefs();
  return (
    <button
      className="tc tc-btn"
      title="Clique para alternar entre quadros (HH:MM:SS:FF) e milissegundos (HH:MM:SS.mmm)"
      onClick={() => prefsStore.set({ timeMode: timeMode === 'frames' ? 'ms' : 'frames' })}
      data-testid="timecode"
    >
      {formatTime(time, fps, timeMode)}
    </button>
  );
}

function Playhead({ zoom, scrollRef }: { zoom: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const { time, playing } = usePlayback();
  const x = time * zoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    if (x > el.scrollLeft + el.clientWidth - 30 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 60);
  }, [x, playing, scrollRef]);
  return <div className="playhead" style={{ left: x }} />;
}

function TrackHead({ track, canRemove }: { track: Track; canRemove: boolean }) {
  const set = (patch: Partial<Track>, label: string) => store.execute(Cmd.updateTrack(track.id, patch, label));
  return (
    <div className={`track-head ${track.kind}`} style={{ height: trackHeight(track) }}>
      <button
        className="name"
        title="Selecionar todos os clipes da trilha (Shift: somar à seleção)"
        onClick={(e) => {
          const ids = Object.values(store.getState().project.clips).filter((c) => c.trackId === track.id).map((c) => c.id);
          store.select(e.shiftKey ? [...new Set([...store.getState().selection, ...ids])] : ids);
        }}
      >
        {track.name}
      </button>
      {track.kind === 'video' && (
        <button className={`btn icon sm${track.hidden ? ' active' : ''}`} title={track.hidden ? 'Mostrar trilha' : 'Esconder trilha'} onClick={() => set({ hidden: !track.hidden }, 'Visibilidade da trilha')}>
          {track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}
      <button className={`btn icon sm${track.muted ? ' active' : ''}`} title={track.muted ? 'Ativar som' : 'Silenciar trilha'} onClick={() => set({ muted: !track.muted }, 'Mudo da trilha')}>
        {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
      <button className={`btn icon sm${track.locked ? ' active' : ''}`} title={track.locked ? 'Destravar' : 'Travar'} onClick={() => set({ locked: !track.locked }, 'Trava da trilha')}>
        {track.locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
      {canRemove && (
        <button
          className="btn icon sm danger"
          title="Remover trilha"
          onClick={() => {
            const n = Object.values(store.getState().project.clips).filter((c) => c.trackId === track.id).length;
            if (n && !confirm(`Remover ${track.name} e seus ${n} clipe(s)?`)) return;
            store.execute(Cmd.removeTrack(track.id));
          }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

interface TrackIndex {
  clips: Clip[];
  maxDuration: number;
}

/** Clipes de cada trilha ordenados pelo início (recalculado só quando os clipes mudam). */
function indexByTrack(clips: Record<string, Clip>): Map<string, TrackIndex> {
  const map = new Map<string, TrackIndex>();
  for (const c of Object.values(clips)) {
    let e = map.get(c.trackId);
    if (!e) map.set(c.trackId, (e = { clips: [], maxDuration: 0 }));
    e.clips.push(c);
    if (c.duration > e.maxDuration) e.maxDuration = c.duration;
  }
  for (const e of map.values()) e.clips.sort((a, b) => a.start - b.start);
  return map;
}

/** Busca binária: só os clipes que cruzam [t0, t1]. */
function visibleClips(idx: TrackIndex | undefined, t0: number, t1: number): Clip[] {
  if (!idx) return [];
  const list = idx.clips;
  let lo = 0;
  let hi = list.length;
  const from = t0 - idx.maxDuration;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start < from) lo = mid + 1;
    else hi = mid;
  }
  const out: Clip[] = [];
  for (let i = lo; i < list.length && list[i].start <= t1; i++) {
    if (list[i].start + list[i].duration >= t0) out.push(list[i]);
  }
  return out;
}
