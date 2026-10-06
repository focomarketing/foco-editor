// Operações puras de edição sobre o Project. Nenhuma delas muta a entrada:
// todas devolvem um novo Project (o histórico de undo/redo depende disso).
//
// Semântica de sobreposição: "overwrite" (como Premiere/Resolve). Ao colocar um clipe
// sobre outro na mesma trilha, o trecho coberto do clipe de baixo é removido. Assim
// uma trilha nunca tem dois clipes no mesmo instante, o que simplifica o compositor.

import type { Asset, Clip, Project, Track, TrackKind } from '../../core/types';
import { DEFAULT_TRANSFORM } from '../../core/types';
import { EPS, newId } from '../../core/time';
import { speedOf, sourceEnd, sourceSpan } from '../../core/clipTime';
import type { Folder, Marker } from '../../core/types';

export const IMAGE_DEFAULT_DURATION = 5;

export const clipEnd = (c: Clip) => c.start + c.duration;

export function clipsOnTrack(p: Project, trackId: string): Clip[] {
  return Object.values(p.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
}

export function projectDuration(p: Project): number {
  let end = 0;
  for (const c of Object.values(p.clips)) end = Math.max(end, clipEnd(c));
  return end;
}

export function trackKindForAsset(asset: Asset): TrackKind {
  return asset.kind === 'audio' ? 'audio' : 'video';
}

/** Imagem ou SVG: um quadro fixo desenhado como imagem. */
export const isStill = (asset: Asset) => asset.kind === 'image' || asset.kind === 'svg';

/** Pode ir para a timeline (fontes não). */
export const isPlaceable = (asset: Asset) => asset.kind !== 'font';

/** Imagens/SVG não têm duração própria (podem ser esticados à vontade). */
export const hasTimeLimit = (asset: Asset) => asset.kind === 'video' || asset.kind === 'audio';

/** Quanto de mídia existe a partir de sourceIn=0. */
export function sourceLength(asset: Asset): number {
  return hasTimeLimit(asset) ? asset.duration : Infinity;
}

export function getTrack(p: Project, trackId: string): Track | undefined {
  return p.tracks.find((t) => t.id === trackId);
}

// ---------------------------------------------------------------------------
// Overwrite
// ---------------------------------------------------------------------------

/** Remove o conteúdo de [start, end) de uma trilha, cortando/dividindo clipes parcialmente cobertos. */
export function clearRange(
  clips: Record<string, Clip>,
  trackId: string,
  start: number,
  end: number,
  except: ReadonlySet<string> = new Set(),
): Record<string, Clip> {
  const out = { ...clips };
  for (const c of Object.values(clips)) {
    if (c.trackId !== trackId || except.has(c.id)) continue;
    const cs = c.start;
    const ce = clipEnd(c);
    if (ce <= start + EPS || cs >= end - EPS) continue;

    if (cs >= start - EPS && ce <= end + EPS) {
      delete out[c.id];
    } else if (cs < start && ce > end) {
      out[c.id] = { ...c, duration: start - cs };
      const rightId = newId('c');
      out[rightId] = { ...c, id: rightId, start: end, duration: ce - end, sourceIn: c.sourceIn + (end - cs) * speedOf(c) };
    } else if (cs < start) {
      out[c.id] = { ...c, duration: start - cs };
    } else {
      out[c.id] = { ...c, start: end, duration: ce - end, sourceIn: c.sourceIn + (end - cs) * speedOf(c) };
    }
  }
  return out;
}

function placeClip(clips: Record<string, Clip>, clip: Clip, except: ReadonlySet<string>): Record<string, Clip> {
  const out = clearRange(clips, clip.trackId, clip.start, clipEnd(clip), except);
  out[clip.id] = clip;
  return out;
}

// ---------------------------------------------------------------------------
// Clipes
// ---------------------------------------------------------------------------

export function createClip(asset: Asset, trackId: string, start: number): Clip {
  return {
    id: newId('c'),
    assetId: asset.id,
    trackId,
    start: Math.max(0, start),
    duration: hasTimeLimit(asset) ? asset.duration : IMAGE_DEFAULT_DURATION,
    sourceIn: 0,
    volume: 1,
    speed: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
  };
}

export function addClip(p: Project, clip: Clip): Project {
  return { ...p, clips: placeClip(p.clips, clip, new Set([clip.id])) };
}

export function updateClip(p: Project, id: string, patch: Partial<Omit<Clip, 'id'>>): Project {
  const c = p.clips[id];
  if (!c) return p;
  return { ...p, clips: { ...p.clips, [id]: { ...c, ...patch } } };
}

export interface ClipMove {
  id: string;
  start: number;
  trackId: string;
}

/** Move vários clipes de uma vez (overwrite no destino). */
export function moveClips(p: Project, moves: ClipMove[]): Project {
  const moving = new Set(moves.map((m) => m.id));
  let clips = { ...p.clips };
  for (const id of moving) delete clips[id];
  for (const m of moves) {
    const c = p.clips[m.id];
    if (!c) continue;
    const moved: Clip = { ...c, start: Math.max(0, m.start), trackId: m.trackId };
    clips = placeClip(clips, moved, moving);
  }
  return { ...p, clips };
}

/**
 * Limites válidos para aparar uma borda: não passa do começo/fim da mídia,
 * não invade o vizinho e mantém pelo menos um quadro.
 */
export function trimBounds(p: Project, id: string, edge: 'start' | 'end'): [number, number] {
  const c = p.clips[id];
  const asset = p.assets[c.assetId];
  const minDur = 1 / p.settings.fps;
  const neighbors = clipsOnTrack(p, c.trackId).filter((o) => o.id !== c.id);
  if (edge === 'start') {
    const prevEnd = Math.max(0, ...neighbors.filter((o) => clipEnd(o) <= c.start + EPS).map(clipEnd));
    const mediaMin = asset && hasTimeLimit(asset) ? c.start - c.sourceIn / speedOf(c) : -Infinity;
    return [Math.max(prevEnd, mediaMin, 0), clipEnd(c) - minDur];
  }
  const nextStart = Math.min(Infinity, ...neighbors.filter((o) => o.start >= clipEnd(c) - EPS).map((o) => o.start));
  const mediaMax = asset ? c.start + (sourceLength(asset) - c.sourceIn) / speedOf(c) : Infinity;
  return [c.start + minDur, Math.min(nextStart, mediaMax)];
}

export function trimClip(p: Project, id: string, edge: 'start' | 'end', t: number): Project {
  const c = p.clips[id];
  if (!c) return p;
  const [min, max] = trimBounds(p, id, edge);
  const v = Math.min(max, Math.max(min, t));
  if (edge === 'start') {
    const delta = v - c.start;
    return updateClip(p, id, { start: v, duration: c.duration - delta, sourceIn: c.sourceIn + delta * speedOf(c) });
  }
  return updateClip(p, id, { duration: v - c.start });
}

/** Divide os clipes que cruzam o tempo t. Devolve os ids das metades da direita. */
export function splitClips(p: Project, ids: string[], t: number): { project: Project; created: string[] } {
  const clips = { ...p.clips };
  const created: string[] = [];
  for (const id of ids) {
    const c = clips[id];
    if (!c || t <= c.start + EPS || t >= clipEnd(c) - EPS) continue;
    const leftDur = t - c.start;
    clips[id] = { ...c, duration: leftDur };
    const rightId = newId('c');
    clips[rightId] = { ...c, id: rightId, start: t, duration: c.duration - leftDur, sourceIn: c.sourceIn + leftDur * speedOf(c), fadeIn: 0 };
    clips[id] = { ...clips[id], fadeOut: 0 };
    created.push(rightId);
  }
  return { project: { ...p, clips }, created };
}

/** Clipes que cruzam o tempo t (em trilhas destravadas). */
export function clipsAt(p: Project, t: number): Clip[] {
  const unlocked = new Set(p.tracks.filter((tr) => !tr.locked).map((tr) => tr.id));
  return Object.values(p.clips).filter((c) => unlocked.has(c.trackId) && c.start < t - EPS && clipEnd(c) > t + EPS);
}

/**
 * Apaga clipes. Com ripple, os clipes posteriores da mesma trilha andam para a
 * esquerda e fecham o buraco.
 */
export function deleteClips(p: Project, ids: string[], ripple = false): Project {
  const removed = ids.map((id) => p.clips[id]).filter(Boolean);
  const clips = { ...p.clips };
  for (const c of removed) delete clips[c.id];
  if (ripple) {
    for (const c of Object.values(clips)) {
      const shift = removed
        .filter((r) => r.trackId === c.trackId && clipEnd(r) <= c.start + EPS)
        .reduce((acc, r) => acc + r.duration, 0);
      if (shift > 0) clips[c.id] = { ...c, start: c.start - shift };
    }
  }
  return { ...p, clips };
}

export type Range = [number, number];

/** Ordena e une intervalos que se tocam ou se sobrepõem. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter(([a, b]) => b - a > EPS).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Remove intervalos de tempo da timeline em todas as trilhas destravadas e puxa
 * tudo o que vem depois para a esquerda (como um ripple delete com sync lock).
 * Mantém vídeo, áudio separado e legendas sincronizados.
 */
export function rippleRemoveRanges(p: Project, ranges: Range[]): Project {
  const unlocked = p.tracks.filter((t) => !t.locked).map((t) => t.id);
  const unlockedSet = new Set(unlocked);
  let clips = { ...p.clips };
  for (const [a, b] of mergeRanges(ranges).reverse()) {
    for (const trackId of unlocked) clips = clearRange(clips, trackId, a, b);
    const len = b - a;
    for (const c of Object.values(clips)) {
      if (unlockedSet.has(c.trackId) && c.start >= b - EPS) clips[c.id] = { ...c, start: c.start - len };
    }
  }
  return { ...p, clips };
}

/** Converte intervalos no tempo da mídia de origem para o tempo da timeline (todos os clipes daquele asset). */
export function sourceRangesToTimeline(p: Project, assetId: string, ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const c of Object.values(p.clips)) {
    if (c.assetId !== assetId || c.caption) continue;
    const srcEnd = sourceEnd(c);
    const k = speedOf(c);
    for (const [a, b] of ranges) {
      const s = Math.max(a, c.sourceIn);
      const e = Math.min(b, srcEnd);
      if (e - s > EPS) out.push([c.start + (s - c.sourceIn) / k, c.start + (e - c.sourceIn) / k]);
    }
  }
  return mergeRanges(out);
}

/** Converte um tempo da mídia de origem para a timeline (primeiro clipe que o contém). */
export function sourceTimeToTimeline(p: Project, assetId: string, t: number): number | null {
  for (const c of Object.values(p.clips)) {
    if (c.assetId !== assetId || c.caption) continue;
    if (t >= c.sourceIn - EPS && t < sourceEnd(c)) return c.start + (t - c.sourceIn) / speedOf(c);
  }
  return null;
}

/** Cola cópias dos clipes no tempo `at`, mantendo o espaçamento relativo entre eles. */
export function pasteClips(p: Project, source: Clip[], at: number): { project: Project; created: string[] } {
  if (source.length === 0) return { project: p, created: [] };
  const base = Math.min(...source.map((c) => c.start));
  let clips = { ...p.clips };
  const created: string[] = [];
  for (const c of source) {
    const asset = p.assets[c.assetId];
    if (!asset && !c.caption && !c.title) continue;
    let trackId = c.trackId;
    if (!getTrack(p, trackId)) {
      const kind = asset ? trackKindForAsset(asset) : 'video';
      const t = p.tracks.find((tr) => tr.kind === kind);
      if (!t) continue;
      trackId = t.id;
    }
    const copy: Clip = { ...c, id: newId('c'), trackId, start: at + (c.start - base) };
    clips = placeClip(clips, copy, new Set([copy.id]));
    created.push(copy.id);
  }
  return { project: { ...p, clips }, created };
}

// ---------------------------------------------------------------------------
// Trilhas
// ---------------------------------------------------------------------------

export function addTrack(p: Project, kind: TrackKind, opts: { id?: string; name?: string } = {}): Project {
  const prefix = kind === 'video' ? 'V' : 'A';
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  const track: Track = { id: opts.id ?? newId('t'), kind, name: opts.name ?? `${prefix}${n}`, muted: false, hidden: false, locked: false };
  // Vídeos novos entram no topo (ficam por cima na composição); áudios no fim.
  const tracks = kind === 'video' ? [track, ...p.tracks] : [...p.tracks, track];
  return { ...p, tracks };
}

export function updateTrack(p: Project, id: string, patch: Partial<Omit<Track, 'id' | 'kind'>>): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function removeTrack(p: Project, id: string): Project {
  const track = getTrack(p, id);
  if (!track) return p;
  if (p.tracks.filter((t) => t.kind === track.kind).length <= 1) return p;
  const clips = Object.fromEntries(Object.entries(p.clips).filter(([, c]) => c.trackId !== id));
  return { ...p, tracks: p.tracks.filter((t) => t.id !== id), clips };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export function addAssets(p: Project, assets: Asset[]): Project {
  const all = { ...p.assets };
  for (const a of assets) all[a.id] = a;
  return { ...p, assets: all };
}

export function removeAsset(p: Project, assetId: string): Project {
  const assets = { ...p.assets };
  delete assets[assetId];
  const clips = Object.fromEntries(Object.entries(p.clips).filter(([, c]) => c.assetId !== assetId));
  return { ...p, assets, clips };
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

export function snapPoints(p: Project, exclude: ReadonlySet<string>, playhead: number): number[] {
  const pts = [0, playhead, ...p.markers.map((m) => m.time)];
  for (const c of Object.values(p.clips)) {
    if (exclude.has(c.id)) continue;
    pts.push(c.start, clipEnd(c));
  }
  return pts;
}

/** Devolve o ponto de snap mais próximo dentro do limiar, ou null. */
export function findSnap(t: number, points: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const pt of points) {
    const d = Math.abs(pt - t);
    if (d <= bestDist) {
      best = pt;
      bestDist = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Projeto
// ---------------------------------------------------------------------------

export function createProject(name = 'Projeto sem título'): Project {
  const now = Date.now();
  return {
    version: 2,
    id: newId('p'),
    name,
    createdAt: now,
    updatedAt: now,
    settings: { width: 1920, height: 1080, fps: 30 },
    assets: {},
    tracks: [
      { id: newId('t'), kind: 'video', name: 'V2', muted: false, hidden: false, locked: false },
      { id: newId('t'), kind: 'video', name: 'V1', muted: false, hidden: false, locked: false },
      { id: newId('t'), kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false },
      { id: newId('t'), kind: 'audio', name: 'A2', muted: false, hidden: false, locked: false },
    ],
    clips: {},
    folders: {},
    markers: [],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Velocidade
// ---------------------------------------------------------------------------

/**
 * Muda a velocidade mantendo o mesmo trecho de mídia: a duração na timeline muda e os
 * clipes seguintes da mesma trilha acompanham (ripple), para nada ser sobrescrito.
 */
export function setSpeed(p: Project, ids: string[], speed: number): Project {
  const v = Math.min(16, Math.max(0.1, speed));
  let clips = { ...p.clips };
  for (const id of ids) {
    const c = clips[id];
    if (!c || c.caption || c.title) continue;
    const span = sourceSpan(c);
    const duration = span / v;
    const delta = duration - c.duration;
    const end = clipEnd(c);
    clips[id] = { ...c, speed: v, duration };
    if (Math.abs(delta) > EPS) {
      for (const o of Object.values(clips)) {
        if (o.id !== id && o.trackId === c.trackId && o.start >= end - EPS) clips[o.id] = { ...o, start: o.start + delta };
      }
    }
  }
  if (clips === p.clips) clips = { ...clips };
  return { ...p, clips };
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

export function addMarker(p: Project, m: Marker): Project {
  return { ...p, markers: [...p.markers.filter((x) => x.id !== m.id), m].sort((a, b) => a.time - b.time) };
}

export function updateMarker(p: Project, id: string, patch: Partial<Omit<Marker, 'id'>>): Project {
  return { ...p, markers: p.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.time - b.time) };
}

export function removeMarker(p: Project, id: string): Project {
  return { ...p, markers: p.markers.filter((m) => m.id !== id) };
}

// ---------------------------------------------------------------------------
// Media Bin: renomear e pastas
// ---------------------------------------------------------------------------

export function renameAsset(p: Project, assetId: string, name: string): Project {
  const a = p.assets[assetId];
  if (!a || !name.trim()) return p;
  return { ...p, assets: { ...p.assets, [assetId]: { ...a, name: name.trim() } } };
}

export function moveAssetsToFolder(p: Project, ids: string[], folderId: string | null): Project {
  const assets = { ...p.assets };
  for (const id of ids) if (assets[id]) assets[id] = { ...assets[id], folderId };
  return { ...p, assets };
}

export function addFolder(p: Project, f: Folder): Project {
  return { ...p, folders: { ...p.folders, [f.id]: f } };
}

export function renameFolder(p: Project, id: string, name: string): Project {
  const f = p.folders[id];
  if (!f || !name.trim()) return p;
  return { ...p, folders: { ...p.folders, [id]: { ...f, name: name.trim() } } };
}

/** Remove a pasta; o conteúdo (mídias e subpastas) sobe para a pasta-mãe. */
export function removeFolder(p: Project, id: string): Project {
  const f = p.folders[id];
  if (!f) return p;
  const folders = { ...p.folders };
  delete folders[id];
  for (const sub of Object.values(folders)) if (sub.parentId === id) folders[sub.id] = { ...sub, parentId: f.parentId };
  const assets = { ...p.assets };
  for (const a of Object.values(assets)) if (a.folderId === id) assets[a.id] = { ...a, folderId: f.parentId };
  return { ...p, folders, assets };
}
