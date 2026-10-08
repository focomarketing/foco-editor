// Composição dos engines + comandos do editor (usados pela UI e pelos atalhos).

import type { Asset, CaptionStyle, Project, Transcript } from '../core/types';
import { snapToFrame } from '../core/time';
import { EditorStore } from '../engine/timeline/EditorStore';
import { cache } from '../engine/cache/CacheEngine';
import { jobs } from '../engine/jobs/JobQueue';
import { recommendProxy } from '../engine/media/proxy';
import type { ProxyResolution } from '../engine/media/proxy';
import type { DuplicateChoice } from '../engine/media/MediaEngine';
import { detectHardware } from '../engine/diagnostics/hardware';
import { effectiveMode, prefsStore } from './prefs';
import { ask } from './dialogs';
import { Cmd } from '../engine/commands/commands';
import { createdIds } from '../engine/commands/patch';
import {
  clipEnd,
  clipsAt,
  clipsOnTrack,
  createClip,
  createProject,
  getTrack,
  sourceRangesToTimeline,
  trackKindForAsset,
  isPlaceable,
  projectDuration,
} from '../engine/timeline/operations';
import type { Range } from '../engine/timeline/operations';
import { TranscriptEngine } from '../engine/transcript/TranscriptEngine';
import { CUT_KIND_LABEL, suggestCuts, summarize } from '../engine/analysis/cuts';
import type { CutKind, CutLevel } from '../engine/analysis/cuts';
import { timelineWords, toSRT } from '../engine/captions/captions';
import { analysisStore } from './analysis';
import { media } from '../engine/media/MediaEngine';
import type { ImportItem } from '../engine/media/MediaEngine';
import { PlaybackEngine } from '../engine/playback/PlaybackEngine';
import { ProjectFile } from '../engine/project/ProjectEngine';
import type { RecentProject } from '../engine/project/ProjectEngine';
import { MEDIA_TYPES, downloadBlob, fsAccessSupported, isAbort, pickFiles, pickSaveFile, pickWithInput, writeTextFile } from '../engine/platform/fs';
import { notify } from './notify';
import { viewStore } from './view';

export const store = new EditorStore();
export const playback = new PlaybackEngine(store, media);
export const projectFile = new ProjectFile();
export const transcripts = new TranscriptEngine(media);
export { media };

/** Nome da trilha criada para as legendas geradas. */
export const CAPTION_TRACK_NAME = 'Legendas';

const project = () => store.getState().project;

function handleError(e: unknown, context: string) {
  if (isAbort(e)) return;
  console.error(context, e);
  notify(`${context}: ${e instanceof Error ? e.message : String(e)}`, 'error');
}

/** Clipes selecionados que estão em trilhas destravadas. */
function editableSelection(): string[] {
  const p = project();
  return store.getState().selection.filter((id) => {
    const c = p.clips[id];
    return c && !getTrack(p, c.trackId)?.locked;
  });
}

export const actions = {
  // --- mídia ----------------------------------------------------------------

  async importMedia() {
    try {
      let items: ImportItem[];
      if (fsAccessSupported) {
        const handles = await pickFiles(MEDIA_TYPES, true, 'foco-media');
        items = await Promise.all(handles.map(async (handle) => ({ handle, file: await handle.getFile() })));
      } else {
        items = (await pickWithInput('video/*,audio/*,image/*', true)).map((file) => ({ file }));
      }
      await actions.importItems(items);
    } catch (e) {
      handleError(e, 'Falha ao importar');
    }
  },

  /** Chamar de forma síncrona dentro do evento drop (os handles precisam ser pedidos antes de qualquer await). */
  importDataTransfer(dt: DataTransfer) {
    const entries = Array.from(dt.items)
      .filter((i) => i.kind === 'file')
      .map((i) => {
        const withHandle = i as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };
        return { file: i.getAsFile(), handle: withHandle.getAsFileSystemHandle?.() ?? Promise.resolve(null) };
      });
    void (async () => {
      const items: ImportItem[] = [];
      for (const e of entries) {
        if (!e.file) continue;
        const h = await e.handle.catch(() => null);
        items.push({ file: e.file, handle: h && h.kind === 'file' ? (h as FileSystemFileHandle) : undefined });
      }
      await actions.importItems(items);
    })();
  },

  async importItems(items: ImportItem[]) {
    if (items.length === 0) return;
    // Importar estando na tela de Projetos abre o editor com a mídia.
    viewStore.set('project');
    const { assets, errors, skipped } = await media.importFiles(items);
    if (assets.length) {
      store.execute(Cmd.importAssets(assets));
      notify(`${assets.length} arquivo(s) importado(s).`, 'success');
    }
    if (skipped.length) notify(`${skipped.length} arquivo(s) já estavam no projeto — usando a mídia existente.`);
    for (const err of errors) notify(`"${err.name}": ${err.message}`, 'error');
    for (const a of assets) void suggestProxy(a);
  },

  // --- proxies ----------------------------------------------------------------

  createProxy(assetId: string, res: ProxyResolution | 'auto') {
    media.createProxy(assetId, res).catch((e) => handleError(e, 'Falha ao criar proxy'));
  },

  cancelProxy(assetId: string) {
    media.cancelProxy(assetId);
  },

  async deleteProxy(assetId: string) {
    await media.deleteProxy(assetId);
    notify('Proxy apagado. O preview usa o arquivo original.');
  },

  /** Localiza o arquivo de UMA mídia offline (relink), conferindo se é o mesmo conteúdo. */
  async locateMedia(assetId: string) {
    const asset = project().assets[assetId];
    if (!asset) return;
    try {
      let item: ImportItem | undefined;
      if (fsAccessSupported) {
        const [handle] = await pickFiles(MEDIA_TYPES, false, 'foco-media');
        item = handle ? { handle, file: await handle.getFile() } : undefined;
      } else {
        const [file] = await pickWithInput('video/*,audio/*,image/*', false);
        item = file ? { file } : undefined;
      }
      if (!item) return;
      const v = await media.verifyReplacement(asset, item.file);
      if (v.match !== 'same') {
        const choice = await ask('Arquivo diferente', `${v.detail}\n\nUsar este arquivo para "${asset.name}" mesmo assim?`, [
          { id: 'use', label: 'Usar mesmo assim', primary: v.match === 'compatible' },
          { id: 'cancel', label: 'Cancelar' },
        ]);
        if (choice !== 'use') return;
        if (v.fresh) store.execute(Cmd.updateAsset({ ...v.fresh, id: asset.id, name: asset.name, folderId: asset.folderId }, 'Relink de mídia'));
      }
      await media.linkFile(project().assets[assetId], item.file, item.handle);
      notify(`"${asset.name}" reconectada.`, 'success');
    } catch (e) {
      handleError(e, 'Falha ao localizar mídia');
    }
  },

  /** Arquivo alterado fora do editor: reanalisa e atualiza (só quando o usuário pede). */
  async reloadChangedMedia(assetId: string) {
    try {
      const fresh = await media.reanalyze(assetId);
      if (fresh) {
        store.execute(Cmd.updateAsset(fresh, 'Recarregar mídia alterada'));
        notify(`"${fresh.name}" recarregada (${fresh.duration.toFixed(1)} s).`, 'success');
      }
    } catch (e) {
      handleError(e, 'Falha ao recarregar a mídia');
    }
  },

  removeAsset(assetId: string) {
    const p = project();
    const used = Object.values(p.clips).filter((c) => c.assetId === assetId).length;
    if (used && !confirm(`Esta mídia está em ${used} clipe(s) na timeline. Remover mídia e clipes?`)) return;
    store.execute(Cmd.removeAsset(assetId));
  },

  /** Remove várias mídias (e seus clipes) como um passo de histórico. */
  removeAssets(ids: string[]) {
    const p = project();
    const used = Object.values(p.clips).filter((c) => ids.includes(c.assetId)).length;
    if (!ids.length) return;
    if (used && !confirm(`As mídias selecionadas estão em ${used} clipe(s) na timeline. Remover mídias e clipes?`)) return;
    store.execute(ids.length === 1 ? Cmd.removeAsset(ids[0]) : Cmd.batch(`Remover ${ids.length} mídias`, ids.map((id) => Cmd.removeAsset(id))));
  },

  renameAsset(id: string, name: string) {
    const clean = name.trim();
    if (clean && clean !== project().assets[id]?.name) store.execute(Cmd.renameAsset(id, clean));
  },

  newFolder(parentId: string | null, name = 'Nova pasta') {
    const id = `f${crypto.randomUUID().slice(0, 8)}`;
    store.execute(Cmd.addFolder({ id, name, parentId }));
    return id;
  },

  renameFolder(id: string, name: string) {
    const clean = name.trim();
    if (clean && clean !== project().folders[id]?.name) store.execute(Cmd.renameFolder(id, clean));
  },

  removeFolder(id: string) {
    store.execute(Cmd.removeFolder(id));
  },

  moveAssets(ids: string[], folderId: string | null) {
    if (ids.length) store.execute(Cmd.moveAssets(ids, folderId));
  },

  async reconnectMedia() {
    await media.reconnect(Object.values(project().assets));
  },

  async relinkMedia() {
    try {
      let items: ImportItem[];
      if (fsAccessSupported) {
        const handles = await pickFiles(MEDIA_TYPES, true, 'foco-media');
        items = await Promise.all(handles.map(async (handle) => ({ handle, file: await handle.getFile() })));
      } else {
        items = (await pickWithInput('video/*,audio/*,image/*', true)).map((file) => ({ file }));
      }
      const n = await media.relink(Object.values(project().assets), items);
      notify(n ? `${n} mídia(s) reconectada(s).` : 'Nenhum arquivo correspondeu às mídias offline (conteúdo, nome e tamanho diferentes). Use "Localizar" na mídia para escolher manualmente.', n ? 'success' : 'error');
    } catch (e) {
      handleError(e, 'Falha ao localizar mídia');
    }
  },

  /** Coloca a mídia na timeline. Sem trilha/tempo: no fim da primeira trilha compatível. */
  addAssetToTimeline(assetId: string, trackId?: string, start?: number) {
    const p = project();
    const asset = p.assets[assetId];
    if (!asset) return;
    if (!isPlaceable(asset)) {
      notify(`"${asset.name}" é uma fonte: use-a em títulos e legendas (não vai para a timeline).`);
      return;
    }
    const kind = trackKindForAsset(asset);
    let track = trackId ? getTrack(p, trackId) : undefined;
    if (!track || track.kind !== kind || track.locked) {
      const candidates = p.tracks.filter((t) => t.kind === kind && !t.locked);
      track = kind === 'video' ? candidates.at(-1) : candidates[0];
    }
    if (!track) {
      notify('Nenhuma trilha compatível destravada.', 'error');
      return;
    }
    const at = start ?? Math.max(0, ...clipsOnTrack(p, track.id).map(clipEnd));
    const clip = createClip(asset, track.id, snapToFrame(at, p.settings.fps));
    media.prioritize(asset.id);
    store.execute(Cmd.addClip(clip), [clip.id]);
  },

  // --- edição ---------------------------------------------------------------

  split() {
    const p = project();
    const t = snapToFrame(playback.time, p.settings.fps);
    const under = clipsAt(p, t).map((c) => c.id);
    const selected = editableSelection().filter((id) => under.includes(id));
    const ids = selected.length ? selected : under;
    if (!ids.length) return;
    store.execute(Cmd.splitClips(ids, t));
  },

  deleteSelection(ripple: boolean) {
    const ids = editableSelection();
    if (!ids.length) return;
    store.execute(Cmd.deleteClips(ids, ripple), []);
  },

  copy() {
    store.copy(store.getState().selection);
  },

  cut() {
    store.copy(editableSelection());
    actions.deleteSelection(false);
  },

  paste() {
    const src = store.clipboardContents;
    if (!src.length) return;
    const p = project();
    const at = snapToFrame(playback.time, p.settings.fps);
    store.execute(Cmd.pasteClips(src, at), (patch) => createdIds(patch, 'clips'));
  },

  duplicate() {
    const p = project();
    const sel = editableSelection().map((id) => p.clips[id]);
    if (!sel.length) return;
    const at = Math.max(...sel.map(clipEnd));
    store.execute(Cmd.pasteClips(sel, at, 'Duplicar'), (patch) => createdIds(patch, 'clips'));
  },

  addMarker() {
    const t = snapToFrame(playback.time, project().settings.fps);
    const n = project().markers.length + 1;
    store.execute(Cmd.addMarker({ id: `m${crypto.randomUUID().slice(0, 8)}`, time: t, label: `Marcador ${n}`, color: '#ffb020' }));
  },

  jumpMarker(dir: 1 | -1) {
    const t = playback.time;
    const ms = project().markers.map((m) => m.time);
    const target = dir > 0 ? ms.filter((x) => x > t + 1e-3).sort((a, b) => a - b)[0] : ms.filter((x) => x < t - 1e-3).sort((a, b) => b - a)[0];
    if (target !== undefined) playback.seek(target);
  },

  selectAll() {
    store.select(Object.keys(project().clips));
  },

  // --- projeto --------------------------------------------------------------

  confirmDiscard(): boolean {
    const s = store.getState();
    if (!s.dirty || Object.keys(s.project.clips).length === 0) return true;
    return confirm('Há alterações não salvas em arquivo. Continuar mesmo assim? (o autosave guarda só o projeto atual)');
  },

  async load(p: Project, fromFile: Transcript[] = []) {
    viewStore.set('project');
    playback.pause();
    media.releaseAll();
    store.load(p);
    playback.seek(0);
    analysisStore.set({ assetId: null, suggestions: [], selected: new Set(), lastEdit: null });
    await media.restore(Object.values(p.assets));
    await transcripts.hydrate(Object.values(p.assets), fromFile);
    await projectFile.autosave(p);
  },

  async newProject() {
    if (!actions.confirmDiscard()) return;
    projectFile.handle = null;
    await actions.load(createProject());
  },

  async openProject() {
    if (!actions.confirmDiscard()) return;
    try {
      const loaded = await projectFile.open();
      if (loaded) await actions.load(loaded.project, loaded.transcripts);
    } catch (e) {
      handleError(e, 'Falha ao abrir projeto');
    }
  },

  async openRecent(r: RecentProject) {
    if (!actions.confirmDiscard()) return;
    try {
      const loaded = await projectFile.openHandle(r.handle);
      await actions.load(loaded.project, loaded.transcripts);
    } catch (e) {
      handleError(e, `Não foi possível abrir "${r.fileName}"`);
      await projectFile.forgetRecent(r.id);
    }
  },

  async save(as = false) {
    try {
      const p = project();
      const ts = transcripts.all();
      const ok = as ? await projectFile.saveAs(p, ts) : await projectFile.save(p, ts);
      if (ok) {
        store.markSaved();
        void projectFile.backup(p, 'manual');
        void projectFile.autosave(p, false);
        notify(`Projeto salvo${projectFile.fileName ? ` em ${projectFile.fileName}` : ''}.`, 'success');
      }
    } catch (e) {
      handleError(e, 'Falha ao salvar');
    }
  },

  rename(name: string) {
    const clean = name.trim();
    if (!clean || clean === project().name) return;
    store.execute(Cmd.renameProject(clean));
  },

  setSequenceSize(width: number, height: number) {
    store.execute(Cmd.setSequence({ width, height }, 'Formato da sequência'));
  },

  setSequenceFps(fps: number) {
    store.execute(Cmd.setSequence({ fps }, 'FPS da sequência'));
  },

  // --- inteligência ---------------------------------------------------------

  async transcribe(assetId: string, model: string, language: string) {
    const asset = project().assets[assetId];
    if (!asset) return;
    try {
      const job = jobs.add({ type: 'transcribe', label: `Transcrição · ${asset.name}`, assetId, priority: 'medium' }, async (ctx) => {
        const unsub = transcripts.subscribe(() => {
          const j = transcripts.job(assetId);
          if (j?.phase === 'loading-model' && j.total) ctx.progress(0.05 * (j.loaded / j.total), 'baixando modelo');
          if (j?.phase === 'transcribing') ctx.progress(0.05 + 0.95 * (j.done / Math.max(1, j.total)), `trecho ${j.done + 1}/${j.total}`);
        });
        ctx.signal.addEventListener('abort', () => transcripts.cancel(assetId));
        try {
          return await transcripts.transcribe(asset, { model, language });
        } finally {
          unsub();
        }
      });
      const t = await job.done.catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return null;
        throw e;
      });
      if (t) notify(`Transcrição pronta: ${t.words.length} palavras de "${asset.name}".`, 'success');
    } catch (e) {
      handleError(e, 'Falha na transcrição');
    }
  },

  /** Analisa a mídia e lista sugestões de corte para revisão (nada é aplicado ainda). */
  async analyzeCuts(assetId: string, level: CutLevel) {
    const asset = project().assets[assetId];
    if (!asset?.hasAudio) return;
    const levels = media.get(assetId)?.levels ?? (await media.whenLevels(assetId));
    const t = transcripts.get(assetId);
    if (!levels && !t) {
      notify('O áudio ainda está sendo analisado. Tente de novo em instantes.', 'error');
      return;
    }
    const suggestions = suggestCuts({ levels, duration: asset.duration, words: t?.words ?? null, level });
    analysisStore.set({
      assetId,
      level,
      suggestions,
      selected: new Set(suggestions.map((x) => x.id)),
      usedTranscript: !!t,
    });
    if (!suggestions.length) notify('Nenhum corte sugerido neste nível.');
  },

  /** Aplica as sugestões marcadas como um único passo de undo e mostra o resumo. */
  applyCuts() {
    const a = analysisStore.get();
    if (!a.assetId) return;
    const chosen = a.suggestions.filter((x) => a.selected.has(x.id));
    if (!chosen.length) return;
    const p = project();
    const ranges: Range[] = sourceRangesToTimeline(p, a.assetId, chosen.map((x) => [x.start, x.end] as Range));
    if (!ranges.length) {
      notify('Os trechos sugeridos não estão na timeline (a mídia não foi usada ou já foi cortada).', 'error');
      return;
    }
    const removed = ranges.reduce((acc, [x, y]) => acc + (y - x), 0);
    store.execute(Cmd.rippleRemove(ranges, `Cortes automáticos (${chosen.length})`), []);
    const { counts } = summarize(chosen);
    analysisStore.set({
      suggestions: a.suggestions.filter((x) => !a.selected.has(x.id)),
      selected: new Set(),
      lastEdit: { counts, seconds: removed, cuts: ranges.length, at: Date.now() },
    });
    const parts = (Object.entries(counts) as [CutKind, number][]).map(([k, n]) => `${n}× ${CUT_KIND_LABEL[k].toLowerCase()}`);
    notify(`Removi ${parts.join(', ')} — ${removed.toFixed(1)} s a menos. Ctrl+Z desfaz tudo.`, 'success', 6000);
  },

  /** Gera legendas palavra-por-palavra para todos os clipes da mídia na timeline. */
  generateCaptions(assetId: string, presetId: string) {
    const t = transcripts.get(assetId);
    if (!t) return;
    const p = project();
    const words = timelineWords(p, assetId, t.words);
    if (!words.length) {
      notify('Nenhuma palavra transcrita está na timeline. Coloque a mídia na timeline primeiro.', 'error');
      return;
    }
    const existing = p.tracks.find((tr) => tr.kind === 'video' && tr.name === CAPTION_TRACK_NAME);
    const old = existing ? Object.values(p.clips).filter((c) => c.trackId === existing.id && c.caption) : [];
    if (old.length && !confirm(`Substituir as ${old.length} legendas existentes na trilha "${CAPTION_TRACK_NAME}"?`)) return;
    const patch = store.execute(Cmd.generateCaptions(words, presetId));
    const count = patch ? createdIds(patch, 'clips').length : 0;
    notify(`Criei ${count} legendas (${words.length} palavras).`, 'success');
  },

  /** Aplica um estilo a todas as legendas da timeline. */
  styleAllCaptions(style: CaptionStyle) {
    const caps = Object.values(project().clips).filter((c) => c.caption);
    store.execute(Cmd.batch('Estilo das legendas', caps.map((c) => Cmd.setCaption(c.id, { ...c.caption!, style: { ...style } }))));
  },

  async exportSRT() {
    const p = project();
    const srt = toSRT(p);
    if (!srt) {
      notify('Não há legendas na timeline.', 'error');
      return;
    }
    try {
      if (fsAccessSupported) {
        const h = await pickSaveFile(`${p.name}.srt`, [{ description: 'Legendas SRT', accept: { 'text/plain': ['.srt'] } }], 'foco-srt');
        await writeTextFile(h, srt);
        notify(`Legendas exportadas em ${h.name}.`, 'success');
      } else {
        downloadBlob(new Blob([srt], { type: 'text/plain' }), `${p.name}.srt`);
      }
    } catch (e) {
      handleError(e, 'Falha ao exportar SRT');
    }
  },
};

// --- autosave + restauração ---------------------------------------------------


/** Liga o Media Engine e o cache ao projeto e às preferências. */
function wireMedia() {
  playback.config = { quality: () => prefsStore.get().previewQuality };
  prefsStore.subscribe(() => playback.invalidate());
  media.config = {
    useProxies: () => prefsStore.get().useProxies,
    mode: effectiveMode,
    inUse: (assetId) => Object.values(project().clips).some((c) => c.assetId === assetId),
    findByHash: (hash) => Object.values(project().assets).find((a) => a.hash === hash) ?? null,
    onDuplicate: async (file, existing) =>
      (await ask('Arquivo já está no projeto', `"${file.name}" tem o mesmo conteúdo de "${existing.name}", que já está no projeto.`, [
        { id: 'existing', label: 'Usar o existente', primary: true },
        { id: 'import', label: 'Importar mesmo assim' },
        { id: 'cancel', label: 'Cancelar' },
      ])) as DuplicateChoice,
  };
  let protectedIds = new Set<string>();
  media.subscribe(() => void media.protectedCacheIds().then((ids) => (protectedIds = ids)));
  cache.protect = () => protectedIds;
}

/** Arquivo pesado: sugere (ou cria) proxy conforme a preferência. */
async function suggestProxy(a: Asset) {
  const why = recommendProxy(a, effectiveMode());
  const pref = prefsStore.get().autoProxy;
  if (!why || pref === 'never') return;
  if (pref === 'always') {
    actions.createProxy(a.id, 'auto');
    return;
  }
  const choice = await ask(
    'Criar proxy?',
    `"${a.name}" é pesado para edição em tempo real (${why}). Um proxy é uma cópia leve usada só no preview e na edição; o export continua usando o original.`,
    [
      { id: 'auto', label: 'Automático', primary: true },
      { id: '720p', label: '720p' },
      { id: '1080p', label: '1080p' },
      { id: 'no', label: 'Agora não' },
    ],
  );
  if (choice !== 'no') actions.createProxy(a.id, choice as ProxyResolution | 'auto');
}

let autosaveTimer = 0;
let lastRevision = -1;
let lastSavedRevision = -1;
let lastBackupRevision = -1;

function saveNow() {
  const s = store.getState();
  lastSavedRevision = s.revision;
  void projectFile.autosave(s.project, s.dirty);
  // Catálogo da tela Projetos: cada projeto com mídia fica guardado para reabrir depois.
  void projectFile.catalogSave(s.project, transcripts.all(), projectDuration(s.project));
}

/** Autosave: logo após cada edição (intervalo 0) ou a cada N segundos. Backup automático a cada 10 min. */
function startAutosave() {
  lastRevision = store.getState().revision;
  lastSavedRevision = lastRevision;
  lastBackupRevision = lastRevision;
  store.subscribe(() => {
    const s = store.getState();
    if (s.revision === lastRevision) return;
    lastRevision = s.revision;
    if (prefsStore.get().autosaveInterval === 0) {
      clearTimeout(autosaveTimer);
      autosaveTimer = window.setTimeout(saveNow, 1200);
    }
  });
  window.setInterval(() => {
    const iv = prefsStore.get().autosaveInterval;
    const s = store.getState();
    if (iv > 0 && s.revision !== lastSavedRevision && Date.now() - lastAutosaveAt >= iv * 1000) {
      lastAutosaveAt = Date.now();
      saveNow();
    }
  }, 1000);
  window.setInterval(() => {
    const s = store.getState();
    if (s.revision !== lastBackupRevision && Object.keys(s.project.clips).length) {
      lastBackupRevision = s.revision;
      void projectFile.backup(s.project, 'auto');
    }
  }, 10 * 60 * 1000);
  // Salva o último estado ao fechar/esconder a aba.
  window.addEventListener('pagehide', () => {
    if (store.getState().revision !== lastSavedRevision) saveNow();
  });
}
let lastAutosaveAt = 0;

/** Ao voltar para a janela: avisa se algum arquivo sumiu ou foi alterado fora do editor. */
function watchFiles() {
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const { missing, changed } = await media.checkForChanges();
      for (const a of missing) notify(`"${a.name}": o arquivo original não foi encontrado (movido ou apagado). Use "Localizar".`, 'error', 10000);
      for (const a of changed) notify(`"${a.name}" foi alterado fora do editor. Use "Recarregar" no Media Bin para atualizar.`, 'error', 10000);
    } finally {
      checking = false;
    }
  };
  window.addEventListener('focus', () => void check());
}

export async function bootEditor() {
  wireMedia();
  const hw = await detectHardware().catch(() => null);
  if (hw) prefsStore.set({ resolvedMode: hw.score >= 70 ? 'quality' : hw.score >= 45 ? 'balanced' : 'performance' });
  startAutosave();
  watchFiles();
}

/**
 * Recuperação (depois que a interface está montada). Se o último autosave tinha alterações
 * não salvas em arquivo — fechamento inesperado ou aba fechada sem salvar — pergunta.
 */
export async function recoverSession() {
  // A recuperação é assíncrona (IndexedDB + diálogo). Se nesse meio-tempo o usuário já
  // criou/abriu outro projeto ou começou a editar, não sobrescrevemos o trabalho dele.
  const rev0 = store.getState().revision;
  const untouched = () => store.getState().revision === rev0;
  const rec = await projectFile.loadAutosave();
  if (!rec?.project || !untouched()) return;
  const hasContent = Object.keys(rec.project.clips).length + Object.keys(rec.project.assets).length > 0;
  if (!hasContent) return;
  let restore = true;
  if (rec.dirty) {
    const when = new Date(rec.savedAt).toLocaleString('pt-BR');
    const choice = await ask(
      'Versão de recuperação disponível',
      `Existe uma versão de recuperação de "${rec.project.name}" (salva automaticamente em ${when}) com alterações que não foram salvas no arquivo do projeto.`,
      [
        { id: 'restore', label: 'Restaurar', primary: true },
        { id: 'discard', label: 'Descartar' },
      ],
    );
    restore = choice === 'restore';
    if (!untouched()) return;
    if (!restore) {
      await projectFile.backup(rec.project, 'before-restore');
      await projectFile.discardAutosave();
      return;
    }
  }
  try {
    store.load(rec.project, { dirty: !!rec.dirty });
    await media.restore(Object.values(rec.project.assets));
    await transcripts.hydrate(Object.values(rec.project.assets));
    lastRevision = lastSavedRevision = lastBackupRevision = store.getState().revision;
    // Projeto de antes do catálogo existir: entra na lista de Projetos.
    void projectFile.catalogSave(rec.project, transcripts.all(), projectDuration(rec.project));
    // Havia trabalho não salvo e a pessoa escolheu restaurar: abre direto nele.
    if (rec.dirty) viewStore.set('project');
  } catch (e) {
    console.warn('autosave inválido', e);
    store.load(createProject());
  }
}

/** Restaura uma versão do histórico (a atual vira backup antes). */
export async function restoreVersion(id: string) {
  const cur = store.getState().project;
  const p = await projectFile.restoreBackup(id);
  if (!p) return;
  await projectFile.backup(cur, 'before-restore');
  store.load(p, { dirty: true });
  await media.restore(Object.values(p.assets));
  await transcripts.hydrate(Object.values(p.assets));
  notify('Versão restaurada. A versão anterior foi guardada no histórico.', 'success');
}
