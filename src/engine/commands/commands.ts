// EDIT COMMAND ENGINE — linguagem única de edição.
// Toda alteração do projeto (UI, atalhos, IA) é um comando nomeado com payload
// serializável. O histórico guarda o comando + o patch reversível (undo/redo).
// A IA não toca no estado: ela produz comandos, que passam por validação antes.

import type {
  Asset, AudioFx, BlendMode, CaptionData, Clip, ColorSettings, Crop, Folder, Keyframes, Marker, Project,
  SequenceSettings, TitleData, TitleTemplate, Track, TrackKind, Transform,
} from '../../core/types';
import * as ops from '../timeline/operations';
import type { ClipMove, Range } from '../timeline/operations';
import { applyCaptions } from '../captions/captions';
import type { TimelineWord } from '../captions/captions';
import { addTitle } from '../motion/insert';

export interface EditCommand<P = unknown> {
  type: string;
  label: string;
  payload: P;
  execute(p: Project): Project;
}

/** Forma serializável (histórico, IA, logs, testes). */
export interface CommandJSON {
  type: string;
  label: string;
  payload: unknown;
}

export const toJSON = (c: EditCommand): CommandJSON => ({ type: c.type, label: c.label, payload: c.payload });

const cmd = <P>(type: string, label: string, payload: P, execute: (p: Project, payload: P) => Project): EditCommand<P> => ({
  type,
  label,
  payload,
  execute: (p) => execute(p, payload),
});

/** Atualiza um campo em vários clipes; `values[id] = undefined` remove o campo. */
function setClipField<K extends keyof Clip>(p: Project, field: K, values: Record<string, Clip[K] | undefined>): Project {
  const clips = { ...p.clips };
  for (const [id, v] of Object.entries(values)) {
    const c = clips[id];
    if (!c) continue;
    const next = { ...c };
    if (v === undefined) delete next[field];
    else next[field] = v as Clip[K];
    clips[id] = next;
  }
  return { ...p, clips };
}

export const Cmd = {
  // --- mídia / Media Bin ------------------------------------------------------
  importAssets: (assets: Asset[]) =>
    cmd('IMPORT_ASSETS', `Importar ${assets.length} mídia(s)`, { assets }, (p, x) => ops.addAssets(p, x.assets)),
  removeAsset: (assetId: string) => cmd('REMOVE_ASSET', 'Remover mídia', { assetId }, (p, x) => ops.removeAsset(p, x.assetId)),
  /** Substitui os metadados de uma mídia (ex.: arquivo recarregado depois de alterado). */
  updateAsset: (asset: Asset, label = 'Atualizar mídia') =>
    cmd('UPDATE_ASSET', label, { asset }, (p, x) => (p.assets[x.asset.id] ? { ...p, assets: { ...p.assets, [x.asset.id]: x.asset } } : p)),
  renameAsset: (assetId: string, name: string) =>
    cmd('RENAME_ASSET', 'Renomear mídia', { assetId, name }, (p, x) => ops.renameAsset(p, x.assetId, x.name)),
  moveAssets: (assetIds: string[], folderId: string | null) =>
    cmd('MOVE_ASSETS', 'Mover para pasta', { assetIds, folderId }, (p, x) => ops.moveAssetsToFolder(p, x.assetIds, x.folderId)),
  addFolder: (folder: Folder) => cmd('ADD_FOLDER', 'Nova pasta', { folder }, (p, x) => ops.addFolder(p, x.folder)),
  renameFolder: (folderId: string, name: string) =>
    cmd('RENAME_FOLDER', 'Renomear pasta', { folderId, name }, (p, x) => ops.renameFolder(p, x.folderId, x.name)),
  removeFolder: (folderId: string) => cmd('REMOVE_FOLDER', 'Apagar pasta', { folderId }, (p, x) => ops.removeFolder(p, x.folderId)),

  // --- clipes -----------------------------------------------------------------
  addClip: (clip: Clip) => cmd('ADD_CLIP', 'Adicionar clipe', { clip }, (p, x) => ops.addClip(p, x.clip)),
  moveClips: (moves: ClipMove[]) => cmd('MOVE_CLIPS', 'Mover', { moves }, (p, x) => ops.moveClips(p, x.moves)),
  trimClip: (clipId: string, edge: 'start' | 'end', time: number) =>
    cmd('TRIM_CLIP', 'Aparar', { clipId, edge, time }, (p, x) => ops.trimClip(p, x.clipId, x.edge, x.time)),
  splitClips: (clipIds: string[], time: number) =>
    cmd('SPLIT_CLIP', 'Dividir', { clipIds, time }, (p, x) => ops.splitClips(p, x.clipIds, x.time).project),
  deleteClips: (clipIds: string[], ripple = false) =>
    cmd(ripple ? 'RIPPLE_DELETE' : 'DELETE_CLIP', ripple ? 'Ripple delete' : 'Apagar', { clipIds, ripple }, (p, x) => ops.deleteClips(p, x.clipIds, x.ripple)),
  pasteClips: (clips: Clip[], at: number, label = 'Colar') =>
    cmd('PASTE_CLIPS', label, { clips, at }, (p, x) => ops.pasteClips(p, x.clips, x.at).project),
  setTransform: (values: Record<string, Partial<Transform>>, label = 'Transformação') =>
    cmd('SET_TRANSFORM', label, { values }, (p, x) => {
      const clips = { ...p.clips };
      for (const [id, t] of Object.entries(x.values)) if (clips[id]) clips[id] = { ...clips[id], transform: { ...clips[id].transform, ...t } };
      return { ...p, clips };
    }),
  setVolume: (values: Record<string, number>) =>
    cmd('SET_VOLUME', 'Volume', { values }, (p, x) => setClipField(p, 'volume', x.values)),
  setMute: (values: Record<string, boolean>) =>
    cmd('SET_MUTE', 'Mudo', { values }, (p, x) => setClipField(p, 'muted', x.values)),
  setFades: (values: Record<string, { fadeIn?: number; fadeOut?: number }>) =>
    cmd('SET_FADE', 'Fade de áudio', { values }, (p, x) => {
      const clips = { ...p.clips };
      for (const [id, f] of Object.entries(x.values)) {
        const c = clips[id];
        if (!c) continue;
        const half = c.duration / 2;
        clips[id] = { ...c, fadeIn: Math.min(half, Math.max(0, f.fadeIn ?? c.fadeIn)), fadeOut: Math.min(half, Math.max(0, f.fadeOut ?? c.fadeOut)) };
      }
      return { ...p, clips };
    }),
  setSpeed: (clipIds: string[], speed: number) =>
    cmd('SET_SPEED', `Velocidade ${speed}x`, { clipIds, speed }, (p, x) => ops.setSpeed(p, x.clipIds, x.speed)),
  setCrop: (values: Record<string, Crop | undefined>) => cmd('SET_CROP', 'Crop', { values }, (p, x) => setClipField(p, 'crop', x.values)),
  setBlend: (values: Record<string, BlendMode | undefined>) =>
    cmd('SET_BLEND', 'Modo de mesclagem', { values }, (p, x) => setClipField(p, 'blendMode', x.values)),
  setColor: (values: Record<string, ColorSettings | undefined>, label = 'Cor') =>
    cmd('SET_COLOR', label, { values }, (p, x) => setClipField(p, 'color', x.values)),
  setAudioFx: (values: Record<string, AudioFx | undefined>, label = 'Áudio') =>
    cmd('SET_AUDIO_FX', label, { values }, (p, x) => setClipField(p, 'audio', x.values)),
  setKeyframes: (values: Record<string, Keyframes | undefined>, label = 'Keyframes') =>
    cmd('SET_KEYFRAMES', label, { values }, (p, x) => setClipField(p, 'keyframes', x.values)),
  setCaption: (clipId: string, caption: CaptionData, label = 'Editar legenda') =>
    cmd('SET_CAPTION', label, { clipId, caption }, (p, x) => setClipField(p, 'caption', { [x.clipId]: x.caption })),
  setTitle: (clipId: string, title: TitleData, label = 'Editar gráfico') =>
    cmd('SET_TITLE', label, { clipId, title }, (p, x) => setClipField(p, 'title', { [x.clipId]: x.title })),
  rippleRemove: (ranges: Range[], label = 'Remover trechos') =>
    cmd('RIPPLE_REMOVE_RANGES', label, { ranges }, (p, x) => ops.rippleRemoveRanges(p, x.ranges)),

  // --- gráficos / legendas -------------------------------------------------------
  addTitle: (opts: { template: TitleTemplate; text: string; subtitle?: string; at: number; duration: number }) =>
    cmd('ADD_TITLE', `Inserir gráfico`, opts, (p, x) => addTitle(p, x).project),
  generateCaptions: (words: TimelineWord[], preset: string) =>
    cmd('GENERATE_CAPTIONS', 'Gerar legendas', { words, preset }, (p, x) => applyCaptions(p, x.words, x.preset).project),

  // --- trilhas -------------------------------------------------------------------
  addTrack: (kind: TrackKind, opts: { id?: string; name?: string } = {}) =>
    cmd('ADD_TRACK', 'Nova trilha', { kind, ...opts }, (p, x) => ops.addTrack(p, x.kind, { id: x.id, name: x.name })),
  updateTrack: (trackId: string, patch: Partial<Omit<Track, 'id' | 'kind'>>, label = 'Trilha') =>
    cmd('UPDATE_TRACK', label, { trackId, patch }, (p, x) => ops.updateTrack(p, x.trackId, x.patch)),
  removeTrack: (trackId: string) => cmd('REMOVE_TRACK', 'Remover trilha', { trackId }, (p, x) => ops.removeTrack(p, x.trackId)),

  // --- sequência / projeto ----------------------------------------------------------
  setSequence: (patch: Partial<SequenceSettings>, label = 'Sequência') =>
    cmd('SET_SEQUENCE', label, { patch }, (p, x) => ({ ...p, settings: { ...p.settings, ...x.patch } })),
  renameProject: (name: string) => cmd('RENAME_PROJECT', 'Renomear projeto', { name }, (p, x) => ({ ...p, name: x.name })),
  addMarker: (marker: Marker) => cmd('ADD_MARKER', 'Adicionar marcador', { marker }, (p, x) => ops.addMarker(p, x.marker)),
  updateMarker: (markerId: string, patch: Partial<Omit<Marker, 'id'>>) =>
    cmd('UPDATE_MARKER', 'Editar marcador', { markerId, patch }, (p, x) => ops.updateMarker(p, x.markerId, x.patch)),
  removeMarker: (markerId: string) => cmd('REMOVE_MARKER', 'Apagar marcador', { markerId }, (p, x) => ops.removeMarker(p, x.markerId)),

  /** Vários comandos como UM passo de histórico (ex.: uma edição da IA). */
  batch: (label: string, commands: EditCommand[], type = 'BATCH') =>
    cmd(type, label, { commands: commands.map(toJSON) }, (p) => commands.reduce((acc, c) => c.execute(acc), p)),
};

type Factory = (payload: never) => EditCommand;

/** Reconstrói um comando a partir do JSON (para comandos vindos da IA, de arquivos ou testes). */
const REGISTRY: Record<string, Factory> = {
  IMPORT_ASSETS: (x: { assets: Asset[] }) => Cmd.importAssets(x.assets),
  REMOVE_ASSET: (x: { assetId: string }) => Cmd.removeAsset(x.assetId),
  UPDATE_ASSET: (x: { asset: Asset }) => Cmd.updateAsset(x.asset),
  RENAME_ASSET: (x: { assetId: string; name: string }) => Cmd.renameAsset(x.assetId, x.name),
  MOVE_ASSETS: (x: { assetIds: string[]; folderId: string | null }) => Cmd.moveAssets(x.assetIds, x.folderId),
  ADD_FOLDER: (x: { folder: Folder }) => Cmd.addFolder(x.folder),
  RENAME_FOLDER: (x: { folderId: string; name: string }) => Cmd.renameFolder(x.folderId, x.name),
  REMOVE_FOLDER: (x: { folderId: string }) => Cmd.removeFolder(x.folderId),
  ADD_CLIP: (x: { clip: Clip }) => Cmd.addClip(x.clip),
  MOVE_CLIPS: (x: { moves: ClipMove[] }) => Cmd.moveClips(x.moves),
  TRIM_CLIP: (x: { clipId: string; edge: 'start' | 'end'; time: number }) => Cmd.trimClip(x.clipId, x.edge, x.time),
  SPLIT_CLIP: (x: { clipIds: string[]; time: number }) => Cmd.splitClips(x.clipIds, x.time),
  DELETE_CLIP: (x: { clipIds: string[] }) => Cmd.deleteClips(x.clipIds, false),
  RIPPLE_DELETE: (x: { clipIds: string[] }) => Cmd.deleteClips(x.clipIds, true),
  PASTE_CLIPS: (x: { clips: Clip[]; at: number }) => Cmd.pasteClips(x.clips, x.at),
  SET_TRANSFORM: (x: { values: Record<string, Partial<Transform>> }) => Cmd.setTransform(x.values),
  SET_VOLUME: (x: { values: Record<string, number> }) => Cmd.setVolume(x.values),
  SET_MUTE: (x: { values: Record<string, boolean> }) => Cmd.setMute(x.values),
  SET_FADE: (x: { values: Record<string, { fadeIn?: number; fadeOut?: number }> }) => Cmd.setFades(x.values),
  SET_SPEED: (x: { clipIds: string[]; speed: number }) => Cmd.setSpeed(x.clipIds, x.speed),
  SET_CROP: (x: { values: Record<string, Crop | undefined> }) => Cmd.setCrop(x.values),
  SET_BLEND: (x: { values: Record<string, BlendMode | undefined> }) => Cmd.setBlend(x.values),
  SET_COLOR: (x: { values: Record<string, ColorSettings | undefined> }) => Cmd.setColor(x.values),
  SET_AUDIO_FX: (x: { values: Record<string, AudioFx | undefined> }) => Cmd.setAudioFx(x.values),
  SET_KEYFRAMES: (x: { values: Record<string, Keyframes | undefined> }) => Cmd.setKeyframes(x.values),
  SET_CAPTION: (x: { clipId: string; caption: CaptionData }) => Cmd.setCaption(x.clipId, x.caption),
  SET_TITLE: (x: { clipId: string; title: TitleData }) => Cmd.setTitle(x.clipId, x.title),
  RIPPLE_REMOVE_RANGES: (x: { ranges: Range[] }) => Cmd.rippleRemove(x.ranges),
  ADD_TITLE: (x: { template: TitleTemplate; text: string; subtitle?: string; at: number; duration: number }) => Cmd.addTitle(x),
  GENERATE_CAPTIONS: (x: { words: TimelineWord[]; preset: string }) => Cmd.generateCaptions(x.words, x.preset),
  ADD_TRACK: (x: { kind: TrackKind; id?: string; name?: string }) => Cmd.addTrack(x.kind, x),
  UPDATE_TRACK: (x: { trackId: string; patch: Partial<Track> }) => Cmd.updateTrack(x.trackId, x.patch),
  REMOVE_TRACK: (x: { trackId: string }) => Cmd.removeTrack(x.trackId),
  SET_SEQUENCE: (x: { patch: Partial<SequenceSettings> }) => Cmd.setSequence(x.patch),
  RENAME_PROJECT: (x: { name: string }) => Cmd.renameProject(x.name),
  ADD_MARKER: (x: { marker: Marker }) => Cmd.addMarker(x.marker),
  UPDATE_MARKER: (x: { markerId: string; patch: Partial<Marker> }) => Cmd.updateMarker(x.markerId, x.patch),
  REMOVE_MARKER: (x: { markerId: string }) => Cmd.removeMarker(x.markerId),
};

export function commandFromJSON(j: CommandJSON): EditCommand {
  if (j.type === 'BATCH' || j.type === 'AI_EDIT') {
    const inner = ((j.payload as { commands?: CommandJSON[] })?.commands ?? []).map(commandFromJSON);
    return Cmd.batch(j.label, inner, j.type);
  }
  const f = REGISTRY[j.type];
  if (!f) throw new Error(`Comando desconhecido: ${j.type}`);
  const c = f(j.payload as never);
  return { ...c, label: j.label || c.label };
}

export const COMMAND_TYPES = Object.keys(REGISTRY);

/**
 * Converte uma alteração de campos de um clipe no(s) comando(s) nomeado(s) correspondente(s).
 * Usado pelos controles do Inspector (cada campo tem seu comando no histórico).
 */
export function clipPatchCommand(clipId: string, patch: Partial<Clip>, label?: string): EditCommand {
  const list: EditCommand[] = [];
  const has = (k: keyof Clip) => Object.prototype.hasOwnProperty.call(patch, k);
  if (has('transform')) list.push(Cmd.setTransform({ [clipId]: patch.transform! }, label));
  if (has('volume')) list.push(Cmd.setVolume({ [clipId]: patch.volume! }));
  if (has('muted')) list.push(Cmd.setMute({ [clipId]: !!patch.muted }));
  if (has('fadeIn') || has('fadeOut')) list.push(Cmd.setFades({ [clipId]: { fadeIn: patch.fadeIn, fadeOut: patch.fadeOut } }));
  if (has('speed')) list.push(Cmd.setSpeed([clipId], patch.speed!));
  if (has('crop')) list.push(Cmd.setCrop({ [clipId]: patch.crop }));
  if (has('blendMode')) list.push(Cmd.setBlend({ [clipId]: patch.blendMode }));
  if (has('color')) list.push(Cmd.setColor({ [clipId]: patch.color }, label));
  if (has('audio')) list.push(Cmd.setAudioFx({ [clipId]: patch.audio }, label));
  if (has('keyframes')) list.push(Cmd.setKeyframes({ [clipId]: patch.keyframes }, label));
  if (has('caption') && patch.caption) list.push(Cmd.setCaption(clipId, patch.caption, label));
  if (has('title') && patch.title) list.push(Cmd.setTitle(clipId, patch.title, label));
  if (list.length === 1) return label ? { ...list[0], label } : list[0];
  return Cmd.batch(label ?? 'Editar clipe', list);
}
